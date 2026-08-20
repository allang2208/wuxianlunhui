// 世界-122 自动矿工经济公式。玩家与普通队友不使用本模块，保持各自实机采矿口径。
import minerCfg from '../../data/hamster-miner-config.json';
import minerCampCfg from '../../data/hamster-miner-camp-building.json';
import { resolveBuildingUpgradeProject } from './building-upgrade-projects.js';
import { getUpgradeMultsFromLevels } from './unit-upgrade-store.js';

export const MINER_CAMP_CONFIG = resolveBuildingUpgradeProject(minerCampCfg);

export function getMinerEconomyStats(levels = {}, minerCountOverride = null) {
    const ai = minerCfg.ai || {};
    const mults = getUpgradeMultsFromLevels(MINER_CAMP_CONFIG.modules || {}, levels);
    const count = minerCountOverride == null
        ? Math.max(1, Math.floor(mults.count))
        : Math.max(0, Math.floor(Number(minerCountOverride) || 0));
    return {
        count,
        attackDamage: Math.max(1, Math.round((ai.attackDamage ?? 100) * mults.attackDamageMult)),
        attackInterval: Math.max(300, Math.round((ai.attackInterval ?? 2000) * mults.attackIntervalMult)),
        walkSpeed: Math.max(20, Math.round((ai.walkSpeed ?? 80) * mults.moveSpeedMult)),
        miningMult: mults.miningMult,
        backpackCapacity: Math.max(0, Number(ai.backpackCapacity) || 0),
        gatherRatio: Math.max(0, Number(ai.energyGatherRatio) || 0),
        expectedCritChance: Math.max(0, Math.min(1, Number(ai.expectedCritChance) || 0)),
    };
}

/** 后台每秒期望产能，逐次取整与 EnergyNode 实机结算一致。 */
export function getMinerEnergyPerSecond(levels = {}, minerCountOverride = null) {
    const stats = getMinerEconomyStats(levels, minerCountOverride);
    if (stats.count <= 0 || stats.gatherRatio <= 0) return 0;
    const normalDamage = Math.max(0, Math.round(stats.attackDamage * stats.miningMult));
    const critDamage = Math.max(0, Math.round(normalDamage * 1.5));
    const normalEnergy = Math.floor(normalDamage * stats.gatherRatio);
    const critEnergy = Math.floor(critDamage * stats.gatherRatio);
    const energyPerHit = normalEnergy * (1 - stats.expectedCritChance)
        + critEnergy * stats.expectedCritChance;
    return stats.count * energyPerHit * 1000 / stats.attackInterval;
}
