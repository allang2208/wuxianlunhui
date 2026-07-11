
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
        weapon18: 'weapon_p4040',
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
        { key: 'weapon_knights_sword', path: 'assets/weapons/knights_sword_v3_equip.png' },
        { key: 'weapon_rune_sword', path: 'assets/weapons/EXsword_equipped_v2_.png' },
        { key: 'weapon_night_flame', path: 'assets/weapons/Nightandflame_equip.png' },
        { key: 'weapon_g18', path: 'assets/icons/G18icon.png' },
        { key: 'weapon_deagle', path: 'assets/icons/DesertEagle_icon.png' },
        { key: 'weapon_p4040', path: 'assets/weapons/P4040-icon.png' },
        { key: 'weapon_pkm', path: 'assets/icons/pkm_side_clean.png' },
        { key: 'weapon_akm', path: 'assets/weapons/AKm.png' },
        { key: 'weapon_qbz191', path: 'assets/icons/191icon.png' },
        { key: 'weapon_qjb201', path: 'assets/icons/201-icon.png' },
        { key: 'weapon_energy_lmg', path: 'assets/icons/devotion-icon.png' },
        { key: 'weapon_super90', path: 'assets/icons/M4s90_icon.png' },
        { key: 'weapon_saiga12k', path: 'assets/icons/S12k-icon.png' },
        { key: 'weapon_shield', path: 'assets/weapons/woodshied-equip.png' },
    ];
}
