import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
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

/**
 * 银行本栋升级与覆盖圈真源。金币结算及范围内房屋人口统计仍由
 * PopulationEconomySystem 负责，避免视觉范围反向驱动业务结算。
 */
export const BankEconomySystem = {
    _banks: new Set(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'bank') return;
        building.modules = { ...(saved.bankModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._bankUpgrade = saved.bankUpgrade ? {
            moduleId: saved.bankUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.bankUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.bankUpgrade.remainMs) || 0),
        } : null;
        this._banks.add(building);
    },

    reset() {
        this._banks.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._banks.delete(building);
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
        if (building?._economyType !== 'bank') return { ok: false, reason: '该建筑不是银行' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._bankUpgrade) return { ok: false, reason: '已有银行项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._bankUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getSettlementSpeed(building) {
        return Math.max(0.01, 1 + moduleValue(building, 'bank_finance'));
    },

    getStaffCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'bank_staff')));
    },

    getGoldPerPopulation(building) {
        return Math.max(0, moduleValue(building, 'bank_mint'));
    },

    getServiceRange(building) {
        return Math.max(0, moduleValue(building, 'bank_service_range'));
    },

    getSettlementIntervalMs(building, baseIntervalMs = 10000) {
        return Math.max(100, Math.round(Math.max(100, Number(baseIntervalMs) || 10000)
            / this.getSettlementSpeed(building)));
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._bankUpgrade;
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
        building._bankUpgrade = null;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'bank' || !building.active) return;
        this._updateUpgrade(building, dt);
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    showRange(building) {
        if (building?._economyType !== 'bank') return;
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
        graphics.fillStyle(0xe4bd55, 0.09);
        graphics.lineStyle(3, 0xe4bd55, 0.82);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};
