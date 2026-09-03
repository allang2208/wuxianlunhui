// 全局天气排期：以统一游戏时间维护各永久位面的降雨周期，并向预测塔暴露预报事件。
import gameConfig from '../../data/game-config.json';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { TechnologySystem } from './technology-system.js';
import { getWorldSnapshot } from './world122-snapshot.js';
import {
    WeatherForecastTowerSystem,
    WEATHER_FORECAST_TOWER_ID,
} from './weather-forecast-tower-system.js';
import { WorldSpecialWeatherRegistry } from './world-special-weather-registry.js';
import { WorldInstanceSystem } from './world-instance-system.js';

const VERSION = 2;
const FORECAST_TECH_ID = 'weather_forecasting';
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
    if (config.enabled === false || scheduleConfig().enabled === false) return [];

    const explicitIds = new Set(Array.isArray(config.targetSceneIds)
        ? config.targetSceneIds.filter(Boolean) : []);
    const targetTypes = new Set(Array.isArray(config.targetSceneTypes)
        ? config.targetSceneTypes.filter(Boolean) : []);
    return Object.entries(gameConfig.scenes || {})
        .filter(([sceneId, sceneConfig]) => {
            if (!sceneId || excludedTypes.includes(sceneConfig?.type)) return false;
            // 单场景显式 false 始终可退出全局类型继承；显式 true 可让特殊类型接入。
            const sceneRainSetting = sceneConfig?.environmentEffects?.rain?.enabled;
            if (sceneRainSetting === false) return false;
            return explicitIds.has(sceneId)
                || targetTypes.has(sceneConfig?.type)
                || sceneRainSetting === true;
        })
        .map(([sceneId]) => sceneId);
}

function runtimeSceneId(worldId) {
    return WorldInstanceSystem.resolveRuntimeSceneId(worldId);
}

function isRainTarget(worldId) {
    return targetSceneIds().includes(runtimeSceneId(worldId));
}

function targetWorldIds() {
    const rainRuntimeSceneIds = new Set(targetSceneIds());
    const fixed = [...rainRuntimeSceneIds].filter((sceneId) =>
        WorldInstanceSystem.config.worlds?.[sceneId]?.templatePreviewOnly !== true);
    const instances = WorldInstanceSystem.listInstances({ persistentOnly: true })
        .filter((instance) => rainRuntimeSceneIds.has(instance.runtimeSceneId))
        .map((instance) => instance.instanceId);
    return [...fixed, ...instances];
}

function forcedIntensityId(sceneId) {
    const id = scheduleConfig().forcedIntensityBySceneId?.[runtimeSceneId(sceneId)];
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

function createScheduleEntry(sceneId, anchorGameTimeMs, cycle = 1) {
    const config = scheduleConfig();
    const gapDays = readDayRange(config.intervalDays, 0.8, 2.2);
    const durationDays = readDayRange(config.durationDays, 0.25, 0.6);
    const startAtGameTimeMs = Math.max(0, Number(anchorGameTimeMs) || 0)
        + randomRange(gapDays) * dayDurationMs();
    const endAtGameTimeMs = startAtGameTimeMs
        + randomRange(durationDays) * dayDurationMs();
    return {
        cycle: Math.max(1, Math.floor(Number(cycle) || 1)),
        intensityId: pickIntensityId(sceneId),
        startAtGameTimeMs,
        endAtGameTimeMs,
    };
}

function scheduleNext(sceneId, anchorGameTimeMs) {
    const previous = state.worlds[sceneId];
    state.worlds[sceneId] = createScheduleEntry(
        sceneId,
        anchorGameTimeMs,
        Math.max(0, Math.floor(Number(previous?.cycle) || 0)) + 1
    );
    return state.worlds[sceneId];
}

function isValidScheduleEntry(entry) {
    return !!entry && Number(entry.startAtGameTimeMs) >= 0
        && Number(entry.endAtGameTimeMs) > Number(entry.startAtGameTimeMs);
}

function normalizeScheduleEntry(sceneId, source) {
    if (!isValidScheduleEntry(source)) return null;
    return {
        cycle: Math.max(1, Math.floor(Number(source.cycle) || 1)),
        intensityId: resolveSceneIntensityId(sceneId, source.intensityId),
        startAtGameTimeMs: Math.max(0, Number(source.startAtGameTimeMs) || 0),
        endAtGameTimeMs: Math.max(0, Number(source.endAtGameTimeMs) || 0),
    };
}

function ensureForecastQueue(sceneId, entry, horizonEndGameTimeMs) {
    const queue = (Array.isArray(entry.forecastQueue) ? entry.forecastQueue : [])
        .map((candidate) => normalizeScheduleEntry(sceneId, candidate))
        .filter(Boolean);
    let previous = queue[queue.length - 1] || entry;
    let safety = 64;
    // 队列至少保留一个落在监测窗口外的边界事件，避免每次 HUD 刷新重新抽取下一轮。
    while (previous.startAtGameTimeMs <= horizonEndGameTimeMs && safety-- > 0) {
        const next = createScheduleEntry(
            sceneId,
            previous.endAtGameTimeMs,
            Math.max(1, Math.floor(Number(previous.cycle) || 1)) + 1
        );
        queue.push(next);
        previous = next;
    }
    entry.forecastQueue = queue;
    return queue;
}

function ensureSchedule(sceneId, nowGameTimeMs) {
    let entry = state.worlds[sceneId];
    if (!entry || !(entry.startAtGameTimeMs >= 0) || !(entry.endAtGameTimeMs > entry.startAtGameTimeMs)) {
        entry = scheduleNext(sceneId, nowGameTimeMs);
    }
    let safety = 64;
    while (nowGameTimeMs >= entry.endAtGameTimeMs && safety-- > 0) {
        const queue = Array.isArray(entry.forecastQueue) ? [...entry.forecastQueue] : [];
        const queuedNext = normalizeScheduleEntry(sceneId, queue.shift());
        if (queuedNext) {
            entry = { ...queuedNext, forecastQueue: queue };
            state.worlds[sceneId] = entry;
        } else {
            entry = scheduleNext(sceneId, entry.endAtGameTimeMs);
        }
    }
    entry.intensityId = resolveSceneIntensityId(sceneId, entry.intensityId);
    return entry;
}

function isLiveScene(sceneId) {
    return typeof window !== 'undefined'
        && (window.SceneManager?.getCurrentWorldId?.() || window.SceneManager?.currentScene) === sceneId;
}

function forecastProfileRank(profile) {
    const levels = Object.values(profile?.levels || {}).reduce(
        (sum, level) => sum + Math.max(0, Math.floor(Number(level) || 0)),
        0
    );
    return [
        levels,
        Math.max(0, Number(profile?.horizonDays) || 0),
        profile?.disasterWarning ? 1 : 0,
        profile?.showDuration ? 1 : 0,
        Math.max(0, Number(profile?.researchPointsPerSecond) || 0),
    ];
}

function isProfileBetter(candidate, current) {
    if (!current) return true;
    const left = forecastProfileRank(candidate);
    const right = forecastProfileRank(current);
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return left[i] > right[i];
    }
    return false;
}

