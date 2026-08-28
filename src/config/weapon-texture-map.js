
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
        weapon39: 'weapon_s686',
        weapon40: 'weapon_m870_breacher',
        weapon41: 'weapon_ksg12',
        weapon42: 'weapon_spas12',
        weapon43: 'weapon_aa12',
        weapon44: 'weapon_winchester1887',
        weapon45: 'weapon_terminus_pendulum',
        weapon46: 'weapon_void_funeral_tide',
        weapon47: 'weapon_black_sun_verdict',
        weapon48: 'weapon_royal_hunt_finale',
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
        { key: 'weapon_s686', path: 'assets/weapons/s686-equip.png' },
        { key: 'weapon_m870_breacher', path: 'assets/weapons/m870-breacher-equip.png' },
        { key: 'weapon_ksg12', path: 'assets/weapons/ksg12-equip.png' },
        { key: 'weapon_spas12', path: 'assets/weapons/spas12-equip.png' },
        { key: 'weapon_aa12', path: 'assets/weapons/aa12-equip.png' },
        { key: 'weapon_winchester1887', path: 'assets/weapons/winchester1887-equip.png' },
        { key: 'weapon_terminus_pendulum', path: 'assets/weapons/terminus-pendulum-equip.png' },
        { key: 'weapon_void_funeral_tide', path: 'assets/weapons/void-funeral-tide-equip.png' },
        { key: 'weapon_black_sun_verdict', path: 'assets/weapons/black-sun-verdict-equip.png' },
        { key: 'weapon_royal_hunt_finale', path: 'assets/weapons/royal-hunt-finale-equip.png' },
        { key: 'weapon_staff', path: 'assets/weapons/学徒法杖.png' },
        { key: 'weapon_shield', path: 'assets/weapons/woodshied-equip.png' },
    ].map(({ key, path }) => ({
        key,
        // 原始高分辨率美术继续供资产编辑与 DOM 使用；Phaser 只上传 512px 运行时副本。
        path: `assets/weapons/runtime/${path.slice('assets/'.length)}`,
    }));
}
