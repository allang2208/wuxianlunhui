// Gun ammo configuration
import { EquipDataManager, findWeaponConfig } from '../ui/equip-data-manager.js';

function _allCanonicalWeapons() {
    const result = [];
    const add = (value) => {
        if (value && typeof value === 'object' && value.weaponId) result.push(value);
    };
    for (const value of Object.values(EquipDataManager)) {
        add(value);
        if (value && typeof value === 'object' && !value.weaponId) {
            for (const nested of Object.values(value)) add(nested);
        }
    }
    return result;
}

const CANONICAL_WEAPONS = _allCanonicalWeapons();

// 保留旧导出名供既有调用方使用，但内容直接由 EquipDataManager 派生，不再维护第二张弹匣表。
export const GUN_AMMO_CAP = Object.freeze(Object.fromEntries(
    CANONICAL_WEAPONS
        .filter((weapon) => weapon.ammoConfig)
        .map((weapon) => [weapon.weaponId, weapon.ammoConfig])
));

// 枪械射速唯一口径：运行时、主副手、准星/散布与 tooltip 都必须调用同一解析器。
// 40ms（25发/秒）是硬下限，防止旧配置中的大额负增量生成负冷却并退化为逐帧开火。
export const MIN_GUN_ATTACK_INTERVAL = 40;
export function resolveGunAttackInterval(item, baseInterval = null) {
    const base = Number(baseInterval ?? item?.attack?.attackInterval);
    if (!Number.isFinite(base) || base <= 0) return MIN_GUN_ATTACK_INTERVAL;
    const enchantMul = Number(item?._enchantEffects?.attackIntervalMul) || 1;
    const craftDelta = Number(item?._craftEffects?.attackIntervalDelta) || 0;
    return Math.max(MIN_GUN_ATTACK_INTERVAL, Math.round(base * enchantMul + craftDelta));
}

export function isGunWeapon(item) {
    if (!item) return false;
    const canonical = findWeaponConfig(item.weaponId, item.name);
    return !!item.ammoConfig || !!canonical?.ammoConfig ||
        GUN_WEAPON_TYPES.includes(item.weaponType) || item.rangedType === 'pistol';
}

