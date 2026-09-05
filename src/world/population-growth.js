import economyConfig from '../../data/population-economy.json';
import {
    restorePopulationHappiness, getPopulationHappinessModel, settlePopulationHappiness,
} from './population-happiness.js';

// 前台与后台共用的纯数值时钟；不访问实体、仓库、墙钟或全局位面。
export const POPULATION_GROWTH = economyConfig.populationGrowth;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const integer = (value) => Math.max(0, Math.floor(Number(value) || 0));
const EPSILON = 1e-8;

export function restorePopulationGrowth(saved = {}, legacyTotal = 0) {
    const current = Number(saved.populationVersion) >= 1;
    return {
        populationVersion: 1,
        happiness: restorePopulationHappiness(current ? saved.happiness : undefined),
        total: integer(current ? saved.total : legacyTotal),
        progress: current ? clamp(Number(saved.progress) || 0, 0, 1) : 0,
        direction: current && Number(saved.direction) === -1 ? -1 : 1,
        foodElapsedMs: current
            ? clamp(Number(saved.foodElapsedMs) || 0, 0, POPULATION_GROWTH.foodIntervalMs) : 0,
        shortageCycles: current ? integer(saved.shortageCycles) : 0,
        foodSatisfied: current && typeof saved.foodSatisfied === 'boolean' ? saved.foodSatisfied : null,
    };
}

export function getPopulationGrowthModel(state, capacity, foodStored) {
    const cfg = POPULATION_GROWTH;
    const total = integer(state.total);
    const housing = integer(capacity);
    const nextFoodCost = total * cfg.foodPerPopulation;
    const fed = state.foodSatisfied ?? (nextFoodCost > 0 && foodStored >= nextFoodCost);
    const penalty = Math.min(1, cfg.shortageInitialPenalty
        + Math.max(0, state.shortageCycles - cfg.shortageGraceCycles) * cfg.shortagePenaltyPerCycle);
    const starvation = !fed && penalty >= 1 - EPSILON && total > 0;
    const foodModifier = fed ? cfg.fedGrowthBonus : -penalty;
    const housingLimited = total >= housing && (total > 0 || housing > 0);
    const housingModifier = housingLimited ? -cfg.overcrowdingGrowthPenalty : 0;
    const happiness = getPopulationHappinessModel(state);
    const happinessModifier = happiness.modifier;
    const tributeModifier = cfg.tributeGrowthModifier;
    // 先合并百分比，再修正周期；满房 -80% 与供粮 +20% 对应 20s × 1.6 = 32s。
    const combinedModifier = foodModifier + housingModifier + happinessModifier + tributeModifier;
    const growthIntervalMs = Math.max(Math.max(1, Number(cfg.minIntervalMs) || 1),
        cfg.baseIntervalMs * (1 - combinedModifier));
    // 时钟仍消费速率，因此将周期换算为倒数；饥荒仅由食物自身状态触发。
    const potentialMultiplier = cfg.baseIntervalMs / growthIntervalMs;
    const mode = starvation ? 'declining'
        : housing <= 0 ? (total > 0 ? 'homeless' : 'empty')
            : total >= housing ? (total > housing ? 'homeless' : 'full') : 'growing';
    const rateMultiplier = starvation ? -cfg.starvationLossMultiplier
        : mode !== 'empty' ? potentialMultiplier : 0;
    const direction = Math.sign(rateMultiplier);
    const elapsed = direction && direction === state.direction ? state.progress : 0;
    const progress = mode === 'declining' ? 1 - elapsed : elapsed;
    return {
        mode, progress, rateMultiplier, potentialMultiplier, starvation, combinedModifier,
        intervalMs: rateMultiplier ? cfg.baseIntervalMs / Math.abs(rateMultiplier) : null,
        remainingMs: rateMultiplier ? (1 - elapsed) * cfg.baseIntervalMs / Math.abs(rateMultiplier) : null,
        baseIntervalMs: cfg.baseIntervalMs,
        foodIntervalMs: cfg.foodIntervalMs,
        foodPerPopulation: cfg.foodPerPopulation,
        nextFoodInMs: Math.max(0, cfg.foodIntervalMs - state.foodElapsedMs),
        nextFoodCost, foodStored, shortageCycles: state.shortageCycles,
        foodModifier, housingModifier, happinessModifier, tributeModifier, happiness,
    };
}

