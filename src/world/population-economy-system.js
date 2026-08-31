import populationEconomyConfig from '../../data/population-economy.json';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { Game } from '../game.js';
import { EffectManager } from '../effects/effect-manager.js';
import { BuildingFootprintDustEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import {
    createGoldItem,
    getPlayerTotalGold,
    routeProducedGold as routeBankGold,
} from './economy-gold-routing.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { TavernEconomySystem } from './tavern-economy-system.js';
import { BankEconomySystem } from './bank-economy-system.js';
import { GrandMallEconomySystem } from './grand-mall-economy-system.js';
import { WarehouseEconomySystem } from './warehouse-economy-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { TechnologySystem } from './technology-system.js';
import { MilitaryPopulationSystem } from './military-population-system.js';
import { EconomyHudSystem } from './economy-hud-system.js';
import { getAbilityLevel, getAbilityValue } from './ability-store.js';
import {
    getBuildingModuleUpgradeCost,
    getBuildingUpgradeAbility,
} from './building-upgrade-projects.js';
import { getFoodProductionWeatherEffect } from './food-production-weather.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function houseLevel(level) {
    const levels = populationEconomyConfig.house?.levels || [];
    return levels.find((entry) => entry.level === level) || levels[0] || null;
}

function warehouseLevel(level) {
    const levels = populationEconomyConfig.warehouse?.levels || [];
    return levels.find((entry) => entry.level === level) || levels[0] || null;
}

function researchLevel(level) {
    const levels = populationEconomyConfig.research?.levels || [];
    return levels.find((entry) => entry.level === level) || levels[0] || null;
}

function isWithin(source, target, range) {
    const dx = (Number(target?.x) || 0) - (Number(source?.x) || 0);
    const dy = (Number(target?.y) || 0) - (Number(source?.y) || 0);
    return dx * dx + dy * dy <= range * range;
}

function workforceConfig(buildingOrType) {
    const type = typeof buildingOrType === 'string'
        ? buildingOrType
        : buildingOrType?._economyType;
    if (!type || type === 'housing') return null;
    if (type === 'advanced_research' && buildingOrType?._cfg?.researchFacility) {
        const facility = buildingOrType._cfg.researchFacility;
        return Math.max(0, Math.floor(Number(facility.workerSlots) || 0)) > 0
            ? facility : null;
    }
    const cfg = populationEconomyConfig[type];
    return cfg && (Math.max(0, Math.floor(Number(cfg.workerSlots) || 0)) > 0
        || !!cfg.workerSlotsModule || !!cfg.workerSlotsAbilityId) ? cfg : null;
}

function workforceSlots(building, cfg, savedModules = null) {
    const abilityId = cfg?.workerSlotsAbilityId;
    if (abilityId) {
        const ability = getBuildingUpgradeAbility(abilityId);
        if (ability) {
            return Math.max(0, Math.floor(getAbilityValue(
                ability,
                getAbilityLevel(abilityId)
            )));
        }
    }
    const moduleId = cfg?.workerSlotsModule;
    const module = moduleId ? building?._cfg?.modules?.[moduleId] : null;
    if (module) {
        const levels = savedModules || building.modules || {};
        const level = clamp(
            Math.floor(Number(levels[moduleId]) || 0),
            0,
            Math.max(0, Math.floor(Number(module.maxLevel) || 0))
        );
        return Math.max(0, Math.floor((Number(module.base) || 0) + (Number(module.per) || 0) * level));
    }
    return Math.max(0, Math.floor(Number(cfg?.workerSlots) || 0));
}