// 枪械 weaponType 合集（isGunWeapon 的第三级判定）
const GUN_WEAPON_TYPES = ['pistol', 'pkm', 'rpd', 'm249', 'ultimax100', 'mg42', 'fusion_core_lmg', 'singularity_loom_lmg', 'celestial_cartographer_lmg', 'grave_covenant_cantor_lmg', 'akm', 'stg44', 'm416', 'qbz95', 'frontier_rifle', 'vengeance_rifle', 'astral_tide_rifle', 'zero_point_rifle', 'corona_cadence_rifle', 'terminal_echo_rifle', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

export function isCraftableWeapon(item) {
    if (!item) return false;
    return item.category === 'weapon_ranged' || item.category === 'weapon_melee' || item.category === 'weapon_shield';
}

// 武器大类合集（已弃用：优先使用 item.isTwoHanded / item.ammoConfig / item.fireMode 判断）
export const WEAPON_CATEGORIES = {
    machineGun: ['pkm', 'rpd', 'm249', 'ultimax100', 'mg42', 'fusion_core_lmg', 'singularity_loom_lmg', 'celestial_cartographer_lmg', 'grave_covenant_cantor_lmg', 'qjb201', 'energy_lmg'],
    rifle: ['akm', 'stg44', 'm416', 'qbz95', 'frontier_rifle', 'vengeance_rifle', 'astral_tide_rifle', 'zero_point_rifle', 'corona_cadence_rifle', 'terminal_echo_rifle', 'qbz191'],
    pistol: ['pistol'],
    shotgun: ['shotgun'],
    sword: ['sword'],
};

export const isMachineGun = (weaponType) => WEAPON_CATEGORIES.machineGun.includes(weaponType);
export const isRifle = (weaponType) => WEAPON_CATEGORIES.rifle.includes(weaponType);
export const isPistolCategory = (weaponType) => WEAPON_CATEGORIES.pistol.includes(weaponType);
export const isShotgunCategory = (weaponType) => WEAPON_CATEGORIES.shotgun.includes(weaponType);
export const isSwordCategory = (weaponType) => WEAPON_CATEGORIES.sword.includes(weaponType);

// ===== 射击模式分类（兼容旧接口；内容由权威武器定义派生） =====
export const FIRE_MODES = Object.freeze({
    semiAuto: CANONICAL_WEAPONS.filter((weapon) => weapon.fireMode === 'semiAuto').map((weapon) => weapon.weaponId),
    fullAuto: CANONICAL_WEAPONS.filter((weapon) => weapon.fireMode === 'fullAuto').map((weapon) => weapon.weaponId),
});

export const isSemiAuto = (weaponId) => FIRE_MODES.semiAuto.includes(weaponId);
export const isFullAuto = (weaponId) => FIRE_MODES.fullAuto.includes(weaponId);
// 新接口：从 item 读取 fireMode（全自动板机改造 fireModeOverride 最优先）
export const getFireMode = (item) => {
    if (!item) return null;
    if (item._craftEffects && item._craftEffects.fireModeOverride) return item._craftEffects.fireModeOverride;
    if (item.fireMode) return item.fireMode;
    const canonical = findWeaponConfig(item.weaponId, item.name);
    if (canonical?.fireMode) return canonical.fireMode;
    // 兼容没有权威条目的第三方/旧模组实例
    if (isSemiAuto(item.weaponId)) return 'semiAuto';
    if (isFullAuto(item.weaponId)) return 'fullAuto';
    if (item.weaponType === 'bow') return 'charge';
    return 'fullAuto';
};

// ===== 单手/双手武器分类（已弃用：优先使用 item.isTwoHanded） =====
// 单手武器：可以双持，也可以装备到副手槽
export const ONE_HANDED_WEAPONS = ['pistol', 'shield'];
// 双手武器：不可双持，只能装备到主手槽（weapon/weapon2）
export const TWO_HANDED_WEAPONS = ['pkm', 'rpd', 'm249', 'ultimax100', 'mg42', 'fusion_core_lmg', 'singularity_loom_lmg', 'celestial_cartographer_lmg', 'grave_covenant_cantor_lmg', 'akm', 'stg44', 'm416', 'qbz95', 'frontier_rifle', 'vengeance_rifle', 'astral_tide_rifle', 'zero_point_rifle', 'corona_cadence_rifle', 'terminal_echo_rifle', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

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
    const fallback = getGunAmmoCapacity(item.weaponId);
    if (item.ammoConfig) {
        // 实例 ammoConfig 经 JSON 克隆后 Infinity 会变 null（如能量轻机枪 max: Infinity → null），
        // max 缺失时回退 GUN_AMMO_CAP 默认值，其余字段保持实例优先
        if (item.ammoConfig.max == null && fallback) {
            return { ...fallback, ...item.ammoConfig, max: fallback.max };
        }
        return item.ammoConfig;
    }
    return fallback || null;
};

// 装备音效回退表（与 GUN_AMMO_CAP 同模式：实例缺 equipSound 时按 weaponId 回退）
export const GUN_EQUIP_SOUND = {
    weapon12: 'assets/sounds/weapons/bolt_pull_1s_clean.wav', // Super90 枪栓音效
    weapon21: 'assets/sounds/weapons/m416_equip.wav', // M416 装备音效
    weapon22: 'assets/sounds/weapons/revolver357_equip.wav', // .357麦格农左轮装备音效
    weapon23: 'assets/sounds/weapons/stg44_equip.wav', // STG-44 装备音效
    weapon24: 'assets/sounds/weapons/qbz95_equip.wav', // QBZ-95 装备音效
    weapon25: 'assets/sounds/weapons/m416_equip.wav', // 边境突击步枪（临时占位）
    weapon26: 'assets/sounds/weapons/qbz95_equip.wav', // 复仇之神（临时占位）
    weapon27: 'assets/sounds/weapons/m416_equip.wav', // 星潮协议（临时占位）
    weapon28: 'assets/sounds/weapons/qbz95_equip.wav', // 零点仲裁（临时占位）
    weapon29: 'assets/sounds/weapons/m416_equip.wav', // 日冕裁律（临时占位）
    weapon30: 'assets/sounds/weapons/m416_equip.wav', // 终末回声（临时占位）
};
export const getEquipSound = (item) => {
    if (!item) return null;
    return item.equipSound || GUN_EQUIP_SOUND[item.weaponId] || null;
};

// 开火音效回退表（weaponType → 默认开火音）：实例缺 fireSound 时按类型回退。
// 正常枪械在 EDM/shop 数据里都配了 fireSound（含敌人 config.sounds.fire），
// 此表仅作兜底，避免 attack.js 逐枪硬编码 else-if（新枪无需改攻击代码）。
export const GUN_FIRE_SOUND = {
    pistol: 'assets/sounds/weapons/akm_burst.mp3',
    deagle: 'assets/sounds/weapons/cs_deagle_35_80.wav',
    revolver: 'assets/sounds/weapons/revolver357_fire.mp3',
    p4040: 'assets/sounds/weapons/apex2_shot_1s.wav',
    beretta93r: 'assets/sounds/weapons/beretta93r_fire.mp3',
    pkm: 'assets/sounds/weapons/pkm_half_sec.wav',
    rpd: 'assets/sounds/weapons/rpd_fire.wav',
    m249: 'assets/sounds/weapons/m249_fire.wav',
    ultimax100: 'assets/sounds/weapons/ultimax100_fire.wav',
    mg42: 'assets/sounds/weapons/mg42_fire.wav',
    fusion_core_lmg: 'assets/sounds/weapons/fusion_core_lmg_fire.wav',
    singularity_loom_lmg: 'assets/sounds/weapons/singularity_loom_lmg_fire.wav',
    celestial_cartographer_lmg: 'assets/sounds/weapons/celestial_cartographer_lmg_fire.wav',
    grave_covenant_cantor_lmg: 'assets/sounds/weapons/grave_covenant_cantor_lmg_fire.wav',
    akm: 'assets/sounds/weapons/akm_burst.mp3',
    stg44: 'assets/sounds/weapons/stg44_fire.wav',
    m416: 'assets/sounds/weapons/m416_fire.wav',
    qbz95: 'assets/sounds/weapons/qbz95_fire.wav',
    frontier_rifle: 'assets/sounds/weapons/m416_fire.wav',
    vengeance_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    astral_tide_rifle: 'assets/sounds/weapons/m416_fire.wav',
    zero_point_rifle: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    corona_cadence_rifle: 'assets/sounds/weapons/m416_fire.wav',
    terminal_echo_rifle: 'assets/sounds/weapons/m416_fire.wav',
    qbz191: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    qjb201: 'assets/sounds/weapons/qjb201_single_600ms.wav',
    shotgun: 'assets/sounds/weapons/gunshot_600ms_clean.wav',
    energy_lmg: 'assets/sounds/weapons/akm_burst.mp3',
};
export const getFireSound = (item) => {
    if (!item) return null;
    if (item.fireSound && item.fireSound.startsWith('assets/')) return item.fireSound;
    // 优先 animConfigKey（左轮等独立动画键），再按 weaponType 回退
    return GUN_FIRE_SOUND[item.animConfigKey] || GUN_FIRE_SOUND[item.weaponType] || null;
};
