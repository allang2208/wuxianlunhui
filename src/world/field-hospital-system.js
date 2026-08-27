import populationEconomyConfig from '../../data/population-economy.json';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { Game } from '../game.js';
import { PartySystem } from '../systems/party-system.js';
import { queryNearbyEntities } from '../ai/friendly-spatial-query.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

function moduleValue(building, moduleId) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return 0;
    const level = clamp(
        Math.floor(Number(building?.modules?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
    );
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function distanceSquared(source, target) {
    const dx = (Number(target?.x) || 0) - (Number(source?.x) || 0);
    const dy = (Number(target?.y) || 0) - (Number(source?.y) || 0);
    return dx * dx + dy * dy;
}

function healthSnapshot(target) {
    const dataHp = Number(target?.data?.hp);
    const dataMaxHp = Number(target?.data?.maxHp);
    const hp = Number.isFinite(dataHp) ? dataHp : Number(target?.hp);
    const maxHp = Number.isFinite(dataMaxHp) ? dataMaxHp : Number(target?.maxHp);
    if (!(hp > 0) || !(maxHp > hp)) return null;
    return { hp, maxHp };
}

function applyHealing(target, amount) {
    const health = healthSnapshot(target);
    if (!health || !(amount > 0)) return 0;
    const next = Math.min(health.maxHp, health.hp + amount);
    if (target?.data && Number.isFinite(Number(target.data.hp))) target.data.hp = next;
    else target.hp = next;
    return next - health.hp;
}

/**
 * 战地医院本栋升级、医护岗位与范围治疗的前台真源。
 * 每名医护发挥固定配置比例；同时接诊人数受病床和上岗人数双重限制。
 */
export const FieldHospitalSystem = {
    _hospitals: new Set(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'field_hospital') return;
        building.modules = { ...(saved.hospitalModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._hospitalUpgrade = saved.hospitalUpgrade ? {
            moduleId: saved.hospitalUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.hospitalUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.hospitalUpgrade.remainMs) || 0),
        } : null;
        building._hospitalTreatmentElapsedMs = Math.max(0,
            Number(saved.hospitalTreatmentElapsedMs) || 0);
        building._hospitalPatientCount = 0;
        this._hospitals.add(building);
    },

    reset() {
        this._hospitals.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._hospitals.delete(building);
        if (building) {
            building._economyWorking = false;
            building._hospitalPatientCount = 0;
        }
        if (this._rangeBuilding === building) this.hideRange();
    },

    getModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getModuleLevel(building, moduleId)
        );
    },

    startUpgrade(building, moduleId) {
        if (building?._economyType !== 'field_hospital') {
            return { ok: false, reason: '该建筑不是战地医院' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._hospitalUpgrade) return { ok: false, reason: '已有医院项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._hospitalUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getRange(building) {
        return Math.max(0, moduleValue(building, 'hospital_rounds'));
    },

    getConfiguredHealingRate(building) {
        return Math.max(0, moduleValue(building, 'hospital_medicine'));
    },

    getConfiguredPatientCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'hospital_triage')));
    },

    getStaffCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'hospital_staff')));
    },

    getStaffedCount(building) {
        return Math.min(
            this.getStaffCapacity(building),
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
    },

    getStaffFactor(building) {
        const share = Math.max(0,
            Number(populationEconomyConfig.field_hospital?.workerEfficiencyShare) || 0.2);
        return clamp(this.getStaffedCount(building) * share, 0, 1);
    },

    getPatientCapacity(building) {
        return Math.min(this.getConfiguredPatientCapacity(building), this.getStaffedCount(building));
    },

    getActualHealingRate(building) {
        return this.getConfiguredHealingRate(building)
            * this.getStaffFactor(building)
            * PopulationEconomySystem.getLaborEfficiency()
            * WorkshopEconomySystem.getEfficiencyMultiplier(building);
    },

    /**
     * 同一患者同时落入多家医院范围时只采用实际治疗率最高的一家。
     * 治疗率相同则优先病床更多者，最后按稳定建筑 ID 仲裁，禁止叠加回血。
     */
    getBestHospitalForTarget(target) {
        let best = null;
        let bestRate = 0;
        let bestCapacity = 0;
        for (const hospital of this._hospitals) {
            if (!hospital?.active || hospital.hp <= 0 || hospital._sinking) continue;
            const range = this.getRange(hospital);
            if (!(range > 0) || distanceSquared(hospital, target) > range * range) continue;
            const capacity = this.getPatientCapacity(hospital);
            const rate = this.getActualHealingRate(hospital);
            if (!(capacity > 0) || !(rate > 0)) continue;
            const better = rate > bestRate
                || (rate === bestRate && capacity > bestCapacity)
                || (rate === bestRate && capacity === bestCapacity
                    && String(hospital.id || '') < String(best?.id || ''));
            if (!better) continue;
            best = hospital;
            bestRate = rate;
            bestCapacity = capacity;
        }
        return best;
    },

    _patientCandidates(building) {
        const range = this.getRange(building);
        if (!(range > 0)) return [];
        const rangeSquared = range * range;
        const candidates = new Set();
        if (Game?.player) candidates.add(Game.player);
        for (const unit of Game?.friendlyUnits || []) candidates.add(unit);
        for (const member of PartySystem?.members || []) candidates.add(member);
        const nearby = queryNearbyEntities(Game?.entities, building, range);
        for (const entity of nearby || []) candidates.add(entity);
        return [...candidates]
            .filter((target) => target && target !== building && target.active !== false
                && FRIENDLY_FACTIONS.has(target._faction)
                && distanceSquared(building, target) <= rangeSquared
                && this.getBestHospitalForTarget(target) === building
                && healthSnapshot(target))
            .sort((left, right) => {
                const a = healthSnapshot(left);
                const b = healthSnapshot(right);
                const ratioDiff = a.hp / a.maxHp - b.hp / b.maxHp;
                return ratioDiff || distanceSquared(building, left) - distanceSquared(building, right);
            });
    },

    getSnapshot(building) {
        const configuredHealingRate = this.getConfiguredHealingRate(building);
        const actualHealingRate = this.getActualHealingRate(building);
        const configuredPatientCapacity = this.getConfiguredPatientCapacity(building);
        const patientCapacity = this.getPatientCapacity(building);
        return {
            range: this.getRange(building),
            configuredHealingRate,
            actualHealingRate,
            configuredPatientCapacity,
            patientCapacity,
            staffCapacity: this.getStaffCapacity(building),
            staffedCount: this.getStaffedCount(building),
            staffFactor: this.getStaffFactor(building),
            laborEfficiency: PopulationEconomySystem.getLaborEfficiency(),
            workshopMultiplier: WorkshopEconomySystem.getEfficiencyMultiplier(building),
            patientCount: Math.max(0, Math.floor(Number(building?._hospitalPatientCount) || 0)),
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._hospitalUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._hospitalUpgrade = null;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'field_hospital' || !building.active) return;
        const elapsed = Math.max(0, Number(dt) || 0);
        this._updateUpgrade(building, elapsed);
        const snapshot = this.getSnapshot(building);
        if (!(snapshot.actualHealingRate > 0) || snapshot.patientCapacity <= 0) {
            building._hospitalTreatmentElapsedMs = 0;
            building._hospitalPatientCount = 0;
            building._economyWorking = false;
            return;
        }
        const intervalMs = Math.max(100,
            Number(populationEconomyConfig.field_hospital?.treatmentIntervalMs) || 500);
        building._hospitalTreatmentElapsedMs += elapsed;
        if (building._hospitalTreatmentElapsedMs < intervalMs) return;
        const cycles = Math.floor(building._hospitalTreatmentElapsedMs / intervalMs);
        building._hospitalTreatmentElapsedMs -= cycles * intervalMs;
        const patients = this._patientCandidates(building).slice(0, snapshot.patientCapacity);
        const seconds = cycles * intervalMs / 1000;
        let healed = 0;
        for (const patient of patients) {
            const health = healthSnapshot(patient);
            healed += applyHealing(patient,
                health.maxHp * snapshot.actualHealingRate * seconds);
        }
        building._hospitalPatientCount = patients.length;
        building._economyWorking = healed > 0;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    showRange(building) {
        if (building?._economyType !== 'field_hospital') return;
        this._rangeBuilding = building;
        this._drawRange(building);
    },

    hideRange() {
        if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
        this._rangeGraphics = null;
        this._rangeBuilding = null;
    },

    _drawRange(building) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene?.add?.graphics || !building?.active) return;
        if (!this._rangeGraphics?.active || this._rangeGraphics.scene !== scene) {
            if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
            this._rangeGraphics = scene.add.graphics();
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._rangeGraphics);
        }
        const range = this.getRange(building);
        const graphics = this._rangeGraphics;
        graphics.clear();
        graphics.setPosition(building.x, building.y);
        graphics.setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        graphics.fillStyle(0x4ea98c, 0.09);
        graphics.lineStyle(3, 0x7fe0c8, 0.82);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};
