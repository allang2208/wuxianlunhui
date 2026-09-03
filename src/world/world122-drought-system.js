import { GAME_CONFIG } from '../config/game-config.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldInstanceSystem } from './world-instance-system.js';

const VERSION = 1;
const TARGET_SCENE_ID = 'scene8';
const PHASES = new Set(['clear', 'warning', 'active']);
const clone = (value) => JSON.parse(JSON.stringify(value));

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

function droughtConfig() {
    return GAME_CONFIG.scenes?.[TARGET_SCENE_ID]?.environmentEffects?.drought || {};
}

function dayDurationMs() {
    return Math.max(1,
        Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function currentGameTimeMs() {
    return Math.max(0, Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
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

function notify(text, tone = 'warning', duration = 5600) {
    if (typeof window === 'undefined' || !window.SceneManager?.showTopNotification) return;
    window.SceneManager.showTopNotification(text, { tone, emphasis: 'headline', duration });
}

function warningHours(config) {
    const configuredDays = Number(config.warningLeadDays);
    const leadDays = Number.isFinite(configuredDays) ? configuredDays : 0.25;
    return Math.max(0, leadDays) * 24;
}

function ensurePlannedDurationDays() {
    if (state.durationDays > 0) return state.durationDays;
    state.durationDays = randomInRange(rangeOf(droughtConfig().durationDays, 0.75, 1.5));
    return state.durationDays;
}

function durationLabel(durationDays) {
    const days = Math.max(0, Number(durationDays) || 0);
    return days >= 1 ? `${days.toFixed(1)} 天` : `${(days * 24).toFixed(1)} 小时`;
}

function scheduleNext(fromGameTimeMs) {
    const config = droughtConfig();
    const interval = rangeOf(config.intervalDays, 2.5, 5);
    const nextStartAt = Math.max(0, Number(fromGameTimeMs) || 0)
        + randomInRange(interval) * dayDurationMs();
    const leadMs = warningHours(config) / 24 * dayDurationMs();
    state.phase = 'clear';
    state.nextStartAtGameTimeMs = nextStartAt;
    state.warningAtGameTimeMs = Math.max(fromGameTimeMs, nextStartAt - leadMs);
    state.startedAtGameTimeMs = null;
    state.activeUntilGameTimeMs = null;
    state.durationDays = randomInRange(rangeOf(config.durationDays, 0.75, 1.5));
}

function beginDrought(startAtGameTimeMs, { source = 'random', notifyPlayer = true } = {}) {
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
        const worldName = GAME_CONFIG.scenes?.[TARGET_SCENE_ID]?.name || '世界122';
        notify(
            `☀ ${prefix}${worldName}，因水源短缺，导致所有粮食生产建筑减产50%（预计持续 ${durationDays.toFixed(1)} 天）`,
            'warning',
            6200
        );
    }
}

function endDrought(endedAtGameTimeMs, notifyPlayer = true) {
    if (notifyPlayer) notify('✓ 世界122干旱结束，粮食生产恢复', 'success', 4800);
    scheduleNext(endedAtGameTimeMs);
}

export const World122DroughtSystem = {
    forecastSceneIds: [TARGET_SCENE_ID],

    reset() {
        state = initialState();
    },

    update(gameTimeMs = currentGameTimeMs(), { notifyPlayer = true } = {}) {
        const config = droughtConfig();
        if (config.enabled === false) return;
        const now = Math.max(0, Number(gameTimeMs) || 0);
        if (!hasFiniteTime(state.nextStartAtGameTimeMs) && state.phase === 'clear') {
            scheduleNext(now);
        }
        for (let guard = 0; guard < 12; guard++) {
            if (state.phase === 'clear'
                && hasFiniteTime(state.warningAtGameTimeMs)
                && now >= state.warningAtGameTimeMs) {
                state.phase = 'warning';
                if (notifyPlayer) {
                    notify(
                        `⚠ 世界122高温预警：约 ${warningHours(config).toFixed(0)} 游戏小时后将进入干旱`,
                        'warning',
                        6000
                    );
                }
                continue;
            }
            if (state.phase === 'warning'
                && hasFiniteTime(state.nextStartAtGameTimeMs)
                && now >= state.nextStartAtGameTimeMs) {
                beginDrought(state.nextStartAtGameTimeMs, { notifyPlayer });
                continue;
            }
            if (state.phase === 'active'
                && hasFiniteTime(state.activeUntilGameTimeMs)
                && now >= state.activeUntilGameTimeMs) {
                endDrought(state.activeUntilGameTimeMs, notifyPlayer);
                continue;
            }
            break;
        }
    },

    syncToCurrentTime(options = {}) {
        this.update(currentGameTimeMs(), options);
        return this.getDebugModel();
    },

    isActive(sceneId = TARGET_SCENE_ID, gameTimeMs = null) {
        if (hasFiniteTime(gameTimeMs)) this.update(Number(gameTimeMs), { notifyPlayer: false });
        return isTargetWorld(sceneId)
            && droughtConfig().enabled !== false
            && state.phase === 'active';
    },

    getFoodProductionMultiplier(sceneId = TARGET_SCENE_ID, gameTimeMs = null) {
        if (!this.isActive(sceneId, gameTimeMs)) return 1;
        const value = Number(droughtConfig().foodProductionMultiplier);
        return Number.isFinite(value) ? Math.max(0, value) : 0.5;
    },

    getVisualConfig() {
        return droughtConfig().visual || {};
    },

    getForecastEvents({
        sceneId = TARGET_SCENE_ID,
        nowGameTimeMs = currentGameTimeMs(),
        horizonEndGameTimeMs = Number.POSITIVE_INFINITY,
        showDuration = false,
    } = {}) {
        if (!isTargetWorld(sceneId) || droughtConfig().enabled === false) return [];
        const now = Math.max(0, Number(nowGameTimeMs) || 0);
        this.update(now, { notifyPlayer: false });
        const active = state.phase === 'active';
        const startsAtGameTimeMs = active ? state.startedAtGameTimeMs : state.nextStartAtGameTimeMs;
        if (!hasFiniteTime(startsAtGameTimeMs)) return [];
        if (!active && Number(startsAtGameTimeMs) > Number(horizonEndGameTimeMs)) return [];
        const durationDays = ensurePlannedDurationDays();
        const endsAtGameTimeMs = active
            ? state.activeUntilGameTimeMs
            : Number(startsAtGameTimeMs) + durationDays * dayDurationMs();
        return [{
            id: `drought:${sceneId}:${Math.floor(Number(startsAtGameTimeMs))}`,
            sceneId,
            worldName: worldName(sceneId),
            weatherKind: 'special',
            specialWeatherId: 'drought',
            icon: '☀',
            label: `${worldName(sceneId)} · 干旱`,
            intensityId: 'severe',
            intensityName: '干旱高温',
            startsAtGameTimeMs: Number(startsAtGameTimeMs),
            atGameTimeMs: active ? now : Number(startsAtGameTimeMs),
            endsAtGameTimeMs: active || showDuration ? Number(endsAtGameTimeMs) : undefined,
            durationLabel: showDuration ? durationLabel(durationDays) : null,
            warningLevel: 'warning',
            warningLabel: '干旱高温预警',
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
        if (droughtConfig().enabled === false) {
            return { ok: false, reason: '干旱配置未启用', model: this.getDebugModel() };
        }
        beginDrought(currentGameTimeMs(), { source: 'dev' });
        return { ok: true, model: this.getDebugModel() };
    },

    getDebugModel() {
        const now = currentGameTimeMs();
        const transitionAt = state.phase === 'active'
            ? state.activeUntilGameTimeMs
            : (state.phase === 'warning' ? state.nextStartAtGameTimeMs : state.warningAtGameTimeMs);
        return {
            version: VERSION,
            targetSceneId: TARGET_SCENE_ID,
            phase: state.phase,
            active: this.isActive(TARGET_SCENE_ID),
            foodProductionMultiplier: this.getFoodProductionMultiplier(TARGET_SCENE_ID),
            nowGameTimeMs: now,
            dayDurationMs: dayDurationMs(),
            remainingMs: hasFiniteTime(transitionAt)
                ? Math.max(0, Number(transitionAt) - now) : null,
            durationDays: state.durationDays,
            ...clone(state),
        };
    },
};

export default World122DroughtSystem;
