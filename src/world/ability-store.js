// ============================================================
// 铁匠铺特殊能力全局等级（2026-08-17）
// 铁匠铺升级的是"特殊能力"（毒箭/自动防御/横扫 AOE），等级全局生效：
// 任意铁匠铺升级后，场上所有对应兵种单位实时获得该能力（新生成单位同样生效）。
// 独立文件避免 producer-building-system 与兵种 AI 的循环依赖。
// ============================================================

/** 全局能力等级：{ [abilityId]: level } */
export const GLOBAL_ABILITY_LEVELS = {};

/** 新游戏重置：保持导出对象引用不变。 */
export function resetAbilityLevels() {
    for (const key of Object.keys(GLOBAL_ABILITY_LEVELS)) delete GLOBAL_ABILITY_LEVELS[key];
}

/** 存档用纯数据快照。 */
export function serializeAbilityLevels() {
    return { ...GLOBAL_ABILITY_LEVELS };
}

/** 读档恢复；只接受非负有限整数等级。 */
export function restoreAbilityLevels(data) {
    resetAbilityLevels();
    if (!data || typeof data !== 'object') return;
    for (const [abilityId, rawLevel] of Object.entries(data)) {
        const level = Math.max(0, Math.floor(Number(rawLevel) || 0));
        if (level > 0) GLOBAL_ABILITY_LEVELS[abilityId] = level;
    }
}

/** 当前能力全局等级 */
export function getAbilityLevel(abilityId) {
    if (!abilityId) return 0;
    return GLOBAL_ABILITY_LEVELS[abilityId] || 0;
}

/** 能力等级 +1，返回新等级 */
export function raiseAbilityLevel(abilityId) {
    if (!abilityId) return 0;
    GLOBAL_ABILITY_LEVELS[abilityId] = (GLOBAL_ABILITY_LEVELS[abilityId] || 0) + 1;
    return GLOBAL_ABILITY_LEVELS[abilityId];
}

/**
 * 按配置计算当前等级下的能力数值。
 * - 普通能力：base + per × level
 * - 带 firstLevel：Lv0=0，Lv1=firstLevel，之后每级 +per
 */
export function getAbilityValue(abilityCfg, level) {
    if (!abilityCfg) return 0;
    const lv = Math.max(0, level ?? getAbilityLevel(abilityCfg.id));
    if (abilityCfg.firstLevel !== undefined) {
        return lv <= 0 ? 0 : abilityCfg.firstLevel + (abilityCfg.per ?? 0) * (lv - 1);
    }
    return (abilityCfg.base ?? 0) + (abilityCfg.per ?? 0) * lv;
}
