// 世界-122 自动矿工经济公式。玩家与普通队友不使用本模块，保持各自实机采矿口径。
import minerCfg from '../../data/hamster-miner-config.json';
import minerCampCfg from '../../data/hamster-miner-camp-building.json';
import expertCfg from '../../data/hamster-mining-expert-config.json';
import producerBuildings from '../../data/producer-buildings.json';
import { resolveBuildingUpgradeProject } from './building-upgrade-projects.js';
import { getUpgradeMultsFromLevels } from './unit-upgrade-store.js';

export const MINER_CAMP_CONFIG = resolveBuildingUpgradeProject(minerCampCfg);
export const MINING_GUILD_CONFIG = resolveBuildingUpgradeProject(producerBuildings.mining_guild);

export function getMiningWorkerProfile(cfgKey) {
    return cfgKey === 'mining_guild'
        ? { building: MINING_GUILD_CONFIG, unit: expertCfg }
        : { building: MINER_CAMP_CONFIG, unit: minerCfg };
}

function resolveModuleLevel(module, moduleId, levels) {
    if (!module || !moduleId) return 0;
    return Math.max(0, Math.min(
        Math.floor(Number(module.maxLevel) || 0),
        Math.floor(Number(levels[moduleId]) || 0)
    ));
}

export function getMinerEconomyStats(levels = {}, minerCountOverride = null, cfgKey = 'hamster_hut') {
    const profile = getMiningWorkerProfile(cfgKey);
    const ai = profile.unit.ai || {};
    const modules = profile.building.modules || {};
    const mults = getUpgradeMultsFromLevels(modules, levels);
    const countEntry = Object.entries(modules)
        .find(([, module]) => module?.effect === 'count');
    const countModuleId = countEntry?.[0];
    const countModule = countEntry?.[1];
    const countLevel = resolveModuleLevel(countModule, countModuleId, levels);
    const backpackEntry = Object.entries(modules)
        .find(([, module]) => module?.effect === 'backpackCapacityBonus');
    const backpackModuleId = backpackEntry?.[0];
    const backpackModule = backpackEntry?.[1];
    const backpackLevel = resolveModuleLevel(backpackModule, backpackModuleId, levels);
    const backpackCapacity = Math.max(0, Number(ai.backpackCapacity) || 0)
        + Math.max(0, Number(backpackModule?.per) || 0) * backpackLevel;
    const configuredCount = countModule
        ? (Number(countModule.base) || 0) + (Number(countModule.per) || 0) * countLevel
        : mults.count;
    const count = minerCountOverride == null
        ? Math.max(1, Math.floor(Number(configuredCount) || 0))
        : Math.max(0, Math.floor(Number(minerCountOverride) || 0));
    return {
        count,
        attackDamage: Math.max(1, Math.round((ai.attackDamage ?? 25) * mults.attackDamageMult)),
        attackInterval: Math.max(300, Math.round((ai.attackInterval ?? 2000) * mults.attackIntervalMult)),
        walkSpeed: Math.max(20, Math.round((ai.walkSpeed ?? 80) * mults.moveSpeedMult)),
        miningMult: mults.miningMult,
        backpackCapacity,
        gatherRatio: Math.max(0, Number(ai.energyGatherRatio) || 0),
        expectedCritChance: Math.max(0, Math.min(1, Number(ai.expectedCritChance) || 0)),
    };
}

/** 后台每秒期望产能，逐次取整与 EnergyNode 实机结算一致。 */
export function getMinerEnergyPerSecond(levels = {}, minerCountOverride = null, cfgKey = 'hamster_hut') {
    const stats = getMinerEconomyStats(levels, minerCountOverride, cfgKey);
    if (stats.count <= 0 || stats.gatherRatio <= 0) return 0;
    const normalDamage = Math.max(0, Math.round(stats.attackDamage * stats.miningMult));
    const critDamage = Math.max(0, Math.round(normalDamage * 1.5));
    const normalEnergy = Math.floor(normalDamage * stats.gatherRatio);
    const critEnergy = Math.floor(critDamage * stats.gatherRatio);
    const energyPerHit = normalEnergy * (1 - stats.expectedCritChance)
        + critEnergy * stats.expectedCritChance;
    return stats.count * energyPerHit * 1000 / stats.attackInterval;
}
