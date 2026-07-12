// Gun ammo configuration
export const GUN_AMMO_CAP = {
    weapon9:  { max: 12, reloadTime: 1000 },
    weapon10: { max: 6,  reloadTime: 1750 },
    weapon6:  { max: 75, reloadTime: 3500 },
    weapon7:  { max: 30, reloadTime: 1150 },
    weapon8:  { max: 30, reloadTime: 1000 },
    weapon11: { max: 60, reloadTime: 2000 },
    weapon12: { max: 7,  reloadTime: 400 },
    weapon13: { max: 12, reloadTime: 2000 },
    weapon15: { max: Infinity, reloadTime: 0 },
};

export function isGunWeapon(item) {
    if (!item) return false;
    return !!item.ammoConfig;
}

export function isCraftableWeapon(item) {
    if (!item) return false;
    return item.category === 'weapon_ranged' || item.category === 'weapon_melee' || item.category === 'weapon_shield';
}

// 武器大类合集（已弃用：优先使用 item.isTwoHanded / item.ammoConfig / item.fireMode 判断）
export const WEAPON_CATEGORIES = {
    machineGun: ['pkm', 'qjb201', 'energy_lmg'],
    rifle: ['akm', 'qbz191'],
    pistol: ['pistol'],
    shotgun: ['shotgun'],
    sword: ['sword'],
};

export const isMachineGun = (weaponType) => WEAPON_CATEGORIES.machineGun.includes(weaponType);
export const isRifle = (weaponType) => WEAPON_CATEGORIES.rifle.includes(weaponType);
export const isPistolCategory = (weaponType) => WEAPON_CATEGORIES.pistol.includes(weaponType);
export const isShotgunCategory = (weaponType) => WEAPON_CATEGORIES.shotgun.includes(weaponType);
export const isSwordCategory = (weaponType) => WEAPON_CATEGORIES.sword.includes(weaponType);

// ===== 射击模式分类（已弃用：优先使用 item.fireMode） =====
export const FIRE_MODES = {
    semiAuto: ['weapon10', 'weapon12'],
    fullAuto: ['weapon6', 'weapon7', 'weapon8', 'weapon9', 'weapon11', 'weapon13', 'weapon15'],
};

export const isSemiAuto = (weaponId) => FIRE_MODES.semiAuto.includes(weaponId);
export const isFullAuto = (weaponId) => FIRE_MODES.fullAuto.includes(weaponId);
// 新接口：从 item 读取 fireMode
export const getFireMode = (item) => {
    if (!item) return null;
    if (item.fireMode) return item.fireMode;
    // 回退到旧版硬编码
    if (isSemiAuto(item.weaponId)) return 'semiAuto';
    if (isFullAuto(item.weaponId)) return 'fullAuto';
    if (item.weaponType === 'bow') return 'charge';
    return 'fullAuto';
};

// ===== 单手/双手武器分类（已弃用：优先使用 item.isTwoHanded） =====
// 单手武器：可以双持，也可以装备到副手槽
export const ONE_HANDED_WEAPONS = ['pistol', 'shield'];
// 双手武器：不可双持，只能装备到主手槽（weapon/weapon2）
export const TWO_HANDED_WEAPONS = ['pkm', 'akm', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

export const isOneHanded = (arg) => {
    if (typeof arg === 'string') return ONE_HANDED_WEAPONS.includes(arg); // 旧接口兼容
    if (!arg) return false;
    if (typeof arg.isTwoHanded === 'boolean') return !arg.isTwoHanded;
    if (arg.weaponType) return ONE_HANDED_WEAPONS.includes(arg.weaponType);
    return false;
};
export const isTwoHanded = (arg) => {
    if (typeof arg === 'string') return TWO_HANDED_WEAPONS.includes(arg); // 旧接口兼容
    if (!arg) return false;
    if (typeof arg.isTwoHanded === 'boolean') return arg.isTwoHanded;
    if (arg.weaponType) return TWO_HANDED_WEAPONS.includes(arg.weaponType);
    return false;
};

export function getGunAmmoCapacity(weaponId) {
    return GUN_AMMO_CAP[weaponId] || null;
}
// 新接口：从 item 读取 ammoConfig
export const getAmmoConfig = (item) => {
    if (!item) return null;
    return item.ammoConfig || getGunAmmoCapacity(item.weaponId) || null;
};
