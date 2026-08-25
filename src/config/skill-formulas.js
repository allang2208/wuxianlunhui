/**
 * Combat/UI shared skill math. Keep these functions side-effect free so runtime
 * settlement and the skill detail panel cannot drift apart.
 */
export function getPushStrikeValues(level, strength = 0) {
    const lv = Math.max(1, Number(level) || 1);
    const str = Math.max(0, Number(strength) || 0);
    const baseDamage = 3 + lv * 0.35;
    const strengthRatio = 0.35 + lv * 0.015;
    return Object.freeze({
        level: lv,
        baseDamage,
        strengthRatio,
        damage: Math.round(baseDamage + str * strengthRatio),
        cooldown: 8 - lv * 0.12,
        staminaCost: 18 - lv * 0.2,
        radius: 90 + lv,
        hitArc: Math.PI / 2,
        knockback: 130 + lv * 6,
        stunDuration: 220 + lv * 14,
        animationDuration: 800,
        hitCheckDelay: 400,
        rangeEffectLife: 800,
        rangeEffectAlpha: 0.5,
    });
}

export function getDroneValues(level) {
    const lv = Math.max(1, Number(level) || 1);
    return Object.freeze({
        level: lv,
        duration: 15 + lv,
        cooldown: 20,
        mpCost: 50,
        moveSpeed: 500,
        visionRadius: 900 + lv * 25,
        markRadius: 280 + lv * 6,
        damageBonusPercent: 10 + lv * 2,
        critBonusPercent: 10 + lv,
        markLingerMs: 2000,
    });
}

export function getWhirlwindRadius(effect = {}, weapon = null) {
    const craftRangeDelta = Number(weapon?._craftEffects?.rangeDelta) || 0;
    const swordBonus = Number(effect.swordRadiusBonus) || 0;
    return Math.max(0, (Number(effect.radius) || 0) + swordBonus + craftRangeDelta);
}
