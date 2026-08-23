// 全局天气排期：以统一游戏时间维护各永久位面的降雨周期，并向预测塔暴露预报事件。
import gameConfig from '../../data/game-config.json';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { TechnologySystem } from './technology-system.js';
import { getWorldSnapshot } from './world122-snapshot.js';

const VERSION = 1;
const FORECAST_TECH_ID = 'weather_forecasting';
const FORECAST_TOWER_ID = 'weather_forecast_tower';
const clone = (value) => JSON.parse(JSON.stringify(value));

let state = { version: VERSION, worlds: {} };
const debugOverrides = new Map();

function rainConfig() {
    return gameConfig.weatherEffects?.rain || {};
}

function scheduleConfig() {
    return rainConfig().schedule || {};
}

function dayDurationMs() {
    return Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function readDayRange(value, fallbackMin, fallbackMax) {
    const min = Number.isFinite(Number(value?.min)) ? Number(value.min) : fallbackMin;
    const max = Number.isFinite(Number(value?.max)) ? Number(value.max) : fallbackMax;
    return { min: Math.max(0, Math.min(min, max)), max: Math.max(0, Math.max(min, max)) };
}

function randomRange(range) {
    return range.min + Math.random() * Math.max(0, range.max - range.min);
}

function targetSceneIds() {
    const config = rainConfig();
    const excludedTypes = Array.isArray(config.excludedSceneTypes)
        ? config.excludedSceneTypes : ['dungeon'];
    return config.enabled === false || scheduleConfig().enabled === false
        ? []
        : (Array.isArray(config.targetSceneIds) ? config.targetSceneIds.filter((sceneId) =>
            sceneId && !excludedTypes.includes(gameConfig.scenes?.[sceneId]?.type)) : []);
}

function forcedIntensityId(sceneId) {
    const id = scheduleConfig().forcedIntensityBySceneId?.[sceneId];
    return rainConfig().intensities?.[id] ? id : null;
}

function resolveSceneIntensityId(sceneId, intensityId) {
    return forcedIntensityId(sceneId)
        || (rainConfig().intensities?.[intensityId]
            ? intensityId : (rainConfig().defaultIntensity || 'light'));
}

function pickIntensityId(sceneId) {
    const forcedId = forcedIntensityId(sceneId);
    if (forcedId) return forcedId;
    const intensities = rainConfig().intensities || {};
    const entries = Object.entries(scheduleConfig().intensityWeights || {})
        .filter(([id, weight]) => intensities[id] && Number(weight) > 0);
    if (!entries.length) return rainConfig().defaultIntensity || Object.keys(intensities)[0] || 'light';
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
    let roll = Math.random() * total;
    for (const [id, weight] of entries) {
        roll -= Number(weight);
        if (roll <= 0) return id;
    }
    return entries[entries.length - 1][0];
}

function scheduleNext(sceneId, anchorGameTimeMs) {
    const config = scheduleConfig();
    const gapDays = readDayRange(config.intervalDays, 0.8, 2.2);
    const durationDays = readDayRange(config.durationDays, 0.25, 0.6);
    const previous = state.worlds[sceneId];
    const startAtGameTimeMs = Math.max(0, Number(anchorGameTimeMs) || 0)
        + randomRange(gapDays) * dayDurationMs();
    const endAtGameTimeMs = startAtGameTimeMs
        + randomRange(durationDays) * dayDurationMs();
    state.worlds[sceneId] = {
        cycle: Math.max(0, Math.floor(Number(previous?.cycle) || 0)) + 1,
        intensityId: pickIntensityId(sceneId),
        startAtGameTimeMs,
        endAtGameTimeMs,
    };
    return state.worlds[sceneId];
}

function ensureSchedule(sceneId, nowGameTimeMs) {
    let entry = state.worlds[sceneId];
    if (!entry || !(entry.startAtGameTimeMs >= 0) || !(entry.endAtGameTimeMs > entry.startAtGameTimeMs)) {
        entry = scheduleNext(sceneId, nowGameTimeMs);
    }
    let safety = 64;
    while (nowGameTimeMs >= entry.endAtGameTimeMs && safety-- > 0) {
        entry = scheduleNext(sceneId, entry.endAtGameTimeMs);
    }
    entry.intensityId = resolveSceneIntensityId(sceneId, entry.intensityId);
    return entry;
}

function isLiveScene(sceneId) {
    return typeof window !== 'undefined' && window.SceneManager?.currentScene === sceneId;
}

function hasForecastTower(sceneId) {
    if (!TechnologySystem.isCompleted(FORECAST_TECH_ID)) return false;
    if (isLiveScene(sceneId)) {
        const liveBuildings = typeof window !== 'undefined'
            ? window.Game?.ProducerBuildingSystem?.buildings : null;
        return (liveBuildings || []).some((building) =>
            building?.active !== false && building?.hp > 0 && building.cfgKey === FORECAST_TOWER_ID);
    }
    return (getWorldSnapshot(sceneId)?.structures || []).some((building) =>
        building?.hp > 0 && building.cfgKey === FORECAST_TOWER_ID);
}

function intensityName(intensityId) {
    return rainConfig().intensities?.[intensityId]?.name || intensityId || '降雨';
}

function worldName(sceneId) {
    return gameConfig.scenes?.[sceneId]?.name || sceneId;
}

function iconForIntensity(intensityId) {
    if (intensityId === 'storm') return '⛈';
    if (intensityId === 'heavy') return '🌧';
    if (intensityId === 'moderate') return '🌦';
    return '🌦';
}

function iconPathForIntensity(intensityId) {
    if (intensityId === 'storm') return 'assets/ui/event-icons/rain-storm.png';
    if (intensityId === 'heavy') return 'assets/ui/event-icons/rain-heavy.png';
    if (intensityId === 'moderate') return 'assets/ui/event-icons/rain-moderate.png';
    return 'assets/ui/event-icons/rain-light.png';
}

function isScheduledActive(entry, nowGameTimeMs) {
    return !!entry && nowGameTimeMs >= entry.startAtGameTimeMs
        && nowGameTimeMs < entry.endAtGameTimeMs;
}

export const WorldWeatherSystem = {
    reset() {
        state = { version: VERSION, worlds: {} };
        debugOverrides.clear();
    },

    serialize() {
        return clone(state);
    },

    restore(data) {
        state = { version: VERSION, worlds: {} };
        debugOverrides.clear();
        if (!data || typeof data !== 'object') return;
        for (const sceneId of targetSceneIds()) {
            const source = data.worlds?.[sceneId];
            if (!source || !(Number(source.endAtGameTimeMs) > Number(source.startAtGameTimeMs))) continue;
            state.worlds[sceneId] = {
                cycle: Math.max(1, Math.floor(Number(source.cycle) || 1)),
                intensityId: resolveSceneIntensityId(sceneId, source.intensityId),
                startAtGameTimeMs: Math.max(0, Number(source.startAtGameTimeMs) || 0),
                endAtGameTimeMs: Math.max(0, Number(source.endAtGameTimeMs) || 0),
            };
        }
    },

    update(nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        for (const sceneId of targetSceneIds()) ensureSchedule(sceneId, now);
    },

    getVisualState(sceneId, nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        if (!targetSceneIds().includes(sceneId)) return { active: false, intensityId: null, source: null };
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        const entry = ensureSchedule(sceneId, now);
        let override = debugOverrides.get(sceneId);
        if (override?.untilGameTimeMs > 0 && now >= override.untilGameTimeMs) {
            debugOverrides.delete(sceneId);
            override = null;
        }
        if (override) {
            return {
                active: override.enabled,
                intensityId: override.enabled
                    ? resolveSceneIntensityId(sceneId, override.intensityId) : null,
                source: 'debug',
            };
        }
        return {
            active: isScheduledActive(entry, now),
            intensityId: isScheduledActive(entry, now) ? entry.intensityId : null,
            source: 'schedule',
        };
    },

    getForecastEvents(nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        this.update(now);
        const events = [];
        for (const sceneId of targetSceneIds()) {
            if (!hasForecastTower(sceneId)) continue;
            const entry = state.worlds[sceneId];
            const active = isScheduledActive(entry, now);
            events.push({
                id: `weather:${sceneId}:${entry.cycle}`,
                type: 'weather',
                typeLabel: '天气',
                icon: iconForIntensity(entry.intensityId),
                iconPath: iconPathForIntensity(entry.intensityId),
                label: `${worldName(sceneId)} · ${intensityName(entry.intensityId)}`,
                atGameTimeMs: active ? now : entry.startAtGameTimeMs,
                startsAtGameTimeMs: entry.startAtGameTimeMs,
                endsAtGameTimeMs: entry.endAtGameTimeMs,
                status: active ? 'active' : 'upcoming',
                sceneId,
                worldName: worldName(sceneId),
                intensityId: entry.intensityId,
                intensityName: intensityName(entry.intensityId),
            });
        }
        return events;
    },

    debugToggle(sceneId, intensityId = null, { currentSceneId = sceneId, loading = false } = {}) {
        if (!targetSceneIds().includes(sceneId)) return { ok: false, reason: '该位面未启用降雨天气' };
        if (loading || sceneId !== currentSceneId) return { ok: false, reason: '请先进入目标位面' };
        const resolvedId = resolveSceneIntensityId(sceneId, intensityId);
        const current = this.getVisualState(sceneId);
        if (current.active && current.intensityId === resolvedId) {
            const nowGameTimeMs = Math.max(0,
                Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
            const scheduled = ensureSchedule(sceneId, nowGameTimeMs);
            if (current.source === 'schedule' || isScheduledActive(scheduled, nowGameTimeMs)) {
                debugOverrides.set(sceneId, {
                    enabled: false,
                    intensityId: null,
                    untilGameTimeMs: scheduled.endAtGameTimeMs,
                });
            } else {
                debugOverrides.delete(sceneId);
            }
        } else {
            debugOverrides.set(sceneId, { enabled: true, intensityId: resolvedId });
        }
        return { ok: true, model: this.getDebugModel(sceneId, currentSceneId, loading) };
    },

    getDebugModel(sceneId, currentSceneId = sceneId, loading = false) {
        const now = Math.max(0, Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
        const enabled = targetSceneIds().includes(sceneId);
        const entry = enabled ? ensureSchedule(sceneId, now) : null;
        const visual = enabled ? this.getVisualState(sceneId, now) : { active: false, intensityId: null, source: null };
        const shownIntensity = visual.intensityId || entry?.intensityId || rainConfig().defaultIntensity || 'light';
        return {
            sceneId,
            enabled,
            active: visual.active,
            source: visual.source,
            available: enabled && !loading && sceneId === currentSceneId,
            intensityId: shownIntensity,
            intensityName: intensityName(shownIntensity),
            scheduledIntensityId: entry?.intensityId || null,
            scheduledIntensityName: intensityName(entry?.intensityId),
            nextStartAtGameTimeMs: entry?.startAtGameTimeMs ?? null,
            endAtGameTimeMs: entry?.endAtGameTimeMs ?? null,
            forecastUnlocked: TechnologySystem.isCompleted(FORECAST_TECH_ID),
            forecastTowerActive: hasForecastTower(sceneId),
            quality: rainConfig().quality || 'medium',
            intensities: Object.entries(rainConfig().intensities || {})
                .filter(([id]) => !forcedIntensityId(sceneId) || id === forcedIntensityId(sceneId))
                .map(([id, config]) => ({
                id,
                name: config?.name || id,
                thunder: config?.thunder?.enabled === true,
                })),
            gameplayAffects: false,
        };
    },
};

export default WorldWeatherSystem;
