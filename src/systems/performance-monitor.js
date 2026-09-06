import performanceConfig from '../../data/performance-config.json';

const sampling = performanceConfig.sampling || {};
const WINDOW_FRAMES = Math.max(30, Number(sampling.windowFrames) || 120);
const HISTORY_FRAMES = Math.max(WINDOW_FRAMES, Number(sampling.historyFrames) || 240);
const SLOW_FRAME_MS = Math.max(16.67, Number(sampling.slowFrameMs) || 33.34);

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

class PerformanceMonitorImpl {
    constructor() {
        this.reset();
    }

    reset() {
        this._frames = [];
        this._current = null;
        this._counters = Object.create(null);
        this._externalSections = Object.create(null);
        this._lifetimeFrames = 0;
        this._slowFrames = 0;
    }

    beginFrame(rawDt = 0) {
        if (this._current) this.endFrame();
        const externalSections = this._externalSections;
        this._current = {
            startedAt: nowMs(),
            rawDt: Number(rawDt) || 0,
            sections: { ...externalSections },
            externalTotalMs: Object.values(externalSections)
                .reduce((sum, value) => sum + (Number(value) || 0), 0),
        };
        this._externalSections = Object.create(null);
        return this._current.startedAt;
    }

    begin() {
        return nowMs();
    }

    end(name, startedAt) {
        if (!name || startedAt == null) return 0;
        const elapsed = Math.max(0, nowMs() - startedAt);
        if (this._current) {
            this._current.sections[name] = (this._current.sections[name] || 0) + elapsed;
        } else {
            this._externalSections[name] = (this._externalSections[name] || 0) + elapsed;
        }
        return elapsed;
    }

    measure(name, callback) {
        const startedAt = this.begin();
        try {
            return callback();
        } finally {
            this.end(name, startedAt);
        }
    }

    setCounter(name, value) {
        if (!name) return;
        const numeric = Number(value);
        this._counters[name] = Number.isFinite(numeric) ? numeric : value;
    }

    addCounter(name, amount = 1) {
        const current = Number(this._counters[name]) || 0;
        this._counters[name] = current + (Number(amount) || 0);
    }

    // 调试页读取即时计数，无需为每次刷新计算整段帧历史的分位数。
    getCounters() {
        return { ...this._counters };
    }

    endFrame() {
        if (!this._current) return;
        // Phaser 与逻辑层各有自己的 rAF。外部 section 不在当前逻辑回调的墙钟区间内，
        // 因此总 CPU 帧耗时必须把上一相邻 Phaser 同步耗时合入，不能只报 game.js 回调。
        const logicLoopMs = Math.max(0, nowMs() - this._current.startedAt);
        const totalMs = logicLoopMs + this._current.externalTotalMs;
        const frame = {
            rawDt: this._current.rawDt,
            totalMs,
            sections: this._current.sections,
        };
        this._frames.push(frame);
        if (this._frames.length > HISTORY_FRAMES) this._frames.shift();
        this._lifetimeFrames++;
        if (totalMs >= SLOW_FRAME_MS || frame.rawDt >= SLOW_FRAME_MS) this._slowFrames++;
        this._current = null;
    }

