function sortedBuildingTiers(config) {
    return (Array.isArray(config?.buildingTiers) ? config.buildingTiers : [])
        .filter((tier) => tier && Number(tier.level) > 0)
        .slice()
        .sort((left, right) => Number(left.level) - Number(right.level));
}

/** 建筑等级只由全局科技解锁决定；一级是配置中的稳定回退。 */
export function getUnlockedBuildingTier(config, isTierUnlocked = () => false) {
    const tiers = sortedBuildingTiers(config);
    let active = tiers[0] || null;
    for (const tier of tiers.slice(1)) {
        if (tier.id && isTierUnlocked(tier.id)) active = tier;
    }
    return active;
}

/** 现场与后台共用：升级保留绝对已损失耐久，不按生命比例补血。 */
export function applyBuildingTierStats(target, activeTier, baseStats) {
    const nextMaxHp = Math.max(1, Math.round(Number(activeTier?.hp ?? baseStats.hp) || 1));
    const nextDef = Math.max(0, Number(activeTier?.def ?? baseStats.def) || 0);
    const nextMdef = Math.max(0, Number(activeTier?.mdef ?? baseStats.mdef) || 0);
    const currentMaxHp = Math.max(1, Number(target.maxHp) || 1);
    const missingHp = Math.max(0, currentMaxHp - Math.max(0, Number(target.hp) || 0));
    const changed = nextMaxHp !== currentMaxHp || nextDef !== target.def || nextMdef !== target.mdef;
    target.maxHp = nextMaxHp;
    target.hp = Math.max(0, nextMaxHp - missingHp);
    target.def = nextDef;
    target.mdef = nextMdef;
    if (target.data) {
        target.data.maxHp = target.maxHp;
        target.data.hp = target.hp;
        target.data.def = nextDef;
        target.data.mdef = nextMdef;
    }
    return changed;
}

export function syncSnapshotBuildingTiers(snapshot, configs, isTierUnlocked) {
    if (typeof isTierUnlocked !== 'function') return false;
    let changed = false;
    for (const structure of snapshot?.structures || []) {
        if (structure.kind !== 'producer' || !(structure.hp > 0)) continue;
        const config = configs[structure.cfgKey];
        if (!config?.buildingTiers?.some(tier => tier.hp != null || tier.def != null || tier.mdef != null)) continue;
        const tier = getUnlockedBuildingTier(config, isTierUnlocked);
        if (applyBuildingTierStats(structure, tier, config)) changed = true;
    }
    return changed;
}
