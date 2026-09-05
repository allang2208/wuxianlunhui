import economyConfig from '../../data/population-economy.json';

export const ECONOMY_RESOURCES = ['gold', 'energy', 'food'];
const positive = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const emptyFlow = () => ({ income: 0, expense: 0, net: 0, recurringIncome: 0,
    recurringExpense: 0, observedIncome: 0, observedExpense: 0 });

// 只读收支统计，不持有库存、不扣费。业务提供周期金额/秒速率，UI 不复制生产公式。
export const EconomyFlowSystem = {
    _providers: new Map(),
    _contextProvider: null,
    _key: null,
    _startedAt: 0,
    _lastTime: 0,
    _buckets: new Map(),
    _reportedErrors: new Set(),

    _reportError(id, error) {
        if (this._reportedErrors.has(id)) return;
        this._reportedErrors.add(id);
        console.warn(`[EconomyFlowSystem] ${id} 收支统计暂不可用`, error);
    },

    setContextProvider(provider) {
        this._contextProvider = provider;
        this._key = null;
        this._buckets.clear();
    },

    /** provider 返回 [{ resource, income, expense, intervalMs?, label? }]；无周期时单位为每秒。 */
    registerRateProvider(id, provider) {
        this._providers.set(id, provider);
        return () => {
            if (this._providers.get(id) === provider) this._providers.delete(id);
        };
    },

    getObservationWindowMs() {
        return Math.max(1000, positive(economyConfig.resourceAccounting?.observationWindowMs) || 60000);
    },

    _context() {
        let context;
        try { context = this._contextProvider?.(); }
        catch (error) { this._reportError('context', error); return null; }
        if (!context || context.enabled === false || !Number.isFinite(context.timeMs)) return null;
        const now = Math.max(0, context.timeMs);
        if (context.key !== this._key || now < this._lastTime) {
            this._key = context.key;
            this._startedAt = now;
            this._buckets.clear();
        }
        this._lastTime = now;
        const cutoff = now - this.getObservationWindowMs();
        for (const [time] of this._buckets) {
            if (time + 1000 <= cutoff) this._buckets.delete(time);
        }
        return { ...context, timeMs: now };
    },

    /** 资源入口仅记录成功变动。已由 provider 均摊的经营结算显式标记，避免重复计入。 */
    record(resource, delta, accounting = {}) {
        if (!Number.isFinite(delta) || delta === 0 || accounting?.ignore) return;
        if (accounting?.providerId && this._providers.has(accounting.providerId)) return;
        const context = this._context();
        if (!context) return;
        const time = Math.floor(context.timeMs / 1000) * 1000;
        let bucket = this._buckets.get(time);
        if (!bucket) this._buckets.set(time, bucket = new Map());
        let flow = bucket.get(resource);
        if (!flow) bucket.set(resource, flow = { income: 0, expense: 0 });
        if (delta > 0) flow.income += delta;
        else flow.expense -= delta;
    },

    getSnapshot() {
        const resources = Object.fromEntries(ECONOMY_RESOURCES.map((key) => [key, emptyFlow()]));
        const context = this._context();
        const windowMs = this.getObservationWindowMs();
        const observedMs = context ? Math.min(windowMs, Math.max(0, context.timeMs - this._startedAt)) : 0;
        const details = [];
        const unavailable = [];
        if (!context) return { resources, details, windowMs, observedMs, unavailable };
        for (const [id, provider] of this._providers) {
            let entries;
            try { entries = provider(context) || []; }
            catch (error) {
                this._reportError(id, error);
                unavailable.push(id);
                continue;
            }
            for (const entry of entries) {
                const intervalMs = entry.intervalMs == null ? 1000 : positive(entry.intervalMs);
                if (!entry.resource || intervalMs <= 0) continue;
                const income = positive(entry.income) * 1000 / intervalMs;
                const expense = positive(entry.expense) * 1000 / intervalMs;
                const flow = resources[entry.resource] ||= emptyFlow();
                flow.recurringIncome += income;
                flow.recurringExpense += expense;
                if (income || expense) details.push({ providerId: id, ...entry, income, expense });
            }
        }
        const seconds = Math.max(1, observedMs / 1000);
        for (const bucket of this._buckets.values()) {
            for (const [resource, amounts] of bucket) {
                const flow = resources[resource] ||= emptyFlow();
                flow.observedIncome += amounts.income / seconds;
                flow.observedExpense += amounts.expense / seconds;
            }
        }
        for (const flow of Object.values(resources)) {
            flow.income = flow.recurringIncome + flow.observedIncome;
            flow.expense = flow.recurringExpense + flow.observedExpense;
            flow.net = flow.income - flow.expense;
        }
        return { resources, details, windowMs, observedMs, unavailable };
    },
};
