/**
 * 装备改造栏自动排布的稳定输入。
 *
 * anchor 坐标基于武器有效 Alpha 包围盒，而不是整张 PNG；生成器会再把它换算到
 * 340x600 的 object-fit:contain 面板坐标。这里仅描述装备结构，不保存任何用户布局。
 */
export const CRAFT_LAYOUT_PANEL = Object.freeze({
    width: 340,
    height: 600,
    cellSize: 48,
    railLeft: 0.085,
    railRight: 0.915,
    minY: 0.075,
    maxY: 0.925,
    minCellGap: 0.105,
});

const FIREARM_ANCHORS = Object.freeze({
    muzzle: [0.965, 0.40],
    barrel: [0.76, 0.40],
    sight: [0.58, 0.22],
    chamber: [0.61, 0.43],
    receiver: [0.55, 0.43],
    bullet: [0.64, 0.47],
    magazine: [0.50, 0.68],
    grip: [0.40, 0.69],
    trigger: [0.51, 0.57],
    stock: [0.12, 0.46],
    core: [0.57, 0.44],
    prism: [0.69, 0.35],
    lock: [0.55, 0.46],
});

const FIREARM_SIDES = Object.freeze({
    muzzle: 'left',
    barrel: 'left',
    sight: 'left',
    chamber: 'left',
    receiver: 'left',
    prism: 'left',
    lock: 'left',
    bullet: 'right',
    magazine: 'right',
    grip: 'right',
    trigger: 'right',
    stock: 'right',
    core: 'right',
});

function firearmProfile(overrides = {}) {
    return Object.freeze({
        anchors: Object.freeze({ ...FIREARM_ANCHORS, ...(overrides.anchors || {}) }),
        preferredSides: Object.freeze({ ...FIREARM_SIDES, ...(overrides.preferredSides || {}) }),
        confidenceCap: overrides.confidenceCap || 1,
    });
}

export const CRAFT_LAYOUT_PROFILES = Object.freeze({
    pistol_standard: firearmProfile({
        anchors: {
            muzzle: [0.96, 0.33], barrel: [0.77, 0.34], sight: [0.58, 0.19],
            chamber: [0.60, 0.39], bullet: [0.67, 0.42], magazine: [0.47, 0.70],
            grip: [0.39, 0.72], trigger: [0.52, 0.55], core: [0.58, 0.42],
        },
    }),
    pistol_revolver: firearmProfile({
        anchors: {
            muzzle: [0.96, 0.36], barrel: [0.76, 0.36], sight: [0.60, 0.20],
            chamber: [0.59, 0.45], bullet: [0.60, 0.46], magazine: [0.58, 0.46],
            grip: [0.36, 0.74], trigger: [0.49, 0.59], core: [0.58, 0.45],
        },
    }),
    rifle_standard: firearmProfile(),
    rifle_bullpup: firearmProfile({
        anchors: {
            magazine: [0.31, 0.64], grip: [0.49, 0.68], trigger: [0.55, 0.55],
            stock: [0.11, 0.48], chamber: [0.43, 0.44], receiver: [0.43, 0.44],
        },
    }),
    lmg_box: firearmProfile({
        anchors: {
            barrel: [0.72, 0.39], magazine: [0.45, 0.70], grip: [0.35, 0.67],
            stock: [0.10, 0.45], core: [0.50, 0.44],
        },
    }),
    shotgun_pump: firearmProfile({
        anchors: {
            barrel: [0.72, 0.39], magazine: [0.58, 0.45], grip: [0.40, 0.66],
            stock: [0.12, 0.46], sight: [0.57, 0.24], bullet: [0.63, 0.45],
        },
    }),
    shotgun_break: firearmProfile({
        anchors: {
            barrel: [0.70, 0.39], chamber: [0.45, 0.44], magazine: [0.45, 0.44],
            grip: [0.35, 0.64], stock: [0.11, 0.46], bullet: [0.54, 0.44],
        },
    }),
    shotgun_bullpup: firearmProfile({
        anchors: {
            barrel: [0.76, 0.39], magazine: [0.31, 0.57], grip: [0.51, 0.66],
            stock: [0.12, 0.47], sight: [0.55, 0.22], bullet: [0.49, 0.44],
        },
    }),
    sword_vertical: Object.freeze({
        anchors: Object.freeze({
            blade: [0.50, 0.12], blade_body_1: [0.50, 0.31], blade_body_2: [0.50, 0.47],
            guard: [0.50, 0.66], grip: [0.50, 0.80], pommel: [0.50, 0.93],
        }),
        preferredSides: Object.freeze({ blade: 'left', guard: 'left', grip: 'left', blade_body_1: 'right', blade_body_2: 'right', pommel: 'right' }),
        confidenceCap: 0.96,
    }),
    staff_vertical: Object.freeze({
        anchors: Object.freeze({
            head_crystal: [0.50, 0.10], crown: [0.50, 0.20], mana_line: [0.50, 0.38],
            shaft_rune: [0.50, 0.52], grip_lining: [0.50, 0.72], tail_charm: [0.50, 0.91],
        }),
        preferredSides: Object.freeze({ head_crystal: 'left', crown: 'left', shaft_rune: 'left', mana_line: 'right', grip_lining: 'right', tail_charm: 'right' }),
        confidenceCap: 0.96,
    }),
    shield_round: Object.freeze({
        anchors: Object.freeze({
            face: [0.50, 0.30], core: [0.50, 0.36],
            boss: [0.63, 0.52], boss_rim: [0.50, 0.45], rim: [0.50, 0.78],
            grip: [0.58, 0.50], straps: [0.42, 0.46],
        }),
        preferredSides: Object.freeze({
            face: 'left', core: 'left', boss: 'left', boss_rim: 'left', rim: 'left',
            grip: 'right', straps: 'right',
        }),
        confidenceCap: 0.90,
    }),
    shield_tower: Object.freeze({
        anchors: Object.freeze({
            face: [0.50, 0.28], rim_spine: [0.54, 0.72], harness: [0.61, 0.44],
        }),
        preferredSides: Object.freeze({ face: 'left', rim_spine: 'left', harness: 'right' }),
        confidenceCap: 0.88,
    }),
});

