function sortedRecruitmentTiers(config) {
    return (Array.isArray(config?.recruitmentTiers) ? config.recruitmentTiers : [])
        .filter((tier) => tier && Number(tier.level) > 0)
        .slice()
        .sort((a, b) => Number(a.level) - Number(b.level));
}

function configuredUnitByKey(config) {
    return new Map((config?.unitTypes || [])
        .filter((unit) => unit?.key)
        .map((unit) => [unit.key, unit]));
}

/** 只有整级两条兵种线都已开发并登记运行时单位时，建筑等级才允许真正启用。 */
export function isRecruitmentTierImplemented(config, tier) {
    const lines = Array.isArray(tier?.lines) ? tier.lines : [];
    if (!lines.length) return false;
    const units = configuredUnitByKey(config);
    return lines.every((line) => line?.placeholder !== true
        && line?.unitKey && units.has(line.unitKey));
}

export function getRecruitmentTierPlan(config, tierId) {
    return sortedRecruitmentTiers(config).find((tier) => tier.id === tierId) || null;
}

/** 建筑名称与贴图只依赖科研解锁；兵种换代仍由完整开发门槛单独控制。 */
export function getUnlockedRecruitmentTier(config, isTierUnlocked = () => false) {
    const tiers = sortedRecruitmentTiers(config);
    let active = tiers[0] || null;
    for (const tier of tiers.slice(1)) {
        if (tier.id && isTierUnlocked(tier.id)) active = tier;
    }
    return active;
}

export function getActiveRecruitmentTier(config, isTierUnlocked = () => false) {
    const tiers = sortedRecruitmentTiers(config);
    let active = tiers[0] || null;
    for (const tier of tiers.slice(1)) {
        if (!tier.id || !isTierUnlocked(tier.id)) continue;
        if (!isRecruitmentTierImplemented(config, tier)) continue;
        active = tier;
    }
    return active;
}

/**
 * 当前版本在首个完整高阶编制落地前保留既有可玩阵容；一旦高阶科技完成，
 * 同一兵种槽位会切换为该等级的单位，旧等级不再出现在招募按钮中。
 */
export function getRecruitableUnitTypes(config, isTierUnlocked = () => false) {
    const configured = Array.isArray(config?.unitTypes) ? config.unitTypes : [];
    const active = getActiveRecruitmentTier(config, isTierUnlocked);
    const units = configuredUnitByKey(config);
    if (!active) return configured;
    if (Number(active.level) <= 1) {
        const baseline = (active.lines || []).map((line) => units.get(line.unitKey)).filter(Boolean);
        return baseline.length ? baseline : configured;
    }
    return (active.lines || []).map((line) => units.get(line.unitKey)).filter(Boolean);
}

export function resolveRecruitmentUnitType(config, currentUnitType, isTierUnlocked = () => false) {
    const available = getRecruitableUnitTypes(config, isTierUnlocked);
    if (!available.length) return currentUnitType || '';
    if (available.some((unit) => unit.key === currentUnitType)) return currentUnitType;

    const tiers = sortedRecruitmentTiers(config);
    const currentLine = tiers.flatMap((tier) => tier.lines || [])
        .find((line) => line.unitKey === currentUnitType);
    if (currentLine?.slot) {
        const active = getActiveRecruitmentTier(config, isTierUnlocked);
        const replacement = (active?.lines || []).find((line) => line.slot === currentLine.slot);
        if (replacement && available.some((unit) => unit.key === replacement.unitKey)) {
            return replacement.unitKey;
        }
    }
    return available[0].key;
}
