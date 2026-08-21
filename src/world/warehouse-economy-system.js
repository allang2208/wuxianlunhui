import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moduleValue(building, moduleId) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return 0;
    const level = clamp(
        Math.floor(Number(building?.warehouseModules?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
    );
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

export const WarehouseEconomySystem = {
    _warehouses: new Set(),

    initializeBuilding(building, saved = {}) {
        if (!building?._isEnergyWarehouse) return;
        building.warehouseModules = { ...(saved.warehouseModules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.warehouseModules[moduleId] = clamp(
                Math.floor(Number(building.warehouseModules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._warehouseUpgrade = saved.warehouseUpgrade ? {
            moduleId: saved.warehouseUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.warehouseUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.warehouseUpgrade.remainMs) || 0),
        } : null;
        this.applyStorageStats(building);
        this._warehouses.add(building);
    },

    reset() { this._warehouses.clear(); },
    unregisterBuilding(building) { this._warehouses.delete(building); },

    getModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.warehouseModules?.[moduleId]) || 0));
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(building?._cfg, moduleId, this.getModuleLevel(building, moduleId));
    },

    getCapacity(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'warehouse_capacity')
            || Number(building?._cfg?.storageCapacity) || 0));
    },

    getEnergyFactor(building) {
        return clamp(1 + moduleValue(building, 'warehouse_energy_density'), 0.1, 1);
    },

    getFoodFactor(building) {
        return clamp(1 + moduleValue(building, 'warehouse_food_density'), 0.1, 1);
    },

    getProtocolSurcharge(building) {
        return Math.max(0, moduleValue(building, 'warehouse_cross_plane'));
    },

    applyStorageStats(building) {
        if (!building?._isEnergyWarehouse) return;
        building.storageCapacity = this.getCapacity(building);
        building._energyStorageFactor = this.getEnergyFactor(building);
        building._foodStorageFactor = this.getFoodFactor(building);
    },

    startUpgrade(building, moduleId) {
        if (!building?._isEnergyWarehouse) return { ok: false, reason: '该建筑不是仓库' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._warehouseUpgrade) return { ok: false, reason: '已有仓库项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._warehouseUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost: payment, moduleId };
    },

    updateBuilding(building, dt) {
        const upgrade = building?._warehouseUpgrade;
        if (!upgrade || !building.active) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.warehouseModules[upgrade.moduleId] = clamp(
                this.getModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
            this.applyStorageStats(building);
        }
        building._warehouseUpgrade = null;
    },
};
