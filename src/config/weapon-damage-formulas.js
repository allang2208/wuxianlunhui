/**
 * WeaponDamageFormulas — 武器伤害最小回退公式
 * 仅在 Player.getCurrentWeaponAtk 不可用时（防御性分支）为无 attackFormula
 * 配置的旧武器提供保底伤害估算。公式系数为硬编码，不含强化/改造/精通加成；
 * 与 attack-formula.js 无重复实现，新武器无需在此登记——正常路径一律走
 * attack-formula.js 的 attackFormula 配置。
 */

export const WEAPON_DAMAGE_FORMULAS = {
    // 机枪 / 步枪
    pkm: (data) => Math.round(5 + data.str * 0.1 + data.stamina * 0.1),
    qbz191: (data) => Math.round(3 + data.str * 0.04 + data.wis * 0.18),
    qjb201: (data) => Math.round(3 + data.str * 0.08 + data.wis * 0.15),
    akm: (data) => Math.round(3 + data.str * 0.05 + data.wis * 0.15),

    // 霰弹枪
    shotgun: (data) => Math.round(1 + data.con * 0.1 + data.wis * 0.2)
};

/**
 * 根据武器攻击键计算回退伤害。
 * @param {string} attackKey
 * @param {Object} data 玩家 data 对象（str/dex/int/con/wis/stamina 等）
 * @returns {number|null}
 */
export function calculateFallbackDamage(attackKey, data) {
    if (!data) return null;
    const formula = WEAPON_DAMAGE_FORMULAS[attackKey];
    return formula ? formula(data) : null;
}
