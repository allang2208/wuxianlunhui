// ============================================================
// 世界-122 后台抽象结算（2026-08-18，多世界并行 M1）
//
// 玩家不在世界-122 时，世界不逐实体模拟；离场期间按本模块做「回场结算」：
// 以快照 + 离场时长推演世界状态（产兵/采矿/读条/波次战报），回场一次性物化。
//
// 口径（全部为可调整的估算常量，集中在 WORLD122_SIM）：
// - 波次：预算 TP × SIM.tpHpAvg 估 HP 池；防守方 DPS = 塔（捕获时实机口径入快照）
//   + 军事单位（配置×全局升级倍率）；清波耗时 = 池/DPS。怪物输出按接触系数
//   落到「墙/门 → 建筑 → 基地」顺序承伤。回场时仍在进行中的波次重开（break 阶段）。
// - 采矿：矿工产出 = 数量 × 单矿工速率（miner 配置真源）× 采矿效率模块；受仓库
//   剩余容量与矿点余量双重封顶；无仓库不采（与实机满仓口径一致）。
// - 读条：铁匠铺能力/研究院研究及出兵建筑模块按剩余时间完成并升全局等级；持续目标独立保留，
//   后台完成当前读条后回场由实机资源轮询自动续升。
// - commit=false 时为预览（世界切换面板用）：不改快照、不触发全局副作用。
// ============================================================
import { getAbilityLevel, getAbilityValue, raiseAbilityLevel } from './ability-store.js';
import {
    applyGlobalUpgradesToKind,
    getUnitUpgradeMults,
    raiseSharedUnitUpgradeLevel,
} from './unit-upgrade-store.js';
import { ResearchSystem } from './research-system.js';
import { RECRUIT_MODE, normalizeRecruitMode } from './recruit-mode.js';
import { resolveRecruitmentUnitType } from './recruitment-tier.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import {
    getBuildingUpgradeAbility,
    getUpgradeModulesForUnitKind,
} from './building-upgrade-projects.js';
import producerBuildingsJson from '../../data/producer-buildings.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import championCfg from '../../data/hamster-champion-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import phalanxCfg from '../../data/hamster-phalanx-config.json';
import riotSquadCfg from '../../data/hamster-riot-squad-config.json';
import specialForcesCfg from '../../data/hamster-special-forces-config.json';
import trenchAssaultCfg from '../../data/hamster-trench-assault-config.json';
import halberdierCfg from '../../data/hamster-halberdier-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import rangerCfg from '../../data/hamster-ranger-config.json';
import crossbowCfg from '../../data/hamster-crossbow-config.json';
import catapultCrewCfg from '../../data/hamster-catapult-crew-config.json';
import fieldCannonCrewCfg from '../../data/hamster-field-cannon-crew-config.json';
import industrialArtilleryCrewCfg from '../../data/hamster-industrial-artillery-crew-config.json';
import howitzerCrewCfg from '../../data/hamster-howitzer-crew-config.json';
import longbowCfg from '../../data/hamster-longbow-config.json';
import assaultCfg from '../../data/hamster-assault-config.json';
import heavyMachineGunnerCfg from '../../data/hamster-heavy-machine-gunner-config.json';
import serviceRiflemanCfg from '../../data/hamster-service-rifleman-config.json';
import barAutomaticRiflemanCfg from '../../data/hamster-bar-automatic-rifleman-config.json';
import sniperCfg from '../../data/hamster-sniper-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import antiVehicleCfg from '../../data/hamster-anti-vehicle-config.json';
import priestCfg from '../../data/hamster-priest-config.json';
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import cavalryCfg from '../../data/hamster-cavalry-config.json';
import wingedHussarCfg from '../../data/hamster-winged-hussar-config.json';
import scoutRifleSkirmisherCfg from '../../data/hamster-scout-rifle-skirmisher-config.json';
import poweredEodExplosiveLancerCfg from '../../data/hamster-powered-eod-explosive-lancer-config.json';
import industrialCarbineCavalryCfg from '../../data/hamster-industrial-carbine-cavalry-config.json';
import industrialHeavyLancerCfg from '../../data/hamster-industrial-heavy-lancer-config.json';
import antiTankRiflemanCfg from '../../data/hamster-anti-tank-rifleman-config.json';
import industrialReconRiflemanCfg from '../../data/hamster-industrial-recon-rifleman-config.json';
import steelShieldAssaultCfg from '../../data/hamster-steel-shield-assault-config.json';
import ninjaCfg from '../../data/hamster-ninja-config.json';
import samuraiCfg from '../../data/hamster-samurai-config.json';
import camelCavalryCfg from '../../data/hamster-camel-cavalry-config.json';
import explorerCfg from '../../data/hamster-explorer-config.json';
import bountyHunterCfg from '../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorCfg from '../../data/jaguar-warrior-config.json';
import junglePriestCfg from '../../data/jungle-priest-config.json';
import desertPriestCfg from '../../data/desert-priest-config.json';
import { MINER_CAMP_CONFIG, getMinerEnergyPerSecond, getMinerEconomyStats } from './miner-economy.js';
import populationEconomyConfig from '../../data/population-economy.json';
import buildingUpgradesJson from '../../data/building-upgrades.json';
import skillsData from '../../data/skills.json';
import combatFormulasData from '../../data/combat-formulas.json';
import { createExplorerReward } from '../config/explorer-rewards.js';
import { buildSkillFromJSON } from '../systems/skill-formula.js';
import { blockCellCenter } from './gate4-grid.js';
import { buildingRoadLayout } from './building-road-system.js';
import { createRoadNetwork, shortestRoadRoute } from './road-connectivity.js';
import { TechnologySystem } from './technology-system.js';
import {
    isInstantTroopProductionEnabled,
    isMilitaryPopulationIgnored,
    skipBuildingUpgradeWait,
} from '../config/dev-cheats.js';
import { getFoodProductionWeatherEffect } from './food-production-weather.js';

/** 抽象结算估算常量（调整平衡只改这里） */
export const WORLD122_SIM = {
    tpHpAvg: 35,            // 波次 HP 池：每威胁预算 TP ≈ 35 HP
    tpCountAvg: 3.5,        // 每只怪平均 TP（估只数）
    monsterDpsPer: 8,       // 每只怪平均 DPS（随波次 atk 成长另乘）
    contactFraction: 0.5,   // 怪物输出实际落到建筑的比例（其余被拦截/走位消耗）
    sweepExpectedExtraTargets: 1, // 横扫在波次抱团中按平均额外命中1个目标估算
    waveTimeMin: 20,        // 清波耗时下限（秒）
    waveTimeMax: 180,       // 清波耗时上限（秒）
};

const UNIT_CFGS = {
    hamster_catapult_crew: catapultCrewCfg,
    hamster_field_cannon_crew: fieldCannonCrewCfg,
    industrial_artillery_crew: industrialArtilleryCrewCfg,
    hamster_howitzer_crew: howitzerCrewCfg,
    militia: militiaCfg, warrior: warriorCfg, champion: championCfg, shooter: shooterCfg,
    guard: guardCfg, phalanx: phalanxCfg, trench_assault: trenchAssaultCfg, special_forces: specialForcesCfg, riot_special: riotSquadCfg, steel_shield_assault: steelShieldAssaultCfg, halberd: halberdierCfg, scout: scoutCfg, ranger: rangerCfg, industrial_recon_rifleman: industrialReconRiflemanCfg, crossbow: crossbowCfg, longbow: longbowCfg, assault: assaultCfg, heavy_machine_gunner: heavyMachineGunnerCfg, service_rifleman: serviceRiflemanCfg, emplaced_machine_gun_crew: barAutomaticRiflemanCfg, sniper: sniperCfg, musketeer: musketeerCfg, anti_vehicle: antiVehicleCfg, anti_tank_rifleman: antiTankRiflemanCfg, priest: priestCfg,
    knight: knightCfg, light_cavalry: lightCavalryCfg,
    cavalry: cavalryCfg, winged_hussar: wingedHussarCfg,
    industrial_carbine_cavalry: industrialCarbineCavalryCfg,
    gunpowder_explosive_lancer: industrialHeavyLancerCfg,
    powered_eod_explosive_lancer: poweredEodExplosiveLancerCfg,
    scout_rifle_skirmisher: scoutRifleSkirmisherCfg, ninja: ninjaCfg,
    samurai: samuraiCfg,
    camel_cavalry: camelCavalryCfg,
    explorer: explorerCfg, bounty_hunter: bountyHunterCfg,
    jaguar_warrior: jaguarWarriorCfg, jungle_priest: junglePriestCfg,
    desert_priest: desertPriestCfg,
};

function _snapshotRoadContext(snapshot) {
    const cells = new Map();
    const addCell = (cell) => {
        const i = Number(cell?.i);
        const j = Number(cell?.j);
        if (!Number.isInteger(i) || !Number.isInteger(j)) return;
        const key = `${i},${j}`;
        const [x, y] = blockCellCenter(i, j);
        cells.set(key, { key, i, j, x, y });
    };
    for (const road of snapshot.roads || []) addCell(road);
    for (const structure of snapshot.structures || []) {
        if (structure?.kind !== 'producer' || !(Number(structure.hp ?? 1) > 0)) continue;
        const config = producerBuildingsJson[structure.cfgKey] || {};
        if ((config.perimeterTile ?? 'road') !== 'road') continue;
        for (const cell of buildingRoadLayout(
            structure.x,
            structure.y,
            Number(config.footprintCells) || 2
        ).roadCells) addCell(cell);
    }
    // 常开门允许后台道路通过；自动门离场后没有友军维持感应，按关闭状态结算。
    const blockers = [];
    for (const structure of snapshot.structures || []) {
        if (!(Number(structure?.hp ?? 1) > 0)) continue;
        if (structure.kind === 'block') {
            blockers.push({ x: Number(structure.x) || 0, y: Number(structure.y) || 0 });
        } else if (structure.kind === 'gate4') {
            if (structure.gateMode !== 'open') {
                blockers.push({ x: Number(structure.x) || 0, y: Number(structure.y) || 0 });
            }
            for (const pillar of structure.pillars || []) {
                blockers.push({ x: Number(pillar.x) || 0, y: Number(pillar.y) || 0 });
            }
        }
    }
    const edgeBlocked = (from, to) => blockers.some((blocker) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1,
            ((blocker.x - from.x) * dx + (blocker.y - from.y) * dy) / lengthSq));
        return Math.hypot(
            blocker.x - (from.x + dx * t),
            blocker.y - (from.y + dy * t)
        ) < 36;
    });
    return { network: createRoadNetwork(cells.values(), { edgeBlocked }) };
}

function _snapshotBuildingAccessKeys(context, structure) {
    const footprintCells = Number(producerBuildingsJson[structure?.cfgKey]?.footprintCells) || 2;
    return buildingRoadLayout(structure.x, structure.y, footprintCells).roadCells
        .map((cell) => cell.key)
        .filter((key) => context.network.byKey.has(key));
}

function _snapshotReachableWarehouses(context, structure, warehouses) {
    const starts = _snapshotBuildingAccessKeys(context, structure);
    const reachable = [];
    for (const warehouse of warehouses || []) {
        const route = shortestRoadRoute(
            context.network,
            starts,
            _snapshotBuildingAccessKeys(context, warehouse)
        );
        if (route) reachable.push({ warehouse, route });
    }
    reachable.sort((a, b) => a.route.length - b.route.length);
    return reachable;
}

const JUNGLE_PRIEST_SIM_SKILLS = ['lightningStrike', 'iceSpike', 'fireball']
    .map((key) => buildSkillFromJSON(key, skillsData.skills?.[key] || {}));

/** 丛林祭司后台伤害保持现有 Lv.1 基线，只按三种真实魔法公式的平均成长比例放大。 */
function _junglePriestMagicDamageMult(level) {
    const spellLevel = Math.max(1, Math.floor(Number(level) || 1));
    const stats = junglePriestCfg.baseData || {};
    const magicFormula = combatFormulasData.player?.magicAttack || {};
    const matk = Math.floor(
        (Number(stats.int) || 0) * (Number(magicFormula.intMultiplier) || 0)
        + (Number(stats.wis) || 0) * (Number(magicFormula.wisMultiplier) || 0)
    );
    const powerAt = (atLevel) => JUNGLE_PRIEST_SIM_SKILLS.reduce((sum, skill) => {
        const effect = skill.getEffect(atLevel);
        let damage = (Number(effect.damageBase) || 0)
            + matk * (Number(effect.magicMul) || 0)
            + (Number(stats.int) || 0) * (Number(effect.intMul) || 0);
        if (skill.id === 'iceSpike') damage *= Math.max(1, Number(effect.spikeCount) || 1);
        return sum + damage;
    }, 0) / Math.max(1, JUNGLE_PRIEST_SIM_SKILLS.length);
    return Math.max(1, powerAt(spellLevel) / Math.max(1, powerAt(1)));
}

function _producerConfigOf(structure) {
    const cfgKey = structure?.kind === 'barracks' ? 'hamster_barracks' : structure?.cfgKey;
    return producerBuildingsJson[cfgKey] || null;
}

/** 兼容旧快照：未保存共享目标列表时，按建筑兵种与模块 unitKinds 重建。 */
function _moduleUnitTypesOf(structure, moduleId) {
    const buildingCfg = _producerConfigOf(structure);
    const module = buildingUpgradesJson[buildingCfg?.upgradeProject]?.modules?.[moduleId];
    if (!module) return [];
    return (buildingCfg.unitTypes || [])
        .map((unit) => unit?.key)
        .filter((kind) => kind && (!Array.isArray(module.unitKinds) || module.unitKinds.includes(kind)));
}

function _economyModuleValue(structure, economyType, moduleId) {
    const buildingCfg = producerBuildingsJson[structure?.cfgKey] || {};
    const project = buildingUpgradesJson[buildingCfg.upgradeProject];
    const module = project?.modules?.[moduleId];
    if (!module) return 0;
    const savedModules = {
        research: structure?.researchModules,
        advanced_research: structure?.advancedResearchModules,
        windmill: structure?.windmillModules,
        royal_mint: structure?.mintModules,
        bank: structure?.bankModules,
        grand_mall: structure?.grandMallModules,
        bakery: structure?.bakeryModules,
        desert_cookhouse: structure?.desertCookhouseModules,
        frost_smokehouse: structure?.frostSmokehouseModules,
        chain_restaurant: structure?.chainRestaurantModules,
        cheese_farm: structure?.cheeseFarmModules,
        steam_power_plant: structure?.steamModules,
        oil_power_plant: structure?.oilPowerModules,
        cannery: structure?.canneryModules,
        trading_company: structure?.tradingModules,
        wind_power_plant: structure?.windPowerModules,
        solar_power_plant: structure?.solarPowerModules,
        computing_center: structure?.computingCenterModules,
        tavern: structure?.tavernModules,
        armory: structure?.armoryModules,
        workshop: structure?.workshopModules,
        planar_resonator: structure?.resonatorModules,
        weather_forecast: structure?.weatherModules,
        field_hospital: structure?.hospitalModules,
    }[economyType];
    const level = Math.max(0, Math.min(
        Number(module.maxLevel) || 0,
        Math.floor(Number(savedModules?.[moduleId]) || 0)
    ));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function _economyEffectValue(structure, economyType, effect, fallback = 0) {
    const buildingCfg = producerBuildingsJson[structure?.cfgKey] || {};
    const project = buildingUpgradesJson[buildingCfg.upgradeProject];
    const entry = Object.entries(project?.modules || {})
        .find(([, module]) => module?.effect === effect);
    return entry ? _economyModuleValue(structure, economyType, entry[0]) : fallback;
}

const INDUSTRIAL_SIM_DEFINITIONS = {
    oil_power_plant: {
        cycleModule: 'oil_combustion_control', outputModule: 'oil_generator_output',
        inputModule: 'oil_fuel_efficiency', inputResource: 'gold', outputResource: 'energy',
    },
    cannery: {
        cycleModule: 'cannery_assembly_line', outputModule: 'cannery_food_output',
        inputModule: 'cannery_energy_efficiency', inputResource: 'energy', outputResource: 'food',
    },
    trading_company: {
        cycleModule: 'trading_contract_cycle', outputModule: 'trading_gold_output',
        inputModule: 'trading_food_efficiency', inputResource: 'food', outputResource: 'gold',
    },
};

function _workshopModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'workshop', moduleId);
}

function _bankModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'bank', moduleId);
}

function _grandMallModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'grand_mall', moduleId);
}

function _bakeryModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'bakery', moduleId);
}

function _desertCookhouseModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'desert_cookhouse', moduleId);
}

function _frostSmokehouseModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'frost_smokehouse', moduleId);
}

function _chainRestaurantModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'chain_restaurant', moduleId);
}

function _cheeseFarmModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'cheese_farm', moduleId);
}

function _steamModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'steam_power_plant', moduleId);
}

function _tavernModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'tavern', moduleId);
}

function _armoryModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'armory', moduleId);
}

function _bankServiceRange(structure) {
    return Math.max(0, _bankModuleValue(structure, 'bank_service_range'));
}

function _bankCoverageCountAt(target, economyStructures) {
    return (economyStructures || []).reduce((count, structure) => {
        if (producerBuildingsJson[structure?.cfgKey]?.economyType !== 'bank') return count;
        const range = _bankServiceRange(structure);
        const distance = Math.hypot(
            (Number(target?.x) || 0) - (Number(structure?.x) || 0),
            (Number(target?.y) || 0) - (Number(structure?.y) || 0)
        );
        return count + (distance <= range ? 1 : 0);
    }, 0);
}

function _bankOverlapMultiplier(bankCount) {
    const count = Math.max(0, Math.floor(Number(bankCount) || 0));
    const zeroAt = Math.max(1,
        Math.floor(Number(populationEconomyConfig.bank?.overlapZeroAtBankCount) || 3));
    if (count >= zeroAt) return 0;
    const penalty = Math.max(0, Math.min(1,
        Number(populationEconomyConfig.bank?.overlapPenaltyPerAdditionalBank) || 0));
    return Math.max(0, Math.min(1, 1 - Math.max(0, count - 1) * penalty));
}

