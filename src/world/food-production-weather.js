import { GAME_CONFIG } from '../config/game-config.js';
import { WorldWeatherSystem } from './world-weather-system.js';
import { World122DroughtSystem } from './world122-drought-system.js';

const RAIN_LABELS = Object.freeze({
    light: '小雨',
    moderate: '中雨',
    heavy: '大雨',
    storm: '暴风雨',
});

function currentSceneId() {
    return typeof globalThis !== 'undefined'
        ? (globalThis.SceneManager?.getCurrentWorldId?.()
            || globalThis.SceneManager?.currentScene
            || null)
        : null;
}

/** 粮食生产只取一个权威天气倍率：降雨优先于干旱，禁止两种天气叠乘。 */
export function getFoodProductionWeatherEffect(sceneId = null, gameTimeMs = null) {
    const resolvedSceneId = sceneId || currentSceneId();
    const rainState = resolvedSceneId
        ? WorldWeatherSystem.getVisualState(resolvedSceneId, gameTimeMs ?? undefined)
        : { active: false, intensityId: null };
    const droughtActive = !rainState?.active && !!resolvedSceneId
        && World122DroughtSystem.isActive(resolvedSceneId, gameTimeMs);
    return resolveFoodProductionWeatherEffect(resolvedSceneId, { rainState, droughtActive });
}

/** 纯解析入口，后台天气边界结算不通过查询反向推进天气排期。 */
export function resolveFoodProductionWeatherEffect(sceneId, { rainState, droughtActive = false }) {
    if (rainState?.active) {
        const intensityId = rainState.intensityId;
        return {
            multiplier: Math.max(0,
                Number(GAME_CONFIG.weatherEffects?.rain?.intensities?.[intensityId]
                    ?.foodProductionMultiplier) || 1),
            label: RAIN_LABELS[intensityId] || '降雨',
            weatherId: 'rain',
            rainActive: true,
            rainIntensityId: intensityId,
            droughtActive: false,
        };
    }
    const configuredDroughtMultiplier = Number(GAME_CONFIG.scenes?.[sceneId]
        ?.environmentEffects?.drought?.foodProductionMultiplier);
    return {
        multiplier: droughtActive
            ? (Number.isFinite(configuredDroughtMultiplier) ? Math.max(0, configuredDroughtMultiplier) : 0.5)
            : 1,
        label: droughtActive ? '干旱' : '正常天气',
        weatherId: droughtActive ? 'drought' : null,
        rainActive: false,
        rainIntensityId: null,
        droughtActive,
    };
}

export default getFoodProductionWeatherEffect;