function selectBestForecastProfile(buildings, snapshot = false) {
    let best = null;
    for (const building of buildings || []) {
        const operational = snapshot
            ? WeatherForecastTowerSystem.isSnapshotOperational(building)
            : WeatherForecastTowerSystem.isOperational(building);
        if (!operational) continue;
        const profile = snapshot
            ? WeatherForecastTowerSystem.getProfileFromSnapshot(building)
            : WeatherForecastTowerSystem.getProfile(building);
        if (isProfileBetter(profile, best)) best = profile;
    }
    return best;
}

function getForecastTowerProfile(sceneId) {
    if (!TechnologySystem.isCompleted(FORECAST_TECH_ID)) return null;
    if (isLiveScene(sceneId)) {
        const liveBuildings = typeof window !== 'undefined'
            ? window.Game?.ProducerBuildingSystem?.buildings : null;
        const buildings = (liveBuildings || []).filter((candidate) =>
            candidate?.active !== false && candidate?.hp > 0
            && candidate.cfgKey === WEATHER_FORECAST_TOWER_ID);
        return selectBestForecastProfile(buildings);
    }
    const snapshots = (getWorldSnapshot(sceneId)?.structures || []).filter((building) =>
        building?.hp > 0 && building.cfgKey === WEATHER_FORECAST_TOWER_ID);
    return selectBestForecastProfile(snapshots, true);
}

function intensityName(intensityId) {
    return rainConfig().intensities?.[intensityId]?.name || intensityId || '降雨';
}

