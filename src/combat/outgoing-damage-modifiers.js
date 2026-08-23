/**
 * 攻击来源侧的最终伤害倍率统一入口。
 * 当前只消费骆驼惊吓；保持纯计算，供玩家、侍从和 DamageableEntity 三条受击链共用。
 */
export function getOutgoingDamageMultiplier(source) {
    if (!source || source._faction !== 'enemy' || typeof source.hasStatusEffect !== 'function') return 1;
    if (!source.hasStatusEffect('camelFright')) return 1;
    const effect = source.statusEffects?.find((entry) => (
        entry?.type === 'camelFright' && entry.remaining > 0
    ));
    const reduction = Math.max(0, Math.min(0.9, Number(effect?.value) || 0));
    return 1 - reduction;
}

export function applyOutgoingDamageModifiers(damage, source) {
    const amount = Math.max(0, Number(damage) || 0);
    if (!(amount > 0)) return 0;
    const multiplier = getOutgoingDamageMultiplier(source);
    if (multiplier >= 1) return amount;
    return Math.max(1, Math.floor(amount * multiplier));
}
