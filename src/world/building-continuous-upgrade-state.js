// 持续目标的快照读取规则；只读配置/等级，不启动升级，也不支付资源。
import producerConfigs from '../../data/producer-buildings.json';
import minerConfig from '../../data/hamster-miner-camp-building.json';
import populationConfig from '../../data/population-economy.json';
import { getAbilityLevel } from './ability-store.js';
import { getUnitUpgradeLevel } from './unit-upgrade-store.js';
import { normalizeBuildingContinuousTarget, resolveBuildingUpgradeProject } from './building-upgrade-projects.js';

const MODULE_FIELDS = {
    weather_forecast: 'weatherModules', warehouse: 'warehouseModules',
    bank: 'bankModules', grand_mall: 'grandMallModules',
    bakery: 'bakeryModules', desert_cookhouse: 'desertCookhouseModules', frost_smokehouse: 'frostSmokehouseModules',
    chain_restaurant: 'chainRestaurantModules',
    cheese_farm: 'cheeseFarmModules', corn_farm: 'cornFarmModules',
    mushroom_farm: 'mushroomFarmModules',
    steam_power_plant: 'steamModules', tavern: 'tavernModules',
    workshop: 'workshopModules', armory: 'armoryModules', field_hospital: 'hospitalModules',
    research: 'researchModules', advanced_research: 'advancedResearchModules',
    windmill: 'windmillModules', royal_mint: 'mintModules',
    planar_resonator: 'resonatorModules', wind_power_plant: 'windPowerModules',
    solar_power_plant: 'solarPowerModules', computing_center: 'computingCenterModules',
    geothermal_power_plant: 'geothermalPowerModules',
};
const LEVEL_PROJECTS = {
    house_capacity: ['housing', 'house'],
    research_institute_level: ['research', 'research'],
    warehouse_level: ['warehouse', 'warehouse'],
};

export function getSnapshotContinuousUpgradeTargets(structure) {
    const empty = { continuous: null, economyContinuous: null };
    if (!structure || Number(structure.hp ?? 1) <= 0
        || !(structure.continuous || structure.economyContinuous)) return empty;
    const cfg = resolveBuildingUpgradeProject(structure.kind === 'hut' ? minerConfig
        : producerConfigs[structure.kind === 'barracks' ? 'hamster_barracks' : structure.cfgKey]);
    if (!cfg) return empty;
    let continuous = normalizeBuildingContinuousTarget(structure.continuous);
    if (continuous?.kind === 'ability') {
        const ability = cfg.abilities?.[continuous.abilityId];
        if (!ability || getAbilityLevel(continuous.abilityId) >= (ability.maxLevel ?? 10)) continuous = null;
    } else if (continuous?.kind === 'module') {
        const module = cfg.modules?.[continuous.moduleId];
        const kinds = (cfg.unitTypes || []).map((unit) => unit.key)
            .filter((kind) => (!module?.unitKinds || module.unitKinds.includes(kind))
                && continuous.unitTypes.includes(kind));
        if (!module || !kinds.length || kinds.every((kind) =>
            getUnitUpgradeLevel(kind, continuous.moduleId) >= (Number(module.maxLevel) || 0))) continuous = null;
    }
    let economyContinuous = typeof structure.economyContinuous === 'string'
        ? structure.economyContinuous : null;
    if (economyContinuous) {
        const levelProject = LEVEL_PROJECTS[economyContinuous];
        if (Array.isArray(levelProject) && levelProject[0] === cfg.economyType) {
            const nextLevel = Math.max(1, Math.floor(Number(structure.economyLevel) || 1)) + 1;
            if (!(populationConfig[levelProject[1]]?.levels || []).some((entry) => entry.level === nextLevel)) {
                economyContinuous = null;
            }
        } else {
            const field = structure.kind === 'hut' ? 'modules'
                : cfg.panelMode === 'candle' ? 'candleModules' : MODULE_FIELDS[cfg.economyType];
            const module = cfg.modules?.[economyContinuous];
            if (!field || !module || (Number(structure[field]?.[economyContinuous]) || 0)
                >= (Number(module.maxLevel) || 0)) economyContinuous = null;
        }
    }
    return { continuous, economyContinuous };
}