export const CRAFT_LAYOUT_PROFILE_BY_WEAPON_ID = Object.freeze({
    weapon2: 'sword_vertical', weapon4: 'sword_vertical', weapon5: 'sword_vertical',
    weapon6: 'lmg_box', weapon11: 'lmg_box', weapon15: 'lmg_box',
    weapon20: 'staff_vertical', weapon22: 'pistol_revolver', weapon24: 'rifle_bullpup',
    weapon31: 'lmg_box', weapon32: 'lmg_box', weapon33: 'lmg_box', weapon34: 'lmg_box',
    weapon35: 'lmg_box', weapon36: 'lmg_box', weapon37: 'lmg_box', weapon38: 'lmg_box',
    weapon39: 'shotgun_break', weapon40: 'shotgun_pump', weapon41: 'shotgun_bullpup',
    weapon42: 'shotgun_pump', weapon43: 'shotgun_pump', weapon44: 'shotgun_break',
    weapon45: 'shotgun_pump', weapon46: 'shotgun_pump', weapon47: 'shotgun_pump', weapon48: 'shotgun_pump',
    weapon56: 'shield_round', weapon57: 'shield_round', weapon58: 'shield_round', weapon59: 'shield_tower',
    weapon60: 'shield_tower', weapon61: 'shield_round', weapon62: 'shield_tower', weapon63: 'shield_round',
    weapon64: 'shield_tower', weapon65: 'shield_tower',
});

/** 新装备/异形装备先生成 B 级候选，必须在面板中人工看一眼再保存。 */
export const CRAFT_LAYOUT_REVIEW_WEAPONS = Object.freeze(new Set([
    'weapon33', 'weapon34', 'weapon35', 'weapon36', 'weapon37', 'weapon38',
    'weapon45', 'weapon46', 'weapon47', 'weapon48', 'weapon52', 'weapon53', 'weapon54', 'weapon55',
    'weapon56', 'weapon57', 'weapon58', 'weapon59', 'weapon60', 'weapon61', 'weapon62', 'weapon63',
    'weapon64', 'weapon65',
]));

export function resolveCraftLayoutProfile(weaponId, weaponData, slotIds = []) {
    const explicit = CRAFT_LAYOUT_PROFILE_BY_WEAPON_ID[weaponId];
    if (explicit) return explicit;
    if (slotIds.includes('blade') || slotIds.some(id => id.startsWith('blade_body'))) return 'sword_vertical';
    if (slotIds.includes('head_crystal') || slotIds.includes('shaft_rune')) return 'staff_vertical';
    const type = `${weaponData?.weaponType || ''} ${weaponData?.type || ''}`.toLowerCase();
    if (type.includes('shield') || type.includes('盾')) return 'shield_round';
    if (type.includes('pistol') || type.includes('手枪') || type.includes('手炮')) return 'pistol_standard';
    if (type.includes('shotgun') || type.includes('散弹') || type.includes('霰弹')) return 'shotgun_pump';
    if (type.includes('lmg') || type.includes('machine') || type.includes('机枪')) return 'lmg_box';
    return 'rifle_standard';
}
