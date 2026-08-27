import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { TechnologySystem } from './technology-system.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

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

/** 大商场本栋升级、服务范围和岗位效率真源；人口覆盖与资源结算由人口经济系统负责。 */
export const GrandMallEconomySystem = {
    _malls: new Set(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'grand_mall') return;
        building.modules = { ...(saved.grandMallModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._grandMallUpgrade = saved.grandMallUpgrade ? {
            moduleId: saved.grandMallUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.grandMallUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.grandMallUpgrade.remainMs) || 0),
        } : null;
        building._grandMallGoldRemainder = Math.max(0, Number(saved.grandMallGoldRemainder) || 0);
        building._grandMallEnergyRemainder = Math.max(0, Number(saved.grandMallEnergyRemainder) || 0);
        this._malls.add(building);
    },

    reset() {
        this._malls.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._malls.delete(building);
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
        if (building?._economyType !== 'grand_mall') return { ok: false, reason: '该建筑不是大商场' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知商场升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (Number(module.maxLevel) || 0)) return { ok: false, reason: '商场升级项目已满级' };
        if (building._grandMallUpgrade) return { ok: false, reason: '已有商场项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._grandMallUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getGoldPerPopulationPerSecond(building) {
        return Math.max(0, moduleValue(building, 'grand_mall_showcase'));
    },

    getEnergyPerPopulationPerSecond(building) {
        return Math.max(0, moduleValue(building, 'grand_mall_energy_atrium'));
    },

    getServiceRange(building) {
        return Math.max(0, moduleValue(building, 'grand_mall_business_radius'));
    },

    getStaffCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'grand_mall_staff')));
    },

    getStaffEfficiency(building, workerEfficiency = 0.05) {
        const staffed = Math.min(
            this.getStaffCapacity(building),
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        return clamp(staffed * Math.max(0, Number(workerEfficiency) || 0), 0, 1);
    },

    _updateUpgrade(building, dt) {
        const upgrade = building?._grandMallUpgrade;
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
        building._grandMallUpgrade = null;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'grand_mall' || !building.active) return;
        this._updateUpgrade(building, dt);
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    showRange(building) {
        if (building?._economyType !== 'grand_mall') return;
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
        const range = this.getServiceRange(building);
        const graphics = this._rangeGraphics;
        graphics.clear();
        graphics.setPosition(building.x, building.y);
        graphics.setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        graphics.fillStyle(0xd79b45, 0.09);
        graphics.lineStyle(3, 0xd79b45, 0.84);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};