    getSnapshot(requestedWindowFrames = WINDOW_FRAMES) {
        const parsedWindowFrames = Number(requestedWindowFrames);
        const windowFrames = Math.max(
            30,
            Math.min(HISTORY_FRAMES, Number.isFinite(parsedWindowFrames)
                ? Math.round(parsedWindowFrames)
                : WINDOW_FRAMES),
        );
        const frames = this._frames.slice(-windowFrames);
        const count = frames.length;
        const totals = frames.map((frame) => frame.totalMs).sort((a, b) => a - b);
        const rawDts = frames.map((frame) => frame.rawDt).sort((a, b) => a - b);
        const frameIntervalGaps = frames
            .map((frame) => Math.max(0, frame.rawDt - frame.totalMs))
            .sort((a, b) => a - b);
        const percentile = (sorted, ratio) => {
            if (!sorted.length) return 0;
            return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
        };
        const sectionNames = new Set();
        for (const frame of frames) {
            for (const name of Object.keys(frame.sections)) sectionNames.add(name);
        }
        const sections = {};
        for (const name of sectionNames) {
            const values = frames.map((frame) => Number(frame.sections[name]) || 0);
            const sortedValues = [...values].sort((a, b) => a - b);
            const total = values.reduce((sum, value) => sum + value, 0);
            sections[name] = {
                totalMs: total,
                averageMs: count ? total / count : 0,
                p50Ms: percentile(sortedValues, 0.50),
                p95Ms: percentile(sortedValues, 0.95),
                p99Ms: percentile(sortedValues, 0.99),
                maxMs: values.length ? Math.max(...values) : 0,
                activeFrames: values.filter((value) => value > 0).length,
            };
        }
        const sampleDurationMs = rawDts.reduce((sum, value) => sum + value, 0);
        const measuredSectionTotalMs = Object.values(sections)
            .reduce((sum, section) => sum + section.totalMs, 0);
        for (const section of Object.values(sections)) {
            section.sharePercent = measuredSectionTotalMs > 0
                ? section.totalMs / measuredSectionTotalMs * 100
                : 0;
            section.wallSharePercent = sampleDurationMs > 0
                ? section.totalMs / sampleDurationMs * 100
                : 0;
            section.activeFramePercent = count ? section.activeFrames / count * 100 : 0;
        }
        const averageTotal = count ? totals.reduce((sum, value) => sum + value, 0) / count : 0;
        const averageRawDt = count ? rawDts.reduce((sum, value) => sum + value, 0) / count : 0;
        const averageFrameIntervalGap = count
            ? frameIntervalGaps.reduce((sum, value) => sum + value, 0) / count
            : 0;
        const windowCpuSlowFrames = frames.filter((frame) => frame.totalMs >= SLOW_FRAME_MS).length;
        const windowIntervalSlowFrames = frames.filter((frame) => frame.rawDt >= SLOW_FRAME_MS).length;
        const windowSlowFrames = frames.filter((frame) => (
            frame.totalMs >= SLOW_FRAME_MS || frame.rawDt >= SLOW_FRAME_MS
        )).length;
        const frameSamples = frames.map((frame, index) => ({
            sampleIndex: index + 1,
            rawDtMs: frame.rawDt,
            cpuMs: frame.totalMs,
            intervalGapMs: Math.max(0, frame.rawDt - frame.totalMs),
            sections: { ...frame.sections },
        }));
        return {
            requestedFrames: windowFrames,
            sampleFrames: count,
            sampleDurationMs,
            historyCapacityFrames: HISTORY_FRAMES,
            defaultWindowFrames: WINDOW_FRAMES,
            slowFrameThresholdMs: SLOW_FRAME_MS,
            lifetimeFrames: this._lifetimeFrames,
            slowFrames: this._slowFrames,
            windowSlowFrames,
            windowSlowFramePercent: count ? windowSlowFrames / count * 100 : 0,
            windowCpuSlowFrames,
            windowCpuSlowFramePercent: count ? windowCpuSlowFrames / count * 100 : 0,
            windowIntervalSlowFrames,
            windowIntervalSlowFramePercent: count ? windowIntervalSlowFrames / count * 100 : 0,
            averageFps: averageRawDt > 0 ? 1000 / averageRawDt : 0,
            averageFrameMs: averageTotal,
            averageRawDtMs: averageRawDt,
            cpuFrameBudgetPercent: averageRawDt > 0 ? averageTotal / averageRawDt * 100 : 0,
            unprofiledCpuAverageMs: count
                ? Math.max(0, averageTotal - measuredSectionTotalMs / count)
                : 0,
            p95FrameMs: percentile(totals, 0.95),
            p99FrameMs: percentile(totals, 0.99),
            maxFrameMs: totals.length ? totals[totals.length - 1] : 0,
            p50RawDtMs: percentile(rawDts, 0.50),
            p95RawDtMs: percentile(rawDts, 0.95),
            p99RawDtMs: percentile(rawDts, 0.99),
            maxRawDtMs: rawDts.length ? rawDts[rawDts.length - 1] : 0,
            averageFrameIntervalGapMs: averageFrameIntervalGap,
            p95FrameIntervalGapMs: percentile(frameIntervalGaps, 0.95),
            maxFrameIntervalGapMs: frameIntervalGaps.length
                ? frameIntervalGaps[frameIntervalGaps.length - 1]
                : 0,
            slowestIntervalFrames: [...frameSamples]
                .sort((a, b) => b.rawDtMs - a.rawDtMs || b.cpuMs - a.cpuMs)
                .slice(0, 8),
            slowestCpuFrames: [...frameSamples]
                .sort((a, b) => b.cpuMs - a.cpuMs || b.rawDtMs - a.rawDtMs)
                .slice(0, 8),
            measuredSectionTotalMs,
            sections,
            counters: { ...this._counters },
        };
    }
}

export const PerformanceMonitor = new PerformanceMonitorImpl();
