import populationEconomyConfig from '../../data/population-economy.json';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { Game } from '../game.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { routeArmoryEnhancementStones } from './armory-reward-routing.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

function isWithin(source, target, range) {
    const dx = (Number(target?.x) || 0) - (Number(source?.x) || 0);
    const dy = (Number(target?.y) || 0) - (Number(source?.y) || 0);
    return dx * dx + dy * dy <= range * range;
}

/**
 * 军械库本栋升级、维护师效率、出兵减耗光环和强化石整理的前台真源。
 * 多栋军械库只取最强减耗，不叠加；岗位数值由本系统保存，Sprite 由独立视觉系统镜像。
 */
export const ArmoryEconomySystem = {
    _armories: new Set(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'armory') return;
        building.modules = { ...(saved.armoryModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._armoryUpgrade = saved.armoryUpgrade ? {
            moduleId: saved.armoryUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.armoryUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.armoryUpgrade.remainMs) || 0),
        } : null;
        building._armorySortElapsedMs = Math.max(0, Number(saved.armorySortElapsedMs) || 0);
        building._armoryPendingStones = Math.max(0,
            Math.floor(Number(saved.armoryPendingStones) || 0));
        this._armories.add(building);
        this._flushPendingStones(building);
    },

    reset() {
        this._armories.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._armories.delete(building);
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
        if (building?._economyType !== 'armory') {
            return { ok: false, reason: '该建筑不是军械库' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._armoryUpgrade) return { ok: false, reason: '已有军械库项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._armoryUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getRange(building) {
        return Math.max(0, moduleValue(building, 'armory_service_range'));
    },

    getConfiguredCostReduction(building) {
        return clamp(moduleValue(building, 'armory_equipment_care'), 0, 0.95);
    },

    getConfiguredStoneChance(building) {
        return clamp(moduleValue(building, 'armory_resource_sorting'), 0, 1);
    },

    getStaffCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'armory_staff')));
    },

    getStaffedCount(building) {
        return Math.min(
            this.getStaffCapacity(building),
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
    },

    getStaffFactor(building) {
        const share = Math.max(0,
            Number(populationEconomyConfig.armory?.staffEfficiencyShare) || 0.2);
        return clamp(this.getStaffedCount(building) * share, 0, 1);
    },

    getActualCostReduction(building) {
        return this.getConfiguredCostReduction(building) * this.getStaffFactor(building);
    },

    getActualStoneChance(building) {
        return this.getConfiguredStoneChance(building) * this.getStaffFactor(building);
    },

    getResourceCostMultiplier(target) {
        if (!target?.active || !target._isTroopProducer) return 1;
        let strongest = 0;
        for (const armory of this._armories) {
            if (!armory?.active || armory.hp <= 0 || armory._sinking) continue;
            if (!isWithin(armory, target, this.getRange(armory))) continue;
            strongest = Math.max(strongest, this.getActualCostReduction(armory));
        }
        return clamp(1 - strongest, 0.05, 1);
    },

    getCoveredProducerCount(building) {
        const buildings = Game?.ProducerBuildingSystem?.buildings;
        if (!Array.isArray(buildings)) return 0;
        const range = this.getRange(building);
        return buildings.filter((target) => target?.active && target._isTroopProducer
            && isWithin(building, target, range)).length;
    },

    getSnapshot(building) {
        return {
            range: this.getRange(building),
            configuredCostReduction: this.getConfiguredCostReduction(building),
            actualCostReduction: this.getActualCostReduction(building),
            configuredStoneChance: this.getConfiguredStoneChance(building),
            actualStoneChance: this.getActualStoneChance(building),
            staffCapacity: this.getStaffCapacity(building),
            staffedCount: this.getStaffedCount(building),
            staffFactor: this.getStaffFactor(building),
            coveredProducerCount: this.getCoveredProducerCount(building),
            sortIntervalMs: Math.max(1000,
                Number(populationEconomyConfig.armory?.resourceSortIntervalMs) || 60000),
            sortElapsedMs: Math.max(0, Number(building?._armorySortElapsedMs) || 0),
            pendingStones: Math.max(0, Math.floor(Number(building?._armoryPendingStones) || 0)),
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._armoryUpgrade;
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
        building._armoryUpgrade = null;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    _flushPendingStones(building) {
        const pending = Math.max(0, Math.floor(Number(building?._armoryPendingStones) || 0));
        if (pending <= 0) return;
        building._armoryPendingStones = routeArmoryEnhancementStones(pending).remaining;
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'armory' || !building.active) return;
        const elapsed = Math.max(0, Number(dt) || 0);
        this._updateUpgrade(building, elapsed);
        this._flushPendingStones(building);
        const chance = this.getActualStoneChance(building);
        if (chance > 0) {
            const interval = Math.max(1000,
                Number(populationEconomyConfig.armory?.resourceSortIntervalMs) || 60000);
            building._armorySortElapsedMs += elapsed;
            let guard = 1000;
            while (building._armorySortElapsedMs >= interval && guard-- > 0) {
                building._armorySortElapsedMs -= interval;
                if (Math.random() < chance) building._armoryPendingStones += 1;
            }
            this._flushPendingStones(building);
        }
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    showRange(building) {
        if (building?._economyType !== 'armory') return;
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
        graphics.fillStyle(0xb88948, 0.09);
        graphics.lineStyle(3, 0xd8ad62, 0.82);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};
