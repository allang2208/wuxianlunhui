const toSafeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const clamp01 = (value) => Math.max(0, Math.min(1, toSafeNumber(value)));

const fmtInt = (value) => Math.max(0, Math.floor(toSafeNumber(value))).toLocaleString('zh-CN');

const fmtSignedRate = (value) => {
    const ratio = toSafeNumber(value);
    const percent = Math.round(ratio * 1000) / 10;
    const sign = percent > 0 ? '+' : '';
    return `${sign}${percent}%`;
};

const fmtSignedPoint = (value) => {
    const point = toSafeNumber(value);
    const sign = point > 0 ? '+' : '';
    return `${sign}${point.toFixed(1)}点`;
};

const fmtDecimalBound = (value) => {
    const safe = toSafeNumber(value);
    const clamped = Math.max(0, Math.min(100, safe));
    return clamped.toFixed(1);
};

const fmtInterval = (ms) => Number((toSafeNumber(ms) / 1000).toFixed(2)) + '秒';

const fmtSeconds = (ms) => {
    const totalSeconds = Math.max(0, Math.ceil(toSafeNumber(ms) / 1000));
    if (totalSeconds <= 0) return '0秒';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins <= 0) return `${secs}秒`;
    return `${mins}分${secs}秒`;
};

const modeLabel = {
    growing: '增长中',
    full: '住房已满 · 减速增长',
    homeless: '住房不足 · 减速增长',
    declining: '流失中',
    empty: '暂无增长',
};

const happinessFactors = [
    { key: 'food', label: '食物', icon: 'food' },
    { key: 'housing', label: '住房', icon: 'housing' },
    { key: 'quality', label: '住房品质', icon: 'housing-quality' },
    { key: 'entertainment', label: '娱乐服务', icon: 'entertainment' },
    { key: 'commerce', label: '商业便利', icon: 'commerce' },
    { key: 'safety', label: '安全感', icon: 'safety' },
];

// 图标只辅助识别，名称与分值仍由原数据节点表达；读取128px透明运行时副本。
const renderHappinessIcon = (icon) => `<img class="ch-happiness-icon" src="assets/ui/happiness/${icon}.png" width="32" height="32" alt="" aria-hidden="true" draggable="false" decoding="async">`;

const getHappinessTone = (value) => {
    const score = Math.max(0, Math.min(100, toSafeNumber(value)));
    if (score >= 60) return 'good';
    if (score >= 40) return 'normal';
    if (score >= 20) return 'medium';
    return 'bad';
};

const describeFoodLine = (growth, totalPopulation) => {
    const nextFoodIn = toSafeNumber(growth.nextFoodInMs);
    const foodIntervalMs = toSafeNumber(growth.foodIntervalMs);
    const baseFood = toSafeNumber(growth.foodPerPopulation) || 1;
    const total = toSafeNumber(totalPopulation);
    const intervalText = `${fmtSeconds(foodIntervalMs)}`;
    const foodPerCycle = Number.isInteger(baseFood) ? baseFood : baseFood.toFixed(2);
    const rule = `${intervalText} · 每人每次 ${foodPerCycle} 食物`;
    const fallbackCost = toSafeNumber(growth.nextFoodCost);
    const foodCost = fallbackCost > 0 ? fallbackCost : Math.max(0, Math.ceil(total * baseFood));
    const estimatedByPop = foodCost > 0 ? `（按当前人口 ${fmtInt(total)} 人估算）` : '（当前无可结算人口）';
    return `${foodCost > 0 ? `食物结算倒计时 ${fmtSeconds(nextFoodIn)} · 下次消耗 ${fmtInt(foodCost)} 食物` : '食物结算：未产生人口消耗'}${estimatedByPop}（${rule}）`;
};

const renderHappinessFactors = () => happinessFactors
    .map((item) => `
        <p class="ch-happiness-factor" data-pop-growth-happiness-factor="${item.key}">
            <strong class="ch-happiness-factor-title">
                ${renderHappinessIcon(item.icon)}
                <span data-pop-growth-happiness-factor-label>${item.label}</span>
            </strong>
            <span>
                <b data-pop-growth-happiness-factor-value>0.0点</b>
                <small data-pop-growth-happiness-factor-detail>—</small>
            </span>
        </p>`)
    .join('');