function _economyWorkerSlots(structure, economyType) {
    const facility = producerBuildingsJson[structure?.cfgKey]?.researchFacility;
    if (economyType === 'advanced_research' && facility) {
        return Math.max(0, Math.floor(Number(facility.workerSlots) || 0));
    }
    const cfg = populationEconomyConfig[economyType] || {};
    if (cfg.workerSlotsAbilityId) {
        const ability = getBuildingUpgradeAbility(cfg.workerSlotsAbilityId);
        if (ability) {
            return Math.max(0, Math.floor(getAbilityValue(
                ability,
                getAbilityLevel(cfg.workerSlotsAbilityId)
            )));
        }
    }
    if (cfg.workerSlotsModule) {
        const value = _economyModuleValue(structure, economyType, cfg.workerSlotsModule);
        return Math.max(0, Math.floor(value));
    }
    return Math.max(0, Math.floor(Number(cfg.workerSlots) || 0));
}

function _processorWorkerOutputFactor(structure, config) {
    const share = Number(config?.workerOutputEfficiencyShare);
    if (!(share > 0)) return 1;
    const fullCount = Math.max(1, Math.floor(Number(config.fullEfficiencyWorkerCount)
        || Number(config.workerSlots) || 1));
    const assigned = Math.max(0, Math.min(fullCount,
        Math.floor(Number(structure?.assignedWorkers) || 0)));
    return Math.max(0, Math.min(1, assigned * share));
}

function _researchFacilityType(structure) {
    const buildingCfg = producerBuildingsJson[structure?.cfgKey] || {};
    const economyType = buildingCfg.economyType;
    if (!['research', 'weather_forecast', 'advanced_research'].includes(economyType)) return '';
    return buildingCfg.researchFacility?.clusterType || structure?.cfgKey || economyType;
}

function _snapshotResearchClusterMultiplier(target, economyStructures) {
    const cfg = populationEconomyConfig.researchCluster || {};
    const targetEconomyType = producerBuildingsJson[target?.cfgKey]?.economyType;
    const radius = Math.max(0, _economyEffectValue(target, targetEconomyType,
        'advancedResearchClusterRadius', Number(cfg.radius) || 0));
    const bonusPerType = Math.max(0, _economyEffectValue(target, targetEconomyType,
        'advancedResearchClusterBonusPerType', Number(cfg.bonusPerDistinctFacilityType) || 0));
    const maxBonus = Math.max(0, Number(cfg.maxBonus) || 0);
    const selfType = _researchFacilityType(target);
    if (!selfType || radius <= 0 || bonusPerType <= 0) return 1;
    const types = new Set();
    for (const candidate of economyStructures || []) {
        if (candidate === target || !(Number(candidate?.hp ?? 1) > 0)) continue;
        if (Math.max(0, Math.floor(Number(candidate.assignedWorkers) || 0)) <= 0) continue;
        const candidateType = _researchFacilityType(candidate);
        if (!candidateType || candidateType === selfType) continue;
        const distance = Math.hypot(
            (Number(candidate.x) || 0) - (Number(target.x) || 0),
            (Number(candidate.y) || 0) - (Number(target.y) || 0)
        );
        if (distance <= radius) types.add(candidateType);
    }
    return 1 + Math.min(maxBonus, types.size * bonusPerType);
}

function _workshopEfficiencyMultiplier(target, economyStructures) {
    const targetType = producerBuildingsJson[target?.cfgKey]?.economyType;
    if (!targetType || targetType === 'housing' || targetType === 'workshop') return 1;
    let strongest = 0;
    const share = Math.max(0, Number(populationEconomyConfig.workshop?.engineerEfficiencyShare) || 0.2);
    for (const workshop of economyStructures || []) {
        if (producerBuildingsJson[workshop.cfgKey]?.economyType !== 'workshop' || !(workshop.hp > 0)) continue;
        const range = Math.max(0, _workshopModuleValue(workshop, 'workshop_range'));
        if (Math.hypot((target.x || 0) - (workshop.x || 0), (target.y || 0) - (workshop.y || 0)) > range) continue;
        const configured = Math.max(0, _workshopModuleValue(workshop, 'workshop_efficiency'));
        const engineers = Math.min(
            Math.max(0, Math.floor(_workshopModuleValue(workshop, 'workshop_engineers'))),
            Math.max(0, Math.floor(Number(workshop.assignedWorkers) || 0))
        );
        strongest = Math.max(strongest, configured * Math.min(1, engineers * share));
    }
    return 1 + strongest;
}

const TAVERN_OUTPUT_TARGETS = new Set([
    'windmill', 'bakery', 'desert_cookhouse', 'frost_smokehouse', 'chain_restaurant', 'cheese_farm',
    'miner_camp', 'deep_drill', 'steam_power_plant', 'oil_power_plant', 'wind_power_plant', 'solar_power_plant', 'planar_resonator',
    'cannery', 'trading_company',
    'bank', 'royal_mint', 'grand_mall',
    'research', 'weather_forecast', 'advanced_research',
]);

function _tavernConfiguredBonus(structure) {
    return Math.max(0, _tavernModuleValue(structure, 'tavern_feast_sign')
        || Number(populationEconomyConfig.tavern?.baseOutputBonus) || 0.12);
}

function _snapshotTavernMultiplier(economyType, economyStructures) {
    if (!TAVERN_OUTPUT_TARGETS.has(economyType)) return 1;
    let strongest = 0;
    for (const tavern of economyStructures || []) {
        if (producerBuildingsJson[tavern?.cfgKey]?.economyType !== 'tavern') continue;
        const job = tavern.tavernJob;
        if (!(Number(tavern.hp ?? 1) > 0)
            || Math.floor(Number(tavern.assignedWorkers) || 0) <= 0
            || job?.phase !== 'serving'
            || !(Number(job.serviceRemainMs) > 0)) continue;
        strongest = Math.max(strongest, _tavernConfiguredBonus(tavern));
    }
    return 1 + strongest;
}

function _advanceSnapshotTavernPosition(job, entry, phase) {
    const sourceRoute = Array.isArray(entry?.route) ? entry.route : [];
    const route = phase === 'to_tavern' ? [...sourceRoute].reverse() : sourceRoute;
    if (route.length <= 0) return;
    const totalMs = Math.max(1, Number(job.phaseTotalMs) || 1);
    const progress = Math.max(0, Math.min(1,
        1 - Math.max(0, Number(job.phaseRemainMs) || 0) / totalMs));
    // 后台不物化 Sprite，但持久化位置仍落在道路折线上，保证切回前台后可以从当前道路格重算。
    const points = route;
    if (points.length === 1) {
        job.x = points[0].x;
        job.y = points[0].y;
        return;
    }
    const segments = [];
    let totalDistance = 0;
    for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance <= 0) continue;
        segments.push({ from, to, distance });
        totalDistance += distance;
    }
    if (totalDistance <= 0) return;
    let targetDistance = totalDistance * progress;
    for (const segment of segments) {
        if (targetDistance > segment.distance) {
            targetDistance -= segment.distance;
            continue;
        }
        const ratio = targetDistance / segment.distance;
        job.x = segment.from.x + (segment.to.x - segment.from.x) * ratio;
        job.y = segment.from.y + (segment.to.y - segment.from.y) * ratio;
        return;
    }
    const last = points[points.length - 1];
    job.x = last.x;
    job.y = last.y;
}

function _simulateTavernService(structure, elapsedMs, laborEfficiency,
    roadContext, warehouses) {
    const cfg = populationEconomyConfig.tavern || {};
    const job = structure.tavernJob && typeof structure.tavernJob === 'object'
        ? structure.tavernJob : {};
    structure.tavernJob = job;
    job.phase = ['idle', 'to_pickup', 'to_tavern', 'serving'].includes(job.phase)
        ? job.phase : 'idle';
    job.cargoFood = Math.max(0, Math.floor(Number(job.cargoFood) || 0));
    job.completedBatches = Math.max(0, Math.floor(Number(job.completedBatches) || 0));
    if (Math.floor(Number(structure.assignedWorkers) || 0) <= 0) {
        return { activeMs: 0, foodSpent: 0 };
    }
    const reachableRoutes = _snapshotReachableWarehouses(roadContext, structure, warehouses);
    const routeByWarehouse = new Map(reachableRoutes.map((entry) => [
        entry.warehouse.id ?? `${entry.warehouse.x},${entry.warehouse.y}`,
        entry,
    ]));
    const inputFood = Math.max(1, Math.floor(
        _tavernModuleValue(structure, 'tavern_cellar_rations')
            || Number(cfg.inputFoodPerBatch) || 120));
    const serviceTimeMs = Math.max(100,
        _tavernModuleValue(structure, 'tavern_long_table')
            || Number(cfg.baseServiceTimeMs) || 60000);
    const moveSpeed = Math.max(1, (Number(cfg.baseMoveSpeed) || 80)
        * (_tavernModuleValue(structure, 'tavern_bartender_steps') || 1)
        * Math.max(0.01, Number(laborEfficiency) || 0));
    const routeDuration = (entry) => Math.max(100,
        Math.max(1, (entry?.route?.length || 1) - 1) * 64 / moveSpeed * 1000);
    let remaining = Math.max(0, Number(elapsedMs) || 0);
    let activeMs = 0;
    let foodSpent = 0;
    let guard = 10000;
    while (remaining > 0 && guard-- > 0) {
        if (job.phase === 'serving') {
            const serviceRemain = Math.max(0, Number(job.serviceRemainMs) || 0);
            if (serviceRemain <= 0) {
                job.phase = 'idle';
                job.serviceTotalMs = 0;
                job.completedBatches++;
                continue;
            }
            const spent = Math.min(remaining, serviceRemain);
            activeMs += spent;
            remaining -= spent;
            job.serviceRemainMs = serviceRemain - spent;
            if (job.serviceRemainMs <= 0) {
                job.serviceRemainMs = 0;
                job.serviceTotalMs = 0;
                job.phase = 'idle';
                job.targetWarehouseId = null;
                job.completedBatches++;
            }
            continue;
        }
        if (job.phase === 'idle') {
            const entry = reachableRoutes.find(({ warehouse }) =>
                Math.floor(Number(warehouse.storedFood) || 0) >= inputFood);
            if (!entry) break;
            job.targetWarehouseId = entry.warehouse.id ?? `${entry.warehouse.x},${entry.warehouse.y}`;
            job.phase = 'to_pickup';
            job.phaseTotalMs = routeDuration(entry);
            job.phaseRemainMs = job.phaseTotalMs;
            continue;
        }
        const entry = routeByWarehouse.get(job.targetWarehouseId)
            || (job.phase === 'to_tavern' ? reachableRoutes[0] : null);
        // 运输阶段断路或仓库失效时冻结位置、携粮与阶段，待回场后从当前道路格续作。
        if (!entry) break;
        let phaseRemain = Math.max(0, Number(job.phaseRemainMs) || 0);
        if (phaseRemain <= 0) {
            job.phaseTotalMs = routeDuration(entry);
            phaseRemain = job.phaseTotalMs;
        }
        const spent = Math.min(remaining, phaseRemain);
        remaining -= spent;
        job.phaseRemainMs = phaseRemain - spent;
        _advanceSnapshotTavernPosition(job, entry, job.phase);
        if (job.phaseRemainMs > 0) break;
        if (job.phase === 'to_pickup') {
            if (!_deductFoodFromWarehouses([entry.warehouse], inputFood)) {
                job.phase = 'idle';
                job.targetWarehouseId = null;
                continue;
            }
            foodSpent += inputFood;
            job.cargoFood = inputFood;
            job.phase = 'to_tavern';
            job.phaseTotalMs = routeDuration(entry);
            job.phaseRemainMs = job.phaseTotalMs;
            job.x = Number(entry.warehouse.x) || job.x || structure.x || 0;
            job.y = Number(entry.warehouse.y) || job.y || structure.y || 0;
            continue;
        }
        job.x = Number(structure.x) || 0;
        job.y = Number(structure.y) || 0;
        job.cargoFood = 0;
        job.phase = 'serving';
        job.serviceTotalMs = serviceTimeMs;
        job.serviceRemainMs = serviceTimeMs;
        job.phaseRemainMs = 0;
        job.phaseTotalMs = 0;
    }
    return { activeMs, foodSpent };
}

/**
 * 只读计算一个后台位面的研究院数量与全部科研速率（含气象科研）。科技树是跨位面全局系统，因此
 * WorldSimDriver 会把所有后台快照与当前前台位面的结果相加后统一推进。
 */
export function getWorld122ResearchSummary(snapshot) {
    const structures = Array.isArray(snapshot?.structures) ? snapshot.structures : [];
    const economyStructures = structures.filter((structure) =>
        structure?.kind === 'producer'
        && Number(structure?.hp ?? 1) > 0
        && producerBuildingsJson[structure?.cfgKey]?.economyType
    );
    const houseLevels = populationEconomyConfig.house?.levels || [];
    const populationCapacity = economyStructures.reduce((sum, structure) => {
        if (producerBuildingsJson[structure.cfgKey]?.economyType !== 'housing') return sum;
        const level = Math.max(1, Math.floor(Number(structure.economyLevel) || 1));
        const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
        return sum + Math.max(0, Number(levelCfg?.populationCapacity) || 0);
    }, 0);
    let assignedPopulation = economyStructures.reduce((sum, structure) => {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        const assigned = Math.max(0, Math.min(
            _economyWorkerSlots(structure, economyType),
            Math.floor(Number(structure.assignedWorkers) || 0)
        ));
        return sum + assigned;
    }, 0);
    for (const camp of structures) {
        if (camp?.kind !== 'hut' || !(Number(camp.hp ?? 1) > 0)) continue;
        const slots = getMinerEconomyStats(camp.modules || {}).count;
        const migrated = camp.assignedWorkers == null ? camp.miners : camp.assignedWorkers;
        assignedPopulation += Math.max(0, Math.min(
            slots,
            Math.floor(Number(migrated) || 0)
        ));
    }
    const laborEfficiency = assignedPopulation > 0
        ? Math.max(0, Math.min(1, populationCapacity / assignedPopulation))
        : 1;
    const lastWeightedTavernMultiplier = Math.max(1,
        Number(snapshot?.tavernLastWeightedMultiplier) || 1);
    const researchCfg = populationEconomyConfig.research || {};
    const researchLevels = researchCfg.levels || [];
    const baseModuleId = researchCfg.baseResearchModuleId || 'research_base_points';
    const workerShare = Math.max(0, Number(researchCfg.workerEfficiencyShare) || 0.1);
    let count = 0;
    let rate = 0;
    for (const structure of economyStructures) {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        if (economyType === 'research') {
            count += 1;
            const level = Math.max(1, Math.floor(Number(structure.economyLevel) || 1));
            const levelCfg = researchLevels.find((entry) => entry.level === level)
                || researchLevels[0] || {};
            const baseRate = Math.max(0,
                Number(levelCfg.baseResearchPointsPerSecond) || 0)
                + Math.max(0, _economyModuleValue(structure, economyType, baseModuleId));
            const staffed = Math.min(
                _economyWorkerSlots(structure, 'research'),
                Math.max(0, Math.floor(Number(structure.assignedWorkers) || 0))
            );
            const staffFactor = Math.max(0, Math.min(1, staffed * workerShare));
            rate += baseRate * staffFactor * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures)
                * (snapshot?.tavernLastWeightedMultiplier != null
                    ? lastWeightedTavernMultiplier
                    : _snapshotTavernMultiplier(economyType, economyStructures))
                * _snapshotResearchClusterMultiplier(structure, economyStructures)
                * getProductionResourceMul();
        } else if (economyType === 'weather_forecast') {
            count += 1;
            const weatherCfg = populationEconomyConfig.weather_forecast || {};
            const moduleId = weatherCfg.researchModuleId || 'weather_forecast_cycles';
            const baseRate = Math.max(0,
                _economyModuleValue(structure, economyType, moduleId));
            const staffed = Math.min(
                _economyWorkerSlots(structure, economyType),
                Math.max(0, Math.floor(Number(structure.assignedWorkers) || 0))
            );
            const staffFactor = Math.max(0, Math.min(1,
                staffed * (Number(weatherCfg.workerEfficiencyShare) || 1)));
            rate += baseRate * staffFactor * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures)
                * (snapshot?.tavernLastWeightedMultiplier != null
                    ? lastWeightedTavernMultiplier
                    : _snapshotTavernMultiplier(economyType, economyStructures))
                * _snapshotResearchClusterMultiplier(structure, economyStructures)
                * getProductionResourceMul();
        } else if (economyType === 'advanced_research') {
            count += 1;
            const facility = producerBuildingsJson[structure.cfgKey]?.researchFacility || {};
            const baseRate = Math.max(0,
                _economyEffectValue(structure, economyType, 'advancedResearchBasePoints',
                    Number(facility.baseResearchPointsPerSecond) || 0));
            const slots = _economyWorkerSlots(structure, economyType);
            const staffed = Math.min(
                slots,
                Math.max(0, Math.floor(Number(structure.assignedWorkers) || 0))
            );
            const workerShare = Math.max(0,
                _economyEffectValue(structure, economyType,
                    'advancedResearchWorkerEfficiencyShare',
                    Number(facility.workerEfficiencyShare) || (slots > 0 ? 1 / slots : 0)));
            const staffFactor = Math.max(0, Math.min(1, staffed * workerShare));
            rate += baseRate * staffFactor * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures)
                * (snapshot?.tavernLastWeightedMultiplier != null
                    ? lastWeightedTavernMultiplier
                    : _snapshotTavernMultiplier(economyType, economyStructures))
                * _snapshotResearchClusterMultiplier(structure, economyStructures)
                * getProductionResourceMul();
        }
    }
    return { count, rate };
}

function _armoryResourceCostMultiplier(target, economyStructures) {
    let strongest = 0;
    const share = Math.max(0,
        Number(populationEconomyConfig.armory?.staffEfficiencyShare) || 0.2);
    for (const armory of economyStructures || []) {
        if (producerBuildingsJson[armory.cfgKey]?.economyType !== 'armory' || !(armory.hp > 0)) continue;
        const range = Math.max(0, _armoryModuleValue(armory, 'armory_service_range'));
        if (Math.hypot((target.x || 0) - (armory.x || 0), (target.y || 0) - (armory.y || 0)) > range) continue;
        const configured = Math.max(0, Math.min(0.95,
            _armoryModuleValue(armory, 'armory_equipment_care')));
        const staff = Math.min(
            Math.max(0, Math.floor(_armoryModuleValue(armory, 'armory_staff'))),
            Math.max(0, Math.floor(Number(armory.assignedWorkers) || 0))
        );
        strongest = Math.max(strongest, configured * Math.min(1, staff * share));
    }
    return Math.max(0.05, Math.min(1, 1 - strongest));
}