function economyModuleValue(building, moduleId) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return 0;
    const level = clamp(
        Math.floor(Number(building?.modules?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
    );
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function economyEffectValue(building, effect, fallback = 0) {
    const entry = Object.entries(building?._cfg?.modules || {})
        .find(([, module]) => module?.effect === effect);
    return entry ? economyModuleValue(building, entry[0]) : fallback;
}

function isResearchFacility(building) {
    return building?._economyType === 'research'
        || building?._economyType === 'weather_forecast'
        || building?._economyType === 'advanced_research';
}

function researchFacilityType(building) {
    if (!isResearchFacility(building)) return '';
    return building?._cfg?.researchFacility?.clusterType || building?.cfgKey
        || building?._economyType || '';
}

/**
 * 人口经济运行时真源。房屋提供容量，工作建筑只保存岗位人数；未来装饰仓鼠
 * 只能读取岗位快照播放动画，不能进入实体表或反向驱动经济结算。
 */
export const PopulationEconomySystem = {
    _buildings: new Set(),
    _populationReservations: new Map(),

    reset() {
        this._buildings.clear();
        this._populationReservations.clear();
        MilitaryPopulationSystem.reset();
    },

    serializeState() {
        return { storageVersion: 2, foodStored: this.getFoodStored() };
    },

    restoreState(saved = {}) {
        // v1 粮食是脱离仓库的位面全局数；只在旧快照迁移时导入一次。
        if ((Number(saved.storageVersion) || 1) < 2) {
            EnergyManager?.importLegacyFood?.(saved.foodStored);
        }
        if ((Number(saved.legacyFoodPending) || 0) > 0) {
            EnergyManager?.importLegacyFood?.(saved.legacyFoodPending);
        }
    },

    initializeBuilding(building, saved = {}) {
        if (!building?._cfg?.economyType) return;
        building._economyType = building._cfg.economyType;
        building._economyTickMs = Math.max(0, Number(saved.economyTickMs) || 0);
        building._economyLevel = Math.max(1, Math.floor(Number(saved.economyLevel) || 1));
        building._bankGoldRemainder = Math.max(0, Number(saved.bankGoldRemainder) || 0);
        building._grandMallGoldRemainder = Math.max(0, Number(saved.grandMallGoldRemainder) || 0);
        building._grandMallEnergyRemainder = Math.max(0, Number(saved.grandMallEnergyRemainder) || 0);
        building._stockExchangeGoldRemainder = Math.max(0,
            Number(saved.stockExchangeGoldRemainder) || 0);
        building._stockExchangeEnergyRemainder = Math.max(0,
            Number(saved.stockExchangeEnergyRemainder) || 0);
        building._computingCenterGoldRemainder = Math.max(0,
            Number(saved.computingCenterGoldRemainder) || 0);
        building._computingCenterEnergyRemainder = Math.max(0,
            Number(saved.computingCenterEnergyRemainder) || 0);
        building._pendingGoldDrop = Math.max(0, Math.floor(Number(saved.pendingGoldDrop) || 0));
        building._workProductionRemainder = Math.max(0, Number(saved.workProductionRemainder) || 0);
        // 瞬时工作态不进存档；首帧经济结算后再由真实产能快照刷新。
        building._economyWorking = false;
        building._marketPressure = Number.isFinite(Number(saved.marketPressure))
            ? Number(saved.marketPressure)
            : 0;
        building._economyUpgrade = saved.economyUpgrade ? {
            targetLevel: Math.max(1, Math.floor(Number(saved.economyUpgrade.targetLevel) || 1)),
            totalMs: Math.max(1, Number(saved.economyUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.economyUpgrade.remainMs) || 0),
        } : null;
        if (building._economyType === 'research') {
            building.modules = { ...(saved.researchModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._researchUpgrade = saved.researchUpgrade ? {
                moduleId: saved.researchUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.researchUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.researchUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'planar_resonator') {
            building.modules = { ...(saved.resonatorModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._resonatorUpgrade = saved.resonatorUpgrade ? {
                moduleId: saved.resonatorUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.resonatorUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.resonatorUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'wind_power_plant') {
            building.modules = { ...(saved.windPowerModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._windPowerUpgrade = saved.windPowerUpgrade ? {
                moduleId: saved.windPowerUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.windPowerUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.windPowerUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'solar_power_plant') {
            building.modules = { ...(saved.solarPowerModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._solarPowerUpgrade = saved.solarPowerUpgrade ? {
                moduleId: saved.solarPowerUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.solarPowerUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.solarPowerUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'computing_center') {
            building.modules = { ...(saved.computingCenterModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._computingCenterUpgrade = saved.computingCenterUpgrade ? {
                moduleId: saved.computingCenterUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.computingCenterUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.computingCenterUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'windmill') {
            building.modules = { ...(saved.windmillModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._windmillUpgrade = saved.windmillUpgrade ? {
                moduleId: saved.windmillUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.windmillUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.windmillUpgrade.remainMs) || 0),
            } : null;
        }
        if (building._economyType === 'royal_mint') {
            building.modules = { ...(saved.mintModules || saved.modules || {}) };
            for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
                building.modules[moduleId] = clamp(
                    Math.floor(Number(building.modules[moduleId]) || 0),
                    0,
                    Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                );
            }
            building._mintUpgrade = saved.mintUpgrade ? {
                moduleId: saved.mintUpgrade.moduleId,
                totalMs: Math.max(1, Number(saved.mintUpgrade.totalMs) || 1),
                remainMs: Math.max(0, Number(saved.mintUpgrade.remainMs) || 0),
            } : null;
            building._mintGoldRemainder = Math.max(0, Number(saved.mintGoldRemainder) || 0);
        }
        if (building._economyType === 'housing') this.applyHouseLevel(building, building._economyLevel);
        if (building._economyType === 'warehouse') this.applyWarehouseLevel(building, building._economyLevel);
        if (building._economyType === 'research') this.applyResearchLevel(building, building._economyLevel);
        const workerCfg = workforceConfig(building);
        const slots = workforceSlots(building, workerCfg,
            saved.researchModules || saved.windmillModules || saved.mintModules || saved.bankModules
                || saved.grandMallModules
                || saved.workshopModules || saved.armoryModules
                || saved.resonatorModules || saved.windPowerModules || saved.solarPowerModules
                || saved.computingCenterModules
                || saved.hospitalModules || saved.steamModules
                || saved.tavernModules);
        building._assignedWorkers = workerCfg
            ? clamp(
                Math.floor(Number(saved.assignedWorkers) || 0),
                0,
                slots
            )
            : 0;
        this._buildings.add(building);
    },

    unregisterBuilding(building) {
        this._buildings.delete(building);
        if (building) building._economyWorking = false;
        this.releasePopulation(building);
        MilitaryPopulationSystem.unregisterProducer(building);
    },

    registerMilitaryProducer(building) {
        MilitaryPopulationSystem.registerProducer(building);
    },

    getMilitaryPopulationSnapshot() {
        return MilitaryPopulationSystem.getSnapshot();
    },

    canRecruitMilitary(amount = 1) {
        return MilitaryPopulationSystem.canRecruit(amount);
    },

    getPopulationCapacity() {
        let total = 0;
        for (const building of this._buildings) {
            if (!building?.active || building._economyType !== 'housing') continue;
            total += houseLevel(building._economyLevel)?.populationCapacity || 0;
        }
        return total;
    },

    getPopulationUsed() {
        let total = 0;
        for (const amount of this._populationReservations.values()) total += amount;
        for (const building of this._buildings) {
            if (!building?.active || !workforceConfig(building)) continue;
            total += Math.max(0, Math.floor(Number(building._assignedWorkers) || 0));
        }
        return total;
    },

    getPopulationSnapshot() {
        const capacity = this.getPopulationCapacity();
        const used = this.getPopulationUsed();
        return {
            used,
            capacity,
            free: Math.max(0, capacity - used),
            overcrowded: Math.max(0, used - capacity),
        };
    },

    reservePopulation(owner, amount = 1) {
        const cost = Math.max(0, Math.floor(Number(amount) || 0));
        if (!owner || cost <= 0) return false;
        const current = this._populationReservations.get(owner) || 0;
        const delta = Math.max(0, cost - current);
        if (delta > this.getPopulationSnapshot().free) return false;
        this._populationReservations.set(owner, cost);
        return true;
    },

    releasePopulation(owner) {
        return this._populationReservations.delete(owner);
    },

    getWorkerConfig(buildingOrType) {
        return workforceConfig(buildingOrType);
    },

    getWorkerSnapshot(building) {
        const cfg = this.getWorkerConfig(building);
        if (!cfg) return null;
        const slots = workforceSlots(building, cfg);
        const assigned = clamp(Math.floor(Number(building?._assignedWorkers) || 0), 0, slots);
        const population = this.getPopulationSnapshot();
        return {
            assigned,
            slots,
            freeSlots: Math.max(0, slots - assigned),
            label: cfg.workerLabel || '人口',
            visualWorkerCap: Math.max(0, Math.floor(Number(cfg.visualWorkerCap) || 0)),
            visualMode: cfg.visualMode || '',
            laborEfficiency: this.getLaborEfficiency(),
            population,
        };
    },

    /** 当前建筑存在可用人口岗位，但尚未安排任何人员。 */
    isWorkforceUnstaffed(building) {
        const cfg = this.getWorkerConfig(building);
        if (!building?.active || !cfg) return false;
        const slots = workforceSlots(building, cfg);
        return slots > 0 && Math.max(0,
            Math.floor(Number(building._assignedWorkers) || 0)) <= 0;
    },

    setAssignedWorkers(building, requested) {
        const cfg = this.getWorkerConfig(building);
        if (!building?.active || !cfg) return { ok: false, reason: '该建筑没有人口岗位' };
        const slots = workforceSlots(building, cfg);
        const current = clamp(Math.floor(Number(building._assignedWorkers) || 0), 0, slots);
        const target = clamp(Math.floor(Number(requested) || 0), 0, slots);
        const delta = target - current;
        if (delta > this.getPopulationSnapshot().free) return { ok: false, reason: '空闲人口不足' };
        building._assignedWorkers = target;
        if (target !== current && typeof building.onAssignedWorkersChanged === 'function') {
            building.onAssignedWorkersChanged(current, target);
        }
        return { ok: true, assigned: target, slots, delta };
    },

    adjustAssignedWorkers(building, delta) {
        const current = Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0));
        return this.setAssignedWorkers(building, current + Math.floor(Number(delta) || 0));
    },

    assignMaxWorkers(building) {
        const cfg = this.getWorkerConfig(building);
        if (!cfg) return { ok: false, reason: '该建筑没有人口岗位' };
        const slots = workforceSlots(building, cfg);
        const current = Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0));
        return this.setAssignedWorkers(building, Math.min(slots, current + this.getPopulationSnapshot().free));
    },

    getLaborEfficiency() {
        const population = this.getPopulationSnapshot();
        if (population.used <= 0) return 1;
        return clamp(population.capacity / population.used, 0, 1);
    },

    applyHouseLevel(building, requestedLevel) {
        const levels = populationEconomyConfig.house?.levels || [];
        if (!building || levels.length === 0) return null;
        const level = clamp(Math.floor(Number(requestedLevel) || 1), 1, levels.length);
        const cfg = houseLevel(level);
        const previousTexture = building.spriteCfg?.idleKey;
        building._economyLevel = level;
        building.spriteCfg.idleKey = cfg.tex;
        building.spriteCfg.size = cfg.displayW;
        building.spriteCfg.sizeH = cfg.displayH;
        building.spriteCfg.footOffsetY = cfg.footOffsetY;
        building.spriteCfg.visualFootprint = cfg.visualFootprint
            ? { ...cfg.visualFootprint } : null;
        building.footOffsetY = cfg.footOffsetY;
        building.size = cfg.displayW;
        RuntimeAssetManager.transitionBuildingVisual(previousTexture, cfg.tex, 'house');
        return cfg;
    },

    getHouseUpgrade(building) {
        if (building?._economyType !== 'housing') return null;
        const targetLevel = (building._economyLevel || 1) + 1;
        return (populationEconomyConfig.house?.levels || [])
            .find((entry) => entry.level === targetLevel) || null;
    },

    getHouseUpgradeLockReason(building) {
        const next = this.getHouseUpgrade(building);
        const unlockId = next?.technologyUnlockId;
        if (!unlockId || TechnologySystem.isUnlocked('upgrade', unlockId)) return '';
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', unlockId);
        return `需要先完成科技：${technologyName || unlockId}`;
    },

    startHouseUpgrade(building) {
        if (building?._economyType !== 'housing') return { ok: false, reason: '该建筑不是房屋' };
        if (building._economyUpgrade) return { ok: false, reason: '房屋正在升级' };
        const next = this.getHouseUpgrade(building);
        if (!next) return { ok: false, reason: '房屋已达到最高等级' };
        const lockReason = this.getHouseUpgradeLockReason(building);
        if (lockReason) return { ok: false, reason: lockReason };
        const cost = next.upgradeCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        building._economyUpgrade = { targetLevel: next.level, totalMs: timeMs, remainMs: timeMs };
        RuntimeAssetManager.requestBuildingVisualKey(next.tex);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
        return { ok: true, cost, targetLevel: next.level };
    },

    applyWarehouseLevel(building, requestedLevel) {
        const levels = populationEconomyConfig.warehouse?.levels || [];
        if (!building || levels.length === 0) return null;
        const maxLevel = Math.max(1, ...levels.map((entry) => Math.max(1,
            Math.floor(Number(entry.level) || 1))));
        const level = clamp(Math.floor(Number(requestedLevel) || 1), 1, maxLevel);
        const cfg = warehouseLevel(level);
        const previousTexture = building.spriteCfg?.idleKey;
        building._economyLevel = level;
        building.spriteCfg.idleKey = cfg.tex;
        building.spriteCfg.size = cfg.displayW;
        building.spriteCfg.sizeH = cfg.displayH;
        building.spriteCfg.footOffsetY = cfg.footOffsetY;
        building.spriteCfg.visualFootprint = cfg.visualFootprint
            ? { ...cfg.visualFootprint } : null;
        building.footOffsetY = cfg.footOffsetY;
        building.size = cfg.displayW;
        WarehouseEconomySystem.applyStorageStats(building);
        RuntimeAssetManager.transitionBuildingVisual(previousTexture, cfg.tex, 'warehouse');
        return cfg;
    },

    getWarehouseLevelConfig(building) {
        if (building?._economyType !== 'warehouse') return null;
        return warehouseLevel(building._economyLevel || 1);
    },

    getWarehouseLevelUpgrade(building) {
        if (building?._economyType !== 'warehouse') return null;
        const targetLevel = (building._economyLevel || 1) + 1;
        return (populationEconomyConfig.warehouse?.levels || [])
            .find((entry) => entry.level === targetLevel) || null;
    },

    getWarehouseLevelUpgradeLockReason(building) {
        const next = this.getWarehouseLevelUpgrade(building);
        const unlockId = next?.technologyUnlockId;
        if (!unlockId || TechnologySystem.isUnlocked('upgrade', unlockId)) return '';
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', unlockId);
        return `需要先完成科技：${technologyName || unlockId}`;
    },

    startWarehouseLevelUpgrade(building) {
        if (building?._economyType !== 'warehouse') return { ok: false, reason: '该建筑不是仓库' };
        if (building._economyUpgrade) return { ok: false, reason: '仓库等级正在升级' };
        const next = this.getWarehouseLevelUpgrade(building);
        if (!next) return { ok: false, reason: '仓库已达到最高等级' };
        const lockReason = this.getWarehouseLevelUpgradeLockReason(building);
        if (lockReason) return { ok: false, reason: lockReason };
        const cost = next.upgradeCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        building._economyUpgrade = { targetLevel: next.level, totalMs: timeMs, remainMs: timeMs };
        RuntimeAssetManager.requestBuildingVisualKey(next.tex);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
        return { ok: true, cost, targetLevel: next.level };
    },

    applyResearchLevel(building, requestedLevel) {
        const levels = populationEconomyConfig.research?.levels || [];
        if (!building || levels.length === 0) return null;
        const maxLevel = Math.max(1, ...levels.map((entry) => Math.max(1,
            Math.floor(Number(entry.level) || 1))));
        const level = clamp(Math.floor(Number(requestedLevel) || 1), 1, maxLevel);
        const cfg = researchLevel(level);
        const previousTexture = building.spriteCfg?.idleKey;
        building._economyLevel = level;
        building.spriteCfg.idleKey = cfg.tex;
        building.spriteCfg.size = cfg.displayW;
        building.spriteCfg.sizeH = cfg.displayH;
        building.spriteCfg.footOffsetY = cfg.footOffsetY;
        building.spriteCfg.visualFootprint = cfg.visualFootprint
            ? { ...cfg.visualFootprint } : null;
        building.footOffsetY = cfg.footOffsetY;
        building.size = cfg.displayW;
        RuntimeAssetManager.transitionBuildingVisual(
            previousTexture, cfg.tex, 'research_institute');
        return cfg;
    },

    getResearchUpgrade(building) {
        if (building?._economyType !== 'research') return null;
        const targetLevel = (building._economyLevel || 1) + 1;
        return (populationEconomyConfig.research?.levels || [])
            .find((entry) => entry.level === targetLevel) || null;
    },

    getResearchUpgradeLockReason(building) {
        const next = this.getResearchUpgrade(building);
        const unlockId = next?.technologyUnlockId;
        if (!unlockId || TechnologySystem.isUnlocked('upgrade', unlockId)) return '';
        const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', unlockId);
        return `需要先完成科技：${technologyName || unlockId}`;
    },

    startResearchUpgrade(building) {
        if (building?._economyType !== 'research') return { ok: false, reason: '该建筑不是研究所' };
        if (building._economyUpgrade) return { ok: false, reason: '研究所正在升级' };
        const next = this.getResearchUpgrade(building);
        if (!next) return { ok: false, reason: '研究所已达到最高等级' };
        const lockReason = this.getResearchUpgradeLockReason(building);
        if (lockReason) return { ok: false, reason: lockReason };
        const cost = next.upgradeCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        building._economyUpgrade = { targetLevel: next.level, totalMs: timeMs, remainMs: timeMs };
        RuntimeAssetManager.requestBuildingVisualKey(next.tex);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
        return { ok: true, cost, targetLevel: next.level };
    },

    getResearchModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getResearchModuleUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getResearchModuleLevel(building, moduleId)
        );
    },

    startResearchModuleUpgrade(building, moduleId) {
        if (building?._economyType !== 'research') {
            return { ok: false, reason: '该建筑不是研究所' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知本栋研究项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getResearchModuleLevel(building, moduleId);
        if (level >= (Number(module.maxLevel) || 0)) {
            return { ok: false, reason: '本栋研究项目已满级' };
        }
        if (building._researchUpgrade) return { ok: false, reason: '已有本栋项目正在升级' };
        const cost = this.getResearchModuleUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._researchUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateResearchModuleUpgrade(building, dt) {
        const upgrade = building?._researchUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getResearchModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._researchUpgrade = null;
    },

    getResearchSnapshot(building) {
        const cfg = populationEconomyConfig.research || {};
        const levelCfg = researchLevel(building?._economyLevel || 1) || {};
        const baseModuleId = cfg.baseResearchModuleId || 'research_base_points';
        const equipmentBonus = Math.max(0, economyModuleValue(building, baseModuleId));
        const levelBaseResearchPoints = Math.max(0,
            Number(levelCfg.baseResearchPointsPerSecond) || 0);
        const configuredResearchPointsPerSecond = levelBaseResearchPoints + equipmentBonus;
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0, Number(cfg.workerEfficiencyShare) || 0.1);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('research');
        const cluster = this.getResearchClusterSnapshot(building);
        return {
            level: Math.max(1, Math.floor(Number(building?._economyLevel) || 1)),
            levelBaseResearchPoints,
            equipmentBonus,
            configuredResearchPointsPerSecond,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            clusterMultiplier: cluster.multiplier,
            clusterBonus: cluster.bonus,
            clusterFacilityTypes: cluster.facilityTypes,
            actualResearchPointsPerSecond: configuredResearchPointsPerSecond
                * staffFactor * laborEfficiency * workshopMultiplier * tavernMultiplier
                * cluster.multiplier
                * getProductionResourceMul(),
        };
    },

    getWeatherForecastResearchSnapshot(building) {
        const cfg = populationEconomyConfig.weather_forecast || {};
        const moduleId = cfg.researchModuleId || 'weather_forecast_cycles';
        const configuredResearchPointsPerSecond = Math.max(0,
            economyModuleValue(building, moduleId));
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0,
            Number(cfg.workerEfficiencyShare) || 1);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('weather_forecast');
        const cluster = this.getResearchClusterSnapshot(building);
        return {
            configuredResearchPointsPerSecond,
            staffCapacity,
            staffedCount,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            clusterMultiplier: cluster.multiplier,
            clusterBonus: cluster.bonus,
            clusterFacilityTypes: cluster.facilityTypes,
            actualResearchPointsPerSecond: configuredResearchPointsPerSecond
                * staffFactor * laborEfficiency * workshopMultiplier * tavernMultiplier
                * cluster.multiplier
                * getProductionResourceMul(),
        };
    },

    getAdvancedResearchSnapshot(building) {
        const facility = building?._cfg?.researchFacility || {};
        const configuredResearchPointsPerSecond = Math.max(0,
            Number(facility.baseResearchPointsPerSecond) || 0);
        const staffCapacity = workforceSlots(building, facility);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0,
            Number(facility.workerEfficiencyShare) || (staffCapacity > 0 ? 1 / staffCapacity : 0));
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('advanced_research');
        const cluster = this.getResearchClusterSnapshot(building);
        return {
            configuredResearchPointsPerSecond,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            clusterMultiplier: cluster.multiplier,
            clusterBonus: cluster.bonus,
            clusterFacilityTypes: cluster.facilityTypes,
            actualResearchPointsPerSecond: configuredResearchPointsPerSecond
                * staffFactor * laborEfficiency * workshopMultiplier * tavernMultiplier
                * cluster.multiplier * getProductionResourceMul(),
        };
    },

    getResearchClusterSnapshot(building) {
        const cfg = populationEconomyConfig.researchCluster || {};
        const radius = Math.max(0, Number(cfg.radius) || 0);
        const bonusPerType = Math.max(0, Number(cfg.bonusPerDistinctFacilityType) || 0);
        const maxBonus = Math.max(0, Number(cfg.maxBonus) || 0);
        const selfType = researchFacilityType(building);
        const facilityTypes = new Set();
        if (building?.active && selfType && radius > 0 && bonusPerType > 0) {
            for (const candidate of this._buildings) {
                if (candidate === building || !candidate?.active || candidate._sinking) continue;
                if (Number(candidate?.hp ?? candidate?.data?.hp ?? 1) <= 0) continue;
                if (!isResearchFacility(candidate)) continue;
                if (Math.max(0, Math.floor(Number(candidate._assignedWorkers) || 0)) <= 0) continue;
                const candidateType = researchFacilityType(candidate);
                if (!candidateType || candidateType === selfType) continue;
                if (isWithin(building, candidate, radius)) facilityTypes.add(candidateType);
            }
        }
        const bonus = Math.min(maxBonus, facilityTypes.size * bonusPerType);
        return {
            radius,
            bonus,
            multiplier: 1 + bonus,
            facilityTypes: [...facilityTypes],
        };
    },

    getLiveResearchSummary(buildings = null) {
        const source = buildings || this._buildings;
        let count = 0;
        let rate = 0;
        for (const building of source || []) {
            if (!building?.active || building._sinking) continue;
            if (Number(building?.hp ?? building?.data?.hp ?? 1) <= 0) continue;
            if (building._economyType === 'research') {
                count += 1;
                rate += this.getResearchSnapshot(building).actualResearchPointsPerSecond;
            } else if (building._economyType === 'weather_forecast') {
                count += 1;
                rate += this.getWeatherForecastResearchSnapshot(building)
                    .actualResearchPointsPerSecond;
            } else if (building._economyType === 'advanced_research') {
                count += 1;
                rate += this.getAdvancedResearchSnapshot(building)
                    .actualResearchPointsPerSecond;
            }
        }
        return { count, rate };
    },

    _updateEconomyLevelUpgrade(building, dt) {
        if (!building._economyUpgrade) return;
        building._economyUpgrade.remainMs -= dt;
        if (building._economyUpgrade.remainMs > 0) return;
        const targetLevel = building._economyUpgrade.targetLevel;
        building._economyUpgrade = null;
        if (building._economyType === 'housing') this.applyHouseLevel(building, targetLevel);
        else if (building._economyType === 'warehouse') this.applyWarehouseLevel(building, targetLevel);
        else if (building._economyType === 'research') this.applyResearchLevel(building, targetLevel);
        else return;
        EffectManager.add(new BuildingFootprintDustEffect(building));
        const configKey = building._economyType === 'housing' ? 'house' : building._economyType;
        const soundPath = populationEconomyConfig[configKey]?.upgradeCompleteSound;
        if (soundPath) SoundManager.playFile(soundPath, 1, 'ui');
    },

    getFoodStored() {
        return Math.max(0, Number(EnergyManager?.getFood?.()) || 0);
    },

    addFood(amount) {
        const value = Math.max(0, Number(amount) || 0);
        if (value <= 0) return 0;
        return EnergyManager?.depositFood?.(value) || 0;
    },

    consumeFood(amount) {
        const value = Math.max(0, Number(amount) || 0);
        if (value <= 0) return true;
        return CrossPlaneResourceSystem.pay(
            { food: value },
            { allowDevFree: false }
        ).ok;
    },

    routeProducedGold(amount) {
        return routeBankGold(amount);
    },

    getWindmillFoodPerSecond(building = null) {
        if (building) {
            return this.getWindmillSnapshot(building).actualFoodPerSecond;
        }
        let total = 0;
        for (const entry of this._buildings) {
            if (entry?.active && entry._economyType === 'windmill') {
                total += this.getWindmillSnapshot(entry).actualFoodPerSecond;
            }
        }
        return total;
    },

    getWindmillModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getWindmillUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getWindmillModuleLevel(building, moduleId)
        );
    },

    startWindmillUpgrade(building, moduleId) {
        if (building?._economyType !== 'windmill') {
            return { ok: false, reason: '该建筑不是麦田风车' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getWindmillModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._windmillUpgrade) return { ok: false, reason: '已有风车项目正在升级' };
        const cost = this.getWindmillUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._windmillUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateWindmillUpgrade(building, dt) {
        const upgrade = building?._windmillUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getWindmillModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._windmillUpgrade = null;
    },

    getWindmillSnapshot(building) {
        if (building?._economyType !== 'windmill' || !building.active) {
            return {
                foodPerWorker: 0, driveMultiplier: 0, fieldMultiplier: 0,
                staffCapacity: 0, staffedCount: 0, configuredFoodPerSecond: 0,
                actualFoodPerSecond: 0, laborEfficiency: 0, workshopMultiplier: 0,
                weatherMultiplier: 1, weatherLabel: '正常天气',
            };
        }
        const cfg = populationEconomyConfig.windmill || {};
        const foodPerWorker = Math.max(0,
            economyModuleValue(building, 'windmill_seed_selection')
                || Number(cfg.foodPerWorkerPerSecond) || 0);
        const driveMultiplier = Math.max(0,
            economyModuleValue(building, 'windmill_sail_drive') || 1);
        const fieldMultiplier = Math.max(0,
            economyModuleValue(building, 'windmill_crop_rotation') || 1);
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building._assignedWorkers) || 0))
        );
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('windmill');
        const weatherEffect = getFoodProductionWeatherEffect();
        const configuredFoodPerSecond = staffCapacity * foodPerWorker
            * driveMultiplier * fieldMultiplier;
        const actualFoodPerSecond = staffedCount * foodPerWorker
            * driveMultiplier * fieldMultiplier * laborEfficiency * workshopMultiplier
            * tavernMultiplier * weatherEffect.multiplier;
        return {
            foodPerWorker,
            driveMultiplier,
            fieldMultiplier,
            staffCapacity,
            staffedCount,
            configuredFoodPerSecond,
            actualFoodPerSecond,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            weatherMultiplier: weatherEffect.multiplier,
            weatherLabel: weatherEffect.label,
        };
    },

    getBankCoveredHouses(building) {
        if (building?._economyType !== 'bank' || !building.active) return [];
        const range = BankEconomySystem.getServiceRange(building);
        return Array.from(this._buildings).filter((entry) => entry?.active
            && entry._economyType === 'housing'
            && !entry._sinking
            && isWithin(building, entry, range));
    },

    getBankCoverageCountAt(target) {
        if (!target?.active || target._sinking) return 0;
        let count = 0;
        for (const bank of this._buildings) {
            if (!bank?.active || bank._sinking || bank._economyType !== 'bank') continue;
            if (isWithin(bank, target, BankEconomySystem.getServiceRange(bank))) count += 1;
        }
        return count;
    },

    getBankOverlapMultiplier(bankCount) {
        const count = Math.max(0, Math.floor(Number(bankCount) || 0));
        const zeroAt = Math.max(1,
            Math.floor(Number(populationEconomyConfig.bank?.overlapZeroAtBankCount) || 3));
        if (count >= zeroAt) return 0;
        const penalty = clamp(
            Number(populationEconomyConfig.bank?.overlapPenaltyPerAdditionalBank) || 0,
            0,
            1
        );
        return clamp(1 - Math.max(0, count - 1) * penalty, 0, 1);
    },

    getBankSnapshot(building) {
        const houses = this.getBankCoveredHouses(building);
        let servicePopulation = 0;
        let effectiveServicePopulation = 0;
        let overlappedHouseCount = 0;
        let maxBankOverlapCount = 0;
        for (const house of houses) {
            const population = Math.max(0,
                Number(houseLevel(house._economyLevel)?.populationCapacity) || 0);
            const bankCount = this.getBankCoverageCountAt(house);
            const overlapMultiplier = this.getBankOverlapMultiplier(bankCount);
            servicePopulation += population;
            effectiveServicePopulation += population * overlapMultiplier;
            if (bankCount > 1) overlappedHouseCount += 1;
            maxBankOverlapCount = Math.max(maxBankOverlapCount, bankCount);
        }
        const assignedWorkers = Math.max(0, Number(building?._assignedWorkers) || 0);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('bank');
        const goldPerPopulation = BankEconomySystem.getGoldPerPopulation(building);
        const settlementIntervalMs = BankEconomySystem.getSettlementIntervalMs(
            building,
            populationEconomyConfig.bank?.settlementIntervalMs
        );
        const goldPerSettlement = effectiveServicePopulation * goldPerPopulation * assignedWorkers
            * laborEfficiency * workshopMultiplier * tavernMultiplier;
        return {
            range: BankEconomySystem.getServiceRange(building),
            coveredHouseCount: houses.length,
            servicePopulation,
            effectiveServicePopulation,
            overlappedHouseCount,
            maxBankOverlapCount,
            assignedWorkers,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            settlementSpeed: BankEconomySystem.getSettlementSpeed(building),
            settlementIntervalMs,
            goldPerPopulation,
            goldPerSettlement,
            goldPerSecond: settlementIntervalMs > 0 ? goldPerSettlement * 1000 / settlementIntervalMs : 0,
        };
    },

    getBankGoldPerSecond(building = null) {
        if (building) return this.getBankSnapshot(building).goldPerSecond;
        let total = 0;
        for (const entry of this._buildings) {
            if (entry?.active && entry._economyType === 'bank') {
                total += this.getBankSnapshot(entry).goldPerSecond;
            }
        }
        return total;
    },

    getGrandMallCoveredHouses(building) {
        if (building?._economyType !== 'grand_mall' || !building.active) return [];
        const range = GrandMallEconomySystem.getServiceRange(building);
        return Array.from(this._buildings).filter((entry) => entry?.active
            && entry._economyType === 'housing'
            && !entry._sinking
            && isWithin(building, entry, range));
    },

    getGrandMallSnapshot(building) {
        const houses = this.getGrandMallCoveredHouses(building);
        const servicePopulation = houses.reduce((sum, house) => sum + Math.max(0,
            Number(houseLevel(house._economyLevel)?.populationCapacity) || 0), 0);
        const cfg = populationEconomyConfig.grand_mall || {};
        const staffCapacity = GrandMallEconomySystem.getStaffCapacity(building);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiency = Math.max(0, Number(cfg.workerEfficiencyPerEmployee) || 0.05);
        const staffEfficiency = GrandMallEconomySystem.getStaffEfficiency(building, workerEfficiency);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('grand_mall');
        const goldPerPopulationPerSecond = GrandMallEconomySystem.getGoldPerPopulationPerSecond(building);
        const energyPerPopulationPerSecond = GrandMallEconomySystem.getEnergyPerPopulationPerSecond(building);
        const settlementIntervalMs = Math.max(100, Number(cfg.settlementIntervalMs) || 1000);
        const goldPerSecond = servicePopulation * goldPerPopulationPerSecond
            * staffEfficiency * laborEfficiency * workshopMultiplier * tavernMultiplier;
        const energyPerSecond = servicePopulation * energyPerPopulationPerSecond
            * staffEfficiency * laborEfficiency;
        const storedEnergy = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
        return {
            range: GrandMallEconomySystem.getServiceRange(building),
            coveredHouseCount: houses.length,
            servicePopulation,
            staffCapacity,
            staffedCount,
            workerEfficiency,
            staffEfficiency,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            goldPerPopulationPerSecond,
            energyPerPopulationPerSecond,
            settlementIntervalMs,
            goldPerSecond,
            energyPerSecond,
            goldPerSettlement: goldPerSecond * settlementIntervalMs / 1000,
            energyPerSettlement: energyPerSecond * settlementIntervalMs / 1000,
            storedEnergy,
            canOperate: staffedCount > 0 && servicePopulation > 0 && goldPerSecond > 0
                && storedEnergy >= Math.floor(
                    Math.max(0, Number(building?._grandMallEnergyRemainder) || 0)
                    + energyPerSecond * settlementIntervalMs / 1000 + 1e-9
                ),
        };
    },

    _getCapitalEconomySnapshot(building, economyType) {
        const cfg = populationEconomyConfig[economyType] || {};
        const settlementIntervalMs = Math.max(100,
            Number(cfg.settlementIntervalMs) || 1000);
        const population = this.getPopulationCapacity();
        const playerTotalGold = Math.max(0, getPlayerTotalGold());
        const configuredBaseContribution = Math.max(0, economyEffectValue(
            building,
            'computingBaseGoldPerSecond',
            Number(cfg.baseGoldPerSecond) || 0
        ));
        const populationRate = Math.max(0, economyEffectValue(
            building,
            'computingGoldPerPopulationPerSecond',
            Number(cfg.goldPerPopulationPerSecond) || 0
        ));
        const goldBalanceRate = Math.max(0,
            Number(cfg.goldBalanceRatePerSecond) || 0);
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)));
        const workerEfficiency = Math.max(0,
            Number(cfg.workerEfficiencyPerEmployee) || 0);
        const staffFactor = clamp(staffedCount * workerEfficiency, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const operatingFactor = staffFactor * laborEfficiency;
        const baseContribution = configuredBaseContribution * operatingFactor;
        const populationContribution = population * populationRate * operatingFactor;
        const effectiveGoldBalanceRate = goldBalanceRate * operatingFactor;
        const goldBalanceContribution = playerTotalGold * effectiveGoldBalanceRate;
        const goldPerSecond = baseContribution + populationContribution
            + goldBalanceContribution;
        const configuredEnergyPerSecond = Math.max(0, economyEffectValue(
            building,
            'computingEnergyPerSecond',
            Number(cfg.energyPerSecond) || 0
        ));
        const energyPerSecond = configuredEnergyPerSecond * operatingFactor;
        const goldPerSettlement = goldPerSecond * settlementIntervalMs / 1000;
        const energyPerSettlement = energyPerSecond * settlementIntervalMs / 1000;
        const storedEnergy = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
        const energyRemainder = economyType === 'computing_center'
            ? building?._computingCenterEnergyRemainder
            : building?._stockExchangeEnergyRemainder;
        const nextEnergyCost = Math.floor(
            Math.max(0, Number(energyRemainder) || 0)
                + energyPerSettlement + 1e-9
        );
        return {
            settlementIntervalMs,
            population,
            playerTotalGold,
            staffCapacity,
            staffedCount,
            workerEfficiency,
            staffFactor,
            laborEfficiency,
            operatingFactor,
            configuredBaseContribution,
            baseContribution,
            populationRate,
            populationContribution,
            goldBalanceRate,
            effectiveGoldBalanceRate,
            goldBalanceContribution,
            goldPerSecond,
            goldPerSettlement,
            configuredEnergyPerSecond,
            energyPerSecond,
            energyPerSettlement,
            storedEnergy,
            nextEnergyCost,
            canOperate: staffedCount > 0 && goldPerSettlement > 0 && energyPerSettlement > 0
                && storedEnergy >= nextEnergyCost,
        };
    },

    getStockExchangeSnapshot(building) {
        return this._getCapitalEconomySnapshot(building, 'stock_exchange');
    },

    getComputingCenterSnapshot(building) {
        return this._getCapitalEconomySnapshot(building, 'computing_center');
    },

    getMintModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getMintUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getMintModuleLevel(building, moduleId)
        );
    },

    startMintUpgrade(building, moduleId) {
        if (building?._economyType !== 'royal_mint') {
            return { ok: false, reason: '该建筑不是皇家铸币局' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知铸币升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getMintModuleLevel(building, moduleId);
        if (level >= (Number(module.maxLevel) || 0)) {
            return { ok: false, reason: '铸币升级项目已满级' };
        }
        if (building._mintUpgrade) return { ok: false, reason: '已有铸币项目正在升级' };
        const cost = this.getMintUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._mintUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateMintUpgrade(building, dt) {
        const upgrade = building?._mintUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getMintModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._mintUpgrade = null;
    },

    getMintSnapshot(building) {
        const cfg = populationEconomyConfig.royal_mint || {};
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const goldPerWorker = Math.max(0, economyModuleValue(building, 'mint_precision'));
        const energyPerWorker = Math.max(1,
            economyModuleValue(building, 'mint_energy_efficiency'));
        const settlementSpeed = Math.max(0.01,
            1 + economyModuleValue(building, 'mint_press_speed'));
        const baseIntervalMs = Math.max(100, Number(cfg.settlementIntervalMs) || 10000);
        const settlementIntervalMs = Math.max(100, Math.round(baseIntervalMs / settlementSpeed));
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('royal_mint');
        const configuredGoldPerSettlement = staffedCount * goldPerWorker;
        const goldPerSettlement = configuredGoldPerSettlement
            * laborEfficiency * workshopMultiplier * tavernMultiplier;
        const energyPerSettlement = goldPerSettlement > 0
            ? Math.max(1, Math.ceil(staffedCount * energyPerWorker * laborEfficiency))
            : 0;
        const foodPerWorker = Math.max(0,
            Number(cfg.foodPerWorkerPerSettlement) || 60);
        const foodPerSettlement = goldPerSettlement > 0
            ? staffedCount * foodPerWorker
            : 0;
        const storedEnergy = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
        const storedFood = Math.max(0, Number(EnergyManager?.getFood?.()) || 0);
        const canAffordEnergy = energyPerSettlement > 0
            && storedEnergy >= energyPerSettlement;
        const canAffordFood = foodPerSettlement > 0
            && storedFood >= foodPerSettlement;
        const resourceBlockReason = !canAffordEnergy && !canAffordFood
            ? '仓库能源与食物不足'
            : (!canAffordEnergy ? '仓库能源不足' : (!canAffordFood ? '仓库食物不足' : ''));
        return {
            staffCapacity,
            staffedCount,
            goldPerWorker,
            energyPerWorker,
            settlementSpeed,
            settlementIntervalMs,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            configuredGoldPerSettlement,
            goldPerSettlement,
            goldPerSecond: settlementIntervalMs > 0
                ? goldPerSettlement * 1000 / settlementIntervalMs : 0,
            energyPerSettlement,
            energyPerSecond: settlementIntervalMs > 0
                ? energyPerSettlement * 1000 / settlementIntervalMs : 0,
            foodPerWorker,
            foodPerSettlement,
            foodPerSecond: settlementIntervalMs > 0
                ? foodPerSettlement * 1000 / settlementIntervalMs : 0,
            storedEnergy,
            storedFood,
            canAffordEnergy,
            canAffordFood,
            canAffordSettlement: canAffordEnergy && canAffordFood,
            resourceBlockReason,
        };
    },

    getMarketPressure(fallbackBuilding = null) {
        const markets = Array.from(this._buildings).filter((entry) =>
            entry?.active && entry._economyType === 'market'
        );
        if (markets.length === 0) return Number(fallbackBuilding?._marketPressure) || 0;
        return markets.reduce((sum, entry) => sum + (Number(entry._marketPressure) || 0), 0) / markets.length;
    },

    setMarketPressure(value) {
        for (const entry of this._buildings) {
            if (entry?.active && entry._economyType === 'market') entry._marketPressure = value;
        }
    },

    getMarketQuote(building) {
        const cfg = populationEconomyConfig.market || {};
        const baseEnergyPerGold = Math.max(0.01, Number(cfg.baseEnergyPerGold) || 10);
        const effectiveWorkers = Math.max(0, Number(building?._assignedWorkers) || 0)
            * this.getLaborEfficiency()
            * WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const pressure = clamp(
            this.getMarketPressure(building),
            Number(cfg.minPressure) || -0.5,
            Number(cfg.maxPressure) || 1.5
        );
        const mid = clamp(
            baseEnergyPerGold * (1 + pressure),
            Number(cfg.minEnergyPerGold) || 5,
            Number(cfg.maxEnergyPerGold) || 25
        );
        const spread = clamp(
            (Number(cfg.spread) || 0)
                - effectiveWorkers * Math.max(0, Number(cfg.spreadReductionPerWorker) || 0),
            Math.max(0, Number(cfg.minSpread) || 0),
            0.49
        );
        // 市场只提供紧急流动性，不提供套利：无论压力方向与商人数如何，玩家买入
        // 金币的成本都高于基准价，卖出金币的收入都低于基准价。
        const minimumTradeLossRate = clamp(
            Number(cfg.minimumTradeLossRate) || 0,
            0,
            0.49
        );
        const buyFloor = baseEnergyPerGold * (1 + minimumTradeLossRate);
        const sellCeiling = baseEnergyPerGold * (1 - minimumTradeLossRate);
        return {
            midEnergyPerGold: mid,
            buyEnergyPerGold: Math.max(buyFloor, mid * (1 + spread)),
            sellEnergyPerGold: Math.max(0.01, Math.min(sellCeiling, mid * (1 - spread))),
            pressure,
            spread,
            minimumTradeLossRate,
            effectiveWorkers,
        };
    },

    canMarketTrade(building) {
        const required = Math.max(0, Math.floor(Number(populationEconomyConfig.market?.minWorkersToTrade) || 0));
        return building?._economyType === 'market'
            && building.active
            && Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)) >= required
            && this.getLaborEfficiency() > 0;
    },

    buyGold(building, energyAmount = populationEconomyConfig.market?.buyEnergyBatch) {
        if (building?._economyType !== 'market') return { ok: false, reason: '该建筑不是市场' };
        if (!this.canMarketTrade(building)) return { ok: false, reason: '市场需要至少 1 名商人才能交易' };
        const quote = this.getMarketQuote(building);
        const budget = Math.max(1, Math.floor(Number(energyAmount) || 0));
        const gold = Math.floor(budget / quote.buyEnergyPerGold);
        const spent = Math.ceil(gold * quote.buyEnergyPerGold);
        if (gold <= 0) return { ok: false, reason: '本次能源不足以兑换 1 金币' };
        if (!EnergyManager || EnergyManager.getEnergy() < spent) return { ok: false, reason: `能源不足，需要 ${spent}` };
        if (!GoldManager || GoldManager.getRemainingCapacity() < gold) return { ok: false, reason: '背包没有足够金币容量' };
        if (!EnergyManager.deductEnergy(spent)) return { ok: false, reason: '能源扣除失败' };
        if (!GoldManager.addGold(gold)) {
            EnergyManager.addEnergy(spent);
            return { ok: false, reason: '金币入库失败，能源已返还' };
        }
        const impact = Math.max(0, Number(populationEconomyConfig.market?.pressureImpactPerGold) || 0);
        const nextPressure = clamp(
            quote.pressure + gold * impact,
            Number(populationEconomyConfig.market?.minPressure) || -0.5,
            Number(populationEconomyConfig.market?.maxPressure) || 1.5
        );
        this.setMarketPressure(nextPressure);
        return { ok: true, gold, energy: spent, quote: this.getMarketQuote(building) };
    },

    sellGold(building, goldAmount = populationEconomyConfig.market?.sellGoldBatch) {
        if (building?._economyType !== 'market') return { ok: false, reason: '该建筑不是市场' };
        if (!this.canMarketTrade(building)) return { ok: false, reason: '市场需要至少 1 名商人才能交易' };
        const quote = this.getMarketQuote(building);
        const gold = Math.max(1, Math.floor(Number(goldAmount) || 0));
        const energy = Math.floor(gold * quote.sellEnergyPerGold);
        if (!GoldManager || GoldManager.getGold() < gold) return { ok: false, reason: `金币不足，需要 ${gold}` };
        if (!EnergyManager || !EnergyManager.canStore(energy)) return { ok: false, reason: '仓库空间不足，无法接收能源' };
        if (!GoldManager.deductGold(gold)) return { ok: false, reason: '金币扣除失败' };
        if (!EnergyManager.addEnergy(energy)) {
            GoldManager.addGold(gold);
            return { ok: false, reason: '能源入库失败，金币已返还' };
        }
        const impact = Math.max(0, Number(populationEconomyConfig.market?.pressureImpactPerGold) || 0);
        const nextPressure = clamp(
            quote.pressure - gold * impact,
            Number(populationEconomyConfig.market?.minPressure) || -0.5,
            Number(populationEconomyConfig.market?.maxPressure) || 1.5
        );
        this.setMarketPressure(nextPressure);
        return { ok: true, gold, energy, quote: this.getMarketQuote(building) };
    },

    getResonatorModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getWindPowerModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getWindPowerUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getWindPowerModuleLevel(building, moduleId)
        );
    },

    startWindPowerUpgrade(building, moduleId) {
        if (building?._economyType !== 'wind_power_plant') {
            return { ok: false, reason: '该建筑不是风力电站' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getWindPowerModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._windPowerUpgrade) return { ok: false, reason: '已有风电项目正在升级' };
        const cost = this.getWindPowerUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._windPowerUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateWindPowerUpgrade(building, dt) {
        const upgrade = building?._windPowerUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getWindPowerModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._windPowerUpgrade = null;
    },

    getWindPowerSnapshot(building) {
        const cfg = populationEconomyConfig.wind_power_plant || {};
        const cycleMs = Math.max(100, economyModuleValue(building, 'wind_blade_pitch') || 5000);
        const energyPerCycle = Math.max(0,
            economyModuleValue(building, 'wind_generator_output'));
        const conversionRate = clamp(
            economyModuleValue(building, 'wind_rectifier_efficiency'), 0, 1);
        const staffCapacity = Math.max(0,
            Math.floor(economyModuleValue(building, 'wind_maintenance_staff')));
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0,
            Number(cfg.workerEfficiencyShare) || 0.25);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('wind_power_plant');
        const configuredEnergyPerSecond = cycleMs > 0
            ? energyPerCycle * conversionRate * 1000 / cycleMs
            : 0;
        const actualEnergyPerSecond = configuredEnergyPerSecond * staffFactor
            * laborEfficiency * workshopMultiplier * tavernMultiplier;
        return {
            cycleMs,
            energyPerCycle,
            conversionRate,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            configuredEnergyPerSecond,
            actualEnergyPerSecond,
            pendingEnergy: Math.max(0,
                Math.floor(Number(building?._workProductionRemainder) || 0)),
        };
    },

    getSolarPowerModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getSolarPowerUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getSolarPowerModuleLevel(building, moduleId)
        );
    },

    startSolarPowerUpgrade(building, moduleId) {
        if (building?._economyType !== 'solar_power_plant') {
            return { ok: false, reason: '该建筑不是光伏电站' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getSolarPowerModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._solarPowerUpgrade) return { ok: false, reason: '已有光伏项目正在升级' };
        const cost = this.getSolarPowerUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._solarPowerUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateSolarPowerUpgrade(building, dt) {
        const upgrade = building?._solarPowerUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getSolarPowerModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._solarPowerUpgrade = null;
    },

    getSolarPowerSnapshot(building) {
        const cfg = populationEconomyConfig.solar_power_plant || {};
        const cycleMs = Math.max(100,
            economyModuleValue(building, 'solar_tracking_cycle') || 4000);
        const energyPerCycle = Math.max(0,
            economyModuleValue(building, 'solar_array_output'));
        const conversionRate = clamp(
            economyModuleValue(building, 'solar_storage_efficiency'), 0, 1);
        const staffCapacity = Math.max(0,
            Math.floor(economyModuleValue(building, 'solar_maintenance_staff')));
        const staffedCount = Math.min(staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)));
        const workerEfficiencyShare = Math.max(0,
            Number(cfg.workerEfficiencyShare) || 0.2);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('solar_power_plant');
        const configuredEnergyPerSecond = cycleMs > 0
            ? energyPerCycle * conversionRate * 1000 / cycleMs : 0;
        const actualEnergyPerSecond = configuredEnergyPerSecond * staffFactor
            * laborEfficiency * workshopMultiplier * tavernMultiplier;
        return {
            cycleMs,
            energyPerCycle,
            conversionRate,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            configuredEnergyPerSecond,
            actualEnergyPerSecond,
            pendingEnergy: Math.max(0,
                Math.floor(Number(building?._workProductionRemainder) || 0)),
        };
    },

    getComputingCenterModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getComputingCenterUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getComputingCenterModuleLevel(building, moduleId)
        );
    },

    startComputingCenterUpgrade(building, moduleId) {
        if (building?._economyType !== 'computing_center') {
            return { ok: false, reason: '该建筑不是算力重心' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getComputingCenterModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._computingCenterUpgrade) return { ok: false, reason: '已有算力项目正在升级' };
        const cost = this.getComputingCenterUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._computingCenterUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateComputingCenterUpgrade(building, dt) {
        const upgrade = building?._computingCenterUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getComputingCenterModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._computingCenterUpgrade = null;
    },

    getResonatorUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getResonatorModuleLevel(building, moduleId)
        );
    },

    startResonatorUpgrade(building, moduleId) {
        if (building?._economyType !== 'planar_resonator') {
            return { ok: false, reason: '该建筑不是位面谐振塔' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getResonatorModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._resonatorUpgrade) return { ok: false, reason: '已有谐振项目正在升级' };
        const cost = this.getResonatorUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._resonatorUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    _updateResonatorUpgrade(building, dt) {
        const upgrade = building?._resonatorUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getResonatorModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._resonatorUpgrade = null;
    },

    getPlanarResonatorSnapshot(building) {
        const cfg = populationEconomyConfig.planar_resonator || {};
        const cycleMs = Math.max(100, economyModuleValue(building, 'resonator_frequency') || 10000);
        const energyPerCycle = Math.max(0,
            economyModuleValue(building, 'resonator_crystal_output'));
        const conversionRate = clamp(
            economyModuleValue(building, 'resonator_conversion'), 0, 1);
        const staffCapacity = Math.max(0,
            Math.floor(economyModuleValue(building, 'resonator_staff')));
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0,
            Number(cfg.workerEfficiencyShare) || 0.2);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('planar_resonator');
        const configuredEnergyPerSecond = cycleMs > 0
            ? energyPerCycle * conversionRate * 1000 / cycleMs
            : 0;
        const actualEnergyPerSecond = configuredEnergyPerSecond * staffFactor
            * laborEfficiency * workshopMultiplier * tavernMultiplier;
        return {
            cycleMs,
            energyPerCycle,
            conversionRate,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            tavernMultiplier,
            configuredEnergyPerSecond,
            actualEnergyPerSecond,
            pendingEnergy: Math.max(0,
                Math.floor(Number(building?._workProductionRemainder) || 0)),
        };
    },

    updateBuilding(building, dt) {
        if (!building?._economyType || !building.active) return;
        this._updateEconomyLevelUpgrade(building, dt);
        const elapsedDt = Math.max(0, Number(dt) || 0);
        // 科研点由 WorldSimDriver 汇总所有前后台位面后统一写入科技树；本栋只维护等级读条。
        if (building._economyType === 'research') {
            this._updateResearchModuleUpgrade(building, elapsedDt);
            return;
        }
        if (building._economyType === 'advanced_research') return;
        if (building._economyType === 'weather_forecast') return;
        if (building._economyType === 'wind_power_plant'
            || building._economyType === 'solar_power_plant') {
            const isSolar = building._economyType === 'solar_power_plant';
            if (isSolar) this._updateSolarPowerUpgrade(building, elapsedDt);
            else this._updateWindPowerUpgrade(building, elapsedDt);
            const snapshot = isSolar
                ? this.getSolarPowerSnapshot(building)
                : this.getWindPowerSnapshot(building);
            building._economyWorking = snapshot.actualEnergyPerSecond > 0;
            if (snapshot.actualEnergyPerSecond <= 0) {
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.cycleMs) return;
            const cycles = Math.floor(building._economyTickMs / snapshot.cycleMs);
            building._economyTickMs -= cycles * snapshot.cycleMs;
            const total = Math.max(0, Number(building._workProductionRemainder) || 0)
                + snapshot.energyPerCycle * snapshot.conversionRate
                    * snapshot.staffFactor * snapshot.laborEfficiency
                    * snapshot.workshopMultiplier * snapshot.tavernMultiplier
                    * cycles * getProductionResourceMul();
            const energy = Math.floor(total);
            building._workProductionRemainder = total - energy;
            if (energy > 0) {
                const stored = EnergyManager?.depositEnergy?.(energy) || 0;
                building._workProductionRemainder += Math.max(0, energy - stored);
            }
            return;
        }
        if (building._economyType === 'planar_resonator') {
            this._updateResonatorUpgrade(building, elapsedDt);
            const snapshot = this.getPlanarResonatorSnapshot(building);
            building._economyWorking = snapshot.actualEnergyPerSecond > 0;
            if (snapshot.actualEnergyPerSecond <= 0) {
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.cycleMs) return;
            const cycles = Math.floor(building._economyTickMs / snapshot.cycleMs);
            building._economyTickMs -= cycles * snapshot.cycleMs;
            const total = Math.max(0, Number(building._workProductionRemainder) || 0)
                + snapshot.energyPerCycle * snapshot.conversionRate
                    * snapshot.staffFactor * snapshot.laborEfficiency
                    * snapshot.workshopMultiplier * snapshot.tavernMultiplier
                    * cycles * getProductionResourceMul();
            const energy = Math.floor(total);
            building._workProductionRemainder = total - energy;
            if (energy > 0) {
                const stored = EnergyManager?.depositEnergy?.(energy) || 0;
                building._workProductionRemainder += Math.max(0, energy - stored);
            }
            return;
        }
        if (building._economyType === 'bakery' || building._economyType === 'chain_restaurant'
            || building._economyType === 'cheese_farm'
            || building._economyType === 'steam_power_plant'
            || building._economyType === 'deep_drill' || building._economyType === 'tavern') return;
        if (building._economyType === 'windmill') {
            this._updateWindmillUpgrade(building, elapsedDt);
            building._economyWorking = this.getWindmillFoodPerSecond(building) > 0;
        }
        if (building._economyType === 'royal_mint') {
            this._updateMintUpgrade(building, elapsedDt);
            const snapshot = this.getMintSnapshot(building);
            if (snapshot.goldPerSettlement <= 0) {
                building._economyWorking = false;
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.settlementIntervalMs) {
                building._economyWorking = snapshot.canAffordSettlement;
                return;
            }
            const energyAffordableSettlements = Math.floor(
                Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0)
                    / snapshot.energyPerSettlement
            );
            const foodAffordableSettlements = Math.floor(
                Math.max(0, Number(EnergyManager?.getFood?.()) || 0)
                    / snapshot.foodPerSettlement
            );
            const readySettlements = Math.floor(
                building._economyTickMs / snapshot.settlementIntervalMs
            );
            const settlements = Math.min(
                readySettlements,
                energyAffordableSettlements,
                foodAffordableSettlements
            );
            if (settlements <= 0) {
                building._economyWorking = false;
                building._economyTickMs = Math.min(
                    building._economyTickMs,
                    snapshot.settlementIntervalMs
                );
                return;
            }
            const energyCost = settlements * snapshot.energyPerSettlement;
            const foodCost = settlements * snapshot.foodPerSettlement;
            if (!EnergyManager?.deductEnergy?.(energyCost)) {
                building._economyWorking = false;
                building._economyTickMs = snapshot.settlementIntervalMs;
                return;
            }
            if (!EnergyManager?.deductFood?.(foodCost)) {
                EnergyManager?.depositEnergy?.(energyCost);
                building._economyWorking = false;
                building._economyTickMs = snapshot.settlementIntervalMs;
                return;
            }
            building._economyTickMs -= settlements * snapshot.settlementIntervalMs;
            const total = building._mintGoldRemainder
                + snapshot.goldPerSettlement * settlements * getProductionResourceMul();
            const gold = Math.floor(total);
            building._mintGoldRemainder = total - gold;
            building._economyWorking = true;
            if (gold > 0) {
                const routed = routeBankGold(gold);
                if (routed.remaining > 0 && Game?.dropItem) {
                    Game.dropItem(building.x, building.y, createGoldItem(routed.remaining));
                }
            }
            return;
        }
        if (building._economyType === 'bank') {
            const snapshot = this.getBankSnapshot(building);
            if (snapshot.goldPerSettlement <= 0) {
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.settlementIntervalMs) return;
            const settlements = Math.floor(building._economyTickMs / snapshot.settlementIntervalMs);
            building._economyTickMs -= settlements * snapshot.settlementIntervalMs;
            const total = building._bankGoldRemainder
                + snapshot.goldPerSettlement * settlements * getProductionResourceMul();
            const gold = Math.floor(total);
            building._bankGoldRemainder = total - gold;
            if (gold > 0) {
                const routed = routeBankGold(gold);
                if (routed.remaining > 0 && Game?.dropItem) {
                    Game.dropItem(building.x, building.y, createGoldItem(routed.remaining));
                }
            }
            return;
        }
        if (building._economyType === 'grand_mall') {
            const snapshot = this.getGrandMallSnapshot(building);
            if (snapshot.goldPerSettlement <= 0 || snapshot.energyPerSettlement <= 0) {
                building._economyWorking = false;
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.settlementIntervalMs) {
                building._economyWorking = snapshot.canOperate;
                return;
            }
            const readySettlements = Math.floor(
                building._economyTickMs / snapshot.settlementIntervalMs
            );
            let settlements = 0;
            let energyCost = 0;
            let nextEnergyRemainder = building._grandMallEnergyRemainder;
            const storedEnergy = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
            for (let i = 0; i < readySettlements; i += 1) {
                const energyTotal = nextEnergyRemainder + snapshot.energyPerSettlement;
                const batchCost = Math.floor(energyTotal + 1e-9);
                if (energyCost + batchCost > storedEnergy) break;
                energyCost += batchCost;
                nextEnergyRemainder = energyTotal - batchCost;
                settlements += 1;
            }
            if (settlements <= 0 || (energyCost > 0 && !EnergyManager?.deductEnergy?.(energyCost))) {
                building._economyWorking = false;
                building._economyTickMs = Math.min(
                    building._economyTickMs,
                    snapshot.settlementIntervalMs
                );
                return;
            }
            building._grandMallEnergyRemainder = nextEnergyRemainder;
            building._economyTickMs -= settlements * snapshot.settlementIntervalMs;
            if (settlements < readySettlements) {
                building._economyTickMs = Math.min(building._economyTickMs, snapshot.settlementIntervalMs);
            }
            const total = building._grandMallGoldRemainder
                + snapshot.goldPerSettlement * settlements * getProductionResourceMul();
            const gold = Math.floor(total);
            building._grandMallGoldRemainder = total - gold;
            building._economyWorking = true;
            if (gold > 0) {
                const routed = routeBankGold(gold);
                if (routed.remaining > 0 && Game?.dropItem) {
                    Game.dropItem(building.x, building.y, createGoldItem(routed.remaining));
                }
            }
            return;
        }
        if (building._economyType === 'stock_exchange'
            || building._economyType === 'computing_center') {
            const isComputing = building._economyType === 'computing_center';
            if (isComputing) this._updateComputingCenterUpgrade(building, elapsedDt);
            const snapshot = isComputing
                ? this.getComputingCenterSnapshot(building)
                : this.getStockExchangeSnapshot(building);
            const energyRemainderField = isComputing
                ? '_computingCenterEnergyRemainder'
                : '_stockExchangeEnergyRemainder';
            const goldRemainderField = isComputing
                ? '_computingCenterGoldRemainder'
                : '_stockExchangeGoldRemainder';
            if (snapshot.goldPerSettlement <= 0 || snapshot.energyPerSettlement <= 0) {
                building._economyWorking = false;
                building._economyTickMs = 0;
                return;
            }
            building._economyTickMs += elapsedDt;
            if (building._economyTickMs < snapshot.settlementIntervalMs) {
                building._economyWorking = snapshot.canOperate;
                return;
            }
            const readySettlements = Math.floor(
                building._economyTickMs / snapshot.settlementIntervalMs
            );
            let settlements = 0;
            let energyCost = 0;
            let nextEnergyRemainder = Math.max(0,
                Number(building[energyRemainderField]) || 0);
            const storedEnergy = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
            for (let i = 0; i < readySettlements; i += 1) {
                const energyTotal = nextEnergyRemainder + snapshot.energyPerSettlement;
                const batchCost = Math.floor(energyTotal + 1e-9);
                if (energyCost + batchCost > storedEnergy) break;
                energyCost += batchCost;
                nextEnergyRemainder = energyTotal - batchCost;
                settlements += 1;
            }
            if (settlements <= 0 || (energyCost > 0
                && !EnergyManager?.deductEnergy?.(energyCost))) {
                building._economyWorking = false;
                building._economyTickMs = Math.min(
                    building._economyTickMs,
                    snapshot.settlementIntervalMs
                );
                return;
            }
            building[energyRemainderField] = nextEnergyRemainder;
            building._economyTickMs -= settlements * snapshot.settlementIntervalMs;
            if (settlements < readySettlements) {
                building._economyTickMs = Math.min(
                    building._economyTickMs,
                    snapshot.settlementIntervalMs
                );
            }
            const baseAndPopulation = snapshot.baseContribution
                + snapshot.populationContribution;
            const goldBalanceRate = snapshot.effectiveGoldBalanceRate;
            let currentGold = Math.max(0, getPlayerTotalGold());
            let goldRemainder = Math.max(0,
                Number(building[goldRemainderField]) || 0);
            let gold = 0;
            for (let i = 0; i < settlements; i += 1) {
                const total = goldRemainder + (baseAndPopulation
                    + currentGold * goldBalanceRate)
                    * snapshot.settlementIntervalMs / 1000;
                const produced = Math.floor(total);
                goldRemainder = total - produced;
                gold += produced;
                currentGold += produced;
            }
            building[goldRemainderField] = goldRemainder;
            building._economyWorking = true;
            if (gold > 0) {
                const routed = routeBankGold(gold);
                if (routed.remaining > 0 && Game?.dropItem) {
                    Game.dropItem(building.x, building.y, createGoldItem(routed.remaining));
                }
            }
            return;
        }
        building._economyTickMs += elapsedDt;
        const tickMs = Math.max(100, Number(populationEconomyConfig.tickMs) || 1000);
        if (building._economyTickMs < tickMs) return;
        const elapsedMs = building._economyTickMs;
        building._economyTickMs = 0;
        const elapsedSeconds = elapsedMs / 1000;
        if (building._economyType === 'windmill') {
            const total = building._workProductionRemainder
                + this.getWindmillFoodPerSecond(building) * elapsedSeconds * getProductionResourceMul();
            const food = Math.floor(total);
            building._workProductionRemainder = total - food;
            if (food > 0) {
                const stored = this.addFood(food);
                building._workProductionRemainder += Math.max(0, food - stored);
            }
        } else if (building._economyType === 'market') {
            const cfg = populationEconomyConfig.market || {};
            const workers = Math.max(0, Number(building._assignedWorkers) || 0)
                * this.getLaborEfficiency()
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
            const decayMultiplier = 1
                + workers * Math.max(0, Number(cfg.pressureDecayMultiplierPerWorker) || 0);
            const decay = Math.max(0, Number(cfg.pressureDecayPerSecond) || 0)
                * decayMultiplier * elapsedSeconds;
            if (building._marketPressure > 0) building._marketPressure = Math.max(0, building._marketPressure - decay);
            else building._marketPressure = Math.min(0, building._marketPressure + decay);
        }
    },
};

// 军事人口与经济人口只共享房屋容量；岗位占用和军事单位占用彼此独立。
MilitaryPopulationSystem.setCapacityProvider(() => PopulationEconomySystem.getPopulationCapacity());
EconomyHudSystem.setPopulationProvider(() => PopulationEconomySystem.getPopulationSnapshot());

export { populationEconomyConfig };
