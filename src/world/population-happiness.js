import economyConfig from '../../data/population-economy.json';

export const POPULATION_HAPPINESS = economyConfig.populationHappiness;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const positive = (value) => Math.max(0, Number(value) || 0);
const factorDefinitions = [
    ['food', '食物保障'], ['housing', '住房供给'], ['quality', '住房品质'],
    ['entertainment', '娱乐服务'], ['commerce', '商业便利'], ['safety', '安全感'],
];

// 只注入只读查询，数值模块不依赖实体/入侵模块；幸福度本身始终保存在位面人口快照内。
let safetyProvider = () => ({ known: false });
export function setPopulationSafetyProvider(provider) { safetyProvider = provider; }
export function getPopulationSafety(sceneId, worldEpoch) { return safetyProvider(sceneId, worldEpoch); }

export function restorePopulationHappiness(saved = {}) {
    const cfg = POPULATION_HAPPINESS;
    return {
        version: 1,
        value: saved.version ? clamp(saved.value, 0, 100) : cfg.initialValue,
        target: saved.version ? clamp(saved.target, 0, 100) : cfg.initialValue,
        change: clamp(saved.change, -cfg.fallPerCycle, cfg.risePerCycle),
        settled: !!saved.settled,
        fedCycles: Math.floor(positive(saved.fedCycles)),
        peacefulMs: clamp(saved.peacefulMs, 0, cfg.peacefulMs),
        safety: { known: !!saved.safety?.known, sieged: !!saved.safety?.sieged,
            coreHpRatio: clamp(saved.safety?.coreHpRatio ?? 1, 0, 1) },
        sampleMs: clamp(saved.sampleMs, 0, economyConfig.populationGrowth.foodIntervalMs),
        entertainmentMs: clamp(saved.entertainmentMs, 0, economyConfig.populationGrowth.foodIntervalMs),
        commerceCredits: (Array.isArray(saved.commerceCredits) ? saved.commerceCredits : []).map((entry) => ({
            houseId: String(entry.houseId), mallId: String(entry.mallId),
            coverageMs: clamp(entry.coverageMs, 0, economyConfig.populationGrowth.foodIntervalMs),
        })),
        factors: factorDefinitions.map(([key, label]) => {
            const previous = saved.factors?.find?.((entry) => entry.key === key);
            return { key, label, value: clamp(previous?.value, -100, 100),
                detail: typeof previous?.detail === 'string' ? previous.detail : '等待首次结算' };
        }),
    };
}

export function getPopulationHappinessModel(state) {
    const h = state.happiness;
    const cfg = POPULATION_HAPPINESS;
    return {
        value: h.value, target: h.target, change: h.change, settled: h.settled,
        frozen: state.total <= 0,
        nextSettlementMs: Math.max(0, economyConfig.populationGrowth.foodIntervalMs - state.foodElapsedMs),
        modifier: clamp((h.value - cfg.initialValue) * cfg.growthModifierPerPoint,
            -cfg.maxGrowthModifier, cfg.maxGrowthModifier),
        factors: h.factors.map((factor) => ({ ...factor })),
    };
}

export function advancePopulationHappiness(state, elapsedMs, safety) {
    const h = state.happiness;
    if (state.total <= 0) {
        h.sampleMs = 0;
        h.entertainmentMs = 0;
        h.commerceCredits = [];
        h.fedCycles = 0;
        return;
    }
    h.sampleMs += positive(elapsedMs);
    h.safety = { known: !!safety?.known, sieged: !!safety?.sieged,
        coreHpRatio: clamp(safety?.coreHpRatio ?? 1, 0, 1) };
    h.peacefulMs = !h.safety.known || h.safety.sieged ? 0
        : Math.min(POPULATION_HAPPINESS.peacefulMs, h.peacefulMs + positive(elapsedMs));
}

/** windows 的时间相对本段起点；覆盖人数按同一时刻叠加后封顶，不能叠出超过100%的覆盖。 */
export function recordEntertainmentService(state, elapsedMs, windows) {
    if (state.total <= 0 || elapsedMs <= 0) return;
    const events = [];
    for (const window of windows) {
        const start = clamp(window.startMs, 0, elapsedMs);
        const end = clamp(window.endMs, start, elapsedMs);
        const seats = positive(window.seats);
        if (end > start && seats > 0) events.push([start, seats], [end, -seats]);
    }
    events.sort((a, b) => a[0] - b[0]);
    let seats = 0, cursor = 0;
    for (const [time, delta] of events) {
        state.happiness.entertainmentMs += (time - cursor) * Math.min(1, seats / state.total);
        seats += delta;
        cursor = time;
    }
}