function _structureMaxHp(structure) {
    const saved = Math.max(0, Number(structure?.maxHp) || 0);
    if (saved > 0) return saved;
    if (structure?.kind === 'producer') {
        return Math.max(0, Number(producerBuildingsJson[structure.cfgKey]?.hp) || 0);
    }
    return 0;
}

/** 后台仅在已知无敌的 prep/break 时间窗维修；逐工坊保存抽象行程，抵达后才结算恢复。 */
function _settleWorkshopRepairs(target, economyStructures, safeSeconds) {
    const workshops = (economyStructures || []).filter((structure) =>
        producerBuildingsJson[structure.cfgKey]?.economyType === 'workshop' && structure.hp > 0
    );
    if (safeSeconds <= 0) {
        for (const workshop of workshops) workshop.workshopRepairAssignments = {};
        return;
    }
    const structures = (target.structures || []).filter((structure) => {
        const maxHp = _structureMaxHp(structure);
        return structure.hp > 0 && maxHp > 0 && structure.hp < maxHp;
    });
    const globallyClaimed = new Set();
    const speed = Math.max(1, Number(populationEconomyConfig.workshop?.engineerSpeed) || 180);
    for (const workshop of workshops) {
        const range = Math.max(0, _workshopModuleValue(workshop, 'workshop_range'));
        const engineerCount = Math.min(
            Math.max(0, Math.floor(_workshopModuleValue(workshop, 'workshop_engineers'))),
            Math.max(0, Math.floor(Number(workshop.assignedWorkers) || 0))
        );
        const rate = Math.max(0, _workshopModuleValue(workshop, 'workshop_repair'));
        const existing = workshop.workshopRepairAssignments || {};
        const assignments = {};
        const candidates = structures
            .filter((structure) => !globallyClaimed.has(structure.id)
                && Math.hypot((structure.x || 0) - (workshop.x || 0), (structure.y || 0) - (workshop.y || 0)) <= range)
            .sort((a, b) => a.hp / _structureMaxHp(a) - b.hp / _structureMaxHp(b));
        for (let index = 0; index < engineerCount; index++) {
            const savedTargetId = existing[index]?.targetId;
            let repairTarget = candidates.find((structure) =>
                structure.id === savedTargetId && !globallyClaimed.has(structure.id));
            if (!repairTarget) repairTarget = candidates.find((structure) => !globallyClaimed.has(structure.id));
            if (!repairTarget) continue;
            globallyClaimed.add(repairTarget.id);
            const distance = Math.hypot(
                (repairTarget.x || 0) - (workshop.x || 0),
                (repairTarget.y || 0) - (workshop.y || 0)
            );
            const travelMs = savedTargetId === repairTarget.id
                ? Math.max(0, Number(existing[index]?.travelRemainMs) || 0)
                : distance / speed * 1000;
            const elapsedMs = safeSeconds * 1000;
            const workingMs = Math.max(0, elapsedMs - travelMs);
            const remainingTravelMs = Math.max(0, travelMs - elapsedMs);
            if (workingMs > 0) {
                const maxHp = _structureMaxHp(repairTarget);
                repairTarget.hp = Math.min(maxHp, repairTarget.hp + maxHp * rate * workingMs / 1000);
            }
            if (repairTarget.hp < _structureMaxHp(repairTarget)) {
                assignments[index] = { targetId: repairTarget.id, travelRemainMs: remainingTravelMs };
            }
        }
        workshop.workshopRepairAssignments = assignments;
    }
}

/** 兵种单兵 DPS（配置 × 全局升级倍率，与实机 spawnUnit 同公式） */
function _levelOf(abilityId, levelOverrides = null) {
    return levelOverrides && Object.prototype.hasOwnProperty.call(levelOverrides, abilityId)
        ? levelOverrides[abilityId]
        : getAbilityLevel(abilityId);
}

function _unitDps(kind, levelOverrides = null) {
    const cfg = UNIT_CFGS[kind];
    if (!cfg || !cfg.ai) return 0;
    if (kind === 'explorer') return 0;
    const mults = getUnitUpgradeMults(kind, getUpgradeModulesForUnitKind(kind));
    const dmg = (cfg.ai.attackDamage ?? 20) * mults.attackDamageMult;
    const spellCooldownMult = kind === 'jungle_priest' ? mults.jungleSpellCooldownMult : 1;
    const artillery = ['hamster_catapult_crew', 'hamster_field_cannon_crew',
        'industrial_artillery_crew', 'hamster_howitzer_crew'].includes(kind);
    const interval = Math.max(300, artillery ? cfg.animations.attack.durationMs : 0,
        (cfg.ai.attackInterval ?? 2000) * mults.attackIntervalMult * spellCooldownMult);
    let dps = dmg * 1000 / interval;
    if (kind === 'heavy_machine_gunner' || kind === 'emplaced_machine_gun_crew') {
        const shotCount = Math.max(1, cfg.ai.attackLaunchFrames?.length || 1);
        dps *= shotCount;
    }
    if (artillery) {
        dps *= 1 + Math.max(0, Number(cfg.ai.expectedExtraTargets) || 0)
            * (1 - (Number(cfg.ai.splashFalloff) || 0) * 0.5);
    }
    if (kind === 'anti_vehicle') {
        const rocketDamage = (Number(cfg.ai.rocketDamage) || 0) * mults.attackDamageMult;
        dps += rocketDamage * 1000 / Math.max(1000, Number(cfg.ai.rocketCooldownMs) || 8000);
    }
    if (kind === 'anti_tank_rifleman') {
        // 后台只折算一次手榴弹直击，不虚构范围内额外聚怪收益。
        const grenadeDamage = (Number(cfg.ai.grenadeDamage) || 0) * mults.attackDamageMult;
        dps += grenadeDamage * 1000 / Math.max(1000,
            Number(cfg.ai.grenadeCooldownMs) || 10000);
    }
    const doubleStrikeChance = Math.max(0, Math.min(1,
        Number(cfg.passives?.doubleStrikeChance) || 0));
    const doubleStrikeMultiplier = Math.max(1,
        Number(cfg.passives?.doubleStrikeMultiplier) || 1);
    dps *= 1 + doubleStrikeChance * (doubleStrikeMultiplier - 1);
    if (kind === 'jungle_priest') {
        dps *= _junglePriestMagicDamageMult(mults.jungleMagicLevel);
    }
    if ((kind === 'knight' || kind === 'winged_hussar' || kind === 'gunpowder_explosive_lancer'
        || kind === 'powered_eod_explosive_lancer') && cfg.ai.charge) {
        const charge = cfg.ai.charge;
        const chargeMult = mults.chargeDamageMult || 1;
        dps += dmg * (charge.damageMul ?? 2) * chargeMult
            * 1000 / Math.max(1000, charge.cooldown ?? 15000);
        const aoe = charge.impactAoe;
        if (aoe) {
            dps += dmg * (aoe.damageMul ?? 0) * chargeMult
                * Math.max(0, Number(aoe.expectedExtraTargets) || 0)
                * 1000 / Math.max(1000, charge.cooldown ?? 15000);
        }
    }
    if (kind === 'warrior' || kind === 'special_forces' || kind === 'trench_assault'
        || kind === 'jaguar_warrior') {
        const ability = getBuildingUpgradeAbility('sweep_aoe');
        const level = _levelOf('sweep_aoe', levelOverrides);
        const baseAoeMul = Math.max(0, Number(cfg.ai.baseAoeDamageMultiplier) || 0);
        const upgradeAoeBonus = ability && level > 0 ? getAbilityValue(ability, level) : 0;
        const expectedExtraTargets = Math.max(0,
            Number(cfg.ai.expectedExtraTargets) || WORLD122_SIM.sweepExpectedExtraTargets);
        if (baseAoeMul > 0) {
            dps += dps * baseAoeMul * (1 + upgradeAoeBonus) * expectedExtraTargets;
        } else if (ability && level > 0) {
            // 旧战士/美洲虎合同没有固有倍率，继续只计算已研究横扫的额外目标。
            dps += dps * upgradeAoeBonus * WORLD122_SIM.sweepExpectedExtraTargets;
        }
    }
    return dps;
}

function _normalizedRoster(structure) {
    const roster = {};
    if (structure?.unitRoster && typeof structure.unitRoster === 'object') {
        for (const [kind, rawCount] of Object.entries(structure.unitRoster)) {
            if (!UNIT_CFGS[kind]) continue;
            const count = Math.max(0, Math.floor(Number(rawCount) || 0));
            if (count > 0) roster[kind] = count;
        }
    }
    if (Object.keys(roster).length === 0 && structure?.unitType && structure.units > 0) {
        roster[structure.unitType] = Math.max(0, Math.floor(Number(structure.units) || 0));
    }
    return roster;
}

function _rosterCount(roster) {
    return Object.values(roster || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
}

function _rosterDps(roster, levelOverrides = null) {
    return Object.entries(roster || {}).reduce(
        (sum, [kind, count]) => sum
            + Math.max(0, Number(count) || 0) * _unitDps(kind, levelOverrides),
        0
    );
}

/** 后台无逐实体坐标：至少一名存活骆驼骑兵参战时，按当前惊吓等级折算怪群输出。 */
function _camelFrightReduction(target) {
    const hasCamel = (target.structures || []).some((structure) => (
        structure?.hp > 0
        && (structure.kind === 'barracks' || structure.kind === 'producer')
        && (_normalizedRoster(structure).camel_cavalry || 0) > 0
    ));
    if (!hasCamel) return 0;
    const mults = getUnitUpgradeMults('camel_cavalry', getUpgradeModulesForUnitKind('camel_cavalry'));
    return Math.max(0, Math.min(0.9, Number(mults.camelFrightReduction) || 0));
}

/** 快速募兵倍率（与 research-system.getRecruitIntervalMs 同口径，读结算开始时的等级） */
function _recruitMult(level = getAbilityLevel('research_recruit_speed')) {
    const bonus = getAbilityValue(getBuildingUpgradeAbility('research_recruit_speed'), level);
    return 1 / (1 + bonus);
}

function _abilityTimeline(initialLevel, completionTimes, totalMs, abilityId) {
    const ability = getBuildingUpgradeAbility(abilityId);
    const maxLevel = ability?.maxLevel ?? 10;
    const events = (completionTimes[abilityId] || [])
        .map((time) => Math.max(0, Math.min(totalMs, Number(time) || 0)))
        .sort((a, b) => a - b);
    const segments = [];
    let cursor = 0;
    let level = Math.max(0, initialLevel || 0);
    for (const at of events) {
        if (at > cursor) segments.push({ durationMs: at - cursor, level });
        level = Math.min(maxLevel, level + 1);
        cursor = at;
    }
    if (cursor < totalMs) segments.push({ durationMs: totalMs - cursor, level });
    return segments;
}

function _multiAbilityTimeline(initialLevels, completionTimes, totalMs, abilityIds) {
    const levels = { ...initialLevels };
    const events = [];
    for (const abilityId of abilityIds) {
        for (const rawTime of completionTimes[abilityId] || []) {
            events.push({
                abilityId,
                at: Math.max(0, Math.min(totalMs, Number(rawTime) || 0)),
            });
        }
    }
    events.sort((a, b) => a.at - b.at);
    const segments = [];
    let cursor = 0;
    let index = 0;
    while (index < events.length) {
        const at = events[index].at;
        if (at > cursor) segments.push({ durationMs: at - cursor, levels: { ...levels } });
        while (index < events.length && events[index].at === at) {
            const { abilityId } = events[index++];
            const ability = getBuildingUpgradeAbility(abilityId);
            levels[abilityId] = Math.min(
                ability?.maxLevel ?? 10,
                (levels[abilityId] || 0) + 1
            );
        }
        cursor = at;
    }
    if (cursor < totalMs) segments.push({ durationMs: totalMs - cursor, levels: { ...levels } });
    return segments;
}

/** 大段离线概率结算避免逐轮 Math.random；小样本保持精确伯努利，大样本用正态近似。 */
function _sampleBinomial(trials, probability) {
    const n = Math.max(0, Math.floor(Number(trials) || 0));
    const p = Math.max(0, Math.min(1, Number(probability) || 0));
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 256) {
        let successes = 0;
        for (let index = 0; index < n; index++) {
            if (Math.random() < p) successes++;
        }
        return successes;
    }
    const mean = n * p;
    const deviation = Math.sqrt(n * p * (1 - p));
    const u1 = Math.max(Number.EPSILON, Math.random());
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(n, Math.round(mean + deviation * normal)));
}

function _applyStructureHpLevel(target, fromLevel, toLevel) {
    if (!(toLevel > fromLevel)) return;
    const ability = getBuildingUpgradeAbility('research_structure_hp');
    const oldBonus = getAbilityValue(ability, fromLevel);
    const newBonus = getAbilityValue(ability, toLevel);
    const oldMul = Math.max(0.01, 1 + oldBonus);
    const newMul = Math.max(0.01, 1 + newBonus);
    const applyEntry = (entry) => {
        if (!entry || !(entry.hp > 0) || !(entry.maxHp > 0)) return;
        const baseMax = entry.maxHp / oldMul;
        const nextMax = Math.max(1, Math.round(baseMax * newMul));
        const delta = nextMax - entry.maxHp;
        entry.maxHp = nextMax;
        entry.hp = Math.max(0, Math.min(nextMax, entry.hp + delta));
    };
    for (const structure of target.structures || []) {
        if (structure.kind === 'block' || structure.kind === 'gate4') {
            applyEntry(structure);
            for (const pillar of structure.pillars || []) applyEntry(pillar);
        }
    }
}

/** 波次 N 的 HP 池与怪物 DPS（快照 config 口径） */
function _wavePool(wave, cfg) {
    const budget = (cfg.waveBudgetBase ?? 26) * Math.pow(cfg.waveBudgetGrowth ?? 1.15, wave - 1);
    const hp = budget * WORLD122_SIM.tpHpAvg * (1 + (cfg.hpPerWave ?? 0.16) * (wave - 1));
    const count = budget / WORLD122_SIM.tpCountAvg;
    const dps = count * WORLD122_SIM.monsterDpsPer * (1 + (cfg.atkPerWave ?? 0.08) * (wave - 1));
    return { hp, dps };
}

// 本栋升级在时间边界提交；字段/项目保持原有快照协议和配置真源。
const LOCAL_MODULE_UPGRADES = [
    ['warehouse', 'warehouse_logistics'],
    ['candle', 'candle_sanctuary'],
    ['workshop', 'economic_workshop'],
    ['research', 'research_standard'],
    ['advancedResearch', 'high_energy_laboratory_economy'],
    ['windmill', 'wheat_windmill_economy'],
    ['mint', 'royal_mint_economy'],
    ['armory', 'armory_economy'],
    ['hospital', 'field_hospital_economy'],
    ['bank', 'bank_economy'],
    ['grandMall', 'grand_mall_economy'],
    ['bakery', 'bakery_economy'],
    ['desertCookhouse', 'desert_cookhouse_economy'],
    ['frostSmokehouse', 'frost_smokehouse_economy'],
    ['chainRestaurant', 'chain_restaurant_economy'],
    ['cheeseFarm', 'cheese_farm_economy'],
    ['steam', 'steam_power_plant_economy'],
    ['oilPower', 'oil_power_plant_economy'],
    ['cannery', 'cannery_economy'],
    ['trading', 'trading_company_economy'],
    ['tavern', 'tavern_economy'],
    ['resonator', 'planar_resonator_economy'],
    ['windPower', 'wind_power_plant_economy'],
    ['solarPower', 'solar_power_plant_economy'],
    ['computingCenter', 'computing_center_economy'],
    ['weather', 'weather_forecast_analysis'],
];

function _snapshotLocalUpgradeJobs(target) {
    const jobs = [];
    const add = (structure, field, modulesField = null, modules = null) => {
        const upgrade = structure[field];
        if (!upgrade) return;
        jobs.push({
            structure, field, upgrade, modulesField,
            module: modules?.[upgrade.moduleId],
            atMs: Math.max(0, Number(upgrade.remainMs) || 0),
        });
    };
    for (const structure of target.structures || []) {
        if (!(Number(structure.hp ?? 1) > 0)) continue;
        if (structure.kind === 'hut') {
            add(structure, 'upgrade', 'modules', MINER_CAMP_CONFIG.modules);
            continue;
        }
        if (structure.kind !== 'producer') continue;
        const cfg = producerBuildingsJson[structure.cfgKey] || {};
        if (cfg.economyType) add(structure, 'economyUpgrade');
        for (const [prefix, projectId] of LOCAL_MODULE_UPGRADES) {
            const applies = prefix === 'warehouse' ? getProducerStorageCap(structure) > 0
                : prefix === 'candle' ? cfg.panelMode === 'candle' : !!cfg.economyType;
            if (!applies) continue;
            add(structure, `${prefix}Upgrade`, `${prefix}Modules`,
                buildingUpgradesJson[projectId]?.modules);
        }
    }
    return jobs;
}

function _advanceLocalUpgradeJobs(jobs, atMs) {
    for (const job of jobs) {
        const { structure, field, upgrade, modulesField, module } = job;
        // 被毁/已完成的工程不复活，也不覆盖后续被替换的队列。
        if (!(Number(structure.hp ?? 1) > 0) || structure[field] !== upgrade) continue;
        upgrade.remainMs = Math.max(0, job.atMs - atMs);
        if (upgrade.remainMs > 0) continue;
        if (field === 'economyUpgrade') {
            structure.economyLevel = Math.max(1, Math.floor(Number(upgrade.targetLevel) || 1));
        } else if (module) {
            const levels = structure[modulesField] ||= {};
            levels[upgrade.moduleId] = Math.min(
                Number(module.maxLevel) || 0,
                Math.max(0, Math.floor(Number(levels[upgrade.moduleId]) || 0)) + 1
            );
        }
        structure[field] = null;
        if (field === 'warehouseUpgrade' || (field === 'economyUpgrade'
            && producerBuildingsJson[structure.cfgKey]?.economyType === 'warehouse')) {
            structure.storageCapacity = getProducerStorageCap(structure);
        }
    }
}