function worldName(sceneId) {
    return WorldInstanceSystem.getDisplayName(sceneId)
        || gameConfig.scenes?.[runtimeSceneId(sceneId)]?.name
        || sceneId;
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

function weatherDurationLabel(entry) {
    const hours = Math.max(0, Number(entry.endAtGameTimeMs) - Number(entry.startAtGameTimeMs))
        / dayDurationMs() * 24;
    return hours >= 24 ? `${(hours / 24).toFixed(1)} 天` : `${hours.toFixed(1)} 小时`;
}

export const WorldWeatherSystem = {
    reset() {
        state = { version: VERSION, worlds: {} };
        debugOverrides.clear();
    },

    removeWorld(worldId) {
        if (!worldId) return false;
        const existed = !!state.worlds?.[worldId] || debugOverrides.has(worldId);
        if (state.worlds) delete state.worlds[worldId];
        debugOverrides.delete(worldId);
        return existed;
    },

    serialize() {
        const serialized = clone(state);
        for (const worldId of Object.keys(serialized.worlds || {})) {
            if (WorldInstanceSystem.isInstanceId(worldId)
                && !WorldInstanceSystem.isPersistentInstance(worldId)) {
                delete serialized.worlds[worldId];
            }
        }
        return serialized;
    },

    restore(data) {
        state = { version: VERSION, worlds: {} };
        debugOverrides.clear();
        if (!data || typeof data !== 'object') return;
        for (const sceneId of targetWorldIds()) {
            const source = data.worlds?.[sceneId];
            const entry = normalizeScheduleEntry(sceneId, source);
            if (!entry) continue;
            entry.forecastQueue = (Array.isArray(source.forecastQueue) ? source.forecastQueue : [])
                .map((candidate) => normalizeScheduleEntry(sceneId, candidate))
                .filter(Boolean);
            state.worlds[sceneId] = entry;
        }
    },

    update(nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        for (const sceneId of targetWorldIds()) ensureSchedule(sceneId, now);
    },

    getVisualState(sceneId, nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        if (!isRainTarget(sceneId)) return { active: false, intensityId: null, source: null };
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
        const rainSceneIds = new Set(targetWorldIds());
        const specialRuntimeSceneIds = new Set(WorldSpecialWeatherRegistry.getSceneIds());
        const specialSceneIds = [...specialRuntimeSceneIds].filter((sceneId) =>
            WorldInstanceSystem.config.worlds?.[sceneId]?.templatePreviewOnly !== true);
        const specialInstanceIds = WorldInstanceSystem.listInstances({ persistentOnly: true })
            .filter((instance) => specialRuntimeSceneIds.has(instance.runtimeSceneId))
            .map((instance) => instance.instanceId);
        const forecastSceneIds = new Set([
            ...rainSceneIds,
            ...specialSceneIds,
            ...specialInstanceIds,
        ]);
        for (const sceneId of forecastSceneIds) {
            const profile = getForecastTowerProfile(sceneId);
            if (!profile) continue;
            const horizonEnd = now + Math.max(0, Number(profile.horizonDays) || 0) * dayDurationMs();
            const entry = rainSceneIds.has(sceneId) ? state.worlds[sceneId] : null;
            if (entry) {
                const futureQueue = ensureForecastQueue(sceneId, entry, horizonEnd);
                const candidates = [entry, ...futureQueue];
                candidates.forEach((candidate, index) => {
                    const active = index === 0 && isScheduledActive(candidate, now);
                    if (!active && candidate.startAtGameTimeMs > horizonEnd) return;
                    const warningLevel = candidate.intensityId === 'storm' ? 'critical'
                        : (candidate.intensityId === 'heavy' ? 'warning' : null);
                    const warningLabel = warningLevel === 'critical'
                        ? '强度：暴风雨'
                        : (warningLevel === 'warning' ? '强度：大雨' : null);
                    events.push({
                        id: `weather:${sceneId}:${candidate.cycle}`,
                        type: 'weather',
                        typeLabel: '天气',
                        weatherKind: 'rain',
                        icon: iconForIntensity(candidate.intensityId),
                        iconPath: iconPathForIntensity(candidate.intensityId),
                        label: `${warningLabel ? '⚠ ' : ''}${worldName(sceneId)} · ${intensityName(candidate.intensityId)}`,
                        atGameTimeMs: active ? now : candidate.startAtGameTimeMs,
                        startsAtGameTimeMs: candidate.startAtGameTimeMs,
                        endsAtGameTimeMs: active || profile.showDuration
                            ? candidate.endAtGameTimeMs : undefined,
                        durationLabel: profile.showDuration ? weatherDurationLabel(candidate) : null,
                        warningLevel,
                        warningLabel,
                        forecastCycleIndex: index,
                        status: active ? 'active' : 'upcoming',
                        sceneId,
                        worldName: worldName(sceneId),
                        intensityId: candidate.intensityId,
                        intensityName: intensityName(candidate.intensityId),
                    });
                });
            }
            if (profile.disasterWarning) {
                events.push(...WorldSpecialWeatherRegistry.getForecastEvents(sceneId, {
                    nowGameTimeMs: now,
                    horizonEndGameTimeMs: horizonEnd,
                    showDuration: profile.showDuration,
                }));
            }
        }
        return events.sort((a, b) => Number(a.atGameTimeMs) - Number(b.atGameTimeMs));
    },

    debugToggle(sceneId, intensityId = null, { currentSceneId = sceneId, loading = false } = {}) {
        if (!isRainTarget(sceneId)) return { ok: false, reason: '该位面未启用降雨天气' };
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
        const enabled = isRainTarget(sceneId);
        const entry = enabled ? ensureSchedule(sceneId, now) : null;
        const visual = enabled ? this.getVisualState(sceneId, now) : { active: false, intensityId: null, source: null };
        const shownIntensity = visual.intensityId || entry?.intensityId || rainConfig().defaultIntensity || 'light';
        const forecastProfile = getForecastTowerProfile(sceneId);
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
            forecastTowerActive: !!forecastProfile,
            forecastProfile,
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
