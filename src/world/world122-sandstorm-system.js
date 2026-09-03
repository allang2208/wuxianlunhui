import { GAME_CONFIG } from '../config/game-config.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldInstanceSystem } from './world-instance-system.js';

const VERSION = 1;
const TARGET_SCENE_ID = 'scene8';
const PHASES = new Set(['clear', 'warning', 'active']);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function rangeOf(value, fallbackMin, fallbackMax) {
    const min = Number.isFinite(Number(value?.min)) ? Number(value.min) : fallbackMin;
    const max = Number.isFinite(Number(value?.max)) ? Number(value.max) : fallbackMax;
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

function randomInRange(range) {
    return range.min + Math.random() * Math.max(0, range.max - range.min);
}

function hasFiniteTime(value) {
    return value !== null && value !== undefined && value !== ''
        && Number.isFinite(Number(value));
}

function sandstormConfig() {
    return GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
        ?.environmentEffects?.windblownSand?.sandstorm || {};
}

function dayDurationMs() {
    return Math.max(1,
        Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function currentGameTimeMs() {
    return Math.max(0,
        Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
}

function isTargetWorld(worldId) {
    return WorldInstanceSystem.resolveRuntimeSceneId(worldId) === TARGET_SCENE_ID;
}

function worldName(worldId) {
    return WorldInstanceSystem.getDisplayName(worldId)
        || GAME_CONFIG.scenes?.[TARGET_SCENE_ID]?.name
        || '世界122';
}

function initialState() {
    return {
        version: VERSION,
        phase: 'clear',
        nextStartAtGameTimeMs: null,
        warningAtGameTimeMs: null,
        startedAtGameTimeMs: null,
        activeUntilGameTimeMs: null,
        durationDays: 0,
    };
}

let state = initialState();

function notify(text, color, duration = 5600) {
    if (typeof window === 'undefined' || !window.SceneManager?.showTopNotification) return;
    window.SceneManager.showTopNotification(text, {
        color,
        fontSize: '30px',
        duration,
    });
}

function warningHours(config) {
    const configuredDays = Number(config.warningLeadDays);
    const leadDays = Number.isFinite(configuredDays) ? configuredDays : 0.25;
    return Math.max(0, leadDays) * 24;
}

function ensurePlannedDurationDays() {
    if (state.durationDays > 0) return state.durationDays;
    state.durationDays = randomInRange(rangeOf(sandstormConfig().durationDays, 1, 2));
    return state.durationDays;
}

function durationLabel(durationDays) {
    const days = Math.max(0, Number(durationDays) || 0);
    return days >= 1 ? `${days.toFixed(1)} 天` : `${(days * 24).toFixed(1)} 小时`;
}

function scheduleNext(fromGameTimeMs) {
    const config = sandstormConfig();
    const interval = rangeOf(config.intervalDays, 3, 6);
    const nextStartAt = Math.max(0, Number(fromGameTimeMs) || 0)
        + randomInRange(interval) * dayDurationMs();
    const leadMs = warningHours(config) / 24 * dayDurationMs();
    state.phase = 'clear';
    state.nextStartAtGameTimeMs = nextStartAt;
    state.warningAtGameTimeMs = Math.max(fromGameTimeMs, nextStartAt - leadMs);
    state.startedAtGameTimeMs = null;
    state.activeUntilGameTimeMs = null;
    state.durationDays = randomInRange(rangeOf(config.durationDays, 1, 2));
}

function beginStorm(startAtGameTimeMs, { source = 'random', notifyPlayer = true } = {}) {
    const durationDays = ensurePlannedDurationDays();
    const startAt = Math.max(0, Number(startAtGameTimeMs) || 0);
    state.phase = 'active';
    state.nextStartAtGameTimeMs = null;
    state.warningAtGameTimeMs = null;
    state.startedAtGameTimeMs = startAt;
    state.activeUntilGameTimeMs = startAt + durationDays * dayDurationMs();
    state.durationDays = durationDays;
    if (notifyPlayer) {
        const prefix = source === 'dev' ? '开发面板已触发：' : '';
        notify(
            `🌪 ${prefix}世界122沙尘暴爆发，预计持续 ${durationDays.toFixed(1)} 天；所有单位视野减半`,
            '#ff9a3c',
            6200
        );
    }
}

function endStorm(endedAtGameTimeMs, notifyPlayer = true) {
    if (notifyPlayer) {
        notify('✓ 世界122沙尘暴已经消散，单位视野恢复', '#b9e7b0', 4800);
    }
    scheduleNext(endedAtGameTimeMs);
}

export const World122SandstormSystem = {
    forecastSceneIds: [TARGET_SCENE_ID],

    reset() {
        state = initialState();
    },

    update(gameTimeMs = currentGameTimeMs(), { notifyPlayer = true } = {}) {
        const config = sandstormConfig();
        if (config.enabled === false) return;
        const now = Math.max(0, Number(gameTimeMs) || 0);
        if (!hasFiniteTime(state.nextStartAtGameTimeMs) && state.phase === 'clear') {
            scheduleNext(now);
        }

        // 开发面板可以一次推进数个游戏日，因此允许同一次同步跨过预警、爆发和结束。
        for (let guard = 0; guard < 12; guard++) {
            if (state.phase === 'clear'
                && hasFiniteTime(state.warningAtGameTimeMs)
                && now >= state.warningAtGameTimeMs) {
                state.phase = 'warning';
                if (notifyPlayer) {
                    notify(
                        `⚠ 世界122气象预警：约 ${warningHours(config).toFixed(0)} 游戏小时后将出现沙尘暴`,
                        '#ffd166',
                        6000
                    );
                }
                continue;
            }
            if (state.phase === 'warning'
                && hasFiniteTime(state.nextStartAtGameTimeMs)
                && now >= state.nextStartAtGameTimeMs) {
                beginStorm(state.nextStartAtGameTimeMs, {
                    source: 'random',
                    notifyPlayer,
                });
                continue;
            }
            if (state.phase === 'active'
                && hasFiniteTime(state.activeUntilGameTimeMs)
                && now >= state.activeUntilGameTimeMs) {
                endStorm(state.activeUntilGameTimeMs, notifyPlayer);
                continue;
            }
            break;
        }
    },

    syncToCurrentTime(options = {}) {
        this.update(currentGameTimeMs(), options);
        return this.getDebugModel();
    },

    isActive(sceneId = TARGET_SCENE_ID) {
        return isTargetWorld(sceneId)
            && sandstormConfig().enabled !== false
            && state.phase === 'active';
    },

    getVisionRangeMultiplier(sceneId) {
        if (!this.isActive(sceneId)) return 1;
        const configuredValue = sandstormConfig().visionMultiplier;
        const value = Number(configuredValue);
        return configuredValue !== null && configuredValue !== undefined && Number.isFinite(value)
            ? Math.max(0, value) : 0.5;
    },

    getForecastEvents({
        sceneId = TARGET_SCENE_ID,
        nowGameTimeMs = currentGameTimeMs(),
        horizonEndGameTimeMs = Number.POSITIVE_INFINITY,
        showDuration = false,
    } = {}) {
        if (!isTargetWorld(sceneId) || sandstormConfig().enabled === false) return [];
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        this.update(now, { notifyPlayer: false });
        const active = state.phase === 'active';
        const startsAtGameTimeMs = active
            ? state.startedAtGameTimeMs : state.nextStartAtGameTimeMs;
        if (!hasFiniteTime(startsAtGameTimeMs)) return [];
        if (!active && Number(startsAtGameTimeMs) > Number(horizonEndGameTimeMs)) return [];
        const durationDays = ensurePlannedDurationDays();
        const endsAtGameTimeMs = active
            ? state.activeUntilGameTimeMs
            : Number(startsAtGameTimeMs) + durationDays * dayDurationMs();
        return [{
            id: `sandstorm:${sceneId}:${Math.floor(Number(startsAtGameTimeMs))}`,
            sceneId,
            worldName: worldName(sceneId),
            weatherKind: 'special',
            specialWeatherId: 'sandstorm',
            icon: '🌪',
            label: `${worldName(sceneId)} · 沙尘暴`,
            intensityId: 'disaster',
            intensityName: '沙尘暴',
            startsAtGameTimeMs: Number(startsAtGameTimeMs),
            atGameTimeMs: active ? now : Number(startsAtGameTimeMs),
            endsAtGameTimeMs: active || showDuration ? Number(endsAtGameTimeMs) : undefined,
            durationLabel: showDuration ? durationLabel(durationDays) : null,
            warningLevel: 'critical',
            warningLabel: '沙尘暴灾害预警',
            status: active ? 'active' : 'upcoming',
        }];
    },

    serialize() {
        return clone(state);
    },

    restore(data) {
        state = initialState();
        if (!data || typeof data !== 'object') return;
        const phase = PHASES.has(data.phase) ? data.phase : 'clear';
        state = {
            version: VERSION,
            phase,
            nextStartAtGameTimeMs: hasFiniteTime(data.nextStartAtGameTimeMs)
                ? Math.max(0, Number(data.nextStartAtGameTimeMs)) : null,
            warningAtGameTimeMs: hasFiniteTime(data.warningAtGameTimeMs)
                ? Math.max(0, Number(data.warningAtGameTimeMs)) : null,
            startedAtGameTimeMs: hasFiniteTime(data.startedAtGameTimeMs)
                ? Math.max(0, Number(data.startedAtGameTimeMs)) : null,
            activeUntilGameTimeMs: hasFiniteTime(data.activeUntilGameTimeMs)
                ? Math.max(0, Number(data.activeUntilGameTimeMs)) : null,
            durationDays: Math.max(0, Number(data.durationDays) || 0),
        };
        if (state.phase === 'clear'
            && (!hasFiniteTime(state.nextStartAtGameTimeMs)
                || !hasFiniteTime(state.warningAtGameTimeMs))) state = initialState();
        if (state.phase === 'active'
            && (!hasFiniteTime(state.startedAtGameTimeMs)
                || !hasFiniteTime(state.activeUntilGameTimeMs)
                || state.activeUntilGameTimeMs < state.startedAtGameTimeMs)) state = initialState();
        if (state.phase === 'warning'
            && (!hasFiniteTime(state.warningAtGameTimeMs)
                || !hasFiniteTime(state.nextStartAtGameTimeMs)
                || state.nextStartAtGameTimeMs < state.warningAtGameTimeMs)) state = initialState();
    },

    debugTriggerNow() {
        if (sandstormConfig().enabled === false) {
            return { ok: false, reason: '沙尘暴配置未启用', model: this.getDebugModel() };
        }
        const now = currentGameTimeMs();
        beginStorm(now, { source: 'dev' });
        return { ok: true, model: this.getDebugModel() };
    },

    getDebugModel() {
        const now = currentGameTimeMs();
        const duration = dayDurationMs();
        const transitionAt = state.phase === 'active'
            ? state.activeUntilGameTimeMs
            : (state.phase === 'warning' ? state.nextStartAtGameTimeMs : state.warningAtGameTimeMs);
        return {
            version: VERSION,
            targetSceneId: TARGET_SCENE_ID,
            phase: state.phase,
            active: this.isActive(TARGET_SCENE_ID),
            visionMultiplier: this.getVisionRangeMultiplier(TARGET_SCENE_ID),
            nowGameTimeMs: now,
            dayDurationMs: duration,
            remainingMs: hasFiniteTime(transitionAt)
                ? Math.max(0, Number(transitionAt) - now) : null,
            durationDays: state.durationDays,
            ...clone(state),
        };
    },
};

export default World122SandstormSystem;
