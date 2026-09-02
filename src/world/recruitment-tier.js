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

function mergeUniqueUnits(...groups) {
    const merged = [];
    const seen = new Set();
    for (const unit of groups.flat()) {
        if (!unit?.key || seen.has(unit.key)) continue;
        seen.add(unit.key);
        merged.push(unit);
    }
    return merged;
}

/**
 * 独立科技已完成、但所属整级仍因另一条兵种占位而未启用时，允许该单位作为补充选项出现。
 * 一旦所属整级或更高整级正式启用，继续服从正常槽位换代，不永久保留旧兵种。
 */
function getSupplementalUnlockedUnits(config, activeTier, isUnitUnlocked) {
    const rawEntries = Array.isArray(config?.supplementalUnitUnlocks)
        ? config.supplementalUnitUnlocks : [];
    const supplementalEntries = [];
    const seen = new Set();
    for (const rawEntry of rawEntries) {
        const unitKey = typeof rawEntry === 'string' ? rawEntry : rawEntry?.key;
        if (!unitKey || seen.has(unitKey)) continue;
        seen.add(unitKey);
        supplementalEntries.push({
            unitKey,
            untilTierLevel: typeof rawEntry === 'object'
                ? Math.max(0, Number(rawEntry.untilTierLevel) || 0)
                : 0,
        });
    }
    if (!supplementalEntries.length) return [];
    const tiers = sortedRecruitmentTiers(config);
    const units = configuredUnitByKey(config);
    const activeLevel = Math.max(0, Number(activeTier?.level) || 0);
    return supplementalEntries.map(({ unitKey, untilTierLevel }) => {
        if (!isUnitUnlocked(unitKey)) return null;
        const sourceTier = tiers.find((tier) => (tier.lines || [])
            .some((line) => line?.unitKey === unitKey));
        const retirementLevel = untilTierLevel || Math.max(0, Number(sourceTier?.level) || 0);
        if (!retirementLevel || activeLevel >= retirementLevel) return null;
        return units.get(unitKey) || null;
    }).filter(Boolean);
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
export function getRecruitableUnitTypes(
    config,
    isTierUnlocked = () => false,
    isUnitUnlocked = () => false
) {
    const configured = Array.isArray(config?.unitTypes) ? config.unitTypes : [];
    const active = getActiveRecruitmentTier(config, isTierUnlocked);
    const units = configuredUnitByKey(config);
    if (!active) return configured;
    const supplemental = getSupplementalUnlockedUnits(config, active, isUnitUnlocked);
    if (Number(active.level) <= 1) {
        const baseline = (active.lines || []).map((line) => units.get(line.unitKey)).filter(Boolean);
        return mergeUniqueUnits(baseline.length ? baseline : configured, supplemental);
    }
    const tierUnits = (active.lines || []).map((line) => units.get(line.unitKey)).filter(Boolean);
    return mergeUniqueUnits(tierUnits, supplemental);
}

export function resolveRecruitmentUnitType(
    config,
    currentUnitType,
    isTierUnlocked = () => false,
    isUnitUnlocked = () => false
) {
    const available = getRecruitableUnitTypes(config, isTierUnlocked, isUnitUnlocked);
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
