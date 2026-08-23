import { GAME_CONFIG } from '../config/game-config.js';
import { hasEnemyFamily } from '../config/enemy-family.js';
import { CandleSanctuarySystem } from './candle-sanctuary-system.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';

const TARGET_SCENE_ID = 'scene11';
let active = false;
let currentSceneId = null;
let trackedPlayer = null;
let playerShelterSampled = false;
let playerSheltered = false;

function resolvedSceneId(sceneId) {
    if (sceneId) return sceneId;
    const runtimeSceneId = typeof window !== 'undefined' ? window.SceneManager?.currentScene : null;
    return runtimeSceneId || currentSceneId;
}

function gameplayConfig() {
    return GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
        ?.environmentEffects?.dungeonAtmosphere?.fogTide?.gameplay || {};
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

export const World125FogTideSystem = {
    reset() {
        active = false;
        currentSceneId = null;
        clearTrackedPlayer();
    },

    syncScene(sceneId) {
        currentSceneId = sceneId || null;
        if (currentSceneId !== TARGET_SCENE_ID) {
            active = false;
            clearTrackedPlayer();
        }
        return active;
    },

    isActive(sceneId = null) {
        const targetScene = resolvedSceneId(sceneId);
        const enabled = GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
            ?.environmentEffects?.dungeonAtmosphere?.fogTide?.enabled !== false;
        return enabled && targetScene === TARGET_SCENE_ID && active;
    },

    setActive(nextActive, sceneId = TARGET_SCENE_ID) {
        if (sceneId !== TARGET_SCENE_ID) {
            return { ok: false, reason: '死寂雾潮只能在世界-125触发', model: this.getDebugModel(sceneId) };
        }
        const enabled = GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
            ?.environmentEffects?.dungeonAtmosphere?.fogTide?.enabled !== false;
        if (!enabled) return { ok: false, reason: '死寂雾潮配置未启用', model: this.getDebugModel(sceneId) };
        const next = !!nextActive;
        const changed = next !== active;
        active = next;
        clearTrackedPlayer();
        if (changed) {
            notify(active
                ? '☠ 死寂雾潮涌入：视野受限，亡者进入猎场状态'
                : '死寂雾潮已经消散', {
                color: active ? '#a9c2b3' : '#d7c99b',
                duration: active ? 3600 : 2600,
            });
        }
        return { ok: true, active, model: this.getDebugModel(sceneId) };
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

        // 夜晚全局视野先乘 0.5；庇护区再乘 0.9，最终得到用户指定的 0.45。
        const isNight = EnvironmentLightingSystem.getVisionRangeMultiplier(visionConfig) < 1;
        return isNight
            ? finiteMultiplier(config.shelteredNightWeatherMultiplier, 0.9)
            : finiteMultiplier(config.shelteredDayWeatherMultiplier, 1);
    },

    /** 玩家进入/离开守夜烛台范围时给出一次明确反馈；友军的倍率仍由视野注册表逐单位计算。 */
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
        return Math.max(0.01, finiteMultiplier(gameplayConfig().zombieAttackIntervalMultiplier, 0.85));
    },

    getZombieAttackTimeScale(entity, sceneId) {
        return 1 / this.getZombieAttackIntervalMultiplier(entity, sceneId);
    },

    getDebugModel(sceneId = TARGET_SCENE_ID) {
        const config = gameplayConfig();
        return {
            targetSceneId: TARGET_SCENE_ID,
            enabled: GAME_CONFIG.scenes?.[TARGET_SCENE_ID]
                ?.environmentEffects?.dungeonAtmosphere?.fogTide?.enabled !== false,
            active: this.isActive(sceneId),
            visualOnly: false,
            unitVisionMultiplier: finiteMultiplier(config.unitVisionMultiplier, 0.6),
            shelteredDayWeatherMultiplier: finiteMultiplier(config.shelteredDayWeatherMultiplier, 1),
            shelteredNightWeatherMultiplier: finiteMultiplier(config.shelteredNightWeatherMultiplier, 0.9),
            zombieMoveSpeedMultiplier: finiteMultiplier(config.zombieMoveSpeedMultiplier, 1.2),
            zombieAttackIntervalMultiplier: finiteMultiplier(config.zombieAttackIntervalMultiplier, 0.85),
            candleCount: CandleSanctuarySystem.getBuildings().length,
            playerSheltered,
        };
    },
};

export default World125FogTideSystem;
