// Gun ammo configuration
export const GUN_AMMO_CAP = {
    weapon9:  { max: 12, reloadTime: 1000 },   // G18
    weapon10: { max: 6,  reloadTime: 1750 },   // Desert Eagle
    weapon6:  { max: 75, reloadTime: 3500 },   // PKM
    weapon7:  { max: 30, reloadTime: 1150 },  // AKM
    weapon8:  { max: 30, reloadTime: 1000 },  // QBZ-191
    weapon11: { max: 60, reloadTime: 2000 },  // QJB-201
    weapon12: { max: 7,  reloadTime: 400 },   // Super90 (单发装填，每发400ms)
    weapon13: { max: 12, reloadTime: 2000 },  // SAIGA-12K (正常弹夹换弹)
};

export function isGunWeapon(item) {
    if (!item) return false;
    return item.weaponType === 'pistol' || item.weaponType === 'pkm' || item.weaponType === 'akm' || item.weaponType === 'qbz191' || item.weaponType === 'qjb201' || item.weaponType === 'shotgun';
}

export function isCraftableWeapon(item) {
    if (!item) return false;
    return isGunWeapon(item) || item.weaponType === 'sword' || item.category === 'weapon_melee';
}

// 武器大类合集
export const WEAPON_CATEGORIES = {
    machineGun: ['pkm', 'qjb201'],
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

// ===== 射击模式分类 =====
export const FIRE_MODES = {
    semiAuto: ['weapon10', 'weapon12'], // 半自动：沙漠之鹰、Super90
    fullAuto: ['weapon6', 'weapon7', 'weapon8', 'weapon9', 'weapon11', 'weapon13'], // 全自动：PKM、AKM、QBZ-191、G18、QJB-201、SAIGA-12K
};

export const isSemiAuto = (weaponId) => FIRE_MODES.semiAuto.includes(weaponId);
export const isFullAuto = (weaponId) => FIRE_MODES.fullAuto.includes(weaponId);

// ===== 单手/双手武器分类（双持系统使用） =====
// 单手武器：可以双持，也可以装备到副手槽
export const ONE_HANDED_WEAPONS = ['pistol'];
// 双手武器：不可双持，只能装备到主手槽（weapon/weapon2）
export const TWO_HANDED_WEAPONS = ['pkm', 'akm', 'qbz191', 'qjb201', 'shotgun'];

export const isOneHanded = (weaponType) => ONE_HANDED_WEAPONS.includes(weaponType);
export const isTwoHanded = (weaponType) => TWO_HANDED_WEAPONS.includes(weaponType);

export function getGunAmmoCapacity(weaponId) {
    return GUN_AMMO_CAP[weaponId] || null;
}
