/**
 * 魔法改造效果公共工具
 * 统一读取当前武器改造、计算分类伤害倍率、距离修正、MP/冷却/暴击加成等。
 */

import { getSkillMagicCategory } from '../config/magic-categories.js';
import { getElevatedRangedRangeMultiplier } from '../combat/elevated-ranged.js';

/** 获取 source 当前主手武器的改造聚合效果 */
export function getCurrentWeaponCraftEffects(source) {
    if (!source || !source.equipments) return null;
    const weapon = source.equipments[source.weaponMode];
    return weapon?._craftEffects || null;
}

/** 获取当前武器的杖头元素专精（ice/fire/electric/light），无则返回 null */
export function getStaffSpecialty(source) {
    const ce = getCurrentWeaponCraftEffects(source);
    return ce?.staffSpecialty || null;
}

/**
 * 计算某分类魔法的伤害倍率。
 * 包含：通用魔法伤害加成、分类伤害加成、杖冠对应专精加成。
 * 不包含链式强化（由调用方在触发时消费并传入）。
 */
export function getMagicDamageMultiplier(source, skillId, ce) {
    const category = getSkillMagicCategory(skillId);
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (!ce || !category) return 1;

    let mul = 1;
    if (ce.magicDamagePercent) mul += ce.magicDamagePercent;

    // 分类加成：仅当杖头专精匹配该分类时生效（杖冠“有对应词条才生效”）
    const specialty = ce.staffSpecialty;
    if (specialty === category) {
        if (category === 'ice' && ce.iceDamagePercent) mul += ce.iceDamagePercent;
        if (category === 'fire' && ce.fireDamagePercent) mul += ce.fireDamagePercent;
        if (category === 'electric' && ce.electricDamagePercent) mul += ce.electricDamagePercent;
        if (category === 'light' && ce.lightHealPercent) mul += ce.lightHealPercent;
    }

    return mul;
}

/** 计算含链式强化的伤害倍率（用于一次完整施法） */
export function getMagicDamageMultiplierWithChain(source, skillId, ce, chainStacks = 0) {
    let mul = getMagicDamageMultiplier(source, skillId, ce);
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (chainStacks > 0 && ce?.chainSpellDamagePercent) {
        mul *= 1 + chainStacks * ce.chainSpellDamagePercent;
    }
    return mul;
}

/**
 * 计算治疗类光魔法的倍率（与伤害倍率类似，但只取 lightHealPercent）。
 */
export function getMagicHealMultiplier(source, skillId, ce) {
    const category = getSkillMagicCategory(skillId);
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (!ce || category !== 'light') return 1;

    let mul = 1;
    if (ce.magicDamagePercent) mul += ce.magicDamagePercent;
    const specialty = ce.staffSpecialty;
    if (specialty === 'light' && ce.lightHealPercent) mul += ce.lightHealPercent;
    return mul;
}

/** 计算含链式强化的治疗倍率 */
export function getMagicHealMultiplierWithChain(source, skillId, ce, chainStacks = 0) {
    let mul = getMagicHealMultiplier(source, skillId, ce);
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (chainStacks > 0 && ce?.chainSpellDamagePercent) {
        mul *= 1 + chainStacks * ce.chainSpellDamagePercent;
    }
    return mul;
}

/** 计算施法者到目标的最大射程倍率：武器改造 × 墙顶远程加成。 */
export function getMagicRangeMultiplier(source, ce) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    const craftMultiplier = ce ? 1 + (ce.magicRangePercent || 0) : 1;
    return craftMultiplier * getElevatedRangedRangeMultiplier(source);
}

/** 计算锁定容差、传导和范围半径倍率；墙顶只加最大射程，不扩大技能作用范围。 */
export function getMagicAreaMultiplier(source, ce) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    return ce ? 1 + (ce.magicRangePercent || 0) : 1;
}

/** 计算魔法 MP 消耗倍率（含链式强化已消费层数） */
export function getMagicMpCostMultiplier(source, ce, chainSpellStacks = 0) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    let mul = 1;
    if (ce?.magicMpCostPercent) mul += ce.magicMpCostPercent;
    if (chainSpellStacks > 0 && ce?.chainSpellMpCostPercent) {
        mul += chainSpellStacks * ce.chainSpellMpCostPercent;
    }
    return mul;
}

/** 计算魔法冷却倍率 */
export function getMagicCooldownMultiplier(source, ce) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (!ce) return 1;
    return 1 - (ce.magicCooldownPercent || 0);
}

/** 获取魔法暴击率加成（百分比点数） */
export function getMagicCritBonus(source, ce) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (!ce) return 0;
    return ce.magicCritPercent || 0;
}

/** 获取施法速度倍率（>1 表示更快，前摇/后摇时长除以该值） */
export function getCastSpeedMultiplier(source, ce) {
    ce = ce || getCurrentWeaponCraftEffects(source);
    if (!ce) return 1;
    return 1 + (ce.castSpeedPercent || 0);
}

/**
 * 消费 source 当前的链式强化 buff，返回 { stacks, damageMul, mpCostMul }。
 * 调用后清空 source._chainSpellStacks。
 */
export function consumeChainSpellBonus(source) {
    const stacks = source?._chainSpellStacks || 0;
    if (stacks <= 0) return { stacks: 0, damageMul: 0, mpCostMul: 0 };
    const ce = getCurrentWeaponCraftEffects(source);
    const damageMul = stacks * (ce?.chainSpellDamagePercent || 0.02);
    const mpCostMul = stacks * (ce?.chainSpellMpCostPercent || 0.05);
    source._chainSpellStacks = 0;
    if (source.removeStatusEffect) source.removeStatusEffect('chainSpell');
    return { stacks, damageMul, mpCostMul };
}

/**
 * 施法后给 source 添加檀木握柄的加速 buff（castHasteStacks / castHasteDuration）。
 * 任意魔法施法后调用。
 */
export function applyCastHaste(source) {
    const ce = getCurrentWeaponCraftEffects(source);
    if (!ce || !ce.castHasteStacks || !source || typeof source.applyHaste !== 'function') return;
    for (let i = 0; i < ce.castHasteStacks; i++) {
        source.applyHaste(ce.castHasteDuration || 5000);
    }
}

/**
 * 给 source 添加链式强化层数（松木握柄用）。
 * 层数可叠加，持续时间按来源追加，到期全部清空。
 */
export function addChainSpellStack(source, durationMs = 10000) {
    if (!source) return;
    // 状态免疫期间不获得链式强化：addStatusEffect 会拒绝入库，硬设 _chainSpellStacks
    // 会导致无状态条目驱动到期清理、层数永久滞留
    if (typeof source.hasStatusEffect === 'function' && source.hasStatusEffect('statusImmune')) return;
    const existing = source.statusEffects?.find(e => e.type === 'chainSpell');
    if (existing) {
        existing.stacks += 1;
        existing.remaining += durationMs;
        existing.duration += durationMs;
        source._chainSpellStacks = existing.stacks;
    } else {
        source._chainSpellStacks = 1;
        if (source.addStatusEffect) {
            source.addStatusEffect('chainSpell', durationMs, { stacks: 1, name: '链式强化', icon: '🔗', color: '#8a7a6a' });
        }
    }
}
