// 顶部时间事件轴：通过 provider 接口聚合袭击、天气及后续更多时间事件。
import { EnvironmentLightingSystem } from './environment-lighting-system.js';

const providers = new Map();
let frameProvider = null;

function dayDurationMs() {
    return Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function defaultFrame() {
    const nowGameTimeMs = Math.max(0,
        Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
    const durationMs = dayDurationMs() * 5;
    return {
        nowGameTimeMs,
        startAtGameTimeMs: nowGameTimeMs,
        endAtGameTimeMs: nowGameTimeMs + durationMs,
        progress: 0,
        durationMs,
    };
}

function eventTimeLabel(event, nowGameTimeMs) {
    if (event.status === 'active') return '进行中';
    const days = Math.max(0, Number(event.atGameTimeMs) - nowGameTimeMs) / dayDurationMs();
    if (days < 1 / 24) return '即将发生';
    if (days < 1) return `${Math.max(1, Math.ceil(days * 24))} 小时后`;
    return `${days.toFixed(1)} 天后`;
}

function finiteOr(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export const WorldEventTimelineSystem = {
    setFrameProvider(provider) {
        frameProvider = typeof provider === 'function' ? provider : null;
    },

    registerProvider(id, provider) {
        if (!id || typeof provider !== 'function') return false;
        providers.set(id, provider);
        return true;
    },

    unregisterProvider(id) {
        return providers.delete(id);
    },

    getHudModel() {
        const fallback = defaultFrame();
        let frame = fallback;
        try {
            frame = { ...fallback, ...(frameProvider?.() || {}) };
        } catch (error) {
            console.warn('[WorldEventTimelineSystem] frame provider failed', error);
        }
        const start = Math.max(0, finiteOr(frame.startAtGameTimeMs, fallback.startAtGameTimeMs));
        const end = Math.max(start + 1, finiteOr(frame.endAtGameTimeMs, fallback.endAtGameTimeMs));
        const now = Math.max(start, finiteOr(frame.nowGameTimeMs, fallback.nowGameTimeMs));
        const events = [];
        for (const [providerId, provider] of providers) {
            try {
                for (const event of provider({ ...frame }) || []) {
                    if (!event?.id || !Number.isFinite(Number(event.atGameTimeMs))) continue;
                    const eventAt = Number(event.atGameTimeMs);
                    if (event.status !== 'active' && (eventAt < start || eventAt > end)) continue;
                    events.push({
                        ...event,
                        providerId,
                        position: Math.max(0.02, Math.min(0.98, (eventAt - start) / (end - start))),
                        timeLabel: eventTimeLabel(event, now),
                    });
                }
            } catch (error) {
                console.warn(`[WorldEventTimelineSystem] provider failed: ${providerId}`, error);
            }
        }
        events.sort((left, right) => left.atGameTimeMs - right.atGameTimeMs
            || left.providerId.localeCompare(right.providerId));
        return {
            progress: Math.max(0, Math.min(1, Number(frame.progress) || 0)),
            startAtGameTimeMs: start,
            endAtGameTimeMs: end,
            nowGameTimeMs: now,
            durationDays: (end - start) / dayDurationMs(),
            events,
        };
    },
};

export default WorldEventTimelineSystem;
