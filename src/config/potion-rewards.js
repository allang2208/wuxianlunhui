/**
 * Potion tiers shared by dungeon events and reward delivery.
 * Restricted events use their own configured grade; universal events use the
 * active dungeon grade.
 */

export const POTION_TIER_BY_GRADE = Object.freeze({
    F: 'basic',
    E: 'basic',
    D: 'medium',
    C: 'medium',
    B: 'high',
    A: 'special',
});

export const POTION_REWARD_ITEMS = Object.freeze({
    basic: Object.freeze({
        hp: Object.freeze({ itemId: 'hp_potion', name: '治疗药水' }),
        mp: Object.freeze({ itemId: 'mp_potion', name: '魔力药水' }),
    }),
    medium: Object.freeze({
        hp: Object.freeze({ itemId: 'hp_potion_medium', name: '中级生命药水' }),
        mp: Object.freeze({ itemId: 'mp_potion_medium', name: '中级魔法药水' }),
    }),
    high: Object.freeze({
        hp: Object.freeze({ itemId: 'hp_potion_high', name: '高级生命药水' }),
        mp: Object.freeze({ itemId: 'mp_potion_high', name: '高级魔法药水' }),
    }),
    special: Object.freeze({
        hp: Object.freeze({ itemId: 'hp_potion_special', name: '特级生命药水' }),
        mp: Object.freeze({ itemId: 'mp_potion_special', name: '特级魔法药水' }),
    }),
});

export function getPotionTierForGrade(grade) {
    return POTION_TIER_BY_GRADE[String(grade || '').toUpperCase()] || 'medium';
}
export function createPotionReward(kind, { grade = 'D', tier = null, count = 1 } = {}) {
    const normalizedKind = kind === 'mp' ? 'mp' : 'hp';
    const resolvedTier = POTION_REWARD_ITEMS[tier] ? tier : getPotionTierForGrade(grade);
    const spec = POTION_REWARD_ITEMS[resolvedTier][normalizedKind];
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    return {
        kind: normalizedKind,
        tier: resolvedTier,
        itemId: spec.itemId,
        name: spec.name,
        count: normalizedCount,
    };
}