export function getPopulationNextEventMs(state, capacity, foodStored) {
    if (state.total <= 0 && capacity <= 0) return Infinity;
    const model = getPopulationGrowthModel(state, capacity, foodStored);
    return Math.max(0, Math.min(model.nextFoodInMs, model.remainingMs ?? Infinity));
}

/** 只推进到下一个人口/口粮边界。调用方先用旧岗位结算该段，再提交人口变化。 */
export function advancePopulationGrowth(state, elapsedMs, capacity, foodStored) {
    if (state.total <= 0 && capacity <= 0) {
        state.progress = 0;
        state.foodElapsedMs = 0;
        return 0;
    }
    const model = getPopulationGrowthModel(state, capacity, foodStored);
    const direction = Math.sign(model.rateMultiplier);
    if (direction && direction !== state.direction) {
        state.progress = 0;
        state.direction = direction;
    }
    if (direction) state.progress += elapsedMs * Math.abs(model.rateMultiplier) / model.baseIntervalMs;
    else state.progress = 0; // 仅实际无增长时清空；住房不足只减速，不清空进度。
    state.foodElapsedMs += elapsedMs;
    return direction;
}

/** 扣粮回调只允许当前位面的实存仓库；不足时吃掉剩余粮食并记一次缺粮。 */
export function settlePopulationEvents(state, capacity, getFood, spendFood, getHouses = () => []) {
    let born = 0;
    let lost = 0;
    if (state.progress >= 1 - EPSILON) {
        state.progress = 0;
        if (state.direction < 0 && state.total > 0) { state.total--; lost++; }
        else if (state.direction > 0 && (state.total > 0 || capacity > 0)) { state.total++; born++; }
    }
    let foodConsumed = 0;
    if (state.foodElapsedMs >= POPULATION_GROWTH.foodIntervalMs - EPSILON) {
        state.foodElapsedMs = Math.max(0, state.foodElapsedMs - POPULATION_GROWTH.foodIntervalMs);
        const cost = state.total * POPULATION_GROWTH.foodPerPopulation;
        const available = integer(getFood());
        const payable = Math.min(available, cost);
        const paid = payable <= 0 || spendFood(payable);
        foodConsumed = paid ? payable : 0;
        state.foodSatisfied = cost > 0 ? paid && payable >= cost : null;
        state.shortageCycles = cost <= 0 || state.foodSatisfied ? 0 : state.shortageCycles + 1;
        settlePopulationHappiness(state, getHouses());
    }
    // 饥荒/恢复切换独立的整人读条，不能拿未出生的人口抵消已有人口流失。
    const nextDirection = Math.sign(getPopulationGrowthModel(state, capacity, getFood()).rateMultiplier);
    if (nextDirection && nextDirection !== state.direction) {
        state.progress = 0;
        state.direction = nextDirection;
    }
    return { born, lost, foodConsumed };
}

/** 按住房容量比例分配实际居民（最大余数法），同样的建筑ID在前后台结果一致。 */
export function distributeResidents(houses, total) {
    const ordered = houses.map((house) => ({ ...house, capacity: integer(house.capacity) }))
        .filter((house) => house.capacity > 0)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const capacity = ordered.reduce((sum, house) => sum + house.capacity, 0);
    const housed = Math.min(integer(total), capacity);
    const allocations = new Map();
    let remaining = housed;
    for (const house of ordered) {
        const share = housed * house.capacity / capacity;
        house.fraction = share - Math.floor(share);
        allocations.set(house.key, Math.floor(share));
        remaining -= Math.floor(share);
    }
    ordered.sort((a, b) => b.fraction - a.fraction || String(a.id).localeCompare(String(b.id)));
    for (const house of ordered) {
        if (remaining-- <= 0) break;
        allocations.set(house.key, allocations.get(house.key) + 1);
    }
    return allocations;
}
