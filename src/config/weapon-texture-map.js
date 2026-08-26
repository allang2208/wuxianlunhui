
// 武器纹理映射配置
// 统一 Phaser 纹理键与武器数据的映射，避免在 GameScene.js / BootScene.js 中重复硬编码

/**
 * 根据武器数据获取 Phaser 纹理键
 * @param {Object} item - 武器物品数据（需包含 weaponId 和 weaponType）
 * @returns {string} Phaser 纹理键
 */
export function getWeaponTextureKey(item) {
    if (!item) return 'weapon_rusty_sword';
    const { weaponId, weaponType } = item;
    const specialMap = {
        weapon1: 'weapon_rusty_sword',
        weapon2: 'weapon_knights_sword',
        weapon4: 'weapon_rune_sword',
        weapon5: 'weapon_night_flame',
        weapon9: 'weapon_g18',
        weapon10: 'weapon_deagle',
        weapon22: 'weapon_revolver357',
        weapon18: 'weapon_p4040',
        weapon19: 'weapon_beretta93r',
        weapon12: 'weapon_super90',
        weapon13: 'weapon_saiga12k',
    };
    if (specialMap[weaponId]) return specialMap[weaponId];
    if (weaponType) return `weapon_${weaponType}`;
    return 'weapon_rusty_sword';
}

/**
 * 获取所有需要预加载的武器纹理配置
 * 供 BootScene.js 使用
 * @returns {Array<{key: string, path: string}>}
 */
export function getWeaponTextureLoadList() {
    return [
        { key: 'weapon_rusty_sword', path: 'assets/weapons/1-rusty_sword_euip.png' },
        { key: 'weapon_knights_sword', path: 'assets/weapons/knights_sword_ingame_v2.png' },
        { key: 'weapon_rune_sword', path: 'assets/weapons/rune_sword_ingame_v2.png' },
        { key: 'weapon_night_flame', path: 'assets/weapons/night_flame_sword_ingame_v2.png' },
        { key: 'weapon_g18', path: 'assets/icons/G18icon.png' },
        { key: 'weapon_deagle', path: 'assets/icons/DesertEagle_icon.png' },
        { key: 'weapon_revolver357', path: 'assets/weapons/revolver357-equip.png' },
        { key: 'weapon_p4040', path: 'assets/weapons/P4040-icon.png' },
        { key: 'weapon_beretta93r', path: 'assets/weapons/beretta93r.png' },
        { key: 'weapon_pkm', path: 'assets/icons/pkm_side_clean.png' },
        { key: 'weapon_rpd', path: 'assets/weapons/rpd-equip.png' },
        { key: 'weapon_m249', path: 'assets/weapons/m249-equip.png' },
        { key: 'weapon_ultimax100', path: 'assets/weapons/ultimax100-equip.png' },
        { key: 'weapon_mg42', path: 'assets/weapons/mg42-equip.png' },
        { key: 'weapon_fusion_core_lmg', path: 'assets/weapons/fusion-core-lmg-equip.png' },
        { key: 'weapon_singularity_loom_lmg', path: 'assets/weapons/singularity-loom-lmg-equip.png' },
        { key: 'weapon_celestial_cartographer_lmg', path: 'assets/weapons/celestial-cartographer-lmg-equip.png' },
        { key: 'weapon_grave_covenant_cantor_lmg', path: 'assets/weapons/grave-covenant-cantor-lmg-equip.png' },
        { key: 'weapon_akm', path: 'assets/weapons/akm-equip.png' },
        { key: 'weapon_stg44', path: 'assets/weapons/stg44-equip.png' },
        { key: 'weapon_m416', path: 'assets/weapons/m416-equip.png' },
        { key: 'weapon_qbz95', path: 'assets/weapons/qbz95-equip.png' },
        { key: 'weapon_frontier_rifle', path: 'assets/weapons/frontier-rifle-equip.png' },
        { key: 'weapon_vengeance_rifle', path: 'assets/weapons/vengeance-rifle-equip.png' },
        { key: 'weapon_astral_tide_rifle', path: 'assets/weapons/astral-tide-rifle-equip.png' },
        { key: 'weapon_zero_point_rifle', path: 'assets/weapons/zero-point-arbitrator-equip.png' },
        { key: 'weapon_corona_cadence_rifle', path: 'assets/weapons/corona-cadence-rifle-equip.png' },
        { key: 'weapon_terminal_echo_rifle', path: 'assets/weapons/terminal-echo-rifle-equip.png' },
        { key: 'weapon_qbz191', path: 'assets/icons/191icon.png' },
        { key: 'weapon_qjb201', path: 'assets/icons/201-icon.png' },
        { key: 'weapon_energy_lmg', path: 'assets/icons/devotion-icon.png' },
        { key: 'weapon_super90', path: 'assets/icons/M4s90_icon.png' },
        { key: 'weapon_saiga12k', path: 'assets/icons/S12k-icon.png' },
        { key: 'weapon_staff', path: 'assets/weapons/学徒法杖.png' },
        { key: 'weapon_shield', path: 'assets/weapons/woodshied-equip.png' },
    ];
}
