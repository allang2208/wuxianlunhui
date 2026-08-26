import populationEconomyConfig from '../../data/population-economy.json';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { Game } from '../game.js';
import { EffectManager } from '../effects/effect-manager.js';
import { BuildingFootprintDustEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import { createGoldItem, routeProducedGold as routeBankGold } from './economy-gold-routing.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { BankEconomySystem } from './bank-economy-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { TechnologySystem } from './technology-system.js';
import { MilitaryPopulationSystem } from './military-population-system.js';
import { EconomyHudSystem } from './economy-hud-system.js';
import { getAbilityLevel, getAbilityValue } from './ability-store.js';
import {
    getBuildingModuleUpgradeCost,
    getBuildingUpgradeAbility,
} from './building-upgrade-projects.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function houseLevel(level) {
    const levels = populationEconomyConfig.house?.levels || [];
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

function workforceConfig(type) {
    if (!type || type === 'housing') return null;
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
        building._pendingGoldDrop = Math.max(0, Math.floor(Number(saved.pendingGoldDrop) || 0));
        building._workProductionRemainder = Math.max(0, Number(saved.workProductionRemainder) || 0);
        building._marketPressure = Number.isFinite(Number(saved.marketPressure))
            ? Number(saved.marketPressure)
            : 0;
        building._economyUpgrade = saved.economyUpgrade ? {
            targetLevel: Math.max(1, Math.floor(Number(saved.economyUpgrade.targetLevel) || 1)),
            totalMs: Math.max(1, Number(saved.economyUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.economyUpgrade.remainMs) || 0),
        } : null;
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
        if (building._economyType === 'housing') this.applyHouseLevel(building, building._economyLevel);
        if (building._economyType === 'research') this.applyResearchLevel(building, building._economyLevel);
        const workerCfg = workforceConfig(building._economyType);
        const slots = workforceSlots(building, workerCfg,
            saved.bankModules || saved.workshopModules || saved.armoryModules
                || saved.resonatorModules);
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
            if (!building?.active || !workforceConfig(building._economyType)) continue;
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
        const type = typeof buildingOrType === 'string'
            ? buildingOrType
            : buildingOrType?._economyType;
        return workforceConfig(type);
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
        building._economyLevel = level;
        building.spriteCfg.idleKey = cfg.tex;
        building.spriteCfg.size = cfg.displayW;
        building.spriteCfg.sizeH = cfg.displayH;
        building.spriteCfg.footOffsetY = cfg.footOffsetY;
        building.spriteCfg.visualFootprint = cfg.visualFootprint
            ? { ...cfg.visualFootprint } : null;
        building.footOffsetY = cfg.footOffsetY;
        building.size = cfg.displayW;
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
        return { ok: true, cost, targetLevel: next.level };
    },

    applyResearchLevel(building, requestedLevel) {
        const levels = populationEconomyConfig.research?.levels || [];
        if (!building || levels.length === 0) return null;
        const maxLevel = Math.max(1, ...levels.map((entry) => Math.max(1,
            Math.floor(Number(entry.level) || 1))));
        const level = clamp(Math.floor(Number(requestedLevel) || 1), 1, maxLevel);
        const cfg = researchLevel(level);
        building._economyLevel = level;
        building.spriteCfg.idleKey = cfg.tex;
        building.spriteCfg.size = cfg.displayW;
        building.spriteCfg.sizeH = cfg.displayH;
        building.spriteCfg.footOffsetY = cfg.footOffsetY;
        building.spriteCfg.visualFootprint = cfg.visualFootprint
            ? { ...cfg.visualFootprint } : null;
        building.footOffsetY = cfg.footOffsetY;
        building.size = cfg.displayW;
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
        if (building?._economyType !== 'research') return { ok: false, reason: '该建筑不是研究院' };
        if (building._economyUpgrade) return { ok: false, reason: '研究院正在升级' };
        const next = this.getResearchUpgrade(building);
        if (!next) return { ok: false, reason: '研究院已达到最高等级' };
        const lockReason = this.getResearchUpgradeLockReason(building);
        if (lockReason) return { ok: false, reason: lockReason };
        const cost = next.upgradeCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        building._economyUpgrade = { targetLevel: next.level, totalMs: timeMs, remainMs: timeMs };
        return { ok: true, cost, targetLevel: next.level };
    },

    getResearchSnapshot(building) {
        const cfg = populationEconomyConfig.research || {};
        const levelCfg = researchLevel(building?._economyLevel || 1) || {};
        const baseAbilityId = cfg.baseResearchAbilityId;
        const baseBonus = baseAbilityId
            ? Math.max(0, getAbilityValue(
                getBuildingUpgradeAbility(baseAbilityId),
                getAbilityLevel(baseAbilityId)
            ))
            : 0;
        const levelBaseResearchPoints = Math.max(0,
            Number(levelCfg.baseResearchPointsPerSecond) || 0);
        const configuredResearchPointsPerSecond = levelBaseResearchPoints + baseBonus;
        const staffCapacity = workforceSlots(building, cfg);
        const staffedCount = Math.min(
            staffCapacity,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
        const workerEfficiencyShare = Math.max(0, Number(cfg.workerEfficiencyShare) || 0.2);
        const staffFactor = clamp(staffedCount * workerEfficiencyShare, 0, 1);
        const laborEfficiency = this.getLaborEfficiency();
        const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
        return {
            level: Math.max(1, Math.floor(Number(building?._economyLevel) || 1)),
            levelBaseResearchPoints,
            baseBonus,
            configuredResearchPointsPerSecond,
            staffCapacity,
            staffedCount,
            workerEfficiencyShare,
            staffFactor,
            laborEfficiency,
            workshopMultiplier,
            actualResearchPointsPerSecond: configuredResearchPointsPerSecond
                * staffFactor * laborEfficiency * workshopMultiplier,
        };
    },

    getLiveResearchSummary(buildings = null) {
        const source = buildings || this._buildings;
        let count = 0;
        let rate = 0;
        for (const building of source || []) {
            if (!building?.active || building._sinking || building._economyType !== 'research') continue;
            if (Number(building?.hp ?? building?.data?.hp ?? 1) <= 0) continue;
            count += 1;
            rate += this.getResearchSnapshot(building).actualResearchPointsPerSecond;
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
        else if (building._economyType === 'research') this.applyResearchLevel(building, targetLevel);
        else return;
        EffectManager.add(new BuildingFootprintDustEffect(building));
        const soundPath = populationEconomyConfig[building._economyType]?.upgradeCompleteSound;
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
        const rate = Math.max(0, Number(populationEconomyConfig.windmill?.foodPerWorkerPerSecond) || 0);
        const laborEfficiency = this.getLaborEfficiency();
        if (building) {
            if (building._economyType !== 'windmill' || !building.active) return 0;
            return Math.max(0, Number(building._assignedWorkers) || 0) * rate * laborEfficiency
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
        }
        let total = 0;
        for (const entry of this._buildings) {
            if (entry?.active && entry._economyType === 'windmill') {
                total += Math.max(0, Number(entry._assignedWorkers) || 0) * rate
                    * WorkshopEconomySystem.getEfficiencyMultiplier(entry);
            }
        }
        return total * laborEfficiency;
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
        const goldPerPopulation = BankEconomySystem.getGoldPerPopulation(building);
        const settlementIntervalMs = BankEconomySystem.getSettlementIntervalMs(
            building,
            populationEconomyConfig.bank?.settlementIntervalMs
        );
        const goldPerSettlement = effectiveServicePopulation * goldPerPopulation * assignedWorkers
            * laborEfficiency * workshopMultiplier;
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
        const configuredEnergyPerSecond = cycleMs > 0
            ? energyPerCycle * conversionRate * 1000 / cycleMs
            : 0;
        const actualEnergyPerSecond = configuredEnergyPerSecond * staffFactor
            * laborEfficiency * workshopMultiplier;
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
        if (building._economyType === 'research') return;
        if (building._economyType === 'planar_resonator') {
            this._updateResonatorUpgrade(building, elapsedDt);
            const snapshot = this.getPlanarResonatorSnapshot(building);
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
                    * snapshot.workshopMultiplier * cycles * getProductionResourceMul();
            const energy = Math.floor(total);
            building._workProductionRemainder = total - energy;
            if (energy > 0) {
                const stored = EnergyManager?.depositEnergy?.(energy) || 0;
                building._workProductionRemainder += Math.max(0, energy - stored);
            }
            return;
        }
        if (building._economyType === 'bakery') return;
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
