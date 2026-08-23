// 顶部时间事件轴：通过 provider 接口聚合袭击、天气及后续更多时间事件。
import { EnvironmentLightingSystem } from './environment-lighting-system.js';

const providers = new Map();
let frameProvider = null;
const NOW_POSITION = 0.04;
const FUTURE_END_POSITION = 0.98;

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

function absoluteGameTimeLabel(gameTimeMs) {
    const config = EnvironmentLightingSystem.getConfig?.() || {};
    const duration = dayDurationMs();
    const cycles = Math.max(0, Number(gameTimeMs) || 0) / duration
        + (Number(config.startPhase) || 0);
    const day = Math.floor(cycles) + 1;
    const phase = ((cycles % 1) + 1) % 1;
    const clockMinutes = Math.floor((((phase * 24 + 6) % 24) * 60));
    const hour = Math.floor(clockMinutes / 60);
    const minute = clockMinutes % 60;
    return `第${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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
        const now = Math.max(0, finiteOr(frame.nowGameTimeMs, fallback.nowGameTimeMs));
        const durationMs = Math.max(1, finiteOr(frame.durationMs,
            finiteOr(frame.endAtGameTimeMs, fallback.endAtGameTimeMs)
                - finiteOr(frame.startAtGameTimeMs, fallback.startAtGameTimeMs)));
        const start = now;
        const end = now + durationMs;
        const events = [];
        for (const [providerId, provider] of providers) {
            try {
                for (const event of provider({
                    ...frame,
                    nowGameTimeMs: now,
                    startAtGameTimeMs: start,
                    endAtGameTimeMs: end,
                    durationMs,
                    progress: 0,
                }) || []) {
                    if (!event?.id || !Number.isFinite(Number(event.atGameTimeMs))) continue;
                    const eventAt = Number(event.atGameTimeMs);
                    if (event.status !== 'active' && (eventAt < start || eventAt > end)) continue;
                    const remainingRatio = Math.max(0, Math.min(1, (eventAt - now) / durationMs));
                    events.push({
                        ...event,
                        providerId,
                        typeLabel: event.typeLabel || event.type || '事件',
                        position: NOW_POSITION
                            + remainingRatio * (FUTURE_END_POSITION - NOW_POSITION),
                        timeLabel: eventTimeLabel(event, now),
                        startsAtLabel: absoluteGameTimeLabel(
                            event.startsAtGameTimeMs ?? event.atGameTimeMs),
                        endsAtLabel: Number.isFinite(Number(event.endsAtGameTimeMs))
                            ? absoluteGameTimeLabel(event.endsAtGameTimeMs)
                            : null,
                    });
                }
            } catch (error) {
                console.warn(`[WorldEventTimelineSystem] provider failed: ${providerId}`, error);
            }
        }
        events.sort((left, right) => left.atGameTimeMs - right.atGameTimeMs
            || left.providerId.localeCompare(right.providerId));
        return {
            progress: 0,
            nowPosition: NOW_POSITION,
            direction: 'events-toward-now',
            startAtGameTimeMs: start,
            endAtGameTimeMs: end,
            nowGameTimeMs: now,
            durationDays: durationMs / dayDurationMs(),
            events,
        };
    },
};

export default WorldEventTimelineSystem;