function _createSettlementReport(elapsedMs) {
    return {
        elapsedMs, wavesCleared: [], victory: false, defeated: false,
        energyMined: 0, deepDrillEnergyMined: 0, passiveEnergy: 0, titheEnergy: 0, resonatorEnergyProduced: 0,
        oilEnergyProduced: 0, windEnergyProduced: 0, solarEnergyProduced: 0,
        steamEnergyProduced: 0,
        goldProduced: 0, foodProduced: 0, unitsProduced: 0,
        goldSpentOnOil: 0, energySpentOnCannery: 0, foodSpentOnTrading: 0,
        energySpentOnMiners: 0, energySpentOnMinting: 0, energySpentOnGrandMall: 0,
        energySpentOnStockExchange: 0, energySpentOnComputing: 0,
        foodSpentOnMinting: 0, foodSpentOnSteam: 0, foodSpentOnTavern: 0,
        foodSpentOnUnits: 0,
        abilitiesCompleted: [], modulesCompleted: [], structuresLost: 0, baseDamage: 0,
        explorerRewards: [], plantTributesProduced: 0, enhancementStonesProduced: 0,
    };
}

/**
 * 后台结算主入口。
 * @param {object} snap 快照（commit 时原地修改）
 * @param {number} elapsedMs 离场时长
 * @param {{commit?:boolean, sceneId?:string, runtimeSceneId?:string, grant?:(reward:{gold?:number,energy?:number,tributeItemIds?:string[]})=>void}} [opts]
 * @returns 结算报告（世界切换面板预览/回场播报共用）
 */
export function settleWorld122(snap, elapsedMs, opts = {}) {
    const report = _createSettlementReport(elapsedMs);
    if (!snap || !snap.wave || !(elapsedMs > 0)) return report;
    const commit = opts.commit !== false;
    const target = commit ? snap : JSON.parse(JSON.stringify(snap));
    for (const structure of target.structures || []) skipBuildingUpgradeWait(structure);
    const jobs = _snapshotLocalUpgradeJobs(target);
    const boundaries = [...new Set([
        ...jobs.map((job) => job.atMs).filter((atMs) => atMs > 0 && atMs < elapsedMs),
        elapsedMs,
    ])].sort((a, b) => a - b);
    // 预览只推进本次模拟的等级；多段结算不能写全局，也不能丢掉已完成的研究。
    const simulation = { abilityLevels: {}, passiveEnergyRemainder: 0 };
    _advanceLocalUpgradeJobs(jobs, 0);
    let cursor = 0;
    for (const boundary of boundaries) {
        const segmentOpts = Number.isFinite(opts.gameTimeMs)
            ? { ...opts, gameTimeMs: opts.gameTimeMs - elapsedMs + boundary } : opts;
        const segment = _settleWorld122Interval(target, boundary - cursor, segmentOpts, simulation);
        for (const [key, value] of Object.entries(segment)) {
            if (key === 'elapsedMs') continue;
            if (Array.isArray(value)) report[key].push(...value);
            else if (typeof value === 'boolean') report[key] ||= value;
            else if (typeof value === 'number') report[key] += value;
        }
        // 先按旧人口、旧岗位效果和旧仓容结算到期时间，再让新等级作用于下一段。
        _advanceLocalUpgradeJobs(jobs, boundary);
        cursor = boundary;
        if (report.defeated) break;
    }
    if (commit) {
        target.capturedAt = Date.now();
        if (Number.isFinite(opts.gameTimeMs)) target.capturedGameTimeMs = opts.gameTimeMs;
    }
    return report;
}

