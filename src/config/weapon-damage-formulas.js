/**
 * WeaponDamageFormulas — 武器伤害回退公式配置
 * 将 subsystems.js 中根据武器类型硬编码的伤害公式集中管理。
 * 当 getCurrentWeaponAtk 不可用时使用这些回退公式。
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
