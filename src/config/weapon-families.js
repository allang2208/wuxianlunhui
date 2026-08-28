// 武器族（weaponType 分组）常量 — 集中维护，消除 GameScene / weapon-transform 等处散落的重复类型数组
// 注意：与 config/gun-ammo.js 的 GUN_WEAPON_TYPES 口径不同（后者不含 deagle/revolver/p4040/beretta93r，
// 服务于弹药判定），二者语义不同，勿混用

// 手枪族：变换配置 / 后坐力参数 / 尺寸公式完全同构
export const PISTOL_FAMILY = ['pistol', 'p4040', 'deagle', 'revolver', 'beretta93r', 'm1911a1', 'usp45', 'fiveSeven', 'eternalEdict', 'falconEdict', 'crimsonCrownSettlement', 'myriadCorridor'];

// 自动枪械族（机枪/步枪）：变换配置同构，后坐力参数同口径（霰弹枪后坐力口径不同，单列）
export const AUTO_GUN_FAMILY = ['pkm', 'rpd', 'm249', 'ultimax100', 'mg42', 'fusion_core_lmg', 'singularity_loom_lmg', 'celestial_cartographer_lmg', 'grave_covenant_cantor_lmg', 'akm', 'stg44', 'm416', 'qbz95', 'frontier_rifle', 'vengeance_rifle', 'astral_tide_rifle', 'zero_point_rifle', 'corona_cadence_rifle', 'terminal_echo_rifle', 'qbz191', 'qjb201', 'energy_lmg'];

// 机枪族（含霰弹枪）：WEAPON_TRANSFORM_CONFIG 逐字段同构
export const MACHINE_GUN_FAMILY = [...AUTO_GUN_FAMILY, 'shotgun'];

// 全部枪械：GameScene 渲染分支 isGun 判定（setScale/flipY/握把锚点）用
export const GUN_FAMILY = [...PISTOL_FAMILY, ...MACHINE_GUN_FAMILY];