function _settleWorld122Interval(target, elapsedMs, opts, simulation) {
    const commit = opts.commit !== false;
    const runtimeSceneId = opts.runtimeSceneId || opts.sceneId || 'scene8';
    const report = _createSettlementReport(elapsedMs);
    let t = elapsedMs / 1000; // 秒
    const cfg = target.config || {};
    const initialPassiveLevel = _levelOf('research_passive_energy', simulation.abilityLevels);
    const initialRecruitLevel = _levelOf('research_recruit_speed', simulation.abilityLevels);
    const initialStructureHpLevel = _levelOf('research_structure_hp', simulation.abilityLevels);
    const initialCombatLevels = {
        sweep_aoe: _levelOf('sweep_aoe', simulation.abilityLevels),
        mark_arrow: _levelOf('mark_arrow', simulation.abilityLevels),
        inspire_magic: _levelOf('inspire_magic', simulation.abilityLevels),
        research_structure_hp: initialStructureHpLevel,
    };
    const completionTimes = {};
    const warehouses = (target.structures || []).filter((s) => s.kind === 'producer'
        && getProducerStorageCap(s) > 0);
    const roadContext = _snapshotRoadContext(target);
    // v1 快照把粮食挂在位面全局；后台结算开始时先迁入真实仓库，放不下的留作回场迁移。
    const savedEconomy = target.populationEconomy && typeof target.populationEconomy === 'object'
        ? target.populationEconomy
        : {};
    let legacyFoodPending = Math.max(0, Number(savedEconomy.legacyFoodPending) || 0);
    if ((Number(savedEconomy.storageVersion) || 1) < 2) {
        legacyFoodPending += Math.max(0, Number(savedEconomy.foodStored) || 0);
    }
    if (legacyFoodPending > 0) {
        legacyFoodPending -= _depositFoodToWarehouses(warehouses, legacyFoodPending);
    }
    target.populationEconomy = {
        storageVersion: 2,
        foodStored: _foodInWarehouses(warehouses),
        legacyFoodPending,
    };

    // ---- 人口经济：房屋容量、数值岗位、风车粮食、谐振能源、银行金币、市场压力回归。
    // 玩家不在该位面时不物化平民，也不会产生逐单位寻路/动画开销。 ----
    const economyStructures = (target.structures || []).filter((structure) =>
        structure.kind === 'producer'
        && Number(structure.hp ?? 1) > 0
        && producerBuildingsJson[structure.cfgKey]?.economyType
    );
    const houseLevels = populationEconomyConfig.house?.levels || [];
    const populationCapacity = economyStructures.reduce((sum, structure) => {
        if (producerBuildingsJson[structure.cfgKey]?.economyType !== 'housing') return sum;
        const level = Math.max(1, Math.floor(Number(structure.economyLevel) || 1));
        const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
        return sum + (Number(levelCfg?.populationCapacity) || 0);
    }, 0);
    let assignedPopulation = economyStructures.reduce((sum, structure) => {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        const workerSlots = _economyWorkerSlots(structure, economyType);
        const assigned = Math.max(
            0,
            Math.min(workerSlots, Math.floor(Number(structure.assignedWorkers) || 0))
        );
        structure.assignedWorkers = assigned;
        return sum + assigned;
    }, 0);
    for (const camp of target.structures || []) {
        if (camp.kind !== 'hut' || !(camp.hp > 0)) continue;
        const slots = getMinerEconomyStats(camp.modules || {}).count;
        const migrated = camp.assignedWorkers == null ? camp.miners : camp.assignedWorkers;
        camp.assignedWorkers = Math.max(0, Math.min(slots, Math.floor(Number(migrated) || 0)));
        assignedPopulation += camp.assignedWorkers;
    }
    const laborEfficiency = assignedPopulation > 0
        ? Math.max(0, Math.min(1, populationCapacity / assignedPopulation))
        : 1;
    let tavernWeightedMultiplier = 1;
    for (const tavern of economyStructures) {
        if (producerBuildingsJson[tavern.cfgKey]?.economyType !== 'tavern') continue;
        const result = _simulateTavernService(
            tavern,
            elapsedMs,
            laborEfficiency,
            roadContext,
            warehouses
        );
        report.foodSpentOnTavern += result.foodSpent;
        const weightedBonus = _tavernConfiguredBonus(tavern)
            * Math.max(0, Math.min(1, result.activeMs / elapsedMs));
        tavernWeightedMultiplier = Math.max(tavernWeightedMultiplier, 1 + weightedBonus);
    }
    target.tavernLastWeightedMultiplier = tavernWeightedMultiplier;
    const foodWeatherEffect = getFoodProductionWeatherEffect(
        opts.sceneId || 'scene8', opts.gameTimeMs
    );
    const foodWeatherMultiplier = foodWeatherEffect.multiplier;
    for (const structure of economyStructures) {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        const assigned = Math.max(0, Number(structure.assignedWorkers) || 0);
        if (economyType === 'royal_mint') {
            const mintCfg = populationEconomyConfig.royal_mint || {};
            const staffedCount = Math.min(
                _economyWorkerSlots(structure, economyType),
                Math.max(0, Math.floor(assigned))
            );
            const goldPerWorker = Math.max(0,
                _economyModuleValue(structure, economyType, 'mint_precision'));
            const energyPerWorker = Math.max(1,
                _economyModuleValue(structure, economyType, 'mint_energy_efficiency'));
            const settlementSpeed = Math.max(0.01,
                1 + _economyModuleValue(structure, economyType, 'mint_press_speed'));
            const baseIntervalMs = Math.max(100,
                Number(mintCfg.settlementIntervalMs) || 10000);
            const settlementIntervalMs = Math.max(100,
                Math.round(baseIntervalMs / settlementSpeed));
            const workshopMultiplier = _workshopEfficiencyMultiplier(
                structure,
                economyStructures
            );
            const goldPerSettlement = staffedCount * goldPerWorker
                * laborEfficiency * workshopMultiplier * tavernWeightedMultiplier;
            const energyPerSettlement = goldPerSettlement > 0
                ? Math.max(1, Math.ceil(staffedCount * energyPerWorker * laborEfficiency))
                : 0;
            const foodPerWorker = Math.max(0,
                Number(mintCfg.foodPerWorkerPerSettlement) || 60);
            const foodPerSettlement = goldPerSettlement > 0
                ? staffedCount * foodPerWorker
                : 0;
            const tickTotal = goldPerSettlement > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const readySettlements = Math.floor(tickTotal / settlementIntervalMs);
            const availableEnergy = (warehouses || []).reduce(
                (sum, warehouse) => sum + Math.max(0,
                    Number(warehouse.storedEnergy) || 0),
                0
            );
            const availableFood = (warehouses || []).reduce(
                (sum, warehouse) => sum + Math.max(0,
                    Number(warehouse.storedFood) || 0),
                0
            );
            const energyAffordableSettlements = energyPerSettlement > 0
                ? Math.floor(availableEnergy / energyPerSettlement)
                : 0;
            const foodAffordableSettlements = foodPerSettlement > 0
                ? Math.floor(availableFood / foodPerSettlement)
                : 0;
            const settlements = Math.min(
                readySettlements,
                energyAffordableSettlements,
                foodAffordableSettlements
            );
            const energyCost = settlements * energyPerSettlement;
            const foodCost = settlements * foodPerSettlement;
            if (energyCost > 0 && _deductFromWarehouses(warehouses, energyCost)) {
                report.energySpentOnMinting += energyCost;
            }
            if (foodCost > 0 && _deductFoodFromWarehouses(warehouses, foodCost)) {
                report.foodSpentOnMinting += foodCost;
            }
            structure.economyTickMs = settlements < readySettlements
                ? Math.min(tickTotal - settlements * settlementIntervalMs, settlementIntervalMs)
                : tickTotal - settlements * settlementIntervalMs;
            const total = Math.max(0, Number(structure.mintGoldRemainder) || 0)
                + goldPerSettlement * settlements * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.mintGoldRemainder = total - produced;
            report.goldProduced += produced;
            if (commit && produced > 0 && typeof opts.grant === 'function') {
                const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                if (overflow > 0) {
                    structure.pendingGoldDrop = Math.max(0,
                        Number(structure.pendingGoldDrop) || 0) + overflow;
                }
            }
        } else if (economyType === 'grand_mall') {
            const mallCfg = populationEconomyConfig.grand_mall || {};
            const serviceRange = Math.max(0,
                _grandMallModuleValue(structure, 'grand_mall_business_radius'));
            const servicePopulation = economyStructures.reduce((sum, house) => {
                if (producerBuildingsJson[house.cfgKey]?.economyType !== 'housing') return sum;
                if (Math.hypot((house.x || 0) - (structure.x || 0),
                    (house.y || 0) - (structure.y || 0)) > serviceRange) return sum;
                const level = Math.max(1, Math.floor(Number(house.economyLevel) || 1));
                const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
                return sum + Math.max(0, Number(levelCfg?.populationCapacity) || 0);
            }, 0);
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(staffCapacity, Math.max(0, Math.floor(assigned)));
            const workerEfficiency = Math.max(0,
                Number(mallCfg.workerEfficiencyPerEmployee) || 0.05);
            const staffEfficiency = Math.max(0, Math.min(1,
                staffedCount * workerEfficiency));
            const goldRate = Math.max(0,
                _grandMallModuleValue(structure, 'grand_mall_showcase'));
            const energyRate = Math.max(0,
                _grandMallModuleValue(structure, 'grand_mall_energy_atrium'));
            const settlementIntervalMs = Math.max(100,
                Number(mallCfg.settlementIntervalMs) || 1000);
            const goldPerSettlement = servicePopulation * goldRate * staffEfficiency
                * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures)
                * tavernWeightedMultiplier
                * settlementIntervalMs / 1000;
            const energyPerSettlement = servicePopulation * energyRate * staffEfficiency
                * laborEfficiency * settlementIntervalMs / 1000;
            const tickTotal = goldPerSettlement > 0 && energyPerSettlement > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const readySettlements = Math.floor(tickTotal / settlementIntervalMs);
            const availableEnergy = (warehouses || []).reduce(
                (sum, warehouse) => sum + Math.max(0, Number(warehouse.storedEnergy) || 0),
                0
            );
            const energyRemainder = Math.max(0,
                Number(structure.grandMallEnergyRemainder) || 0);
            const affordableSettlements = energyPerSettlement > 0
                ? Math.max(0, Math.ceil(
                    (availableEnergy + 1 - energyRemainder) / energyPerSettlement - 1e-12
                ) - 1)
                : 0;
            const settlements = Math.min(readySettlements, affordableSettlements);
            const energyTotal = energyRemainder + energyPerSettlement * settlements;
            const energyCost = Math.floor(energyTotal + 1e-9);
            if (energyCost > 0 && _deductFromWarehouses(warehouses, energyCost)) {
                report.energySpentOnGrandMall += energyCost;
            }
            if (settlements > 0) {
                structure.grandMallEnergyRemainder = energyTotal - energyCost;
            }
            structure.economyTickMs = settlements < readySettlements
                ? Math.min(tickTotal - settlements * settlementIntervalMs, settlementIntervalMs)
                : tickTotal - settlements * settlementIntervalMs;
            const total = Math.max(0, Number(structure.grandMallGoldRemainder) || 0)
                + goldPerSettlement * settlements * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.grandMallGoldRemainder = total - produced;
            report.goldProduced += produced;
            if (commit && produced > 0 && typeof opts.grant === 'function') {
                const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                if (overflow > 0) {
                    structure.pendingGoldDrop = Math.max(0,
                        Number(structure.pendingGoldDrop) || 0) + overflow;
                }
            }
        } else if (economyType === 'stock_exchange' || economyType === 'computing_center') {
            const isComputing = economyType === 'computing_center';
            const exchangeCfg = populationEconomyConfig[economyType] || {};
            const settlementIntervalMs = Math.max(100,
                Number(exchangeCfg.settlementIntervalMs) || 1000);
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(staffCapacity,
                Math.max(0, Math.floor(assigned)));
            const workerEfficiency = Math.max(0,
                Number(exchangeCfg.workerEfficiencyPerEmployee) || 0);
            const operatingFactor = Math.max(0, Math.min(1,
                staffedCount * workerEfficiency)) * laborEfficiency;
            const configuredBase = isComputing
                ? _economyModuleValue(structure, economyType, 'computing_cluster_output')
                : Math.max(0, Number(exchangeCfg.baseGoldPerSecond) || 0);
            const populationRate = isComputing
                ? _economyModuleValue(structure, economyType, 'computing_population_model')
                : Math.max(0, Number(exchangeCfg.goldPerPopulationPerSecond) || 0);
            const baseAndPopulation = (configuredBase
                + populationCapacity * populationRate) * operatingFactor;
            const goldBalanceRate = Math.max(0,
                Number(exchangeCfg.goldBalanceRatePerSecond) || 0) * operatingFactor;
            const configuredEnergyPerSecond = isComputing
                ? _economyModuleValue(structure, economyType, 'computing_power_efficiency')
                : Math.max(0, Number(exchangeCfg.energyPerSecond) || 0);
            const energyPerSettlement = configuredEnergyPerSecond * operatingFactor
                * settlementIntervalMs / 1000;
            const tickTotal = baseAndPopulation > 0 && energyPerSettlement > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const readySettlements = Math.floor(tickTotal / settlementIntervalMs);
            const availableEnergy = (warehouses || []).reduce(
                (sum, warehouse) => sum + Math.max(0,
                    Number(warehouse.storedEnergy) || 0),
                0
            );
            let energyCost = 0;
            let settlements = 0;
            const energyRemainderField = isComputing
                ? 'computingCenterEnergyRemainder'
                : 'stockExchangeEnergyRemainder';
            const goldRemainderField = isComputing
                ? 'computingCenterGoldRemainder'
                : 'stockExchangeGoldRemainder';
            let energyRemainder = Math.max(0,
                Number(structure[energyRemainderField]) || 0);
            for (let i = 0; i < readySettlements; i += 1) {
                const energyTotal = energyRemainder + energyPerSettlement;
                const batchCost = Math.floor(energyTotal + 1e-9);
                if (energyCost + batchCost > availableEnergy) break;
                energyCost += batchCost;
                energyRemainder = energyTotal - batchCost;
                settlements += 1;
            }
            if (energyCost > 0 && _deductFromWarehouses(warehouses, energyCost)) {
                if (isComputing) report.energySpentOnComputing += energyCost;
                else report.energySpentOnStockExchange += energyCost;
            }
            if (settlements > 0) {
                structure[energyRemainderField] = energyRemainder;
            }
            structure.economyTickMs = settlements < readySettlements
                ? Math.min(tickTotal - settlements * settlementIntervalMs,
                    settlementIntervalMs)
                : tickTotal - settlements * settlementIntervalMs;
            let currentGold = Math.max(0, Number(
                typeof opts.getPlayerTotalGold === 'function'
                    ? opts.getPlayerTotalGold()
                    : opts.playerTotalGold
            ) || 0);
            let goldRemainder = Math.max(0,
                Number(structure[goldRemainderField]) || 0);
            let produced = 0;
            for (let i = 0; i < settlements; i += 1) {
                const total = goldRemainder + (baseAndPopulation
                    + currentGold * goldBalanceRate)
                    * settlementIntervalMs / 1000;
                const batchGold = Math.floor(total);
                goldRemainder = total - batchGold;
                produced += batchGold;
                currentGold += batchGold;
            }
            structure[goldRemainderField] = goldRemainder;
            report.goldProduced += produced;
            if (commit && produced > 0 && typeof opts.grant === 'function') {
                const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                if (overflow > 0) {
                    structure.pendingGoldDrop = Math.max(0,
                        Number(structure.pendingGoldDrop) || 0) + overflow;
                }
            }
        } else if (economyType === 'bank') {
            const serviceRange = _bankServiceRange(structure);
            const effectiveServicePopulation = economyStructures.reduce((sum, house) => {
                if (producerBuildingsJson[house.cfgKey]?.economyType !== 'housing') return sum;
                if (Math.hypot((house.x || 0) - (structure.x || 0), (house.y || 0) - (structure.y || 0)) > serviceRange) return sum;
                const level = Math.max(1, Math.floor(Number(house.economyLevel) || 1));
                const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
                const population = Math.max(0, Number(levelCfg?.populationCapacity) || 0);
                const bankCount = _bankCoverageCountAt(house, economyStructures);
                return sum + population * _bankOverlapMultiplier(bankCount);
            }, 0);
            const settlementSpeed = Math.max(0.01, 1 + _bankModuleValue(structure, 'bank_finance'));
            const baseIntervalMs = Math.max(100, Number(populationEconomyConfig.bank?.settlementIntervalMs) || 10000);
            const settlementIntervalMs = Math.max(100, Math.round(baseIntervalMs / settlementSpeed));
            const goldPerPopulation = Math.max(0, _bankModuleValue(structure, 'bank_mint'));
            const goldPerSettlement = effectiveServicePopulation * goldPerPopulation * assigned * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures)
                * tavernWeightedMultiplier;
            const tickTotal = goldPerSettlement > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const settlements = Math.floor(tickTotal / settlementIntervalMs);
            structure.economyTickMs = tickTotal - settlements * settlementIntervalMs;
            const total = Math.max(0, Number(structure.bankGoldRemainder) || 0)
                + goldPerSettlement * settlements * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.bankGoldRemainder = total - produced;
            report.goldProduced += produced;
            if (commit && produced > 0 && typeof opts.grant === 'function') {
                const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                if (overflow > 0) {
                    structure.pendingGoldDrop = Math.max(0, Number(structure.pendingGoldDrop) || 0) + overflow;
                }
            }
        } else if (economyType === 'windmill') {
            const windmillCfg = populationEconomyConfig.windmill || {};
            const configuredPlaneMultiplier = Number(
                windmillCfg.planeOutputMultipliers?.[runtimeSceneId]
            );
            const planeMultiplier = Number.isFinite(configuredPlaneMultiplier)
                ? Math.max(0, configuredPlaneMultiplier) : 1;
            const foodRate = Math.max(0,
                _economyModuleValue(structure, economyType, 'windmill_seed_selection')
                    || Number(windmillCfg.foodPerWorkerPerSecond) || 0);
            const driveMultiplier = Math.max(0,
                _economyModuleValue(structure, economyType, 'windmill_sail_drive') || 1);
            const fieldMultiplier = Math.max(0,
                _economyModuleValue(structure, economyType, 'windmill_crop_rotation') || 1);
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(staffCapacity, Math.max(0, Math.floor(assigned)));
            const total = Math.max(0, Number(structure.workProductionRemainder) || 0)
                + staffedCount * foodRate * driveMultiplier * fieldMultiplier * laborEfficiency
                    * _workshopEfficiencyMultiplier(structure, economyStructures)
                    * tavernWeightedMultiplier * foodWeatherMultiplier * planeMultiplier * t
                    * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.workProductionRemainder = total - produced;
            const stored = _depositFoodToWarehouses(warehouses, produced);
            structure.workProductionRemainder += Math.max(0, produced - stored);
            report.foodProduced += stored;
        } else if (INDUSTRIAL_SIM_DEFINITIONS[economyType]) {
            const definition = INDUSTRIAL_SIM_DEFINITIONS[economyType];
            const industrialCfg = populationEconomyConfig[economyType] || {};
            const pendingWhole = Math.floor(Math.max(0,
                Number(structure.workProductionRemainder) || 0));
            if (pendingWhole > 0 && definition.outputResource !== 'gold') {
                const storedPending = definition.outputResource === 'energy'
                    ? _depositToWarehouses(warehouses, pendingWhole)
                    : _depositFoodToWarehouses(warehouses, pendingWhole);
                structure.workProductionRemainder = Math.max(0,
                    Number(structure.workProductionRemainder) || 0) - storedPending;
                if (definition.outputResource === 'energy') {
                    report.oilEnergyProduced += storedPending;
                } else {
                    report.foodProduced += storedPending;
                }
            }
            const configuredCycleMs = Math.max(100,
                _economyModuleValue(structure, economyType, definition.cycleModule)
                    || 10000);
            const outputPerCycle = Math.max(0,
                _economyModuleValue(structure, economyType, definition.outputModule));
            const inputPerCycle = Math.max(0, Math.floor(
                _economyModuleValue(structure, economyType, definition.inputModule)));
            const staffedCount = Math.min(
                _economyWorkerSlots(structure, economyType),
                Math.max(0, Math.floor(assigned))
            );
            const workerShare = Math.max(0,
                Number(industrialCfg.workerEfficiencyShare) || 0.25);
            const staffFactor = Math.max(0, Math.min(1, staffedCount * workerShare));
            // 与前台一致：产能增益缩短周期，投入结算频率同步提高，单轮转化率不变。
            const throughputMultiplier = Math.max(0.01,
                _workshopEfficiencyMultiplier(structure, economyStructures)
                    * tavernWeightedMultiplier * getProductionResourceMul());
            const cycleMs = Math.max(100, configuredCycleMs / throughputMultiplier);
            const effectiveOutputPerCycle = outputPerCycle * staffFactor * laborEfficiency;
            const tickTotal = effectiveOutputPerCycle > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const readyCycles = Math.floor(tickTotal / cycleMs);
            let availableInput = definition.inputResource === 'gold'
                ? Math.max(0, Number(opts.getPlayerTotalGold?.()) || 0)
                : definition.inputResource === 'energy'
                    ? _energyInWarehouses(warehouses)
                    : _foodInWarehouses(warehouses);
            if (!commit && definition.inputResource === 'gold') {
                availableInput = Math.max(0, availableInput
                    - Math.max(0, Number(simulation.previewOilGoldSpent) || 0));
            }
            const affordableCycles = inputPerCycle > 0
                ? Math.floor(availableInput / inputPerCycle) : readyCycles;
            let cycles = Math.min(readyCycles, affordableCycles);
            if (definition.outputResource !== 'gold') {
                const storable = definition.outputResource === 'energy'
                    ? _energyStorableInWarehouses(warehouses)
                    : _foodStorableInWarehouses(warehouses);
                const storageCycles = storable > 0 && effectiveOutputPerCycle > 0
                    ? Math.max(1, Math.ceil(storable / effectiveOutputPerCycle)) : 0;
                cycles = Math.min(cycles, storageCycles);
            }
            const inputCost = cycles * inputPerCycle;
            if (cycles > 0 && inputCost > 0) {
                let paid = false;
                if (definition.inputResource === 'gold') {
                    paid = commit
                        ? !!opts.spendPlayerGold?.(inputCost)
                        : true;
                    if (!commit && paid) {
                        simulation.previewOilGoldSpent = Math.max(0,
                            Number(simulation.previewOilGoldSpent) || 0) + inputCost;
                    }
                } else if (definition.inputResource === 'energy') {
                    paid = _deductFromWarehouses(warehouses, inputCost);
                } else {
                    paid = _deductFoodFromWarehouses(warehouses, inputCost);
                }
                if (!paid) cycles = 0;
            }
            structure.economyTickMs = cycles > 0
                ? tickTotal - cycles * cycleMs
                : Math.min(tickTotal, cycleMs);
            if (cycles < readyCycles) {
                structure.economyTickMs = Math.min(structure.economyTickMs, cycleMs);
            }
            if (cycles <= 0) continue;
            const paidInput = cycles * inputPerCycle;
            if (definition.inputResource === 'gold') report.goldSpentOnOil += paidInput;
            else if (definition.inputResource === 'energy') report.energySpentOnCannery += paidInput;
            else report.foodSpentOnTrading += paidInput;
            const total = Math.max(0, Number(structure.workProductionRemainder) || 0)
                + effectiveOutputPerCycle * cycles;
            const produced = Math.floor(total);
            structure.workProductionRemainder = total - produced;
            if (definition.outputResource === 'energy') {
                const stored = _depositToWarehouses(warehouses, produced);
                structure.workProductionRemainder += Math.max(0, produced - stored);
                report.oilEnergyProduced += stored;
            } else if (definition.outputResource === 'food') {
                const stored = _depositFoodToWarehouses(warehouses, produced);
                structure.workProductionRemainder += Math.max(0, produced - stored);
                report.foodProduced += stored;
            } else {
                report.goldProduced += produced;
                if (commit && produced > 0 && typeof opts.grant === 'function') {
                    const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                    const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                    if (overflow > 0) {
                        structure.pendingGoldDrop = Math.max(0,
                            Number(structure.pendingGoldDrop) || 0) + overflow;
                    }
                }
            }
        } else if (economyType === 'wind_power_plant'
            || economyType === 'solar_power_plant') {
            const isSolar = economyType === 'solar_power_plant';
            const windCfg = populationEconomyConfig[economyType] || {};
            const cycleMs = Math.max(100,
                _economyModuleValue(structure, economyType,
                    isSolar ? 'solar_tracking_cycle' : 'wind_blade_pitch')
                    || (isSolar ? 4000 : 5000));
            const energyPerCycle = Math.max(0,
                _economyModuleValue(structure, economyType,
                    isSolar ? 'solar_array_output' : 'wind_generator_output'));
            const conversionRate = Math.max(0, Math.min(1,
                _economyModuleValue(structure, economyType,
                    isSolar ? 'solar_storage_efficiency' : 'wind_rectifier_efficiency')));
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(
                staffCapacity,
                Math.max(0, Math.floor(assigned))
            );
            const workerShare = Math.max(0,
                Number(windCfg.workerEfficiencyShare) || (isSolar ? 0.2 : 0.25));
            const staffFactor = Math.max(0, Math.min(1, staffedCount * workerShare));
            const energyPerEffectiveCycle = energyPerCycle * conversionRate * staffFactor
                * laborEfficiency * _workshopEfficiencyMultiplier(structure, economyStructures)
                * tavernWeightedMultiplier;
            const tickTotal = energyPerEffectiveCycle > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const cycles = Math.floor(tickTotal / cycleMs);
            structure.economyTickMs = tickTotal - cycles * cycleMs;
            const total = Math.max(0, Number(structure.workProductionRemainder) || 0)
                + energyPerEffectiveCycle * cycles * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.workProductionRemainder = total - produced;
            const stored = _depositToWarehouses(warehouses, produced);
            structure.workProductionRemainder += Math.max(0, produced - stored);
            if (isSolar) report.solarEnergyProduced += stored;
            else report.windEnergyProduced += stored;
        } else if (economyType === 'planar_resonator') {
            const resonatorCfg = populationEconomyConfig.planar_resonator || {};
            const cycleMs = Math.max(100,
                _economyModuleValue(structure, economyType, 'resonator_frequency') || 10000);
            const energyPerCycle = Math.max(0,
                _economyModuleValue(structure, economyType, 'resonator_crystal_output'));
            const conversionRate = Math.max(0, Math.min(1,
                _economyModuleValue(structure, economyType, 'resonator_conversion')));
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(
                staffCapacity,
                Math.max(0, Math.floor(assigned))
            );
            const workerShare = Math.max(0,
                Number(resonatorCfg.workerEfficiencyShare) || 0.2);
            const staffFactor = Math.max(0, Math.min(1, staffedCount * workerShare));
            const energyPerEffectiveCycle = energyPerCycle * conversionRate * staffFactor
                * laborEfficiency * _workshopEfficiencyMultiplier(structure, economyStructures)
                * tavernWeightedMultiplier;
            const tickTotal = energyPerEffectiveCycle > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const cycles = Math.floor(tickTotal / cycleMs);
            structure.economyTickMs = tickTotal - cycles * cycleMs;
            const total = Math.max(0, Number(structure.workProductionRemainder) || 0)
                + energyPerEffectiveCycle * cycles * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.workProductionRemainder = total - produced;
            const stored = _depositToWarehouses(warehouses, produced);
            structure.workProductionRemainder += Math.max(0, produced - stored);
            report.resonatorEnergyProduced += stored;
        } else if (economyType === 'deep_drill') {
            const drillCfg = populationEconomyConfig.deep_drill || {};
            const range = Math.max(0, Number(drillCfg.miningRange) || 600);
            const perWorker = Math.max(0,
                Number(drillCfg.energyPerWorkerPerSecond) || 12);
            const staffCapacity = _economyWorkerSlots(structure, economyType);
            const staffedCount = Math.min(
                staffCapacity,
                Math.max(0, Math.floor(assigned))
            );
            const rawRate = staffedCount * perWorker * laborEfficiency;
            const outputMultiplier = Math.max(0,
                _workshopEfficiencyMultiplier(structure, economyStructures)
                * tavernWeightedMultiplier
                * getProductionResourceMul()
            );
            const exactRaw = Math.max(0, Number(structure.deepDrillRemainder) || 0)
                + rawRate * t;
            const rawBudget = Math.floor(exactRaw);
            structure.deepDrillRemainder = exactRaw - rawBudget;
            const warehouseFree = _energyStorableInWarehouses(warehouses);
            const capacityRaw = outputMultiplier > 0
                ? Math.floor((warehouseFree + 0.999999) / outputMultiplier)
                : 0;
            const usableRawBudget = Math.min(rawBudget, capacityRaw);
            const surfaceMinedRaw = _mineFromNodesInRange(
                target.nodes || [],
                structure.x,
                structure.y,
                range,
                usableRawBudget
            );
            const minedRaw = surfaceMinedRaw + (TechnologySystem.isUnlocked(
                'mechanic', 'deep_vein_mining'
            ) ? usableRawBudget - surfaceMinedRaw : 0);
            const output = Math.min(warehouseFree,
                Math.floor(minedRaw * outputMultiplier));
            const stored = output > 0 ? _depositToWarehouses(warehouses, output) : 0;
            structure.deepDrillMinedTotal = Math.max(0,
                Number(structure.deepDrillMinedTotal) || 0) + stored;
            report.deepDrillEnergyMined += stored;
        } else if (economyType === 'bakery' || economyType === 'desert_cookhouse'
            || economyType === 'frost_smokehouse' || economyType === 'chain_restaurant') {
            const isRestaurant = economyType === 'chain_restaurant';
            const isCookhouse = economyType === 'desert_cookhouse';
            const isSmokehouse = economyType === 'frost_smokehouse';
            const bakeryCfg = populationEconomyConfig[economyType] || {};
            const jobField = isRestaurant ? 'chainRestaurantJob'
                : (isCookhouse ? 'desertCookhouseJob'
                    : (isSmokehouse ? 'frostSmokehouseJob' : 'bakeryJob'));
            const remainderField = isRestaurant ? 'chainRestaurantOutputRemainder'
                : (isCookhouse ? 'desertCookhouseOutputRemainder'
                    : (isSmokehouse ? 'frostSmokehouseOutputRemainder' : 'bakeryOutputRemainder'));
            const job = structure[jobField] && typeof structure[jobField] === 'object'
                ? structure[jobField]
                : {};
            structure[jobField] = job;
            if (economyType === 'bakery') {
                structure.bakeryPendingTributeIds = Array.isArray(structure.bakeryPendingTributeIds)
                    ? structure.bakeryPendingTributeIds : [];
            }
            const reachableWarehouseRoutes = _snapshotReachableWarehouses(
                roadContext,
                structure,
                warehouses
            );
            const bakeryWarehouses = reachableWarehouseRoutes.map((entry) => entry.warehouse);
            // 断路期间完整冻结粮食加工任务；不累积离线补偿时间，也不转移资源。
            if (bakeryWarehouses.length <= 0) continue;
            const moduleValue = isRestaurant ? _chainRestaurantModuleValue
                : (isCookhouse ? _desertCookhouseModuleValue
                    : (isSmokehouse ? _frostSmokehouseModuleValue : _bakeryModuleValue));
            const inputModule = isRestaurant ? 'restaurant_bulk_supply'
                : (isCookhouse ? 'cookhouse_water_storage'
                    : (isSmokehouse ? 'smokehouse_curing_racks' : ''));
            const processModule = isRestaurant ? 'restaurant_central_kitchen'
                : (isCookhouse ? 'cookhouse_heat_control'
                    : (isSmokehouse ? 'smokehouse_draft_control' : 'bakery_quick_cooking'));
            const outputModule = isRestaurant ? 'restaurant_signature_menu'
                : (isCookhouse ? 'cookhouse_spice_blending'
                    : (isSmokehouse ? 'smokehouse_curing_recipe' : 'bakery_gourmet'));
            const moveModule = isRestaurant ? 'restaurant_express_delivery'
                : (isCookhouse ? 'cookhouse_caravan_steps'
                    : (isSmokehouse ? 'smokehouse_sled_runners' : 'bakery_quick_steps'));
            const inputFood = Math.max(1, Math.floor((inputModule
                ? moduleValue(structure, inputModule) : 0)
                || Number(bakeryCfg.inputFoodPerBatch) || (isRestaurant ? 80 : 50)));
            const processMs = Math.max(100, moduleValue(structure, processModule)
                || Number(bakeryCfg.baseProcessTimeMs) || 10000);
            const outputMultiplier = Math.max(1, moduleValue(structure, outputModule)
                || Number(bakeryCfg.baseOutputMultiplier) || 5);
            const moveSpeed = Math.max(1, (Number(bakeryCfg.baseMoveSpeed) || 80)
                * (moduleValue(structure, moveModule) || 1));
            const processorWeatherMultiplier = isCookhouse && foodWeatherEffect.droughtActive
                ? Math.max(foodWeatherMultiplier,
                    Number(bakeryCfg.droughtFoodMultiplierFloor) || 1)
                : foodWeatherMultiplier;
            const planeOutputMultipliers = bakeryCfg.planeOutputMultipliers || {};
            const exactPlaneMultiplier = Number(planeOutputMultipliers[runtimeSceneId]);
            const defaultPlaneMultiplier = Number(planeOutputMultipliers.default);
            const processorPlaneMultiplier = isSmokehouse
                ? (Number.isFinite(exactPlaneMultiplier) && exactPlaneMultiplier >= 0
                    ? exactPlaneMultiplier
                    : (Number.isFinite(defaultPlaneMultiplier) && defaultPlaneMultiplier >= 0
                        ? defaultPlaneMultiplier : 1))
                : 1;
            const workerOutputFactor = _processorWorkerOutputFactor(structure, bakeryCfg);
            const nearestDistance = Math.max(
                0,
                (reachableWarehouseRoutes[0]?.route?.length - 1) * 64 || 0
            );
            const workshopMultiplier = _workshopEfficiencyMultiplier(structure, economyStructures);
            const cycleMs = Math.max(100,
                processMs / Math.max(0.01, workshopMultiplier)
                + nearestDistance * 2 / moveSpeed * 1000);
            if (assigned > 0 && (Number(job.pendingFood) || 0) > 0) {
                const stored = _depositFoodToWarehouses(bakeryWarehouses, job.pendingFood);
                job.pendingFood = Math.max(0, Math.floor(Number(job.pendingFood) || 0) - stored);
                report.foodProduced += stored;
            }

            let availableMs = Math.max(0, Number(job.offlineProgressMs) || 0)
                + (assigned > 0 ? elapsedMs * Math.max(0, laborEfficiency) : 0);
            job.offlineProgressMs = 0;
            if (assigned > 0 && job.pendingFood <= 0 && (Number(job.cargoFood) || 0) > 0) {
                const remainingProcessMs = job.phase === 'processing'
                    ? Math.max(0, Number(job.processRemainMs) || processMs)
                    : processMs;
                const effectiveRemainingProcessMs = remainingProcessMs
                    / Math.max(0.01, workshopMultiplier);
                if (availableMs >= effectiveRemainingProcessMs) {
                    availableMs -= effectiveRemainingProcessMs;
                    const consumedFood = Math.max(1,
                        Math.floor(Number(job.cargoFood) || inputFood));
                    const exactOutput = Math.max(0, Number(structure[remainderField]) || 0)
                        + consumedFood * outputMultiplier * workerOutputFactor
                            * tavernWeightedMultiplier * processorWeatherMultiplier
                            * processorPlaneMultiplier
                            * getProductionResourceMul();
                    const produced = Math.max(1, Math.floor(exactOutput));
                    structure[remainderField] = exactOutput - produced;
                    const stored = _depositFoodToWarehouses(bakeryWarehouses, produced);
                    report.foodProduced += stored;
                    job.pendingFood = Math.max(0, produced - stored);
                    job.cargoFood = 0;
                    job.completedBatches = Math.max(0, Math.floor(Number(job.completedBatches) || 0)) + 1;
                    const tributeChance = economyType === 'bakery' ? Math.max(0, Math.min(1,
                        moduleValue(structure, 'bakery_ingredient_processing') || 0.01)) : 0;
                    const tributeIds = economyType === 'bakery'
                        ? (bakeryCfg.plantTributeItemIds || []) : [];
                    if (tributeIds.length > 0 && Math.random() < tributeChance) {
                        const tributeId = tributeIds[Math.floor(Math.random() * tributeIds.length)];
                        const routed = commit && typeof opts.grant === 'function'
                            ? opts.grant({ tributeItemIds: [tributeId] }) || {}
                            : {};
                        if ((Number(routed.acceptedTributes) || 0) < 1) {
                            structure.bakeryPendingTributeIds.push(tributeId);
                        }
                        report.plantTributesProduced++;
                    }
                } else {
                    job.phase = 'processing';
                    job.processTotalMs = processMs;
                    job.processRemainMs = Math.max(0,
                        remainingProcessMs - availableMs * workshopMultiplier);
                    availableMs = 0;
                }
            }
            let guard = 10000;
            while (assigned > 0 && job.pendingFood <= 0 && availableMs >= cycleMs && guard-- > 0) {
                if (!_deductFoodFromWarehouses(bakeryWarehouses, inputFood)) break;
                availableMs -= cycleMs;
                const exactOutput = Math.max(0, Number(structure[remainderField]) || 0)
                    + inputFood * outputMultiplier * workerOutputFactor
                        * tavernWeightedMultiplier * processorWeatherMultiplier
                        * processorPlaneMultiplier
                        * getProductionResourceMul();
                const produced = Math.max(1, Math.floor(exactOutput));
                structure[remainderField] = exactOutput - produced;
                const stored = _depositFoodToWarehouses(bakeryWarehouses, produced);
                report.foodProduced += stored;
                job.pendingFood = Math.max(0, produced - stored);
                job.completedBatches = Math.max(0, Math.floor(Number(job.completedBatches) || 0)) + 1;
                const tributeChance = economyType === 'bakery' ? Math.max(0, Math.min(1,
                    moduleValue(structure, 'bakery_ingredient_processing') || 0.01)) : 0;
                const tributeIds = economyType === 'bakery'
                    ? (bakeryCfg.plantTributeItemIds || []) : [];
                if (tributeIds.length > 0 && Math.random() < tributeChance) {
                    const tributeId = tributeIds[Math.floor(Math.random() * tributeIds.length)];
                    const routed = commit && typeof opts.grant === 'function'
                        ? opts.grant({ tributeItemIds: [tributeId] }) || {}
                        : {};
                    if ((Number(routed.acceptedTributes) || 0) < 1) {
                        structure.bakeryPendingTributeIds.push(tributeId);
                    }
                    report.plantTributesProduced++;
                }
            }
            job.offlineProgressMs = Math.min(cycleMs, availableMs);
            if (job.cargoFood <= 0) job.phase = job.pendingFood > 0 ? 'waiting_deposit' : 'idle';
            job.targetWarehouseId = null;
        } else if (economyType === 'cheese_farm') {
            const cheeseCfg = populationEconomyConfig.cheese_farm || {};
            const job = structure.cheeseFarmJob && typeof structure.cheeseFarmJob === 'object'
                ? structure.cheeseFarmJob
                : {};
            structure.cheeseFarmJob = job;
            const reachableWarehouseRoutes = _snapshotReachableWarehouses(
                roadContext,
                structure,
                warehouses
            );
            const cheeseWarehouses = reachableWarehouseRoutes.map((entry) => entry.warehouse);
            // 与前台一致：断路或无人时冻结熟成、运输与待入库成品。
            if (cheeseWarehouses.length <= 0) continue;
            const processMs = Math.max(1000,
                _cheeseFarmModuleValue(structure, 'cheese_maturation')
                    || Number(cheeseCfg.baseProcessTimeMs) || 20000);
            const foodPerBatch = Math.max(1,
                _cheeseFarmModuleValue(structure, 'cheese_breed_selection')
                    || Number(cheeseCfg.baseFoodPerBatch) || 40);
            const cowCount = Math.max(1, Math.floor(
                _cheeseFarmModuleValue(structure, 'cheese_pasture_expansion')
                    || Number(cheeseCfg.baseCowCount) || 2));
            const baseCowCount = Math.max(1, Number(cheeseCfg.baseCowCount) || 2);
            const moveSpeed = Math.max(1, (Number(cheeseCfg.baseMoveSpeed) || 80)
                * (_cheeseFarmModuleValue(structure, 'cheese_delivery_cart') || 1));
            const nearestDistance = Math.max(
                0,
                (reachableWarehouseRoutes[0]?.route?.length - 1) * 64 || 0
            );
            const workshopMultiplier = _workshopEfficiencyMultiplier(structure, economyStructures);
            const cycleMs = Math.max(1000,
                processMs / Math.max(0.01, workshopMultiplier)
                + nearestDistance * 2 / moveSpeed * 1000);
            if (assigned > 0 && (Number(job.pendingFood) || 0) > 0) {
                const pendingBeforeDeposit = Math.max(0, Math.floor(Number(job.pendingFood) || 0));
                const stored = _depositFoodToWarehouses(cheeseWarehouses, job.pendingFood);
                job.pendingFood = Math.max(0, pendingBeforeDeposit - stored);
                report.foodProduced += stored;
                if (pendingBeforeDeposit > 0 && job.pendingFood <= 0) {
                    job.completedBatches = Math.max(0,
                        Math.floor(Number(job.completedBatches) || 0)) + 1;
                }
            }
            let availableMs = Math.max(0, Number(job.offlineProgressMs) || 0)
                + (assigned > 0 ? elapsedMs * Math.max(0, laborEfficiency) : 0);
            job.offlineProgressMs = 0;
            let guard = 10000;
            while (assigned > 0 && job.pendingFood <= 0 && availableMs >= cycleMs && guard-- > 0) {
                availableMs -= cycleMs;
                const exactOutput = Math.max(0, Number(structure.cheeseFarmOutputRemainder) || 0)
                    + foodPerBatch * cowCount / baseCowCount
                        * tavernWeightedMultiplier * foodWeatherMultiplier
                        * getProductionResourceMul();
                const produced = Math.max(1, Math.floor(exactOutput));
                structure.cheeseFarmOutputRemainder = exactOutput - produced;
                const stored = _depositFoodToWarehouses(cheeseWarehouses, produced);
                report.foodProduced += stored;
                job.pendingFood = Math.max(0, produced - stored);
                if (job.pendingFood <= 0) {
                    job.completedBatches = Math.max(0,
                        Math.floor(Number(job.completedBatches) || 0)) + 1;
                }
            }
            job.offlineProgressMs = Math.min(cycleMs, availableMs);
            job.phase = job.pendingFood > 0 ? 'waiting_deposit' : 'processing';
            job.processTotalMs = processMs;
            job.processRemainMs = Math.max(0,
                processMs - Math.min(processMs, availableMs * workshopMultiplier));
            job.targetWarehouseId = null;
        } else if (economyType === 'steam_power_plant') {
            const steamCfg = populationEconomyConfig.steam_power_plant || {};
            const reachableWarehouseRoutes = _snapshotReachableWarehouses(
                roadContext,
                structure,
                warehouses
            );
            const steamWarehouses = reachableWarehouseRoutes.map((entry) => entry.warehouse);
            // 与前台一致：断路时冻结任务、携带食物、待存能源和计时。
            if (steamWarehouses.length <= 0) continue;
            const slotCount = Math.max(1, Math.floor(Number(steamCfg.workerSlots) || 2));
            structure.steamJobs = Array.isArray(structure.steamJobs) ? structure.steamJobs : [];
            while (structure.steamJobs.length < slotCount) {
                structure.steamJobs.push({
                    slot: structure.steamJobs.length,
                    phase: 'idle',
                    cargoFood: 0,
                    pendingEnergy: 0,
                    completedBatches: 0,
                    offlineProgressMs: 0,
                });
            }
            const activeCount = Math.min(slotCount, Math.max(0, Math.floor(assigned)));
            const foodPerBatch = Math.max(1, Math.floor(
                _steamModuleValue(structure, 'steam_heat_recovery')
                    || Number(steamCfg.inputFoodPerBatch) || 120
            ));
            const energyPerBatch = Math.max(1, Math.floor(
                _steamModuleValue(structure, 'steam_turbine_output')
                    || Number(steamCfg.baseEnergyPerBatch) || 90
            ));
            const processMs = Math.max(100,
                _steamModuleValue(structure, 'steam_high_pressure_boiler')
                    || Number(steamCfg.baseProcessTimeMs) || 15000);
            const moveSpeed = Math.max(1, (Number(steamCfg.baseMoveSpeed) || 80)
                * (_steamModuleValue(structure, 'steam_transport_cart') || 1));
            const nearestDistance = Math.max(0,
                (reachableWarehouseRoutes[0]?.route?.length - 1) * 64 || 0);
            const workshopMultiplier = _workshopEfficiencyMultiplier(structure, economyStructures);
            const cycleMs = Math.max(100,
                processMs / Math.max(0.01, workshopMultiplier)
                    + nearestDistance * 2 / moveSpeed * 1000);

            for (let index = 0; index < activeCount; index++) {
                const job = structure.steamJobs[index];
                job.cargoFood = Math.max(0, Math.floor(Number(job.cargoFood) || 0));
                job.pendingEnergy = Math.max(0, Math.floor(Number(job.pendingEnergy) || 0));
                job.completedBatches = Math.max(0, Math.floor(Number(job.completedBatches) || 0));
                if (job.pendingEnergy > 0) {
                    const stored = _depositToWarehouses(steamWarehouses, job.pendingEnergy);
                    job.pendingEnergy = Math.max(0, job.pendingEnergy - stored);
                    report.steamEnergyProduced += stored;
                }

                let availableMs = Math.max(0, Number(job.offlineProgressMs) || 0)
                    + elapsedMs * Math.max(0, laborEfficiency);
                job.offlineProgressMs = 0;
                if (job.pendingEnergy <= 0 && job.cargoFood > 0) {
                    const remainingProcessMs = job.phase === 'processing'
                        ? Math.max(0, Number(job.processRemainMs) || processMs)
                        : processMs;
                    const effectiveRemaining = remainingProcessMs
                        / Math.max(0.01, workshopMultiplier);
                    if (availableMs >= effectiveRemaining) {
                        availableMs -= effectiveRemaining;
                        const exactOutput = Math.max(0,
                            Number(structure.steamOutputRemainder) || 0)
                            + energyPerBatch * tavernWeightedMultiplier
                                * getProductionResourceMul();
                        const produced = Math.max(1, Math.floor(exactOutput));
                        structure.steamOutputRemainder = exactOutput - produced;
                        const stored = _depositToWarehouses(steamWarehouses, produced);
                        report.steamEnergyProduced += stored;
                        job.pendingEnergy = Math.max(0, produced - stored);
                        job.cargoFood = 0;
                        job.completedBatches++;
                    } else {
                        job.phase = 'processing';
                        job.processTotalMs = processMs;
                        job.processRemainMs = Math.max(0,
                            remainingProcessMs - availableMs * workshopMultiplier);
                        availableMs = 0;
                    }
                }

                let guard = 10000;
                while (job.pendingEnergy <= 0 && availableMs >= cycleMs && guard-- > 0) {
                    if (!_deductFoodFromWarehouses(steamWarehouses, foodPerBatch)) break;
                    report.foodSpentOnSteam += foodPerBatch;
                    availableMs -= cycleMs;
                    const exactOutput = Math.max(0,
                        Number(structure.steamOutputRemainder) || 0)
                        + energyPerBatch * tavernWeightedMultiplier
                            * getProductionResourceMul();
                    const produced = Math.max(1, Math.floor(exactOutput));
                    structure.steamOutputRemainder = exactOutput - produced;
                    const stored = _depositToWarehouses(steamWarehouses, produced);
                    report.steamEnergyProduced += stored;
                    job.pendingEnergy = Math.max(0, produced - stored);
                    job.completedBatches++;
                }
                job.offlineProgressMs = Math.min(cycleMs, availableMs);
                job.phase = job.cargoFood > 0
                    ? 'processing'
                    : (job.pendingEnergy > 0 ? 'waiting_deposit' : 'idle');
                job.targetWarehouseId = null;
            }
        } else if (economyType === 'armory') {
            const armoryCfg = populationEconomyConfig.armory || {};
            const intervalMs = Math.max(1000, Number(armoryCfg.resourceSortIntervalMs) || 60000);
            const staffShare = Math.max(0, Number(armoryCfg.staffEfficiencyShare) || 0.2);
            const staffFactor = Math.min(1, assigned * staffShare);
            const configuredChance = Math.max(0, Math.min(1,
                _armoryModuleValue(structure, 'armory_resource_sorting')));
            const actualChance = configuredChance * staffFactor;
            let pending = Math.max(0, Math.floor(Number(structure.armoryPendingStones) || 0));
            if (pending > 0 && commit && typeof opts.grant === 'function') {
                const routed = opts.grant({ enhancementStones: pending }) || {};
                pending = Math.max(0, pending
                    - Math.max(0, Math.floor(Number(routed.acceptedEnhancementStones) || 0)));
            }
            if (actualChance > 0) {
                const totalMs = Math.max(0, Number(structure.armorySortElapsedMs) || 0) + elapsedMs;
                const intervals = Math.floor(totalMs / intervalMs);
                structure.armorySortElapsedMs = totalMs - intervals * intervalMs;
                const successes = _sampleBinomial(intervals, actualChance);
                if (successes > 0) {
                    let accepted = 0;
                    if (commit && typeof opts.grant === 'function') {
                        const routed = opts.grant({ enhancementStones: successes }) || {};
                        accepted = Math.max(0,
                            Math.floor(Number(routed.acceptedEnhancementStones) || 0));
                    }
                    pending += Math.max(0, successes - accepted);
                    report.enhancementStonesProduced += successes;
                }
            }
            structure.armoryPendingStones = pending;
        } else if (economyType === 'market') {
            const marketCfg = populationEconomyConfig.market || {};
            const effectiveWorkers = assigned * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures);
            const decayMultiplier = 1
                + effectiveWorkers * Math.max(0, Number(marketCfg.pressureDecayMultiplierPerWorker) || 0);
            const decay = Math.max(0, Number(marketCfg.pressureDecayPerSecond) || 0)
                * decayMultiplier * t;
            const pressure = Number(structure.marketPressure) || 0;
            structure.marketPressure = pressure > 0
                ? Math.max(0, pressure - decay)
                : Math.min(0, pressure + decay);
        }
    }
    const safeRepairSeconds = target.wave.phase === 'wave'
        ? 0
        : Math.min(t, Math.max(0, Number(target.wave.phaseTimer) || 0) / 1000);
    _settleWorkshopRepairs(target, economyStructures, safeRepairSeconds);
    target.populationEconomy.foodStored = _foodInWarehouses(warehouses);

    // ---- 读条结算（能力/研究 + 出兵模块；持续目标保留供回场资源轮询）----
    for (const s of target.structures || []) {
        if ((s.kind !== 'producer' && s.kind !== 'barracks') || !s.upgrade) continue;
        const up = s.upgrade;
        const elapsedMsLocal = Math.max(0, elapsedMs);
        if (up.remainMs <= elapsedMsLocal) {
            if (up.abilityId) {
                const ability = getBuildingUpgradeAbility(up.abilityId);
                const previousLevel = _levelOf(up.abilityId, simulation.abilityLevels);
                const level = commit
                    ? raiseAbilityLevel(up.abilityId, ability?.maxLevel ?? 10)
                    : Math.min(ability?.maxLevel ?? 10, previousLevel + 1);
                simulation.abilityLevels[up.abilityId] = level;
                if (level > previousLevel) {
                    if (!completionTimes[up.abilityId]) completionTimes[up.abilityId] = [];
                    completionTimes[up.abilityId].push(Math.max(0, Number(up.remainMs) || 0));
                    report.abilitiesCompleted.push(up.abilityId);
                    if (commit) ResearchSystem.onResearchLeveled(up.abilityId);
                }
            } else if (up.moduleId && up.unitType) {
                const configuredUnitTypes = _moduleUnitTypesOf(s, up.moduleId);
                const unitTypes = configuredUnitTypes.length
                    ? configuredUnitTypes
                    : (Array.isArray(up.unitTypes) && up.unitTypes.length
                        ? [...new Set(up.unitTypes.filter(Boolean))]
                        : [up.unitType]);
                const module = getUpgradeModulesForUnitKind(unitTypes[0])?.[up.moduleId];
                if (module) {
                    if (commit) {
                        raiseSharedUnitUpgradeLevel(unitTypes, up.moduleId, module.maxLevel);
                        for (const kind of unitTypes) {
                            applyGlobalUpgradesToKind(kind, getUpgradeModulesForUnitKind(kind));
                        }
                    }
                    report.modulesCompleted.push(`${unitTypes.join('+')}:${up.moduleId}`);
                }
            }
            s.upgrade = null; // continuous 独立保留：回场后持续轮询条件与资源
        } else {
            up.remainMs -= elapsedMsLocal;
        }
    }

    // ---- 被动能源：按研究真正完成的时点分段，不把新等级错误回溯到整段离线时间。----
    const passiveEnergy = opts.includePassiveEnergy === false ? 0 : _abilityTimeline(
        initialPassiveLevel,
        completionTimes,
        elapsedMs,
        'research_passive_energy'
    ).reduce((sum, segment) => {
        const perSecond = getAbilityValue(
            getBuildingUpgradeAbility('research_passive_energy'),
            segment.level
        );
        return sum + segment.durationMs / 1000 * perSecond;
    }, 0) + simulation.passiveEnergyRemainder;
    report.passiveEnergy = Math.floor(passiveEnergy);
    simulation.passiveEnergyRemainder = passiveEnergy - report.passiveEnergy;

    // ---- 采矿与仓储 ----
    let warehouseFree = _energyStorableInWarehouses(warehouses);
    // 被动能源先入仓
    if (report.passiveEnergy > 0 && warehouseFree > 0) {
        const add = Math.min(report.passiveEnergy, warehouseFree);
        _depositToWarehouses(warehouses, add);
        warehouseFree = _energyStorableInWarehouses(warehouses);
        report.passiveEnergy = add; // 满仓截断（与实机满仓口径一致）
    }
    // 教堂什一税：保存每座教堂的周期余数，后台1Hz增量结算也能累计到完整10秒。
    const priestModules = getUpgradeModulesForUnitKind('priest');
    const priestMults = getUnitUpgradeMults('priest', priestModules);
    const tithePerTick = Math.max(0, Number(priestMults.titheEnergyPerTick) || 0);
    const titheModule = Object.values(priestModules || {})
        .find((module) => module?.effect === 'titheEnergyPerTick');
    const titheIntervalMs = Math.max(0, Number(titheModule?.tickMs) || 0);
    if (tithePerTick > 0 && titheIntervalMs > 0) {
        for (const s of target.structures || []) {
            if (s.kind !== 'producer') continue;
            const priests = _normalizedRoster(s).priest || 0;
            if (priests <= 0) continue;
            const accumulated = Math.max(0, Number(s.titheTimerMs) || 0) + elapsedMs;
            const ticks = Math.floor(accumulated / titheIntervalMs);
            s.titheTimerMs = accumulated - ticks * titheIntervalMs;
            if (ticks <= 0 || warehouseFree <= 0) continue;
            const add = Math.min(warehouseFree, priests * tithePerTick * ticks);
            _depositToWarehouses(warehouses, add);
            warehouseFree = _energyStorableInWarehouses(warehouses);
            report.titheEnergy += add;
        }
    }
    // 小屋暂存先入仓
    for (const s of target.structures || []) {
        if (s.kind !== 'hut' || !(s.storedEnergy > 0) || warehouseFree <= 0) continue;
        const moved = Math.min(s.storedEnergy, warehouseFree);
        s.storedEnergy -= moved;
        _depositToWarehouses(warehouses, moved);
        warehouseFree = _energyStorableInWarehouses(warehouses);
    }
    // 矿点枯竭重生先结算
    for (const n of target.nodes || []) {
        if (n.depleted && n.respawnTimer > 0) {
            n.respawnTimer -= elapsedMs;
            if (n.respawnTimer <= 0) { n.depleted = false; n.hp = n.maxHp; n.respawnTimer = 0; }
        }
    }
    // 矿工采矿：伤害/间隔/采集比与升级倍率均读取当前配置真源。
    const nodes = target.nodes || [];
    for (const s of target.structures || []) {
        if (s.kind !== 'hut') continue;
        const slotCount = getMinerEconomyStats(s.modules || {}).count;
        const desiredCount = Math.max(0, Math.min(
            slotCount,
            Math.floor(Number(s.assignedWorkers == null ? s.miners : s.assignedWorkers) || 0)
        ));
        let miners = Math.min(desiredCount, Math.max(0, Math.floor(Number(s.miners) || 0)));
        s.assignedWorkers = desiredCount;
        const minerOutputMultiplier = tavernWeightedMultiplier * getProductionResourceMul();
        let minerOutputRemainder = Math.max(0, Number(s.minerTavernRemainder) || 0);
        const submitRawMinerEnergy = (rawAmount, countAsMined = true) => {
            const raw = Math.max(0, Number(rawAmount) || 0);
            if (raw <= 0 || warehouseFree <= 0) return { rawAccepted: 0, output: 0 };
            const capacityRaw = Math.max(0,
                (warehouseFree + 0.999999 - minerOutputRemainder)
                    / Math.max(0.000001, minerOutputMultiplier));
            const rawAccepted = Math.min(raw, capacityRaw);
            const exactOutput = minerOutputRemainder + rawAccepted * minerOutputMultiplier;
            const output = Math.min(warehouseFree, Math.floor(exactOutput));
            const stored = output > 0 ? _depositToWarehouses(warehouses, output) : 0;
            if (stored !== output) return { rawAccepted: 0, output: 0 };
            minerOutputRemainder = exactOutput - output;
            s.minerTavernRemainder = minerOutputRemainder;
            warehouseFree = _energyStorableInWarehouses(warehouses);
            if (countAsMined) report.energyMined += output;
            return { rawAccepted, output };
        };
        if ((Number(s.carriedEnergy) || 0) > 0 && warehouseFree > 0) {
            const submitted = submitRawMinerEnergy(s.carriedEnergy, false);
            s.carriedEnergy = Math.max(0, Number(s.carriedEnergy) - submitted.rawAccepted);
        }
        const wait = Math.min(Math.max(0, (s.respawnTimer || 0) / 1000), t);
        const mineSegment = (count, seconds) => {
            if (warehouseFree <= 0 || count <= 0 || seconds <= 0) return;
            const want = getMinerEnergyPerSecond(s.modules || {}, count) * laborEfficiency
                * Math.max(0, seconds);
            const capacityRaw = Math.max(0,
                (warehouseFree + 0.999999 - minerOutputRemainder)
                    / Math.max(0.000001, minerOutputMultiplier));
            const mined = _mineFromNodes(nodes, Math.min(want, capacityRaw));
            if (mined > 0) submitRawMinerEnergy(mined);
        };
        mineSegment(miners, wait);
        if ((s.respawnTimer || 0) <= elapsedMs) {
            const freeMinimum = Math.max(0, Number(MINER_CAMP_CONFIG.freeMinimumCount) || 0);
            const spawnCost = Math.max(0, Number(MINER_CAMP_CONFIG.respawnEnergyCost) || 0);
            const missing = Math.max(0, desiredCount - miners);
            const freeCount = Math.min(missing, Math.max(0, freeMinimum - miners));
            miners += freeCount;
            const paidMissing = Math.max(0, desiredCount - miners);
            const availableEnergy = (warehouses || []).reduce(
                (sum, warehouse) => sum + Math.max(0, Number(warehouse.storedEnergy) || 0),
                0
            );
            const affordable = spawnCost > 0
                ? Math.floor(availableEnergy / spawnCost)
                : paidMissing;
            const paidCount = Math.min(paidMissing, affordable);
            if (paidCount > 0) {
                const totalCost = paidCount * spawnCost;
                if (_deductFromWarehouses(warehouses, totalCost)) {
                    miners += paidCount;
                    report.energySpentOnMiners += totalCost;
                }
            }
            warehouseFree = _energyStorableInWarehouses(warehouses);
            s.miners = miners;
            s.respawnTimer = 0;
            mineSegment(miners, t - wait);
        } else {
            s.respawnTimer -= elapsedMs;
        }
    }

    // ---- 产兵结算（波次前先补员——产出的兵参与后续波次防守）----
    // 军事人口与经济岗位互不占用，但共同读取本位面房屋提供的 populationCapacity。
    // 外派/途中单位仍保存在原生产建筑的 troopLineDeployed 中，继续占原位面军事人口。
    const instantTroopProduction = isInstantTroopProductionEnabled();
    const ignoreMilitaryPopulation = isMilitaryPopulationIgnored();
    let militaryPopulationUsed = (target.structures || []).reduce((sum, structure) => {
        if (structure.kind !== 'barracks' && structure.kind !== 'producer') return sum;
        const cfg = _producerConfigOf(structure);
        if (!(cfg?.unitTypes || []).some((unit) => !!unit?.key)) return sum;
        return sum + _rosterCount(_normalizedRoster(structure))
            + Math.max(0, Math.floor(Number(structure.troopLineDeployed) || 0));
    }, 0);
    for (const s of target.structures || []) {
        if (s.kind !== 'barracks' && s.kind !== 'producer') continue;
        const producerCfg = _producerConfigOf(s);
        if (producerCfg && !producerCfg.parallelProduction && s.unitType) {
            const nextUnitType = resolveRecruitmentUnitType(
                producerCfg,
                s.unitType,
                opts.isRecruitmentTierUnlocked,
                opts.isUnitUnlocked
            );
            if (nextUnitType && nextUnitType !== s.unitType) {
                s.unitType = nextUnitType;
                const unitCfg = (producerCfg.unitTypes || [])
                    .find((unit) => unit.key === nextUnitType);
                s.spawnTimer = Number(unitCfg?.spawnIntervalMs)
                    || Number(producerCfg.spawnIntervalMs) || 0;
                s.populationBlocked = false;
                s.foodBlocked = false;
            }
        }
        if (producerCfg?.parallelProduction) {
            const roster = _normalizedRoster(s);
            const producerCap = _unitCapOf(s);
            let producerAssigned = _rosterCount(roster)
                + Math.max(0, Math.floor(Number(s.troopLineDeployed) || 0));
            s.parallelQueues = s.parallelQueues || {};
            const segments = _abilityTimeline(
                initialRecruitLevel, completionTimes, elapsedMs, 'research_recruit_speed'
            );
            for (const unitCfg of producerCfg.unitTypes || []) {
                const kind = unitCfg.key;
                if (!kind) continue;
                const queue = s.parallelQueues[kind] || {
                    recruitMode: RECRUIT_MODE.PAUSED,
                    timer: Number(unitCfg.spawnIntervalMs) || Number(producerCfg.spawnIntervalMs) || 0,
                };
                s.parallelQueues[kind] = queue;
                const recruitMode = normalizeRecruitMode(queue.recruitMode);
                if (recruitMode === RECRUIT_MODE.PAUSED) continue;
                queue.foodBlocked = false;
                queue.populationBlocked = false;
                const baseInterval = Math.max(0,
                    Number(unitCfg.spawnIntervalMs) || Number(producerCfg.spawnIntervalMs) || 0);
                const cap = _hasIndividualUnitCap(producerCfg)
                    ? Math.max(0, Math.floor(Number(unitCfg.unitCap) || 0))
                    : Number.POSITIVE_INFINITY;
                if (!(baseInterval > 0) || cap <= 0) continue;
                let timer = instantTroopProduction ? 0 : Math.max(0, Number(queue.timer) || 0);
                let localAlive = Math.max(0, Math.floor(Number(roster[kind]) || 0));
                let assigned = localAlive + Math.max(0,
                    Math.floor(Number(s.troopLineDeployedRoster?.[kind]) || 0));
                let previousInterval = baseInterval * _recruitMult(initialRecruitLevel);
                let stop = false;
                for (const segment of segments) {
                    const interval = baseInterval * _recruitMult(segment.level);
                    if (previousInterval > 0 && interval !== previousInterval) {
                        timer = Math.max(0, timer * interval / previousInterval);
                    }
                    const timeLeft = Math.max(0, Number(segment.durationMs) || 0);
                    if (timeLeft < timer) {
                        timer -= timeLeft;
                        previousInterval = interval;
                        continue;
                    }
                    const ready = 1 + Math.floor(Math.max(0, timeLeft - timer) / interval);
                    const producerRoom = Math.max(0, Math.min(
                        cap - assigned,
                        producerCap - producerAssigned
                    ));
                    const populationRoom = ignoreMilitaryPopulation
                        ? Number.POSITIVE_INFINITY
                        : Math.max(0, populationCapacity - militaryPopulationUsed);
                    const spawnCost = Math.max(0, Math.ceil(
                        (Number(unitCfg.spawnFoodCost) || 0)
                            * _armoryResourceCostMultiplier(s, economyStructures)
                    ));
                    const foodRoom = spawnCost > 0
                        ? Math.floor(_foodInWarehouses(warehouses) / spawnCost)
                        : Number.POSITIVE_INFINITY;
                    const singleRoom = recruitMode === RECRUIT_MODE.SINGLE ? 1 : Number.POSITIVE_INFINITY;
                    const produced = Math.max(0, Math.min(
                        ready, producerRoom, populationRoom, foodRoom, singleRoom
                    ));
                    if (produced > 0) {
                        const totalCost = produced * spawnCost;
                        if (totalCost > 0) _deductFoodFromWarehouses(warehouses, totalCost);
                        warehouseFree = _energyStorableInWarehouses(warehouses);
                        report.foodSpentOnUnits += totalCost;
                        localAlive += produced;
                        assigned += produced;
                        producerAssigned += produced;
                        militaryPopulationUsed += produced;
                        roster[kind] = localAlive;
                        report.unitsProduced += produced;
                    }
                    if (recruitMode === RECRUIT_MODE.SINGLE && produced > 0) {
                        queue.recruitMode = RECRUIT_MODE.PAUSED;
                        timer = interval;
                        stop = true;
                    } else if (produced < ready && produced < producerRoom) {
                        timer = 0;
                        if (populationRoom <= produced) queue.populationBlocked = true;
                        else if (foodRoom <= produced) queue.foodBlocked = true;
                        stop = true;
                    } else if (produced >= producerRoom) {
                        timer = interval;
                    } else {
                        const consumedMs = timer + Math.max(0, produced - 1) * interval;
                        timer = Math.max(0, interval - Math.max(0, timeLeft - consumedMs));
                    }
                    previousInterval = interval;
                    if (stop || assigned >= cap || producerAssigned >= producerCap) break;
                }
                const finalInterval = baseInterval * _recruitMult(
                    _levelOf('research_recruit_speed', simulation.abilityLevels));
                queue.timer = Math.max(0, timer * finalInterval / previousInterval);
            }
            s.units = _rosterCount(roster);
            s.unitRoster = roster;
            s.unitDps = _rosterDps(roster);
            continue;
        }
        if (s.kind === 'producer' && !s.unitType) continue; // 非产兵建筑
        const recruitMode = normalizeRecruitMode(s.recruitMode);
        const roster = _normalizedRoster(s);
        if (recruitMode === RECRUIT_MODE.PAUSED) {
            s.units = _rosterCount(roster);
            s.unitRoster = roster;
            s.unitDps = _rosterDps(roster);
            continue;
        }
        const baseInterval = _spawnIntervalOf(s);
        if (!(baseInterval > 0)) continue;
        const cap = _unitCapOf(s);
        let timer = instantTroopProduction ? 0 : Math.max(0, s.spawnTimer || 0);
        const deployed = Math.max(0, Math.floor(Number(s.troopLineDeployed) || 0));
        let alive = _rosterCount(roster) + deployed;
        const segments = _abilityTimeline(
            initialRecruitLevel,
            completionTimes,
            elapsedMs,
            'research_recruit_speed'
        );
        let previousInterval = baseInterval * _recruitMult(initialRecruitLevel);
        let foodBlocked = false;
        let militaryPopulationBlocked = false;
        let singleCompleted = false;
        for (const segment of segments) {
            const interval = baseInterval * _recruitMult(segment.level);
            if (previousInterval > 0 && interval !== previousInterval) {
                timer = Math.max(0, timer * interval / previousInterval);
            }
            const timeLeft = Math.max(0, Number(segment.durationMs) || 0);
            if (timeLeft < timer) {
                timer -= timeLeft;
                previousInterval = interval;
                continue;
            }
            const ready = 1 + Math.floor(Math.max(0, timeLeft - timer) / interval);
            const unitRoom = Math.max(0, cap - alive);
            const populationRoom = ignoreMilitaryPopulation
                ? Number.POSITIVE_INFINITY
                : Math.max(0, populationCapacity - militaryPopulationUsed);
            const spawnCost = _unitSpawnFoodCost(s, economyStructures);
            const foodRoom = spawnCost > 0
                ? Math.floor(_foodInWarehouses(warehouses) / spawnCost)
                : Number.POSITIVE_INFINITY;
            const singleRoom = recruitMode === RECRUIT_MODE.SINGLE ? 1 : Number.POSITIVE_INFINITY;
            const produced = Math.max(0, Math.min(
                ready, unitRoom, populationRoom, foodRoom, singleRoom
            ));
            if (produced > 0) {
                const totalCost = produced * spawnCost;
                if (totalCost > 0) _deductFoodFromWarehouses(warehouses, totalCost);
                warehouseFree = _energyStorableInWarehouses(warehouses);
                report.foodSpentOnUnits += totalCost;
                alive += produced;
                militaryPopulationUsed += produced;
                roster[s.unitType] = (roster[s.unitType] || 0) + produced;
                report.unitsProduced += produced;
            }
            if (recruitMode === RECRUIT_MODE.SINGLE && produced > 0) {
                s.recruitMode = RECRUIT_MODE.PAUSED;
                timer = interval;
                singleCompleted = true;
            } else if (produced < ready && produced < unitRoom) {
                timer = 0;
                if (populationRoom <= produced) militaryPopulationBlocked = true;
                else if (foodRoom <= produced) foodBlocked = true;
            } else if (produced >= unitRoom) {
                timer = interval;
            } else {
                const consumedMs = timer + Math.max(0, produced - 1) * interval;
                timer = Math.max(0, interval - Math.max(0, timeLeft - consumedMs));
            }
            previousInterval = interval;
            if (foodBlocked || militaryPopulationBlocked || singleCompleted) break;
            if (alive >= cap) {
                timer = interval;
                break;
            }
        }
        s.units = _rosterCount(roster);
        s.unitRoster = roster;
        const finalInterval = baseInterval * _recruitMult(
            _levelOf('research_recruit_speed', simulation.abilityLevels));
        s.spawnTimer = Math.max(0, timer * finalInterval / previousInterval);
        s.populationBlocked = militaryPopulationBlocked;
        s.foodBlocked = foodBlocked;
        // 混编部队逐兵种结算，切换生产类型不会把旧兵种整体转换。
        s.unitDps = _rosterDps(roster);
    }

    // ---- 探险结算：12 分钟一次性任务；离场后只推进剩余时间，完成后不再循环产出。----
    for (const s of target.structures || []) {
        const state = s.explorerState;
        if (!state || !(s.hp > 0)) continue;
        const rosterCount = Math.max(0, Math.floor(Number(s.unitRoster?.explorer) || 0));
        const legacyCount = Math.min(
            Math.max(0, Math.floor(Number(state.activeCount) || 0)), rosterCount);
        const runs = (Array.isArray(state.runs) ? state.runs : Array.from({ length: legacyCount }, () => ({
            remainingMs: 720000, durationMs: 720000, playerLevel: 1,
        }))).slice(0, rosterCount);
        if (!runs.length) continue;

        const pendingRuns = [];
        let sequence = Math.max(0, Math.floor(Number(state.rewardSequence) || 0));
        for (const run of runs) {
            const remainingMs = Math.max(0, Number(run?.remainingMs) || 0) - elapsedMs;
            if (remainingMs > 0) {
                pendingRuns.push({
                    remainingMs,
                    durationMs: Math.max(1000, Number(run?.durationMs) || 720000),
                    playerLevel: Math.max(1, Math.floor(Number(run?.playerLevel) || 1)),
                });
                continue;
            }
            // 四步序列严格形成 50/25/25；祭品池索引用黄金分割小数错开，避免总取同一件。
            const rewardRoll = ((sequence % 4) + 0.5) / 4;
            const poolRoll = (sequence * 0.61803398875) % 1;
            const rewardSequence = sequence;
            const reward = createExplorerReward(target.sceneId,
                Math.max(1, Math.floor(Number(run?.playerLevel) || 1)), rewardRoll, poolRoll);
            sequence++;
            report.explorerRewards.push({
                structureId: s.id, x: s.x, y: s.y,
                sequence: rewardSequence,
                kind: reward.kind, label: reward.label,
                items: reward.items || [], gold: reward.gold || 0,
            });
        }
        state.runs = pendingRuns;
        state.activeCount = pendingRuns.length;
        state.rewardSequence = sequence;
    }

    // ---- 波次结算 ----
    let towerDps = 0;
    for (const s of target.structures || []) {
        if (s.kind === 'tower') towerDps += s.dps || 0;
    }
    let appliedStructureLevel = initialStructureHpLevel;
    for (const segment of _multiAbilityTimeline(
        initialCombatLevels,
        completionTimes,
        elapsedMs,
        ['sweep_aoe', 'mark_arrow', 'inspire_magic', 'research_structure_hp']
    )) {
        const structureLevel = segment.levels.research_structure_hp || 0;
        if (structureLevel > appliedStructureLevel) {
            _applyStructureHpLevel(target, appliedStructureLevel, structureLevel);
            appliedStructureLevel = structureLevel;
        }
        let unitDps = 0;
        let priestCount = 0;
        let scoutCount = 0;
        for (const structure of target.structures || []) {
            if (structure.kind !== 'barracks'
                && !(structure.kind === 'producer' && structure.unitType)) continue;
            const roster = _normalizedRoster(structure);
            unitDps += _rosterDps(roster, segment.levels);
            priestCount += roster.priest || 0;
            scoutCount += roster.scout || 0;
        }
        const inspire = getBuildingUpgradeAbility('inspire_magic');
        const inspireLevel = segment.levels.inspire_magic || 0;
        if (priestCount > 0 && inspire && inspireLevel > 0) {
            const duration = getAbilityValue(inspire, inspireLevel);
            const uptime = Math.min(
                1,
                priestCount * duration / Math.max(1, inspire.cooldownMs || 30000)
            );
            unitDps *= 1 + ((inspire.atkMul ?? 1.5) - 1) * uptime;
        }
        const mark = getBuildingUpgradeAbility('mark_arrow');
        const markLevel = segment.levels.mark_arrow || 0;
        let markedMul = 1;
        if (scoutCount > 0 && mark && markLevel > 0) {
            const scoutCfg = UNIT_CFGS.scout?.ai || {};
            const shotInterval = Math.max(300, scoutCfg.attackInterval || 2500);
            const chance = Math.max(0, Math.min(1, getAbilityValue(mark, markLevel)));
            const attempts = scoutCount * (mark.durationMs || 3000) / shotInterval;
            const uptime = 1 - Math.pow(1 - chance, attempts);
            markedMul += (mark.damageAmplify || 0.15) * uptime;
        }
        const defenseDps = (towerDps + unitDps) * markedMul;
        if (!opts.skipWaves) {
            _settleWaves(target, cfg, defenseDps, segment.durationMs / 1000, report);
        }
    }

    const finalStructureLevel = _levelOf('research_structure_hp', simulation.abilityLevels);
    if (finalStructureLevel > appliedStructureLevel) {
        _applyStructureHpLevel(target, appliedStructureLevel, finalStructureLevel);
    }
    if (!opts.skipWaves && commit && report.victory && !target.wave.victoryGrantedPaid) {
        const reward = cfg.victoryReward || { gold: 500, energy: 500 };
        // 能源入快照仓库（恢复时物化）；金币走全局（grant 回调由调用方注入）
        if (reward.energy) _depositToWarehouses(warehouses, reward.energy);
        if (reward.gold && typeof opts.grant === 'function') opts.grant({ gold: reward.gold });
        target.wave.victoryGrantedPaid = true;
    }
    target.populationEconomy.foodStored = _foodInWarehouses(warehouses);
    return report;
}

