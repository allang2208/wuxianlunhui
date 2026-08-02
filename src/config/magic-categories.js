/**
 * 魔法分类体系
 * 把 skillId 映射到冰/火/电/光四大类，供改造效果、伤害结算、UI 提示统一使用。
 * MAGIC_SKILL_TIERS 为魔法等级体系（初级/中级/高级）：中级及以上魔法有装备门槛
 * （中级魔法需装备法杖才能释放，见 meetsMagicWeaponReq）。
 */

export const MAGIC_CATEGORIES = {
    ice:      { key: 'ice',      name: '冰魔法', skills: ['iceSpike', 'iceWall'] },
    fire:     { key: 'fire',     name: '火魔法', skills: ['fireball'] },
    electric: { key: 'electric', name: '电魔法', skills: ['lightningStrike'] },
    light:    { key: 'light',    name: '光魔法', skills: ['holyLight'] },
};

/** 魔法等级：1=初级 2=中级 3=高级（未登记的默认初级） */
export const MAGIC_SKILL_TIERS = {
    iceSpike: 1,
    fireball: 1,
    lightningStrike: 1,
    holyLight: 1,
    iceWall: 2,
};

export const MAGIC_TIER_NAMES = { 1: '初级魔法', 2: '中级魔法', 3: '高级魔法' };

/** 根据 skillId 获取魔法分类键（ice/fire/electric/light），未分类返回 null */
export function getSkillMagicCategory(skillId) {
    for (const cat of Object.values(MAGIC_CATEGORIES)) {
        if (cat.skills.includes(skillId)) return cat.key;
    }
    return null;
}

/** 根据分类键获取分类配置 */
export function getMagicCategory(key) {
    return MAGIC_CATEGORIES[key] || null;
}

/** 判断某 skillId 是否属于指定分类 */
export function isMagicCategory(skillId, categoryKey) {
    return getSkillMagicCategory(skillId) === categoryKey;
}

/** 获取技能的魔法等级（未登记默认 1 初级） */
export function getSkillMagicTier(skillId) {
    return MAGIC_SKILL_TIERS[skillId] || 1;
}

/**
 * 魔法释放装备门槛：中级及以上魔法需要装备法杖（当前武器组主手/副手其一）。
 * 返回 { ok, reason } — ok=false 时 reason 为玩家提示文案。
 */
export function meetsMagicWeaponReq(player, skillId) {
    const tier = getSkillMagicTier(skillId);
    if (tier < 2) return { ok: true, reason: '' };
    if (!player || !player.equipments) return { ok: false, reason: `${MAGIC_TIER_NAMES[tier] || '中级魔法'}需要装备法杖才能释放` };
    const currentWeapon = player.equipments[player.weaponMode];
    const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
    const offhandWeapon = player.equipments[offhandSlot];
    const isStaff = (w) => !!(w && w.weaponType === 'staff');
    if (isStaff(currentWeapon) || isStaff(offhandWeapon)) return { ok: true, reason: '' };
    return { ok: false, reason: `${MAGIC_TIER_NAMES[tier] || '中级魔法'}需要装备法杖才能释放` };
}
