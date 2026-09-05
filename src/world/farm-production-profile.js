import { GAME_CONFIG } from '../config/game-config.js';
import populationEconomyConfig from '../../data/population-economy.json';
import { hasNaturalSunlight } from './scene-sunlight.js';

// 前台物流、后台快照结算和详情共用农场的模块/存档身份。
const FARM_PROFILES = Object.freeze({
    cheese_farm: {
        savePrefix: 'cheeseFarm', buildingName: '奶酪农场',
        processModule: 'cheese_maturation', outputModule: 'cheese_breed_selection',
        scaleModule: 'cheese_pasture_expansion', moveModule: 'cheese_delivery_cart',
        baseScaleKey: 'baseCowCount',
        phaseText: { processing: '门口待命 · 奶酪熟成中', waiting_deposit: '等待仓库空位',
            to_deposit: '抱着奶酪前往仓库', to_farm: '空手返回牧场' },
    },
    corn_farm: {
        savePrefix: 'cornFarm', buildingName: '玉米农场',
        processModule: 'corn_growth_cycle', outputModule: 'corn_seed_selection',
        scaleModule: 'corn_field_expansion', moveModule: 'corn_harvest_cart',
        baseScaleKey: 'baseFieldCount',
        phaseText: { processing: '田间作业 · 玉米生长中', waiting_deposit: '等待仓库空位',
            to_deposit: '携带玉米前往仓库', to_farm: '空手返回农场' },
    },
    mushroom_farm: {
        savePrefix: 'mushroomFarm', buildingName: '蘑菇农场',
        processModule: 'mushroom_growth_cycle', outputModule: 'mushroom_strain_selection',
        scaleModule: 'mushroom_bed_expansion', moveModule: 'mushroom_harvest_cart',
        baseScaleKey: 'baseFieldCount',
        phaseText: { processing: '菌床培育 · 蘑菇生长中', waiting_deposit: '等待仓库空位',
            to_deposit: '运送蘑菇前往仓库', to_farm: '空手返回农场' },
    },
});

export function getFarmProfile(economyType) {
    return FARM_PROFILES[economyType] || null;
}

/** 位面固有环境，不读取昼夜时钟；后台必须显式传入所属 sceneId。 */
export function getFarmPlaneEffect(economyType, sceneId = null) {
    const multipliers = populationEconomyConfig[economyType]?.planeOutputMultipliers;
    if (!multipliers) return { multiplier: 1, label: '无位面修正', source: 'none' };
    const resolvedId = sceneId || globalThis.SceneManager?.currentScene;
    const scene = GAME_CONFIG.scenes?.[resolvedId];
    if (!scene) return { multiplier: 1, label: '位面未就绪', source: 'none' };
    const sceneMultiplier = Number(multipliers[resolvedId]);
    if (Number.isFinite(sceneMultiplier) && sceneMultiplier >= 0) {
        return {
            multiplier: sceneMultiplier,
            label: scene.name || resolvedId,
            source: 'scene',
        };
    }
    const hasSunlight = hasNaturalSunlight(resolvedId);
    const sunlightKey = hasSunlight ? 'sunlit' : 'sunless';
    if (!Object.prototype.hasOwnProperty.call(multipliers, sunlightKey)) {
        return { multiplier: 1, label: '无位面修正', source: 'none' };
    }
    const sunlightMultiplier = Number(multipliers[sunlightKey]);
    return {
        multiplier: Number.isFinite(sunlightMultiplier) && sunlightMultiplier >= 0
            ? sunlightMultiplier : 1,
        label: hasSunlight ? '有阳光位面' : '无阳光位面',
        source: 'sunlight',
    };
}