// ==================== 内部 ====================

function getProducerStorageCap(s) {
    const cfg = producerBuildingsJson[s.cfgKey];
    if (!cfg || cfg.workshopType !== 'warehouse') return 0;
    const warehouseLevels = populationEconomyConfig.warehouse?.levels || [];
    const economyLevel = Math.max(1, Math.floor(Number(s.economyLevel) || 1));
    const levelCfg = warehouseLevels.find((entry) => Number(entry.level) === economyLevel)
        || warehouseLevels[warehouseLevels.length - 1];
    const baseCapacity = Number(levelCfg?.storageCapacity) || Number(cfg.storageCapacity) || 5000;
    const module = buildingUpgradesJson.warehouse_logistics?.modules?.warehouse_capacity;
    const level = Math.max(0, Math.min(
        Number(module?.maxLevel) || 10,
        Math.floor(Number(s.warehouseModules?.warehouse_capacity) || 0)
    ));
    return Math.max(0, Math.floor(
        baseCapacity
            + Math.max(0, (Number(module?.base) || 0) + (Number(module?.per) || 0) * level)
    ));
}

function _warehouseFactor(warehouse, moduleId) {
    const module = buildingUpgradesJson.warehouse_logistics?.modules?.[moduleId];
    const level = Math.max(0, Math.min(
        Number(module?.maxLevel) || 10,
        Math.floor(Number(warehouse?.warehouseModules?.[moduleId]) || 0)
    ));
    return Math.max(0.1, Math.min(1,
        1 + (Number(module?.base) || 0) + (Number(module?.per) || 0) * level));
}

