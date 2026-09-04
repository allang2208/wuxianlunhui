import { GAME_CONFIG } from '../config/game-config.js';
import { hasEnemyFamily } from '../config/enemy-family.js';
import { CandleSanctuarySystem } from './candle-sanctuary-system.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { getWeatherEventIconPath } from './weather-event-icons.js';
import { WorldInstanceSystem } from './world-instance-system.js';

const VERSION = 2;
const TARGET_SCENE_ID = 'scene11';
const PHASES = new Set(['clear', 'warning', 'active']);

let currentSceneId = null;
let trackedPlayer = null;
let playerShelterSampled = false;
let playerSheltered = false;

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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function resolvedSceneId(sceneId) {
    const worldId = sceneId || (typeof window !== 'undefined'
        ? (window.SceneManager?.getCurrentWorldId?.() || window.SceneManager?.currentScene)
        : null) || currentSceneId;
    return WorldInstanceSystem.resolveRuntimeSceneId(worldId);
}

function worldName(worldId) {
    return WorldInstanceSystem.getDisplayName(worldId)
        || GAME_CONFIG.scenes?.[TARGET_SCENE_ID]?.name
        || '世界125';
}

function fogTideConfig() {
    return GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
        ?.environmentEffects?.dungeonAtmosphere?.fogTide || {};
}

function gameplayConfig() {
    return fogTideConfig().gameplay || {};
}

function scheduleConfig() {
    return fogTideConfig().schedule || {};
}