export const renderPopulationGrowth = () => `
<div class="ch-pop-growth" data-population-growth>
    <div class="ch-section-heading">
        <h3>人口增长</h3>
        <strong class="ch-kicker" data-pop-growth-state>待获取状态</strong>
    </div>
    <div class="ch-pop-growth-summary">
        <div class="ch-pop-growth-metric">
            <small>实际人口 / 住房容量</small>
            <strong data-pop-growth-pop>0 / 0</strong>
            <p data-pop-growth-free>空闲：0 · 超额：0</p>
        </div>
        <div class="ch-pop-growth-metric">
            <small>变化状态</small>
            <strong data-pop-growth-progress-text>0%</strong>
            <p data-pop-growth-rate>净变化：0.0 人/分钟</p>
        </div>
    </div>
    <div data-pop-growth-track class="ch-pop-growth-track is-empty" role="progressbar" aria-label="人口变化进度" aria-valuemin="0" aria-valuemax="1">
        <span data-pop-growth-fill class="ch-pop-growth-fill"></span>
    </div>
    <p class="ch-pop-growth-meta" data-pop-growth-meta>等待系统结算数据</p>
    <p class="ch-pop-growth-note" data-pop-growth-base></p>
    <p class="ch-pop-growth-note" data-pop-growth-cycle></p>
    <p class="ch-pop-growth-note" data-pop-growth-food>食物结算：0秒 · 下次消耗 0 食物</p>
    <p class="ch-pop-growth-note" data-pop-growth-shortage>缺粮次数：0</p>
    <div class="ch-pop-growth-modifiers">
        <p><strong>食物</strong><span data-pop-growth-food-mod>后续开发</span></p>
        <p><strong>住房</strong><span data-pop-growth-housing-mod>后续开发</span></p>
        <p><strong>幸福</strong><span data-pop-growth-happiness-mod>0%</span></p>
        <p><strong>祭品</strong><span data-pop-growth-tribute-mod>后续开发</span></p>
    </div>
    <div class="ch-pop-growth-happiness" data-pop-growth-happiness>
        <div class="ch-pop-growth-section-heading">
            <h4 class="ch-happiness-title">${renderHappinessIcon('happiness')}<span>幸福度</span></h4>
            <strong data-pop-growth-happiness-state>等待首次结算</strong>
        </div>
        <div class="ch-pop-growth-track ch-pop-growth-happiness-track" data-pop-growth-happiness-track role="progressbar" aria-label="幸福度进度" aria-valuemin="0" aria-valuemax="100">
            <span data-pop-growth-happiness-fill class="ch-pop-growth-fill ch-pop-happiness-fill"></span>
        </div>
        <div class="ch-pop-growth-happiness-grid">
            <div class="ch-pop-growth-metric">
                <small>当前幸福度</small>
                <strong class="ch-happiness-value" data-pop-growth-happiness-value>0.0</strong>
            </div>
            <div class="ch-pop-growth-metric">
                <small>目标幸福度（上次结算）</small>
                <strong data-pop-growth-happiness-target>待结算</strong>
            </div>
            <div class="ch-pop-growth-metric">
                <small>最近一次变化</small>
                <strong data-pop-growth-happiness-change>0.0点</strong>
            </div>
            <div class="ch-pop-growth-metric">
                <small>下次 20 秒结算</small>
                <strong data-pop-growth-happiness-next>0秒</strong>
            </div>
            <div class="ch-pop-growth-metric ch-pop-growth-metric-wide">
                <small>对人口增长综合修正</small>
                <strong data-pop-growth-happiness-modifier>0%</strong>
            </div>
        </div>
        <p class="ch-pop-growth-note ch-pop-growth-happiness-guide" data-pop-growth-happiness-guide>
            每个位面独立；每20秒按六项更新目标，单次最多+3/−6点；服务按周期实际营业时长、岗位、居民覆盖折算；幸福修正=(幸福度−50)×0.8%，与其他项先相加
        </p>
        <div class="ch-pop-growth-happiness-factors" data-pop-growth-happiness-factors>
            ${renderHappinessFactors()}
        </div>
    </div>
</div>
`;