function _depositToWarehouses(warehouses, amount) {
    let left = amount;
    for (const w of warehouses) {
        const free = _warehouseFree(w);
        const add = Math.min(Math.floor(free / _warehouseFactor(w, 'warehouse_energy_density')), left);
        w.storedEnergy = (w.storedEnergy || 0) + add;
        left -= add;
        if (left <= 0) break;
    }
    return amount - left;
}

function _depositFoodToWarehouses(warehouses, amount) {
    let left = Math.max(0, Math.floor(Number(amount) || 0));
    const requested = left;
    for (const w of warehouses) {
        const free = _warehouseFree(w);
        const add = Math.min(Math.floor(free / _warehouseFactor(w, 'warehouse_food_density')), left);
        w.storedFood = Math.max(0, Number(w.storedFood) || 0) + add;
        left -= add;
        if (left <= 0) break;
    }
    return requested - left;
}

function _foodInWarehouses(warehouses) {
    return warehouses.reduce((sum, w) => sum + Math.max(0, Number(w.storedFood) || 0), 0);
}

function _warehouseFree(warehouse) {
    return Math.max(
        0,
        getProducerStorageCap(warehouse)
            - Math.max(0, Number(warehouse.storedEnergy) || 0)
                * _warehouseFactor(warehouse, 'warehouse_energy_density')
            - Math.max(0, Number(warehouse.storedFood) || 0)
                * _warehouseFactor(warehouse, 'warehouse_food_density')
    );
}

