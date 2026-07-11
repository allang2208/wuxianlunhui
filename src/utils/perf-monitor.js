/**
 * PerfMonitor —  lightweight per-section timing helper
 * Used to locate which part of the frame grows over time.
 */

import { TimerManager } from './timer-manager.js';

const sums = {};
const maxes = {};
const counts = {};
let lastLog = performance.now();
const LOG_INTERVAL_MS = 2000;

function maybeLog() {
    const now = performance.now();
    if (now - lastLog < LOG_INTERVAL_MS) return;

    const out = {};
    for (const key of Object.keys(sums)) {
        out[key] = {
            avg: +(sums[key] / counts[key]).toFixed(3),
            max: +(maxes[key]).toFixed(3),
            n: counts[key]
        };
    }
    if (performance.memory) {
        out.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    }
    if (TimerManager && TimerManager.activeTimeouts) {
        out.timeouts = TimerManager.activeTimeouts.size;
    }
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (scene) {
        out.displayList = scene.sys && scene.sys.displayList && scene.sys.displayList.list ? scene.sys.displayList.list.length : 0;
        out.children = scene.children ? scene.children.length : 0;
    }
    console.log('[PerfMonitor]', JSON.stringify(out));

    for (const key of Object.keys(sums)) {
        delete sums[key];
        delete maxes[key];
        delete counts[key];
    }
    lastLog = now;
}

export const PerfMonitor = {
    /**
     * Time a synchronous function block.
     */
    profile(label, fn) {
        const t0 = performance.now();
        const result = fn();
        this.record(label, performance.now() - t0);
        return result;
    },

    /**
     * Record a manually measured duration.
     */
    record(label, durationMs) {
        sums[label] = (sums[label] || 0) + durationMs;
        maxes[label] = Math.max(maxes[label] || 0, durationMs);
        counts[label] = (counts[label] || 0) + 1;
        maybeLog();
    }
};
