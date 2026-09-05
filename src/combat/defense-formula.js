/** 复用原 DamageableEntity 防御公式，玩家与其他实体只结算一次。 */
export function applyDefenseToDamage(damage, source, target, damageType = 'physical', hitContext = null) {
    if (!source?.data || !target?.data) return damage;
    const magic = damageType === 'magic' || damageType === 'electric';
    const atk = damage > 0 ? damage : (magic ? source.data.matk : source.data.atk) || 0;
    let def = (magic ? target.data.mdef : target.data.def) || 0;
    if (magic) {
        const shred = Math.max(0, Math.min(0.95,
            Number(target.getMagicResistanceShredRatio?.()) || 0));
        def = Math.floor(def * (1 - shred));
    }
    if (magic && hitContext && Number.isFinite(hitContext.magicPenetrationPercent)) {
        def = Math.floor(def * (1 - hitContext.magicPenetrationPercent));
    } else if (source.getCurrentWeapon) {
        const weapon = source.getCurrentWeapon();
        const penetration = weapon?._craftEffects?.[magic ? 'magicPenetrationPercent' : 'armorPenetrationPercent'];
        if (penetration) def = Math.floor(def * (1 - penetration));
    }
    if (!magic) def = Math.max(0, Math.floor(def * (target.getCorrosionDefenseMul?.() ?? 1)));
    if (atk <= 0) return damage;
    // 保持原有取整顺序及10%下限；该下限在盾牌等后续独立乘区之前。
    return Math.max(Math.floor(atk * (1 - def / (def + 60))), Math.floor(atk * 0.1));
}
