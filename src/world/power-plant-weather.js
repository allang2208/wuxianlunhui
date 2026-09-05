import populationEconomyConfig from '../../data/population-economy.json';

const RAIN_LABELS = Object.freeze({
    light: '小雨',
    moderate: '中雨',
    heavy: '大雨',
    storm: '暴风雨',
});

function currentSceneId() {
    return typeof globalThis !== 'undefined'
        ? globalThis.SceneManager?.currentScene || null
        : null;
}

function weatherState(sceneId, gameTimeMs) {
    const resolvedSceneId = sceneId || currentSceneId();
    const weatherSystem = typeof globalThis !== 'undefined'
        ? globalThis.WorldWeatherSystem : null;
    const sandstormSystem = typeof globalThis !== 'undefined'
        ? globalThis.World122SandstormSystem : null;
    const rainState = resolvedSceneId && weatherSystem?.getVisualState
        ? weatherSystem.getVisualState(resolvedSceneId, gameTimeMs ?? undefined)
        : { active: false, intensityId: null };
    return {
        rainState,
        sandstormActive: !!resolvedSceneId
            && sandstormSystem?.isActive?.(resolvedSceneId) === true,
    };
}

/** 风力电站取当前最高天气增效，多天气不叠乘。 */
export function getWindPowerWeatherEffect(sceneId = null, gameTimeMs = null) {
    return resolveWindPowerWeatherEffect(weatherState(sceneId, gameTimeMs));
}

export function resolveWindPowerWeatherEffect({ rainState, sandstormActive }) {
    const cfg = populationEconomyConfig.wind_power_plant?.weatherOutputMultipliers || {};
    const rainMultiplier = rainState?.active
        ? Math.max(1, Number(cfg.rain?.[rainState.intensityId]) || 1)
        : 1;
    const sandstormMultiplier = sandstormActive
        ? Math.max(1, Number(cfg.sandstorm) || 1)
        : 1;
    const multiplier = Math.max(1, rainMultiplier, sandstormMultiplier);
    const label = sandstormMultiplier >= rainMultiplier && sandstormMultiplier > 1
        ? '沙尘暴'
        : (rainMultiplier > 1 ? (RAIN_LABELS[rainState.intensityId] || '降雨') : '无天气增效');
    return {
        multiplier,
        label,
        rainActive: !!rainState?.active,
        rainIntensityId: rainState?.active ? rainState.intensityId : null,
        rainMultiplier,
        sandstormActive,
        sandstormMultiplier,
    };
}

/** 光伏电站取当前最低天气效率，多天气不叠乘。 */
export function getSolarPowerWeatherEffect(sceneId = null, gameTimeMs = null) {
    return resolveSolarPowerWeatherEffect(weatherState(sceneId, gameTimeMs));
}

export function resolveSolarPowerWeatherEffect({ rainState, sandstormActive }) {
    const cfg = populationEconomyConfig.solar_power_plant?.weatherOutputMultipliers || {};
    const rainMultiplier = rainState?.active
        ? Math.max(0, Math.min(1, Number(cfg.rain?.[rainState.intensityId]) || 1))
        : 1;
    const sandstormMultiplier = sandstormActive
        ? Math.max(0, Math.min(1, Number(cfg.sandstorm) || 1))
        : 1;
    const multiplier = Math.min(1, rainMultiplier, sandstormMultiplier);
    const label = sandstormMultiplier <= rainMultiplier && sandstormMultiplier < 1
        ? '沙尘暴'
        : (rainMultiplier < 1 ? (RAIN_LABELS[rainState.intensityId] || '降雨') : '无天气衰减');
    return {
        multiplier,
        label,
        rainActive: !!rainState?.active,
        rainIntensityId: rainState?.active ? rainState.intensityId : null,
        rainMultiplier,
        sandstormActive,
        sandstormMultiplier,
    };
}