function dayDurationMs() {
    return Math.max(1,
        Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function currentGameTimeMs() {
    return Math.max(0,
        Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
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

function finiteMultiplier(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function notify(text, options = {}) {
    if (typeof window === 'undefined') return;
    window.SceneManager?.showTopNotification?.(text, {
        fontSize: '28px',
        duration: 2600,
        ...options,
    });
}

function clearTrackedPlayer() {
    if (trackedPlayer) trackedPlayer._world125CandleSheltered = false;
    trackedPlayer = null;
    playerShelterSampled = false;
    playerSheltered = false;
}

function ensurePlannedDurationDays() {
    if (state.durationDays > 0) return state.durationDays;
    state.durationDays = randomInRange(rangeOf(scheduleConfig().durationDays, 0.75, 1.5));
    return state.durationDays;
}

function durationLabel(durationDays) {
    const days = Math.max(0, Number(durationDays) || 0);
    return days >= 1 ? `${days.toFixed(1)} 天` : `${(days * 24).toFixed(1)} 小时`;
}

function scheduleNext(fromGameTimeMs) {
    const cfg = scheduleConfig();
    const interval = rangeOf(cfg.intervalDays, 4, 7);
    const from = Math.max(0, Number(fromGameTimeMs) || 0);
    const nextStart = from + randomInRange(interval) * dayDurationMs();
    const warningLeadDays = Math.max(0, Number(cfg.warningLeadDays) || 0.35);
    state = {
        version: VERSION,
        phase: 'clear',
        nextStartAtGameTimeMs: nextStart,
        warningAtGameTimeMs: Math.max(from, nextStart - warningLeadDays * dayDurationMs()),
        startedAtGameTimeMs: null,
        activeUntilGameTimeMs: null,
        durationDays: randomInRange(rangeOf(cfg.durationDays, 0.75, 1.5)),
    };
}

function beginFogTide(startAtGameTimeMs, { notifyPlayer = true } = {}) {
    const startAt = Math.max(0, Number(startAtGameTimeMs) || 0);
    const durationDays = ensurePlannedDurationDays();
    state.phase = 'active';
    state.nextStartAtGameTimeMs = null;
    state.warningAtGameTimeMs = null;
    state.startedAtGameTimeMs = startAt;
    state.activeUntilGameTimeMs = startAt + durationDays * dayDurationMs();
    clearTrackedPlayer();
    if (notifyPlayer && resolvedSceneId(currentSceneId) === TARGET_SCENE_ID) {
        notify('☠ 死寂雾潮涌入：视野受限，亡者进入猎场状态', {
            color: '#a9c2b3',
            duration: 3600,
        });
    }
}

function endFogTide(endedAtGameTimeMs, notifyPlayer = true) {
    if (notifyPlayer && resolvedSceneId(currentSceneId) === TARGET_SCENE_ID) {
        notify('死寂雾潮已经消散', { color: '#d7c99b' });
    }
    clearTrackedPlayer();
    scheduleNext(endedAtGameTimeMs);
}

export const World125FogTideSystem = {
    forecastSceneIds: [TARGET_SCENE_ID],

    reset() {
        state = initialState();
        currentSceneId = null;
        clearTrackedPlayer();
    },

    update(gameTimeMs = currentGameTimeMs(), { notifyPlayer = true } = {}) {
        if (fogTideConfig().enabled === false || scheduleConfig().enabled === false) return;
        const now = Math.max(0, Number(gameTimeMs) || 0);
        if (state.phase === 'clear' && !hasFiniteTime(state.nextStartAtGameTimeMs)) {
            scheduleNext(now);
        }
        for (let guard = 0; guard < 12; guard++) {
            if (state.phase === 'clear'
                && hasFiniteTime(state.warningAtGameTimeMs)
                && now >= state.warningAtGameTimeMs) {
                state.phase = 'warning';
                if (notifyPlayer && currentSceneId === TARGET_SCENE_ID) {
                    notify('⚠ 死寂雾潮正在逼近，守夜烛台将成为安全区', {
                        color: '#c8d8cc',
                        duration: 4200,
                    });
                }
                continue;
            }
            if (state.phase === 'warning'
                && hasFiniteTime(state.nextStartAtGameTimeMs)
                && now >= state.nextStartAtGameTimeMs) {
                beginFogTide(state.nextStartAtGameTimeMs, { notifyPlayer });
                continue;
            }
            if (state.phase === 'active'
                && hasFiniteTime(state.activeUntilGameTimeMs)
                && now >= state.activeUntilGameTimeMs) {
                endFogTide(state.activeUntilGameTimeMs, notifyPlayer);
                continue;
            }
            break;
        }
    },

    syncScene(sceneId) {
        currentSceneId = sceneId || null;
        if (resolvedSceneId(currentSceneId) !== TARGET_SCENE_ID) clearTrackedPlayer();
        return this.isActive(currentSceneId);
    },

    isActive(sceneId = null) {
        const targetScene = resolvedSceneId(sceneId);
        return fogTideConfig().enabled !== false
            && targetScene === TARGET_SCENE_ID
            && state.phase === 'active';
    },

    setActive(nextActive, sceneId = TARGET_SCENE_ID) {
        if (resolvedSceneId(sceneId) !== TARGET_SCENE_ID) {
            return { ok: false, reason: '死寂雾潮只能在世界-125触发', model: this.getDebugModel(sceneId) };
        }
        if (fogTideConfig().enabled === false) {
            return { ok: false, reason: '死寂雾潮配置未启用', model: this.getDebugModel(sceneId) };
        }
        const next = !!nextActive;
        const changed = next !== this.isActive(sceneId);
        if (next) {
            state.durationDays = randomInRange(rangeOf(scheduleConfig().durationDays, 0.75, 1.5));
            beginFogTide(currentGameTimeMs(), { notifyPlayer: changed });
        } else {
            endFogTide(currentGameTimeMs(), changed);
        }
        return { ok: true, active: this.isActive(sceneId), model: this.getDebugModel(sceneId) };
    },

    debugToggle(sceneId = TARGET_SCENE_ID) {
        return this.setActive(!this.isActive(sceneId), sceneId);
    },

    isZombie(entity) {
        return entity?._faction === 'enemy'
            && hasEnemyFamily(entity, '僵尸');
    },

    getVisionRangeMultiplier(entity, sceneId, visionConfig = {}) {
        if (!this.isActive(sceneId)) {
            if (entity) entity._world125CandleSheltered = false;
            return 1;
        }
        const config = gameplayConfig();
        const sheltered = CandleSanctuarySystem.isSheltered(entity, sceneId);
        if (entity) entity._world125CandleSheltered = sheltered;
        if (!sheltered) return finiteMultiplier(config.unitVisionMultiplier, 0.6);

        const isNight = EnvironmentLightingSystem.getVisionRangeMultiplier(visionConfig) < 1;
        return isNight
            ? finiteMultiplier(config.shelteredNightWeatherMultiplier, 0.9)
            : finiteMultiplier(config.shelteredDayWeatherMultiplier, 1);
    },

    syncPlayerShelter(entity, sceneId = TARGET_SCENE_ID) {
        if (trackedPlayer && trackedPlayer !== entity) trackedPlayer._world125CandleSheltered = false;
        trackedPlayer = entity || null;
        const fogActive = this.isActive(sceneId);
        const nextSheltered = !!entity && fogActive
            && CandleSanctuarySystem.isSheltered(entity, sceneId);
        if (entity) entity._world125CandleSheltered = nextSheltered;
        if (!fogActive || !entity) {
            playerShelterSampled = false;
            playerSheltered = false;
            return false;
        }
        const changed = playerShelterSampled && nextSheltered !== playerSheltered;
        if ((!playerShelterSampled && nextSheltered) || changed) {
            notify(nextSheltered
                ? '🕯 获得「烛火庇护」：视野恢复'
                : '离开「烛火庇护」：雾潮再次遮蔽视野', {
                color: nextSheltered ? '#ffd07a' : '#9fb2a7',
            });
        }
        playerShelterSampled = true;
        playerSheltered = nextSheltered;
        return nextSheltered;
    },

    getZombieMoveSpeedMultiplier(entity, sceneId) {
        if (!this.isActive(sceneId) || !this.isZombie(entity)) return 1;
        return finiteMultiplier(gameplayConfig().zombieMoveSpeedMultiplier, 1.2);
    },

    getZombieAttackIntervalMultiplier(entity, sceneId) {
        if (!this.isActive(sceneId) || !this.isZombie(entity)) return 1;
        return Math.max(0.01,
            finiteMultiplier(gameplayConfig().zombieAttackIntervalMultiplier, 0.85));
    },

    getZombieAttackTimeScale(entity, sceneId) {
        return 1 / this.getZombieAttackIntervalMultiplier(entity, sceneId);
    },

    serialize() {
        return clone(state);
    },

    restore(data) {
        state = initialState();
        clearTrackedPlayer();
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
        if (state.phase === 'warning'
            && (!hasFiniteTime(state.nextStartAtGameTimeMs)
                || !hasFiniteTime(state.warningAtGameTimeMs))) state = initialState();
        if (state.phase === 'active'
            && (!hasFiniteTime(state.startedAtGameTimeMs)
                || !hasFiniteTime(state.activeUntilGameTimeMs)
                || state.activeUntilGameTimeMs <= state.startedAtGameTimeMs)) state = initialState();
    },

    getForecastEvents({
        sceneId = TARGET_SCENE_ID,
        nowGameTimeMs = currentGameTimeMs(),
        horizonEndGameTimeMs = Number.POSITIVE_INFINITY,
        showDuration = false,
    } = {}) {
        if (resolvedSceneId(sceneId) !== TARGET_SCENE_ID || fogTideConfig().enabled === false) return [];
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
            id: `fog-tide:${sceneId}:${Math.floor(Number(startsAtGameTimeMs))}`,
            sceneId,
            worldName: worldName(sceneId),
            weatherKind: 'special',
            specialWeatherId: 'fog_tide',
            icon: '☣',
            iconPath: getWeatherEventIconPath('fog_tide'),
            label: `${worldName(sceneId)} · 死寂雾潮`,
            intensityId: 'disaster',
            intensityName: '死寂雾潮',
            startsAtGameTimeMs: Number(startsAtGameTimeMs),
            atGameTimeMs: active ? now : Number(startsAtGameTimeMs),
            endsAtGameTimeMs: active || showDuration ? Number(endsAtGameTimeMs) : undefined,
            durationLabel: showDuration ? durationLabel(durationDays) : null,
            warningLevel: 'critical',
            warningLabel: '死寂雾潮灾害预警',
            status: active ? 'active' : 'upcoming',
        }];
    },

    getDebugModel(sceneId = TARGET_SCENE_ID) {
        const config = gameplayConfig();
        const now = currentGameTimeMs();
        const transitionAt = state.phase === 'active'
            ? state.activeUntilGameTimeMs
            : (state.phase === 'warning' ? state.nextStartAtGameTimeMs : state.warningAtGameTimeMs);
        return {
            targetSceneId: TARGET_SCENE_ID,
            enabled: fogTideConfig().enabled !== false,
            active: this.isActive(sceneId),
            phase: state.phase,
            remainingMs: hasFiniteTime(transitionAt)
                ? Math.max(0, Number(transitionAt) - now) : null,
            dayDurationMs: dayDurationMs(),
            visualOnly: false,
            unitVisionMultiplier: finiteMultiplier(config.unitVisionMultiplier, 0.6),
            shelteredDayWeatherMultiplier: finiteMultiplier(config.shelteredDayWeatherMultiplier, 1),
            shelteredNightWeatherMultiplier: finiteMultiplier(config.shelteredNightWeatherMultiplier, 0.9),
            zombieMoveSpeedMultiplier: finiteMultiplier(config.zombieMoveSpeedMultiplier, 1.2),
            zombieAttackIntervalMultiplier: finiteMultiplier(config.zombieAttackIntervalMultiplier, 0.85),
            candleCount: CandleSanctuarySystem.getBuildings().length,
            playerSheltered,
            ...clone(state),
        };
    },
};

export default World125FogTideSystem;
