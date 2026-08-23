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
        this._current = {
            startedAt: nowMs(),
            rawDt: Number(rawDt) || 0,
            sections: { ...this._externalSections },
        };
        this._externalSections = Object.create(null);
        return this._current.startedAt;
    }

    begin() {
        return nowMs();
    }

    end(name, startedAt) {
        if (!name || !startedAt) return 0;
        const elapsed = Math.max(0, nowMs() - startedAt);
        if (this._current) {
            this._current.sections[name] = (this._current.sections[name] || 0) + elapsed;
        } else {
            this._externalSections[name] = elapsed;
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

    endFrame() {
        if (!this._current) return;
        const totalMs = Math.max(0, nowMs() - this._current.startedAt);
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

    getSnapshot() {
        const frames = this._frames.slice(-WINDOW_FRAMES);
        const count = frames.length;
        const totals = frames.map((frame) => frame.totalMs).sort((a, b) => a - b);
        const rawDts = frames.map((frame) => frame.rawDt).sort((a, b) => a - b);
        const sectionNames = new Set();
        for (const frame of frames) {
            for (const name of Object.keys(frame.sections)) sectionNames.add(name);
        }
        const sections = {};
        for (const name of sectionNames) {
            const values = frames.map((frame) => Number(frame.sections[name]) || 0);
            const total = values.reduce((sum, value) => sum + value, 0);
            sections[name] = {
                averageMs: count ? total / count : 0,
                maxMs: values.length ? Math.max(...values) : 0,
            };
        }
        const percentile = (sorted, ratio) => {
            if (!sorted.length) return 0;
            return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
        };
        const averageTotal = count ? totals.reduce((sum, value) => sum + value, 0) / count : 0;
        const averageRawDt = count ? rawDts.reduce((sum, value) => sum + value, 0) / count : 0;
        return {
            sampleFrames: count,
            lifetimeFrames: this._lifetimeFrames,
            slowFrames: this._slowFrames,
            averageFps: averageRawDt > 0 ? 1000 / averageRawDt : 0,
            averageFrameMs: averageTotal,
            p95FrameMs: percentile(totals, 0.95),
            maxFrameMs: totals.length ? totals[totals.length - 1] : 0,
            p95RawDtMs: percentile(rawDts, 0.95),
            sections,
            counters: { ...this._counters },
        };
    }
}

export const PerformanceMonitor = new PerformanceMonitorImpl();