function _energyStorableInWarehouses(warehouses) {
    return warehouses.reduce((sum, warehouse) => sum + Math.floor(
        _warehouseFree(warehouse) / _warehouseFactor(warehouse, 'warehouse_energy_density')
    ), 0);
}

function _deductFromWarehouses(warehouses, amount) {
    let left = Math.max(0, Number(amount) || 0);
    const total = warehouses.reduce((sum, w) => sum + Math.max(0, Number(w.storedEnergy) || 0), 0);
    if (total < left) return false;
    for (let i = warehouses.length - 1; i >= 0 && left > 0; i--) {
        const stored = Math.max(0, Number(warehouses[i].storedEnergy) || 0);
        const take = Math.min(stored, left);
        warehouses[i].storedEnergy = stored - take;
        left -= take;
    }
    return left <= 0;
}

/** 从矿点按序采掘 amount（hp 即储量；枯竭置位并开始重生计时 90s） */
function _mineFromNodes(nodes, amount) {
    let left = amount;
    for (const n of nodes) {
        if (n.depleted || !(n.hp > 0)) continue;
        const take = Math.min(n.hp, left);
        n.hp -= take;
        left -= take;
        if (n.hp <= 0) { n.depleted = true; n.hp = 0; n.respawnTimer = 90000; }
        if (left <= 0) break;
    }
    return amount - Math.max(0, left);
}

/** 深钻井优先采掘自身 600px 服务范围内的地表矿脉，深层矿脉只接管剩余原矿预算。 */
function _mineFromNodesInRange(nodes, x, y, range, amount) {
    const inRange = (nodes || [])
        .filter((node) => !node.depleted && Number(node.hp) > 0
            && Math.hypot((Number(node.x) || 0) - (Number(x) || 0),
                (Number(node.y) || 0) - (Number(y) || 0)) <= range)
        .sort((a, b) => Math.hypot((Number(a.x) || 0) - (Number(x) || 0),
            (Number(a.y) || 0) - (Number(y) || 0))
            - Math.hypot((Number(b.x) || 0) - (Number(x) || 0),
                (Number(b.y) || 0) - (Number(y) || 0)));
    let left = Math.max(0, Number(amount) || 0);
    for (const node of inRange) {
        const take = Math.min(Math.max(0, Number(node.hp) || 0), left);
        node.hp -= take;
        left -= take;
        if (node.hp <= 0) {
            node.depleted = true;
            node.hp = 0;
            node.respawnTimer = 0;
            node.collapseTimer = 0;
        }
        if (left <= 0) break;
    }
    return Math.max(0, Number(amount) || 0) - left;
}

function _spawnIntervalOf(s) {
    const cfg = _producerConfigOf(s);
    if (!cfg) return 0;
    const u = (cfg.unitTypes || []).find((x) => x.key === s.unitType);
    return (u && u.spawnIntervalMs) || cfg.spawnIntervalMs || 0;
}

function _unitCapOf(s) {
    const cfg = _producerConfigOf(s);
    if (!_hasIndividualUnitCap(cfg)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor(Number(cfg?.unitCap) || 0));
}

function _hasIndividualUnitCap(cfg) {
    return !!(cfg?.featureWorldId && (cfg.unitTypes || []).some((unit) => !!unit?.key));
}

function _unitSpawnFoodCost(s, economyStructures = []) {
    const cfg = _producerConfigOf(s);
    const unit = (cfg?.unitTypes || []).find((entry) => entry.key === s.unitType);
    return Math.max(0, Math.ceil(
        (Number(unit?.spawnFoodCost) || 0)
            * _armoryResourceCostMultiplier(s, economyStructures)
    ));
}

function _deductFoodFromWarehouses(warehouses, amount) {
    let left = Math.max(0, Number(amount) || 0);
    if (_foodInWarehouses(warehouses) < left) return false;
    for (let i = warehouses.length - 1; i >= 0 && left > 0; i--) {
        const stored = Math.max(0, Number(warehouses[i].storedFood) || 0);
        const take = Math.min(stored, left);
        warehouses[i].storedFood = stored - take;
        left -= take;
    }
    return left <= 0;
}

/** 波次时间轴推进 + 抽象战斗结算（支持 1Hz 增量 tick 与回场一次性结算两种口径：
 *  波次进度 wave.progressSec 跨 tick 累计，怪物输出按实际交战时长逐段结算） */
function _settleWaves(target, cfg, defenseDps, timeSec, report) {
    const wave = target.wave;
    if (wave.victory) return;
    let t = timeSec;
    let guard = 200;
    while (t > 0 && guard-- > 0) {
        if (wave.phase === 'prep' || wave.phase === 'break') {
            const remain = Math.max(0, (wave.phaseTimer || 0) / 1000);
            if (t < remain) { wave.phaseTimer = (remain - t) * 1000; return; }
            t -= remain;
            wave.wave = (wave.wave || 0) + 1;
            wave.phase = 'wave';
            wave.phaseTimer = 0;
            wave.progressSec = 0;
            continue;
        }
        if (wave.phase === 'wave') {
            const pool = _wavePool(wave.wave, cfg);
            const monsterDamageMul = 1 - _camelFrightReduction(target);
            // 防守 DPS 每波重算（结算过程中建筑可能被摧毁）
            const dps = (target.structures || []).reduce((sum, s) => {
                if (!(s.hp > 0)) return sum;
                if (s.kind === 'tower') return sum + (s.dps || 0);
                if (s.kind === 'barracks' || (s.kind === 'producer' && s.unitType)) return sum + (s.unitDps || 0);
                return sum;
            }, 0);
            if (dps <= 0) {
                // 无防守输出：怪群按实际时长推平防线与基地
                _applyStructureDamage(target, pool.dps * WORLD122_SIM.contactFraction * monsterDamageMul * t, report);
                if ((target.base?.hp ?? 0) <= 0) { report.defeated = true; return; }
                return; // 波次卡住（回场重打）
            }
            const clearTime = Math.min(WORLD122_SIM.waveTimeMax,
                Math.max(WORLD122_SIM.waveTimeMin, pool.hp / dps));
            const need = clearTime - (wave.progressSec || 0);
            const step = Math.min(t, need);
            wave.progressSec = (wave.progressSec || 0) + step;
            t -= step;
            // 怪物输出按本段交战时长结算（墙/门 → 建筑 → 基地）
            _applyStructureDamage(target, pool.dps * WORLD122_SIM.contactFraction * monsterDamageMul * step, report);
            if ((target.base?.hp ?? 0) <= 0) { report.defeated = true; return; }
            if (wave.progressSec < clearTime) return; // 波次仍在进行（时间用尽）
            // 清波
            report.wavesCleared.push(wave.wave);
            wave.progressSec = 0;
            if (wave.wave >= (cfg.victoryWave ?? 10)) {
                wave.victory = true;
                report.victory = true;
                return;
            }
            wave.phase = 'break';
            wave.phaseTimer = (cfg.waveBreakMs ?? 10000);
        }
    }
}

/** 伤害分配：先墙/门（含门柱），再建筑/塔，最后基地；原地修改快照并统计 */
function _applyStructureDamage(target, amount, report) {
    let left = amount;
    const structures = target.structures || [];
    const walls = structures.filter((s) => s.kind === 'block' || s.kind === 'gate4');
    const buildings = structures.filter((s) => s.kind !== 'block' && s.kind !== 'gate4');
    for (const group of [walls, buildings]) {
        if (left <= 0) break;
        for (const s of group) {
            if (left <= 0) break;
            if (!(s.hp > 0)) continue;
            const take = Math.min(s.hp, left);
            s.hp -= take;
            left -= take;
            if (s.hp <= 0) {
                s.hp = 0;
                // 后台摧毁与前台实体销毁保持同一生命周期：未完成读条和持续目标一并失效。
                s.upgrade = null;
                s.continuous = null;
                report.structuresLost++;
            }
        }
    }
    if (left > 0 && target.base) {
        const take = Math.min(target.base.hp, left);
        target.base.hp -= take;
        report.baseDamage += take;
    }
}
