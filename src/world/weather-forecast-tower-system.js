import producerBuildings from '../../data/producer-buildings.json';
import {
    getBuildingModuleUpgradeCost,
    resolveBuildingUpgradeProject,
} from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';

export const WEATHER_FORECAST_TOWER_ID = 'weather_forecast_tower';

const towerConfig = resolveBuildingUpgradeProject(
    producerBuildings[WEATHER_FORECAST_TOWER_ID] || {}
);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function moduleLevelFrom(levels, moduleId) {
    const module = towerConfig.modules?.[moduleId];
    return clamp(
        Math.floor(Number(levels?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module?.maxLevel) || 0))
    );
}

function moduleValueFrom(levels, moduleId) {
    const module = towerConfig.modules?.[moduleId];
    if (!module) return 0;
    const level = moduleLevelFrom(levels, moduleId);
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function normalizeLevels(source = {}) {
    const levels = {};
    for (const moduleId of Object.keys(towerConfig.modules || {})) {
        levels[moduleId] = moduleLevelFrom(source, moduleId);
    }
    return levels;
}

/**
 * 天气预测塔的本栋升级真源。升级改变预报能力并可提供科研点，但不改变实际天气排期。
 */
export const WeatherForecastTowerSystem = {
    initializeBuilding(building, saved = {}) {
        if (building?.cfgKey !== WEATHER_FORECAST_TOWER_ID) return;
        building.modules = normalizeLevels(saved.weatherModules || saved.modules || {});
        building._weatherUpgrade = saved.weatherUpgrade ? {
            moduleId: saved.weatherUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.weatherUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.weatherUpgrade.remainMs) || 0),
        } : null;
    },

    getModuleLevel(building, moduleId) {
        return moduleLevelFrom(building?.modules, moduleId);
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getModuleLevel(building, moduleId)
        );
    },

    startUpgrade(building, moduleId) {
        if (building?.cfgKey !== WEATHER_FORECAST_TOWER_ID) {
            return { ok: false, reason: '该建筑不是天气预测塔' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (Number(module.maxLevel) || 0)) {
            return { ok: false, reason: '升级项目已满级' };
        }
        if (building._weatherUpgrade) return { ok: false, reason: '已有气象项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._weatherUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    updateBuilding(building, dt) {
        if (building?.cfgKey !== WEATHER_FORECAST_TOWER_ID || !building.active) return;
        building._economyWorking = this.isOperational(building);
        const upgrade = building._weatherUpgrade;
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
        building._weatherUpgrade = null;
    },

    getProfileFromLevels(levels = {}) {
        return {
            horizonDays: Math.max(0, moduleValueFrom(levels, 'weather_forecast_horizon')),
            researchPointsPerSecond: Math.max(0,
                moduleValueFrom(levels, 'weather_forecast_cycles')),
            showDuration: moduleValueFrom(levels, 'weather_forecast_duration') > 0,
            disasterWarning: moduleValueFrom(levels, 'weather_forecast_storm_warning') > 0,
            levels: normalizeLevels(levels),
        };
    },

    isOperational(building) {
        return building?.cfgKey === WEATHER_FORECAST_TOWER_ID
            && building.active !== false
            && Number(building.hp ?? 1) > 0
            && Math.floor(Number(building._assignedWorkers) || 0) >= 1;
    },

    isSnapshotOperational(snapshot) {
        return snapshot?.cfgKey === WEATHER_FORECAST_TOWER_ID
            && Number(snapshot.hp ?? 1) > 0
            && Math.floor(Number(snapshot.assignedWorkers) || 0) >= 1;
    },

    getProfile(building) {
        return this.getProfileFromLevels(building?.modules || {});
    },

    getProfileFromSnapshot(snapshot) {
        return this.getProfileFromLevels(snapshot?.weatherModules || {});
    },
};

export default WeatherForecastTowerSystem;
