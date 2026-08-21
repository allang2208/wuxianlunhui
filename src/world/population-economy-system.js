import populationEconomyConfig from '../../data/population-economy.json';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { Game } from '../game.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { createGoldItem, routeProducedGold as routeBankGold } from './economy-gold-routing.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function houseLevel(level) {
    const levels = populationEconomyConfig.house?.levels || [];
    return levels.find((entry) => entry.level === level) || levels[0] || null;
}

function workforceConfig(type) {
    if (!type || type === 'housing') return null;
    const cfg = populationEconomyConfig[type];
    return cfg && (Math.max(0, Math.floor(Number(cfg.workerSlots) || 0)) > 0
        || !!cfg.workerSlotsModule) ? cfg : null;
}

function workforceSlots(building, cfg, savedModules = null) {
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
        if (building._economyType === 'housing') this.applyHouseLevel(building, building._economyLevel);
        const workerCfg = workforceConfig(building._economyType);
        const slots = workforceSlots(building, workerCfg, saved.workshopModules);
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

    startHouseUpgrade(building) {
        if (building?._economyType !== 'housing') return { ok: false, reason: '该建筑不是房屋' };
        if (building._economyUpgrade) return { ok: false, reason: '房屋正在升级' };
        const next = this.getHouseUpgrade(building);
        if (!next) return { ok: false, reason: '房屋已达到最高等级' };
        const cost = next.upgradeCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        building._economyUpgrade = { targetLevel: next.level, totalMs: timeMs, remainMs: timeMs };
        return { ok: true, cost, targetLevel: next.level };
    },

    _updateHouseUpgrade(building, dt) {
        if (!building._economyUpgrade) return;
        building._economyUpgrade.remainMs -= dt;
        if (building._economyUpgrade.remainMs > 0) return;
        const targetLevel = building._economyUpgrade.targetLevel;
        building._economyUpgrade = null;
        this.applyHouseLevel(building, targetLevel);
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
        if (value <= 0 || this.getFoodStored() < value) return false;
        return !!EnergyManager?.deductFood?.(value);
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

    getBankGoldPerSecond(building = null) {
        const rate = Math.max(0, Number(populationEconomyConfig.bank?.goldPerWorkerPerSecond) || 0);
        const laborEfficiency = this.getLaborEfficiency();
        if (building) {
            if (building._economyType !== 'bank' || !building.active) return 0;
            return Math.max(0, Number(building._assignedWorkers) || 0) * rate * laborEfficiency
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
        }
        let total = 0;
        for (const entry of this._buildings) {
            if (entry?.active && entry._economyType === 'bank') {
                total += Math.max(0, Number(entry._assignedWorkers) || 0) * rate
                    * WorkshopEconomySystem.getEfficiencyMultiplier(entry);
            }
        }
        return total * laborEfficiency;
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
        const effectiveWorkers = Math.max(0, Number(building?._assignedWorkers) || 0)
            * this.getLaborEfficiency()
            * WorkshopEconomySystem.getEfficiencyMultiplier(building);
        const pressure = clamp(
            this.getMarketPressure(building),
            Number(cfg.minPressure) || -0.5,
            Number(cfg.maxPressure) || 1.5
        );
        const mid = clamp(
            (Number(cfg.baseEnergyPerGold) || 10) * (1 + pressure),
            Number(cfg.minEnergyPerGold) || 5,
            Number(cfg.maxEnergyPerGold) || 25
        );
        const spread = clamp(
            (Number(cfg.spread) || 0)
                - effectiveWorkers * Math.max(0, Number(cfg.spreadReductionPerWorker) || 0),
            Math.max(0, Number(cfg.minSpread) || 0),
            0.49
        );
        return {
            midEnergyPerGold: mid,
            buyEnergyPerGold: mid * (1 + spread),
            sellEnergyPerGold: mid * (1 - spread),
            pressure,
            spread,
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

    updateBuilding(building, dt) {
        if (!building?._economyType || !building.active) return;
        this._updateHouseUpgrade(building, dt);
        building._economyTickMs += Math.max(0, Number(dt) || 0);
        const tickMs = Math.max(100, Number(populationEconomyConfig.tickMs) || 1000);
        if (building._economyTickMs < tickMs) return;
        const elapsedMs = building._economyTickMs;
        building._economyTickMs = 0;
        const elapsedSeconds = elapsedMs / 1000;
        if (building._economyType === 'bank') {
            const total = building._bankGoldRemainder + this.getBankGoldPerSecond(building) * elapsedSeconds;
            const gold = Math.floor(total);
            building._bankGoldRemainder = total - gold;
            if (gold > 0) {
                const routed = routeBankGold(gold);
                if (routed.remaining > 0 && Game?.dropItem) {
                    Game.dropItem(building.x, building.y, createGoldItem(routed.remaining));
                }
            }
        } else if (building._economyType === 'windmill') {
            const total = building._workProductionRemainder
                + this.getWindmillFoodPerSecond(building) * elapsedSeconds;
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

export { populationEconomyConfig };