export const refreshPopulationGrowth = (root, snapshot) => {
    const data = snapshot || {};
    const population = {
        total: toSafeNumber(data.total),
        capacity: toSafeNumber(data.capacity),
        used: toSafeNumber(data.used),
        free: toSafeNumber(data.free),
        overcrowded: toSafeNumber(data.overcrowded),
        growth: data.growth || {},
    };
    const growth = population.growth || {};
    const happiness = growth.happiness || {};
    const mode = growth.mode || 'empty';
    const progress = clamp01(growth.progress);
    const rateMultiplier = Number.isFinite(toSafeNumber(growth.rateMultiplier)) && growth.rateMultiplier !== undefined
        ? toSafeNumber(growth.rateMultiplier)
        : 0;
    const growthRemaining = toSafeNumber(growth.remainingMs);
    const statusLabel = modeLabel[mode] || '待更新';

    const happinessValueRaw = toSafeNumber(happiness.value);
    const happinessValue = fmtDecimalBound(happinessValueRaw);
    const happinessTargetRaw = toSafeNumber(happiness.target);
    const happinessTarget = happiness.settled ? fmtDecimalBound(happinessTargetRaw) : '待结算';
    const happinessChange = happiness.settled ? fmtSignedPoint(happiness.change) : '0.0点';
    const happinessModifier = fmtSignedRate(toSafeNumber(happiness.modifier));
    const happinessNextSettlement = toSafeNumber(happiness.nextSettlementMs);
    const happinessSettled = happiness.settled === true;
    const happinessFrozen = happiness.frozen === true;
    const factors = Array.isArray(happiness.factors) ? happiness.factors : [];
    const factorMap = new Map();
    for (const factor of factors) {
        if (!factor || typeof factor !== 'object') continue;
        const key = `${factor.key}`;
        if (!key) continue;
        factorMap.set(key, factor);
    }

    const isRootPopulationComponent = root.matches?.('[data-population-growth]');
    const components = isRootPopulationComponent ? [root] : Array.from(root.querySelectorAll('[data-population-growth]'));
    for (const component of components) {
        const track = component.querySelector('[data-pop-growth-track]');
        const fill = component.querySelector('[data-pop-growth-fill]');
        const happinessTrack = component.querySelector('[data-pop-growth-happiness-track]');
        const happinessFill = component.querySelector('[data-pop-growth-happiness-fill]');
        if (!track || !fill) continue;

        const isDeclining = mode === 'declining';
        const isFoodWarning = !isDeclining && toSafeNumber(growth.foodModifier) < 0;
        const visualMode = isDeclining
            ? 'declining'
            : isFoodWarning
                ? 'warning'
                : mode;

        track.classList.remove('is-empty', 'is-growing', 'is-full', 'is-homeless', 'is-declining', 'is-warning');
        track.classList.add(`is-${visualMode}`);

        fill.style.width = `${(progress * 100).toFixed(2)}%`;

        const state = component.querySelector('[data-pop-growth-state]');
        const popText = component.querySelector('[data-pop-growth-pop]');
        const freeText = component.querySelector('[data-pop-growth-free]');
        const progressText = component.querySelector('[data-pop-growth-progress-text]');
        const rateText = component.querySelector('[data-pop-growth-rate]');
        const baseText = component.querySelector('[data-pop-growth-base]');
        const cycleText = component.querySelector('[data-pop-growth-cycle]');
        const meta = component.querySelector('[data-pop-growth-meta]');
        const foodText = component.querySelector('[data-pop-growth-food]');
        const shortageText = component.querySelector('[data-pop-growth-shortage]');
        const foodMod = component.querySelector('[data-pop-growth-food-mod]');
        const housingMod = component.querySelector('[data-pop-growth-housing-mod]');
        const happinessMod = component.querySelector('[data-pop-growth-happiness-mod]');
        const tributeMod = component.querySelector('[data-pop-growth-tribute-mod]');

        const happinessCard = component.querySelector('[data-pop-growth-happiness]');
        const happinessStateText = component.querySelector('[data-pop-growth-happiness-state]');
        const happinessValueText = component.querySelector('[data-pop-growth-happiness-value]');
        const happinessTargetText = component.querySelector('[data-pop-growth-happiness-target]');
        const happinessChangeText = component.querySelector('[data-pop-growth-happiness-change]');
        const happinessNextText = component.querySelector('[data-pop-growth-happiness-next]');
        const happinessModifierText = component.querySelector('[data-pop-growth-happiness-modifier]');

        if (state) state.textContent = statusLabel;
        if (popText) popText.textContent = `${fmtInt(population.total)} / ${fmtInt(population.capacity)}`;
        if (freeText) freeText.textContent = `已用 ${fmtInt(population.used)} · 空闲 ${fmtInt(population.free)}${population.overcrowded > 0 ? ` · 超额 ${fmtInt(population.overcrowded)}` : ''}`;
        if (progressText) progressText.textContent = `${Math.round(progress * 100)}%${mode === 'declining' ? ' 剩余' : ''}`;
        const perMinute = rateMultiplier * 60000 / Math.max(1, toSafeNumber(growth.baseIntervalMs));
        if (rateText) rateText.textContent = `净变化：${perMinute > 0 ? '+' : ''}${perMinute.toFixed(1)} 人/分钟`;
        if (baseText) baseText.textContent = `基础周期：每 ${fmtSeconds(growth.baseIntervalMs)} 新增 1 人 · 同位面全部房屋共用`;
        if (cycleText) {
            cycleText.textContent = mode === 'declining'
                ? `饥荒独立结算：每 ${fmtSeconds(growth.intervalMs)} 流失 1 人`
                : rateMultiplier > 0
                    ? `综合修正：${fmtSignedRate(growth.combinedModifier)} · 当前生成周期：${fmtInterval(growth.intervalMs)} / 人`
                    : '各项修正先加减，再调整基础周期；住房已满只减速增长';
        }
        if (meta) {
            meta.textContent = mode === 'declining'
                ? `流失倒计时 ${fmtSeconds(growthRemaining)}`
                : rateMultiplier > 0
                    ? `增长倒计时 ${fmtSeconds(growthRemaining)}`
                    : `暂停 ${statusLabel}`;
        }
        if (foodText) foodText.textContent = describeFoodLine(growth, population.total);
        if (shortageText) shortageText.textContent = `连续缺粮：${fmtInt(growth.shortageCycles)} 次`;
        if (foodMod) foodMod.textContent = '当前：' + fmtSignedRate(growth.foodModifier);
        if (housingMod) housingMod.textContent = '当前：' + fmtSignedRate(growth.housingModifier);
        if (happinessMod) happinessMod.textContent = '当前：' + fmtSignedRate(growth.happinessModifier);
        if (tributeMod) tributeMod.textContent = toSafeNumber(growth.tributeModifier) === 0 ? '后续开发' : fmtSignedRate(growth.tributeModifier);

        if (happinessCard) {
            const happinessState = happinessFrozen
                ? '无人暂停'
                : (happinessSettled ? (Math.abs(happinessValueRaw - happinessTargetRaw) < 0.01 ? '稳定' : '向目标调整') : '等待首次结算');
            if (happinessStateText) happinessStateText.textContent = happinessState;

            if (happinessValueText) {
                happinessValueText.textContent = happinessValue;
            }
            if (happinessTargetText) {
                happinessTargetText.textContent = happinessTarget;
            }
            if (happinessChangeText) {
                happinessChangeText.textContent = happinessChange;
            }
            if (happinessNextText) {
                happinessNextText.textContent = happinessFrozen ? '暂停' : fmtSeconds(happinessNextSettlement);
            }
            if (happinessModifierText) {
                happinessModifierText.textContent = happinessModifier;
            }

            for (const item of happinessFactors) {
                const row = happinessCard.querySelector(`[data-pop-growth-happiness-factor="${item.key}"]`);
                if (!row) continue;

                const labelNode = row.querySelector('[data-pop-growth-happiness-factor-label]');
                const valueNode = row.querySelector('[data-pop-growth-happiness-factor-value]');
                const detailNode = row.querySelector('[data-pop-growth-happiness-factor-detail]');
                const factor = factorMap.get(item.key) || {};
                const labelText = factor.label || item.label;
                const valueText = fmtSignedPoint(toSafeNumber(factor.value));
                const detailText = `${factor.detail || '—'}`;

                if (labelNode) labelNode.textContent = labelText;
                if (valueNode) valueNode.textContent = valueText;
                if (detailNode) detailNode.textContent = detailText;
            }

            const happinessTone = getHappinessTone(happinessValueRaw);
            happinessCard.setAttribute('data-pop-happiness-tone', happinessTone);

            if (happinessFill && happinessTrack) {
                const happinessProgress = clamp01(happinessValueRaw / 100);
                happinessFill.style.width = `${(happinessProgress * 100).toFixed(1)}%`;
                happinessTrack.setAttribute('aria-valuenow', `${happinessValue}`);
                happinessTrack.setAttribute('aria-valuetext', `幸福度 ${happinessValue}`);
                happinessTrack.setAttribute('aria-label', `幸福度 ${happinessValue} / 100`);
            }
        }

        track.setAttribute('aria-valuenow', `${progress.toFixed(2)}`);
        track.setAttribute('aria-label', `${statusLabel}，进度 ${(progress * 100).toFixed(2)}%`);
        track.setAttribute('aria-valuetext', `${statusLabel}，${meta?.textContent || ''}`);
        component.setAttribute('data-population-growth-mode', mode);
        component.setAttribute('data-population-growth-tone', isFoodWarning ? 'warning' : isDeclining ? 'danger' : mode);
    }
};
