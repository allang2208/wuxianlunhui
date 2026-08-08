// Equipment Data Manager - Extracted from EquipManager
// Contains all equipment data definitions

export const EquipDataManager = {
    TEST_EQUIPMENTS: {
        helmet: null, // 旧防具/饰品已删除（2026-08-01），初始装备暂不佩戴防具
        necklace: null,
        weapon: { weaponId: 'weapon1', name: '生锈的长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png', equipImage: 'assets/weapons/1-rusty_sword_euip.png', category: 'weapon_melee', equipSlot: 'weapon', stats: [{ name: '物理攻击', value: '12-18' }, { name: '暴击率', value: '+3%', pos: true }], desc: '一把锈迹斑斑的旧剑', level: 1, rarity: 'common', weaponType: 'sword',
            attackKey: 'melee', animConfigKey: 'sword', canvasImageProp: 'meleeImage',
            attack: { range: 124, knockback: 6, attackInterval: 500, hitType: '突刺（扇形判定）', damageType: '物理' },
            attackFormula: { base: 12, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.8, perEnhance: 0.2 }, { key: 'dex', base: 0.8, perEnhance: 0.2 }] } },
        weapon2: null,
        armor: null,
        offhand: null,
        ring1: null,
        gloves: null,
        ring2: null,
        belt: null,
        boots: null
    },
    TEST_BACKPACK_ITEMS: [
        { slot: 0, name: '治疗药水', type: '消耗品', icon: '🧪', iconImage: 'assets/items/health_potion.png', dropImage: 'assets/items/health_potion.png', category: 'consumable', stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜', stack: 5 },
        { slot: 1, name: '魔力药水', type: '消耗品', icon: '💧', iconImage: 'assets/items/mana_potion.png', dropImage: 'assets/items/mana_potion.png', category: 'consumable', stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3 },
        { slot: 2, name: '金币', type: '货币', icon: '💰', category: 'gold', rarity: 'mythic', stats: [{ name: '数量', value: '10000' }], desc: '金光闪闪的硬币', stack: 10000, price: 1 }
    ],
    G18_PISTOL_ITEM: {
        weaponId: 'weapon9',
        name: 'G18', type: '手枪', icon: '🔫', iconImage: 'assets/icons/G18icon.png',
        dropImage: 'assets/icons/G18icon.png',
        equipImage: 'assets/icons/G18icon.png',
        slotImage: 'assets/icons/G18icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 5,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/icons/G18icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '650' }],
        desc: 'G18 全自动手枪，1100发/分钟，淡金色曳光弹，可双持',
        equipSlot: 'weapon',
        attack: { range: 650, knockback: 0, attackInterval: 55, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'pistol', offhandAttackKey: 'pistolOffhand', animConfigKey: 'pistol', fireSound: 'assets/sounds/weapons/akm_burst.mp3', isDarkGold: false, canvasImageProp: 'pistolImage',
        ammoConfig: { max: 12, reloadTime: 1000 }, fireMode: 'fullAuto',
        attackFormula: { base: 5, enhanceFlat: 1, attrs: [{ key: 'dex', base: 0.35, perEnhance: 0.15 }, { key: 'wis', base: 0.4, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 0, maxTime: 300, maxAngle: 25 }
    },
        DESERT_EAGLE_ITEM: {
        weaponId: 'weapon10',
        name: '沙漠之鹰', type: '手枪', icon: '🔫', iconImage: 'assets/icons/DesertEagle_icon.png',
        dropImage: 'assets/icons/DesertEagle_icon.png',
        equipImage: 'assets/icons/DesertEagle_icon.png',
        slotImage: 'assets/icons/DesertEagle_icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/icons/DesertEagle_icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-8' }, { name: '射程', value: '750' }],
        desc: '沙漠之鹰半自动手枪，深黄色曳光弹，可双持，连续开火0.5秒后计算散布',
        equipSlot: 'weapon',
        attack: { range: 750, knockback: 10, attackInterval: 800, hitType: '深黄色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'deagle', offhandAttackKey: 'deagleOffhand', animConfigKey: 'deagle', fireSound: 'assets/sounds/weapons/cs_deagle_35_80.wav', isDarkGold: true, canvasImageProp: 'deagleImage',
        ammoConfig: { max: 6, reloadTime: 1750 }, fireMode: 'semiAuto',
        attackFormula: { base: 30, enhanceFlat: 0, attrs: [{ key: 'dex', base: 1, perEnhance: 0 }, { key: 'wis', base: 2, perEnhance: 0 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 30 },
        craftConfig: {
            weaponId: 'weapon10',
            slots: [
                { id: 'muzzle', name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.5027471264367817, y: 0.16656375838926185 } },
                { id: 'barrel', name: '枪管', x: 0.08, y: 0.4, lineTarget: { x: 0.5027471264367817, y: 0.22430872483221465 } },
                { id: 'sight', name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.5018735632183908, y: 0.609127516778525 } },
                { id: 'magazine', name: '弹夹', x: 0.9171264367816092, y: 0.2746308724832214, lineTarget: { x: 0.5073218390804601, y: 0.45444295302013404 } },
                { id: 'bullet', name: '子弹', x: 0.92, y: 0.13375838926174494, lineTarget: { x: 0.5073218390804602, y: 0.4561208053691248 } },
                { id: 'grip', name: '握把', x: 0.9171264367816093, y: 0.49865771812080917, lineTarget: { x: 0.5029999999999992, y: 0.5717785234899334 } },
                { id: 'stock', name: '后托', x: 0.92, y: 0.7, lineTarget: { x: 0.4998735632183908, y: 0.7143355704697995 } }
            ]
        }
    },
    P4040_ITEM: {
        weaponId: 'weapon18',
        name: 'P4040', type: '手枪', icon: '🔫', iconImage: 'assets/weapons/P4040-icon.png',
        dropImage: 'assets/weapons/P4040-icon.png',
        equipImage: 'assets/weapons/P4040-icon.png',
        slotImage: 'assets/weapons/P4040-icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/P4040-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '2-4' }, { name: '射程', value: '750' }],
        desc: 'P4040 半自动手枪，高射速半自动射击，可双持',
        equipSlot: 'weapon',
        attack: { range: 750, knockback: 2, attackInterval: 300, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, bulletSpeed: 1248 },
        attackKey: 'p4040', offhandAttackKey: 'p4040Offhand', animConfigKey: 'p4040', fireSound: 'assets/sounds/weapons/apex2_shot_1s.wav', isDarkGold: true, canvasImageProp: 'p4040Image',
        ammoConfig: { max: 12, reloadTime: 1200 }, fireMode: 'semiAuto',
        attackFormula: { base: 8, enhanceFlat: 1, attrs: [{ key: 'dex', base: 0.75, perEnhance: 0.15 }, { key: 'wis', base: 1, perEnhance: 0.25 }] },
        spreadParams: { startDelay: 0, maxTime: 0, maxAngle: 1 }
    },
    BERETTA93R_ITEM: {
        weaponId: 'weapon19',
        name: 'Beretta 93R', type: '手枪', icon: '🔫', iconImage: 'assets/weapons/beretta93r.png',
        dropImage: 'assets/weapons/beretta93r.png',
        equipImage: 'assets/weapons/beretta93r.png',
        slotImage: 'assets/weapons/beretta93r.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/beretta93r.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '8+敏捷×0.5+精神×0.5' }, { name: '射程', value: '700' }],
        desc: 'Beretta 93R 半自动手枪，9发弹夹，可双持，扳机位可改造三连发/全自动',
        equipSlot: 'weapon',
        attack: { range: 700, knockback: 0, attackInterval: 225, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 800 },
        attackKey: 'beretta93r', offhandAttackKey: 'beretta93rOffhand', animConfigKey: 'beretta93r', fireSound: 'assets/sounds/weapons/beretta93r_fire.mp3', isDarkGold: true, canvasImageProp: 'beretta93rImage',
        ammoConfig: { max: 9, reloadTime: 1500 }, fireMode: 'semiAuto',
        attackFormula: { base: 8, enhanceFlat: 0.75, attrs: [{ key: 'dex', base: 0.5, perEnhance: 0.1 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 0, maxTime: 0, maxAngle: 5 },
        craftConfig: {
            weaponId: 'weapon19',
            slots: [
                { id: 'muzzle', name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.503, y: 0.167 } },
                { id: 'barrel', name: '枪管', x: 0.08, y: 0.4, lineTarget: { x: 0.503, y: 0.224 } },
                { id: 'sight', name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.502, y: 0.609 } },
                { id: 'magazine', name: '弹夹', x: 0.917, y: 0.275, lineTarget: { x: 0.507, y: 0.454 } },
                { id: 'bullet', name: '子弹', x: 0.92, y: 0.134, lineTarget: { x: 0.507, y: 0.456 } },
                { id: 'trigger', name: '板机', x: 0.92, y: 0.55, lineTarget: { x: 0.503, y: 0.572 } }
            ]
        }
    },
    APPRENTICE_STAFF_ITEM: {
        weaponId: 'weapon20',
        name: '学徒长杖', type: '法杖', icon: '🪄', iconImage: 'assets/weapons/学徒法杖.png',
        dropImage: 'assets/weapons/学徒法杖.png',
        equipImage: 'assets/weapons/学徒法杖.png',
        slotImage: 'assets/weapons/学徒法杖.png',
        category: 'weapon_melee', rarity: 'uncommon', level: 1,
        weaponCategory: 'mainhand', weaponType: 'staff',
        weaponTypeTag: '近战武器',
        stats: [{ name: '物理攻击', value: '3+敏捷×0.25+力量×0.25' }, { name: '魔法攻击', value: '5+智力×0.5+精神×0.5' }],
        desc: '初学者的练习法杖，杖身刻有简单的导魔纹路，适合魔法初学者使用',
        equipSlot: 'weapon',
        attack: { range: 110, knockback: 0, attackInterval: 500, hitType: '挥砍（扇形判定）', damageType: '物理' },
        attackKey: 'melee', animConfigKey: 'sword', canvasImageProp: 'meleeImage',
        castAnimKey: 'staff_cast', // 装备法杖释放魔法时的施法动画（player-anim-config 键）
        attackFormula: { base: 3, enhanceFlat: 0.25, attrs: [{ key: 'dex', base: 0.25, perEnhance: 0.1 }, { key: 'str', base: 0.25, perEnhance: 0.15 }] },
        matkFormula: { base: 5, intMul: 0.5, wisMul: 0.5, enhanceBase: 1, enhanceIntMul: 0.25, enhanceWisMul: 0.25 },
        craftConfig: {
            weaponId: 'weapon20',
            slots: [
                { id: 'head_crystal', name: '杖头', x: 0.5, y: 0.12, lineTarget: { x: 0.5, y: 0.12 } },
                { id: 'crown', name: '杖冠', x: 0.5, y: 0.24, lineTarget: { x: 0.5, y: 0.24 } },
                { id: 'shaft_rune', name: '杖身', x: 0.5, y: 0.4, lineTarget: { x: 0.5, y: 0.4 } },
                { id: 'grip_lining', name: '握柄', x: 0.5, y: 0.62, lineTarget: { x: 0.5, y: 0.62 } },
                { id: 'tail_charm', name: '尾坠', x: 0.5, y: 0.84, lineTarget: { x: 0.5, y: 0.84 } },
                { id: 'mana_line', name: '导魔', x: 0.5, y: 0.5, lineTarget: { x: 0.5, y: 0.5 } }
            ]
        }
    },
    PKM_ITEM: {
        weaponId: 'weapon6',
        name: 'PKM', type: '机枪', icon: '🔫', iconImage: 'assets/icons/pkm_side_clean.png',
        dropImage: 'assets/icons/pkm_side_clean.png',
        equipImage: 'assets/icons/pkm_side_clean.png',
        slotImage: 'assets/icons/pkm_side_clean.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'pkm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/pkm_side_clean.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '10+力量×0.5+精神×0.4' }, { name: '射程', value: '1200' }],
        desc: 'PKM通用机枪，650发/分钟，亮金色曳光弹，火力压制利器',
        equipSlot: 'weapon2',
        attack: { range: 1200, knockback: 3, attackInterval: 92, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        heatParams: { overheatTime: 5000, overheatRecoverTime: 3000, overheatCooldownTime: 3000 },
        attackKey: 'pkm', animConfigKey: 'pkm', fireSound: 'assets/sounds/weapons/pkm_half_sec.wav', canvasImageProp: 'pkmImage',
        ammoConfig: { max: 75, reloadTime: 3500 }, fireMode: 'fullAuto',
        attackFormula: { base: 10, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.5, perEnhance: 0.15 }, { key: 'wis', base: 0.4, perEnhance: 0.12 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 }
    },
    AKM_ITEM: {
        weaponId: 'weapon7',
        name: 'AKM', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/akm-equip.png',
        slotImage: 'assets/icons/akm-equip.png',
        equipImage: 'assets/weapons/akm-equip.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'akm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/akm-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }],
        desc: 'AKM自动步枪，600发/分钟，亮金色曳光弹，可靠耐用的经典步枪',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 2, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'akm', animConfigKey: 'akm', fireSound: 'assets/sounds/weapons/akm_burst.mp3', canvasImageProp: 'akmImage',
        ammoConfig: { max: 30, reloadTime: 1150 }, fireMode: 'fullAuto',
        attackFormula: { base: 9, enhanceFlat: 1, attrs: [{ key: 'int', base: 0.45, perEnhance: 0.12 }, { key: 'wis', base: 0.45, perEnhance: 0.12 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 }
    },
    M416_ITEM: {
        weaponId: 'weapon21',
        name: 'M416', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/m416-equip.png',
        slotImage: 'assets/icons/m416-equip.png',
        equipImage: 'assets/weapons/m416-equip.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8,
        weaponCategory: 'mainhand', weaponType: 'm416',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/m416-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-5' }, { name: '射程', value: '1150' }],
        desc: 'M416自动步枪，750发/分钟，亮金色曳光弹，均衡可靠的模块化步枪',
        equipSlot: 'weapon',
        attack: { range: 1150, knockback: 2, attackInterval: 110, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'm416', animConfigKey: 'm416', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'm416Image',
        ammoConfig: { max: 30, reloadTime: 1200, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 8, enhanceFlat: 0.8, attrs: [{ key: 'int', base: 0.4, perEnhance: 0.1 }, { key: 'wis', base: 0.4, perEnhance: 0.1 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 }
    },
    QBZ191_ITEM: {
        weaponId: 'weapon8',
        name: 'QBZ-191', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/191icon.png',
        slotImage: 'assets/icons/191icon.png',
        equipImage: 'assets/icons/191icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12,
        weaponCategory: 'mainhand', weaponType: 'qbz191',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/191icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }],
        desc: 'QBZ-191自动步枪，850发/分钟，亮金色曳光弹，新一代国产步枪',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 2, attackInterval: 70, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'qbz191', animConfigKey: 'qbz191', fireSound: 'assets/sounds/weapons/qbz191_shot6_valley.mp3', canvasImageProp: 'qbz191Image',
        ammoConfig: { max: 30, reloadTime: 1000 }, fireMode: 'fullAuto',
        attackFormula: { base: 8, enhanceFlat: 1, attrs: [{ key: 'int', base: 0.4, perEnhance: 0.15 }, { key: 'wis', base: 0.4, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 }
    },
    QJB201_ITEM: {
        weaponId: 'weapon11',
        name: 'QJB-201', type: '机枪', icon: '🔫', iconImage: 'assets/icons/201-icon.png',
        dropImage: 'assets/icons/201-icon.png',
        equipImage: 'assets/icons/201-icon.png',
        slotImage: 'assets/icons/201-icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12,
        weaponCategory: 'mainhand', weaponType: 'qjb201',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/201-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '7+力量×0.35+精神×0.5' }, { name: '射程', value: '1200' }],
        desc: 'QJB-201班用机枪，1000发/分钟，亮金色曳光弹，轻量化设计的国产机枪，机动性与火力兼备',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 1, attackInterval: 60, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        heatParams: { overheatTime: 4000, overheatRecoverTime: 1500, overheatCooldownTime: 1500 },
        attackKey: 'qjb201', animConfigKey: 'qjb201', fireSound: 'assets/sounds/weapons/qjb201_single_600ms.wav', canvasImageProp: 'qjb201Image',
        ammoConfig: { max: 60, reloadTime: 2000 }, fireMode: 'fullAuto',
        attackFormula: { base: 7, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.35, perEnhance: 0.10 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 30 }
    },
    SUPER90_ITEM: {
        weaponId: 'weapon12',
        name: 'Super90', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/M4s90_icon.png',
        dropImage: 'assets/icons/M4s90_icon.png',
        equipImage: 'assets/icons/M4s90_icon.png',
        slotImage: 'assets/icons/M4s90_icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/M4s90_icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '500' }],
        desc: 'Super90 半自动散弹枪，一次击发6发弹丸，单发装填换弹机制，近距离毁灭性火力',
        equipSlot: 'weapon',
        attack: { range: 500, knockback: 12.5, attackInterval: 333, hitType: '散弹（6发弹丸）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'super90', animConfigKey: 'shotgun', fireSound: 'assets/sounds/weapons/gunshot_600ms_clean.wav', pelletCount: 6, equipSound: 'assets/sounds/weapons/bolt_pull_1s_clean.wav', canvasImageProp: 'super90Image',
        // 腰射贴图上移 4px（瞄准态抵消回 0；只动贴图渲染，手臂/锚点/弹道不受影响）
        spriteOffsetY: -4, aimSpriteOffsetY: 4,
        ammoConfig: { max: 7, reloadTime: 400, singleReloadMode: true, reloadSound: 'assets/sounds/weapons/Super90-reload.mp3' }, fireMode: 'semiAuto',
        attackFormula: { base: 10, enhanceFlat: 1, attrs: [{ key: 'con', base: 0.2, perEnhance: 0.10 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }], variants: { slugMode: { base: 8, enhanceFlat: 5, attrs: [{ key: 'con', base: 0.6, perEnhance: 0.05 }, { key: 'wis', base: 1, perEnhance: 0.1 }] } } }
    },
    SAIGA12K_ITEM: {
        weaponId: 'weapon13',
        name: 'SAIGA-12K', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/S12k-icon.png',
        dropImage: 'assets/icons/S12k-icon.png',
        equipImage: 'assets/icons/S12k-icon.png',
        slotImage: 'assets/icons/S12k-icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/S12k-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '400' }],
        desc: 'SAIGA-12K 半自动散弹枪，一次击发4发弹丸，正常弹夹换弹，高射速近距离火力',
        equipSlot: 'weapon',
        attack: { range: 400, knockback: 12.5, attackInterval: 150, hitType: '散弹（4发弹丸）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'saiga12k', animConfigKey: 'shotgun', fireSound: 'assets/sounds/weapons/gunshot_600ms_open.wav', pelletCount: 4, canvasImageProp: 'saiga12kImage',
        // 贴图下移 12px（腰射/瞄准同步；只动贴图渲染，手臂/锚点/弹道不受影响）
        spriteOffsetY: 12,
        ammoConfig: { max: 12, reloadTime: 2000 }, fireMode: 'fullAuto',
        attackFormula: { base: 8, enhanceFlat: 1, attrs: [{ key: 'con', base: 0.5, perEnhance: 0.15 }, { key: 'wis', base: 0.25, perEnhance: 0.10 }], variants: { slugMode: { base: 8, enhanceFlat: 5, attrs: [{ key: 'con', base: 0.6, perEnhance: 0.05 }, { key: 'wis', base: 1, perEnhance: 0.1 }] } } }
    },
    KINGHTS_SWORD_ITEM: {
        weaponId: 'weapon2',
        name: '骑士长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/knights_sword_v3_macro.png',
        dropImage: 'assets/weapons/knights_sword_v3_equip.png',
        equipImage: 'assets/weapons/knights_sword_v3_equip.png',
        category: 'weapon_melee', rarity: 'uncommon', level: 5,
        weaponCategory: 'mainhand', weaponType: 'sword',
        weaponTypeTag: '近战武器',
        stats: [{ name: '物理攻击', value: '18-23' }],
        desc: '骑士团的标准制式长剑，剑身修长，锋利且坚韧。适合有一定基础的剑士使用。',
        equipSlot: 'weapon2',
        attack: { range: 77, rangeBonus: 25, knockback: 8, attackInterval: 500, damageType: '物理' },
        attackKey: 'melee', animConfigKey: 'sword', canvasImageProp: 'meleeImage',
        attackFormula: { base: 20, enhanceFlat: 2, attrs: [{ key: 'str', base: 2, perEnhance: 0.35 }, { key: 'dex', base: 1.5, perEnhance: 0.25 }] },
        specialAttack: {
            cooldown: 5,
            damageType: '物理',
            damageFormula: '武器攻击力 × (0.80 + 等级×0.05)',
            duration: 0.6
        },
        specialAttackType: 'knightsSword',
        skillOverrides: {
            dashAttackThrust: {
                animation: {
                    totalMs: 600,
                    dashDist: 173,
                    chargeMs: 0,
                    thrustMs: 600,
                    recoverMs: 0
                },
                hitCheck: {
                    shape: 'rectangle',
                    width: 75,
                    length: 350,
                    hitArc: 0,
                    lengthBonus: 50,
                    backOffset: -30
                }
            }
        }
    },
    RUNE_SWORD_ITEM: {
        weaponId: 'weapon4',
        name: '符文长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/EXsword_icon.png',
        dropImage: 'assets/weapons/EXsword_equipped_v2_.png',
        equipImage: 'assets/weapons/EXsword_equipped_v2_.png',
        category: 'weapon_melee', rarity: 'uncommon', level: 5,
        weaponCategory: 'mainhand', weaponType: 'sword',
        weaponTypeTag: '近战武器',
        stats: [{ name: '物理攻击', value: '45-55' }, { name: '暴击率', value: '+5%', pos: true }],
        desc: '剑身上铭刻着上古符文的传奇长剑，符文之力蕴含其中，持有者能感受到符文中流淌的力量。剑刃在挥动时会留下淡蓝色的符文残影，威力远超凡铁。',
        equipSlot: 'weapon',
        attack: { range: 77, rangeBonus: 50, knockback: 8, attackInterval: 500, damageType: '物理' },
        attackKey: 'melee', animConfigKey: 'sword', canvasImageProp: 'meleeImage',
        attackFormula: { base: 16, enhanceFlat: 2, attrs: [{ key: 'int', base: 2, perEnhance: 0.4 }, { key: 'str', base: 1.2, perEnhance: 0.2 }] },
        specialAttack: {
            cooldown: 5,
            damageType: '魔法+物理混合',
            damageFormula: '魔法伤害×1.2 + 物理伤害',
            duration: 30
        },
        specialAttackType: 'runeSword',
        weaponEffect: 'runeSword'
    },
    NIGHT_FLAME_SWORD_ITEM: {
        weaponId: 'weapon5',
        name: '夜与火之剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/Nightandflame_macro.png',
        dropImage: 'assets/weapons/Nightandflame_equip.png',
        equipImage: 'assets/weapons/Nightandflame_equip.png',
        category: 'weapon_melee', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'sword',
        weaponTypeTag: '近战武器',
        stats: [{ name: '物理攻击', value: '60-75' }, { name: '暴击率', value: '+5%', pos: true }],
        desc: '一把在暗夜中燃烧着淡蓝色火焰的传奇之剑，传说中它同时寄宿着夜之力与火之力。持有者可以释放其中的火焰之力，发射毁灭性的光柱。',
        equipSlot: 'weapon',
        attack: { range: 77, rangeBonus: 25, knockback: 8, attackInterval: 500, damageType: '物理' },
        attackKey: 'melee', animConfigKey: 'sword', canvasImageProp: 'meleeImage',
        attackFormula: { base: 24, enhanceFlat: 2.2, attrs: [{ key: 'int', base: 2, perEnhance: 0.5 }, { key: 'str', base: 1.2, perEnhance: 0.2 }] },
        specialAttack: {
            cooldown: 5,
            damageType: '魔法',
            damageFormula: '武器攻击力 × 0.25（每0.2秒一次）',
            duration: 3
        },
        skillOverrides: {
            dashAttackFire: true
        },
        specialAttackType: 'nightFlame'
    },
    ENERGY_LMG_ITEM: {
        weaponId: 'weapon15',
        name: '能量轻机枪', type: '机枪', icon: '🔫', iconImage: 'assets/icons/devotion-icon.png',
        dropImage: 'assets/icons/devotion-icon.png',
        equipImage: 'assets/icons/devotion-icon.png',
        slotImage: 'assets/icons/devotion-icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'energy_lmg',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/devotion-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '魔法攻击', value: '6+力量/精神' }, { name: '射程', value: '1200' }],
        desc: '能量轻机枪，发射高能粒子束，无限能量供给。按住鼠标持续开火，射速随时间线性提升，过热后需冷却。',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 0, attackInterval: 333, hitType: '亮绿色曳光弹（直线弹道）', damageType: '魔法', projectileSpeed: 1248 },
        attackKey: 'energy_lmg', animConfigKey: 'energy_lmg', fireSound: 'assets/sounds/weapons/akm_burst.mp3', canvasImageProp: 'energyLmgImage',
        ammoConfig: { max: Infinity, reloadTime: 0 }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0, attrs: [{ key: 'str', base: 0.35, perEnhance: 0.10 }, { key: 'wis', base: 0.35, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 0, maxTime: 2500, maxAngle: 15 },
        energyLMGParams: {
            baseCooldown: 333,
            maxCooldown: 50,
            rampUpTime: 2500,
            overheatTime: 5000,
            overheatRecoverTime: 4000,
            overheatCooldownTime: 4000,
            spreadMaxTime: 2500,
            maxSpreadAngle: 15
        }
    },
    TRAINING_BOW_ITEM: {
        weaponId: 'weapon14',
        name: '训练用弓', type: '弓', icon: '🏹', iconImage: 'assets/icons/trainingBOW.png',
        dropImage: 'assets/weapons/trainingBOW.png',
        equipImage: 'assets/weapons/trainingBOW.png',
        slotImage: 'assets/icons/trainingBOW.png',
        category: 'weapon_ranged', rarity: 'common', level: 1,
        weaponCategory: 'mainhand', weaponType: 'bow',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/trainingBOW.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '50-85' }, { name: '射程', value: '1500' }],
        desc: '一把适合初学者练习的弓，经过改良后拥有更远的射程和更强的威力。攻击前会先将弓旋转14°蓄力，攻击动画结束后箭矢才射出。',
        equipSlot: 'weapon',
        attack: { range: 1500, knockback: 30, attackInterval: 1500, hitType: '箭矢（直线弹道，攻击动画结束后射出）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'ranged', animConfigKey: 'bow', fireMode: 'charge',
        attackFormula: { base: 50, enhanceFlat: 1, attrs: [] },
        chargeAttack: { chargeTime: 1500, flashDuration: 500 },
        sound: {
            rotateComplete: 'assets/sounds/bow/rope_pull_1s.wav',
            attackEnd: 'assets/sounds/arrow_flyby_1s.mp3'
        }
    },
    BORDER_BOW_ITEM: {
        weaponId: 'weapon16',
        name: '边境长弓', type: '弓', icon: '🏹', iconImage: 'assets/icons/border_bow_icon.png',
        equipImage: 'assets/weapons/borderbow.png',
        dropImage: 'assets/items/border_bow_dropped.png',
        slotImage: 'assets/icons/border_bow_icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'bow',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { framePrefix: 'assets/weapons/border_bow_frame_', frameCount: 10, framePad: 2 },
        stats: [{ name: '物理攻击', value: '60+敏捷×2.5+力量×2' }, { name: '射程', value: '1500' }],
        desc: '一把来自边境猎人手中的长弓，弓身以秘法加固，拉满时弦上似有风雷之声。蓄力射击可贯穿敌人护甲。',
        equipSlot: 'weapon',
        attack: { range: 1500, knockback: 30, attackInterval: 1500, hitType: '箭矢（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'ranged', animConfigKey: 'bow', fireMode: 'charge',
        attackFormula: { base: 60, enhanceFlat: 15, attrs: [{ key: 'dex', base: 2.5, perEnhance: 1.75 }, { key: 'str', base: 2, perEnhance: 1.75 }] },
        chargeAttack: { chargeTime: 1500, flashDuration: 500 },
        sound: {
            rotateComplete: 'assets/sounds/bow/rope_pull_1s.wav',
            attackEnd: 'assets/sounds/arrow_flyby_1s.mp3'
        }
    },
    SMALL_SHIELD_ITEM: {
        weaponId: 'weapon17',
        name: '小圆盾', type: '盾', icon: '🛡', iconImage: 'assets/icons/woodshied.png',
        equipImage: 'assets/weapons/woodshied-equip.png',
        dropImage: 'assets/items/woodshied_dropped.png',
        slotImage: 'assets/icons/woodshied.png',
        category: 'weapon_shield', rarity: 'common', level: 1,
        weaponCategory: 'offhand', weaponType: 'shield',
        weaponTypeTag: '副手武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/woodshied-equip.png' },
        stats: [{ name: '物理防御', value: '15' }, { name: '防御减伤', value: '50%' }],
        desc: '一块用硬木削成的圆盾，虽然简陋，但足以挡住致命的攻击。',
        equipSlot: 'offhand',
        defense: { base: 15, perEnhance: 1.5, damageReduction: 0.5, staminaCost: 20, parryWindow: 1000, parryStun: 1000, parryKnockback: 100 }
    },

};

// ==================== 武器字段补全（单一全量源） ====================
// EquipDataManager 是唯一包含全部武器 attackFormula/ammoConfig/attackKey 等完整字段的数据源。
// equipment.json/商店列表/旧存档实例可能缺字段——统一经 completeWeaponFields 补全，
// 不再在各处维护第二份字段清单（main.js 启动合并与 shop-system 商品列表共用）。

// 与 main.js 启动合并同口径的补全字段清单
const COMPLETE_WEAPON_FIELDS = [
    'attackFormula', 'matkFormula', 'ammoConfig', 'spreadParams', 'heatParams',
    'energyLMGParams', 'fireMode', 'animConfigKey', 'attackKey',
    'offhandAttackKey', 'canvasImageProp', 'specialAttackType',
    'sound', 'chargeAttack', 'pelletCount', 'equipSound', 'renderParams', 'fireSound',
    'isDarkGold', 'dropImage', 'equipImage', 'slotImage',
    'spriteOffsetX', 'spriteOffsetY', 'aimSpriteOffsetX', 'aimSpriteOffsetY'
];

let _weaponConfigIndex = null;
function _buildWeaponConfigIndex() {
    const byWeaponId = new Map();
    const byName = new Map();
    const add = (cfg) => {
        if (!cfg || typeof cfg !== 'object' || !cfg.weaponId) return;
        if (!byWeaponId.has(cfg.weaponId)) byWeaponId.set(cfg.weaponId, cfg);
        if (cfg.name && !byName.has(cfg.name)) byName.set(cfg.name, cfg);
    };
    for (const v of Object.values(EquipDataManager)) {
        add(v);
        // 嵌套容器（如 TEST_EQUIPMENTS.weapon 锈剑）下钻一层
        if (v && typeof v === 'object' && !v.weaponId) {
            for (const inner of Object.values(v)) add(inner);
        }
    }
    _weaponConfigIndex = { byWeaponId, byName };
}

/**
 * 按 weaponId / name 查找 EquipDataManager 中的完整武器配置
 */
export function findWeaponConfig(weaponId, name) {
    if (!_weaponConfigIndex) _buildWeaponConfigIndex();
    return (weaponId && _weaponConfigIndex.byWeaponId.get(weaponId))
        || (name && _weaponConfigIndex.byName.get(name))
        || null;
}

/**
 * 用 EquipDataManager 的完整配置补全武器实例缺失的字段（只补 undefined，不覆盖实例自有值）
 * @returns {Object} 原 item（原地补全）
 */
export function completeWeaponFields(item) {
    if (!item || typeof item !== 'object') return item;
    const cfg = findWeaponConfig(item.weaponId, item.name);
    if (!cfg) return item;
    for (const field of COMPLETE_WEAPON_FIELDS) {
        if (cfg[field] !== undefined && item[field] === undefined) {
            item[field] = cfg[field];
        }
    }
    return item;
}