/** 仅成功支付营业成本后记账，按每栋房屋居民占比累计；重叠商场取较高服务量，不重复加成。 */
export function recordCommerceService(state, mallId, houses, staffEfficiency, paidMs) {
    if (state.total <= 0 || paidMs <= 0) return;
    const credits = state.happiness.commerceCredits;
    for (const house of houses) {
        const coverageMs = positive(house.residents) / state.total * clamp(staffEfficiency, 0, 1) * paidMs;
        if (coverageMs <= 0) continue;
        const houseId = String(house.id);
        const id = String(mallId);
        let entry = credits.find((credit) => credit.houseId === houseId && credit.mallId === id);
        if (!entry) { entry = { houseId, mallId: id, coverageMs: 0 }; credits.push(entry); }
        entry.coverageMs += coverageMs;
    }
}

export function settlePopulationHappiness(state, houses = []) {
    const h = state.happiness;
    const cfg = POPULATION_HAPPINESS;
    if (state.total > 0) {
        h.fedCycles = state.foodSatisfied ? h.fedCycles + 1 : 0;
        const food = state.foodSatisfied
            ? h.fedCycles >= cfg.fedBonusCycles ? cfg.fedBonus : cfg.fedRecoveryBonus
            : state.shortageCycles >= 7 ? cfg.shortageSevere
                : state.shortageCycles >= 4 ? cfg.shortageModerate : cfg.shortageInitial;
        const capacity = houses.reduce((sum, house) => sum + positive(house.capacity), 0);
        const homeless = Math.max(0, state.total - capacity);
        const housing = homeless > 0 ? -cfg.homelessPenalty * homeless / state.total
            : capacity > 0 && state.total / capacity <= cfg.comfortableOccupancy ? cfg.housingSurplusBonus : 0;
        const quality = houses.reduce((sum, house) => sum + positive(house.residents)
            * (cfg.qualityByLevel[Math.floor(clamp(house.level, 1, cfg.qualityByLevel.length)) - 1] || 0), 0) / state.total;
        const sampleMs = h.sampleMs;
        const entertainmentCoverage = sampleMs > 0 ? clamp(h.entertainmentMs / sampleMs, 0, 1) : 0;
        const commerceByHouse = new Map();
        for (const credit of h.commerceCredits) {
            commerceByHouse.set(credit.houseId, Math.max(commerceByHouse.get(credit.houseId) || 0, credit.coverageMs));
        }
        const commerceMs = [...commerceByHouse.values()].reduce((sum, value) => sum + value, 0);
        const commerceCoverage = sampleMs > 0 ? clamp(commerceMs / sampleMs, 0, 1) : 0;
        const coreDamaged = h.safety.known && h.safety.coreHpRatio < cfg.coreWarningRatio;
        const safety = !h.safety.known ? 0
            : (h.safety.sieged ? -cfg.siegePenalty : h.peacefulMs >= cfg.peacefulMs ? cfg.peaceBonus : 0)
                - (coreDamaged ? cfg.coreDamagePenalty : 0);
        const values = [food, housing, quality, cfg.entertainmentMax * entertainmentCoverage,
            cfg.commerceMax * commerceCoverage, safety];
        const details = [
            state.foodSatisfied ? '连续足粮' + h.fedCycles + '次（3次后+10）'
                : '连续缺粮' + state.shortageCycles + '次（1–3次−5，4–6次−10，7次起−20）',
            homeless > 0 ? '无房居民' + homeless + '/' + state.total + '；按无房占比扣分'
                : '入住率' + (capacity ? state.total / capacity * 100 : 0).toFixed(1) + '%；不超过80%时+5',
            '按实际入住人数加权，1–7级分别0/2/4/6/8/10/12；无房居民按0计',
            '本周期有效宴饮覆盖' + (entertainmentCoverage * 100).toFixed(1) + '%；满岗酒馆服务' + cfg.tavernSeats + '人，最高+10',
            '本周期有效商业覆盖' + (commerceCoverage * 100).toFixed(1) + '%；按已支付能源、岗位和入住人口计，最高+10',
            !h.safety.known ? '暂无本位面核心状态；不计安全加分'
                : (h.safety.sieged ? '本位面正在遭受攻城−10'
                    : '连续和平' + Math.floor(h.peacefulMs / 1000) + '/' + cfg.peacefulMs / 1000 + '秒，达标+5')
                    + (coreDamaged ? '；核心生命低于50%额外−5' : ''),
        ];
        h.factors = factorDefinitions.map(([key, label], index) => ({ key, label, value: values[index], detail: details[index] }));
        h.target = clamp(cfg.initialValue + values.reduce((sum, value) => sum + value, 0), 0, 100);
        h.change = clamp(h.target - h.value, -cfg.fallPerCycle, cfg.risePerCycle);
        h.value = clamp(h.value + h.change, 0, 100);
        h.settled = true;
    } else {
        h.change = 0;
        h.fedCycles = 0;
    }
    h.sampleMs = 0;
    h.entertainmentMs = 0;
    h.commerceCredits = [];
}
