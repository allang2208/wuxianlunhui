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
        { slot: 1, name: '魔力药水', type: '消耗品', icon: '💧', iconImage: 'assets/items/mana_potion.png', dropImage: 'assets/items/mana_potion.png', category: 'consumable', stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3 }
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
    REVOLVER357_ITEM: {
        weaponId: 'weapon22',
        name: '.357麦格农左轮', type: '手枪', icon: '🔫', iconImage: 'assets/icons/revolver357-equip.png',
        slotImage: 'assets/icons/revolver357-equip.png',
        equipImage: 'assets/weapons/revolver357-equip.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/revolver357-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '4-9' }, { name: '射程', value: '700' }],
        desc: '.357麦格农左轮手枪，6发弹巢，亮银色曳光弹，威力巨大的经典左轮',
        equipSlot: 'weapon',
        attack: { range: 700, knockback: 12, attackInterval: 700, hitType: '亮银色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 },
        attackKey: 'revolver', offhandAttackKey: 'revolverOffhand', animConfigKey: 'revolver', fireSound: 'assets/sounds/weapons/revolver357_fire.mp3', equipSound: 'assets/sounds/weapons/revolver357_equip.wav', canvasImageProp: 'revolverImage',
        ammoConfig: { max: 6, reloadTime: 900, singleReloadMode: true, reloadSound: 'assets/sounds/weapons/revolver357_reload.wav', reloadFinishSound: 'assets/sounds/weapons/revolver357_reload_last.wav' }, fireMode: 'semiAuto',
        attackFormula: { base: 26, enhanceFlat: 0, attrs: [{ key: 'dex', base: 0.8, perEnhance: 0.1 }, { key: 'wis', base: 1.6, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 28 }
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
        matkFormula: { base: 5, intMul: 0.5, wisMul: 0.5, enhanceBase: 1, enhanceIntMul: 0.2, enhanceWisMul: 0.2 },
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
        name: 'PKM', type: '机枪', icon: '🔫', iconImage: 'assets/icons/firearms/pkm.png',
        dropImage: 'assets/icons/pkm_side_clean.png',
        equipImage: 'assets/icons/pkm_side_clean.png',
        slotImage: 'assets/icons/firearms/pkm.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10, price: 500,
        weaponCategory: 'mainhand', weaponType: 'pkm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/pkm_side_clean.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '7+力量×0.3+精神×0.25' }, { name: '射程', value: '1550' }],
        desc: 'PKM通用机枪，650发/分钟，亮金色曳光弹，火力压制利器',
        equipSlot: 'weapon2',
        attack: { range: 1550, knockback: 3, attackInterval: 92, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 720, minMultiplier: 0.4 } },
        heatParams: { overheatTime: 5000, overheatRecoverTime: 3000, overheatCooldownTime: 3000 },
        attackKey: 'pkm', animConfigKey: 'pkm', fireSound: 'assets/sounds/weapons/pkm_half_sec.wav', canvasImageProp: 'pkmImage',
        ammoConfig: { max: 75, reloadTime: 3500 }, fireMode: 'fullAuto',
        attackFormula: { base: 7, enhanceFlat: 0.45, attrs: [{ key: 'str', base: 0.3, perEnhance: 0.045 }, { key: 'wis', base: 0.25, perEnhance: 0.04 }] },
        spreadParams: { startShots: 6, maxShots: 20, recoveryMs: 520, maxAngle: 25 }
    },
    AKM_ITEM: {
        weaponId: 'weapon7',
        name: 'AKM', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/akm.png',
        slotImage: 'assets/icons/firearms/akm.png',
        equipImage: 'assets/weapons/akm-equip.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10, price: 600,
        weaponCategory: 'mainhand', weaponType: 'akm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/akm-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '8+智力×0.29+精神×0.29' }, { name: '射程', value: '1550' }],
        desc: 'AKM自动步枪，600发/分钟，亮金色曳光弹，可靠耐用的经典步枪',
        equipSlot: 'weapon',
        attack: { range: 1550, knockback: 2, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 700, minMultiplier: 0.4 } },
        attackKey: 'akm', animConfigKey: 'akm', fireSound: 'assets/sounds/weapons/akm_burst.mp3', canvasImageProp: 'akmImage',
        ammoConfig: { max: 30, reloadTime: 1250 }, fireMode: 'fullAuto',
        attackFormula: { base: 8, enhanceFlat: 0.6, attrs: [{ key: 'int', base: 0.29, perEnhance: 0.045 }, { key: 'wis', base: 0.29, perEnhance: 0.045 }] },
        spreadParams: { startShots: 5, maxShots: 16, recoveryMs: 440, maxAngle: 25 }
    },
    STG44_ITEM: {
        weaponId: 'weapon23',
        name: 'STG-44', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/stg44.png',
        slotImage: 'assets/icons/firearms/stg44.png',
        dropImage: 'assets/weapons/stg44-equip.png',
        equipImage: 'assets/weapons/stg44-equip.png',
        category: 'weapon_ranged', rarity: 'common', level: 6, price: 100,
        weaponCategory: 'mainhand', weaponType: 'stg44',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/stg44-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '7+智力×0.24+精神×0.24' }, { name: '射程', value: '1400' }],
        desc: 'STG-44自动步枪，500发/分钟，亮金色曳光弹；单发沉重、后坐明显的早期突击步枪',
        equipSlot: 'weapon',
        attack: { range: 1400, knockback: 3, attackInterval: 120, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1180, damageFalloff: { start: 620, minMultiplier: 0.38 } },
        attackKey: 'stg44', animConfigKey: 'stg44', fireSound: 'assets/sounds/weapons/stg44_fire.wav', equipSound: 'assets/sounds/weapons/stg44_equip.wav', canvasImageProp: 'stg44Image',
        ammoConfig: { max: 30, reloadTime: 1600, reloadSound: 'assets/sounds/weapons/stg44_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 7, enhanceFlat: 0.55, attrs: [{ key: 'int', base: 0.24, perEnhance: 0.04 }, { key: 'wis', base: 0.24, perEnhance: 0.04 }] },
        spreadParams: { startShots: 4, maxShots: 14, recoveryMs: 520, maxAngle: 30 }
    },
    M416_ITEM: {
        weaponId: 'weapon21',
        name: 'M416', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/m416.png',
        slotImage: 'assets/icons/firearms/m416.png',
        equipImage: 'assets/weapons/m416-equip.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8, price: 450,
        weaponCategory: 'mainhand', weaponType: 'm416',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/m416-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '7+智力×0.27+精神×0.27' }, { name: '射程', value: '1500' }],
        desc: 'M416自动步枪，约550发/分钟，亮金色曳光弹，均衡可靠的模块化步枪',
        equipSlot: 'weapon',
        attack: { range: 1500, knockback: 2, attackInterval: 110, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 720, minMultiplier: 0.42 } },
        attackKey: 'm416', animConfigKey: 'm416', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'm416Image',
        ammoConfig: { max: 30, reloadTime: 1300, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 7, enhanceFlat: 0.5, attrs: [{ key: 'int', base: 0.27, perEnhance: 0.04 }, { key: 'wis', base: 0.27, perEnhance: 0.04 }] },
        spreadParams: { startShots: 6, maxShots: 18, recoveryMs: 420, maxAngle: 22 }
    },
    QBZ95_ITEM: {
        weaponId: 'weapon24',
        name: 'QBZ-95', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/qbz-95.png',
        slotImage: 'assets/icons/firearms/qbz-95.png',
        dropImage: 'assets/weapons/qbz95-equip.png',
        equipImage: 'assets/weapons/qbz95-equip.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 9, price: 200,
        weaponCategory: 'mainhand', weaponType: 'qbz95',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/qbz95-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.22+精神×0.22' }, { name: '射程', value: '1480' }],
        desc: 'QBZ-95自动步枪，约650发/分钟，亮金色曳光弹；紧凑无托结构兼顾射速、操控与恢复',
        equipSlot: 'weapon',
        attack: { range: 1480, knockback: 2, attackInterval: 92, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 660, minMultiplier: 0.4 } },
        attackKey: 'qbz95', animConfigKey: 'qbz95', fireSound: 'assets/sounds/weapons/qbz95_fire.wav', equipSound: 'assets/sounds/weapons/qbz95_equip.wav', canvasImageProp: 'qbz95Image',
        ammoConfig: { max: 30, reloadTime: 1250, reloadSound: 'assets/sounds/weapons/qbz95_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.4, attrs: [{ key: 'int', base: 0.22, perEnhance: 0.035 }, { key: 'wis', base: 0.22, perEnhance: 0.035 }] },
        spreadParams: { startShots: 7, maxShots: 19, recoveryMs: 360, maxAngle: 23 }
    },
    FRONTIER_RIFLE_ITEM: {
        weaponId: 'weapon25',
        name: '边境突击步枪', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/frontier-rifle.png',
        slotImage: 'assets/icons/firearms/frontier-rifle.png',
        dropImage: 'assets/weapons/frontier-rifle-equip.png',
        equipImage: 'assets/weapons/frontier-rifle-equip.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15, price: 800,
        weaponCategory: 'mainhand', weaponType: 'frontier_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/frontier-rifle-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.28+精神×0.28' }, { name: '射程', value: '1650' }],
        desc: '边境突击步枪，约770发/分钟；轻量化机匣与配重枪托让连续射击兼具速度、精度和恢复。',
        equipSlot: 'weapon',
        attack: { range: 1650, knockback: 1, attackInterval: 78, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1360, damageFalloff: { start: 760, minMultiplier: 0.46 } },
        attackKey: 'frontier_rifle', animConfigKey: 'frontier_rifle', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'frontierRifleImage',
        ammoConfig: { max: 32, reloadTime: 1150, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.55, attrs: [{ key: 'int', base: 0.28, perEnhance: 0.045 }, { key: 'wis', base: 0.28, perEnhance: 0.045 }] },
        spreadParams: { startShots: 9, maxShots: 24, recoveryMs: 280, maxAngle: 18 }
    },
    VENGEANCE_RIFLE_ITEM: {
        weaponId: 'weapon26',
        name: '复仇之神', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/vengeance-rifle.png',
        slotImage: 'assets/icons/firearms/vengeance-rifle.png',
        dropImage: 'assets/weapons/vengeance-rifle-equip.png',
        equipImage: 'assets/weapons/vengeance-rifle-equip.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15, price: 800,
        weaponCategory: 'mainhand', weaponType: 'vengeance_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/vengeance-rifle-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '12+智力×0.50+精神×0.50' }, { name: '射程', value: '1850' }],
        desc: '复仇之神三连发突击步枪；重型谐振机匣用短促齐射换取远距离精度与强击退。',
        equipSlot: 'weapon',
        attack: { range: 1850, knockback: 4, attackInterval: 300, hitType: '深红曳光弹（三连发直线弹道）', damageType: '物理', projectileSpeed: 1440, damageFalloff: { start: 900, minMultiplier: 0.55 } },
        attackKey: 'vengeance_rifle', animConfigKey: 'vengeance_rifle', fireSound: 'assets/sounds/weapons/qbz191_shot6_valley.mp3', equipSound: 'assets/sounds/weapons/qbz95_equip.wav', canvasImageProp: 'vengeanceRifleImage',
        ammoConfig: { max: 24, reloadTime: 1450, reloadSound: 'assets/sounds/weapons/qbz95_reload.wav' }, fireMode: 'semiAuto', burstMode: 3,
        attackFormula: { base: 12, enhanceFlat: 1.0, attrs: [{ key: 'int', base: 0.5, perEnhance: 0.08 }, { key: 'wis', base: 0.5, perEnhance: 0.08 }] },
        spreadParams: { startShots: 6, maxShots: 18, recoveryMs: 460, maxAngle: 14 }
    },
    ASTRAL_TIDE_RIFLE_ITEM: {
        weaponId: 'weapon27',
        name: '星潮协议', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/astral-tide-rifle.png',
        slotImage: 'assets/icons/firearms/astral-tide-rifle.png',
        dropImage: 'assets/weapons/astral-tide-rifle-equip.png',
        equipImage: 'assets/weapons/astral-tide-rifle-equip.png',
        category: 'weapon_ranged', rarity: 'mythic', level: 18, price: 1600,
        weaponCategory: 'mainhand', weaponType: 'astral_tide_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/astral-tide-rifle-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.26+精神×0.26' }, { name: '射程', value: '1700' }],
        desc: '神话自动步枪“星潮协议”；相位线圈会在持续开火中逐步缩短攻击间隔，短战起步克制，长战进入高速压制。',
        equipSlot: 'weapon',
        attack: { range: 1700, knockback: 2, attackInterval: 88, hitType: '青金相位曳光弹（持续射击升速）', damageType: '物理', projectileSpeed: 1400, damageFalloff: { start: 800, minMultiplier: 0.48 } },
        attackKey: 'astral_tide_rifle', animConfigKey: 'astral_tide_rifle', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'astralTideRifleImage',
        ammoConfig: { max: 36, reloadTime: 1100, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.5, attrs: [{ key: 'int', base: 0.26, perEnhance: 0.043 }, { key: 'wis', base: 0.26, perEnhance: 0.043 }] },
        spreadParams: { startShots: 8, maxShots: 22, recoveryMs: 320, maxAngle: 20 },
        rampFireParams: { minCooldown: 60, rampUpTime: 2000, decayDelay: 450, decayTime: 1600 }
    },
    ZERO_POINT_RIFLE_ITEM: {
        weaponId: 'weapon28',
        name: '零点仲裁', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/zero-point-arbitrator.png',
        slotImage: 'assets/icons/firearms/zero-point-arbitrator.png',
        dropImage: 'assets/weapons/zero-point-arbitrator-equip.png',
        equipImage: 'assets/weapons/zero-point-arbitrator-equip.png',
        category: 'weapon_ranged', rarity: 'mythic', level: 18, price: 1600,
        weaponCategory: 'mainhand', weaponType: 'zero_point_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/zero-point-arbitrator-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.28+精神×0.28' }, { name: '射程', value: '1800' }],
        desc: '神话自动步枪“零点仲裁”；普通弹首次命中会积累校准，连续确认8发后，下一发转化为1.8倍伤害、额外穿透2个目标的相位仲裁弹。',
        equipSlot: 'weapon',
        attack: { range: 1800, knockback: 1, attackInterval: 82, hitType: '洋红相位弹（命中校准/仲裁穿透）', damageType: '物理', projectileSpeed: 1500, damageFalloff: { start: 900, minMultiplier: 0.55 } },
        attackKey: 'zero_point_rifle', animConfigKey: 'zero_point_rifle', fireSound: 'assets/sounds/weapons/qbz191_shot6_valley.mp3', equipSound: 'assets/sounds/weapons/qbz95_equip.wav', canvasImageProp: 'zeroPointRifleImage',
        ammoConfig: { max: 30, reloadTime: 1100, reloadSound: 'assets/sounds/weapons/qbz95_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.55, attrs: [{ key: 'int', base: 0.28, perEnhance: 0.045 }, { key: 'wis', base: 0.28, perEnhance: 0.045 }] },
        spreadParams: { startShots: 10, maxShots: 26, recoveryMs: 260, maxAngle: 13 },
        calibrationShotParams: { hitsRequired: 8, damageMultiplier: 1.8, piercingBonus: 2 }
    },
    CORONA_CADENCE_RIFLE_ITEM: {
        weaponId: 'weapon29',
        name: '日冕裁律', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/corona-cadence-rifle.png',
        slotImage: 'assets/icons/firearms/corona-cadence-rifle.png',
        dropImage: 'assets/weapons/corona-cadence-rifle-equip.png',
        equipImage: 'assets/weapons/corona-cadence-rifle-equip.png',
        category: 'weapon_ranged', rarity: 'legendary', level: 21, price: 3200,
        weaponCategory: 'mainhand', weaponType: 'corona_cadence_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/corona-cadence-rifle-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.28+精神×0.28' }, { name: '射程', value: '1750' }],
        desc: '传说自动步枪“日冕裁律”；停火450ms会重置射击节律，第5—12发进入日冕稳定窗，造成1.28倍伤害且散布缩减55%，继续扫射则退出增益。',
        equipSlot: 'weapon',
        attack: { range: 1750, knockback: 2, attackInterval: 76, hitType: '赤金日冕弹（中段节律强化）', damageType: '物理', projectileSpeed: 1480, damageFalloff: { start: 850, minMultiplier: 0.52 } },
        attackKey: 'corona_cadence_rifle', animConfigKey: 'corona_cadence_rifle', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'coronaCadenceRifleImage',
        ammoConfig: { max: 32, reloadTime: 1100, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.55, attrs: [{ key: 'int', base: 0.28, perEnhance: 0.045 }, { key: 'wis', base: 0.28, perEnhance: 0.045 }] },
        spreadParams: { startShots: 9, maxShots: 24, recoveryMs: 280, maxAngle: 16 },
        rhythmBurstParams: { startShot: 5, endShot: 12, damageMultiplier: 1.28, resetMs: 450 }
    },
    TERMINAL_ECHO_RIFLE_ITEM: {
        weaponId: 'weapon30',
        name: '终末回声', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/terminal-echo-rifle.png',
        slotImage: 'assets/icons/firearms/terminal-echo-rifle.png',
        dropImage: 'assets/weapons/terminal-echo-rifle-equip.png',
        equipImage: 'assets/weapons/terminal-echo-rifle-equip.png',
        category: 'weapon_ranged', rarity: 'legendary', level: 21, price: 3200,
        weaponCategory: 'mainhand', weaponType: 'terminal_echo_rifle',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/terminal-echo-rifle-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '7+智力×0.27+精神×0.27' }, { name: '射程', value: '1700' }],
        desc: '传说自动步枪“终末回声”；连续射击第6发起进入收束，每层提高2%伤害并降低3.5%散布，最多10层，停火320ms后清零。',
        equipSlot: 'weapon',
        attack: { range: 1700, knockback: 1, attackInterval: 82, hitType: '青白收束弹（持续射击强化）', damageType: '物理', projectileSpeed: 1500, damageFalloff: { start: 800, minMultiplier: 0.5 } },
        attackKey: 'terminal_echo_rifle', animConfigKey: 'terminal_echo_rifle', fireSound: 'assets/sounds/weapons/m416_fire.wav', equipSound: 'assets/sounds/weapons/m416_equip.wav', canvasImageProp: 'terminalEchoRifleImage',
        ammoConfig: { max: 34, reloadTime: 1250, reloadSound: 'assets/sounds/weapons/m416_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 7, enhanceFlat: 0.5, attrs: [{ key: 'int', base: 0.27, perEnhance: 0.045 }, { key: 'wis', base: 0.27, perEnhance: 0.045 }] },
        spreadParams: { startShots: 6, maxShots: 22, recoveryMs: 320, maxAngle: 19 },
        convergenceParams: { startShot: 6, maxStacks: 10, damagePerStack: 0.02, spreadPerStack: 0.035, resetMs: 320 }
    },
    QBZ191_ITEM: {
        weaponId: 'weapon8',
        name: 'QBZ-191', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/firearms/qbz-191.png',
        slotImage: 'assets/icons/firearms/qbz-191.png',
        equipImage: 'assets/icons/191icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12, price: 700,
        weaponCategory: 'mainhand', weaponType: 'qbz191',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/191icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+智力×0.21+精神×0.21' }, { name: '射程', value: '1600' }],
        desc: 'QBZ-191自动步枪，850发/分钟，亮金色曳光弹，新一代国产步枪',
        equipSlot: 'weapon',
        attack: { range: 1600, knockback: 2, attackInterval: 70, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 680, minMultiplier: 0.38 } },
        attackKey: 'qbz191', animConfigKey: 'qbz191', fireSound: 'assets/sounds/weapons/qbz191_shot6_valley.mp3', canvasImageProp: 'qbz191Image',
        ammoConfig: { max: 30, reloadTime: 1150 }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.4, attrs: [{ key: 'int', base: 0.21, perEnhance: 0.035 }, { key: 'wis', base: 0.21, perEnhance: 0.035 }] },
        spreadParams: { startShots: 5, maxShots: 18, recoveryMs: 400, maxAngle: 24 }
    },
    QJB201_ITEM: {
        weaponId: 'weapon11',
        name: 'QJB-201', type: '机枪', icon: '🔫', iconImage: 'assets/icons/firearms/qjb-201.png',
        dropImage: 'assets/icons/201-icon.png',
        equipImage: 'assets/icons/201-icon.png',
        slotImage: 'assets/icons/firearms/qjb-201.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12,
        weaponCategory: 'mainhand', weaponType: 'qjb201',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/201-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '5+力量×0.15+精神×0.2' }, { name: '射程', value: '1600' }],
        desc: 'QJB-201班用机枪，1000发/分钟，亮金色曳光弹，轻量化设计的国产机枪，机动性与火力兼备',
        equipSlot: 'weapon',
        attack: { range: 1600, knockback: 1, attackInterval: 60, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 650, minMultiplier: 0.35 } },
        heatParams: { overheatTime: 4000, overheatRecoverTime: 1500, overheatCooldownTime: 1500 },
        attackKey: 'qjb201', animConfigKey: 'qjb201', fireSound: 'assets/sounds/weapons/qjb201_single_600ms.wav', canvasImageProp: 'qjb201Image',
        ammoConfig: { max: 60, reloadTime: 2000 }, fireMode: 'fullAuto',
        attackFormula: { base: 5, enhanceFlat: 0.3, attrs: [{ key: 'str', base: 0.15, perEnhance: 0.025 }, { key: 'wis', base: 0.2, perEnhance: 0.03 }] },
        spreadParams: { startShots: 6, maxShots: 20, recoveryMs: 500, maxAngle: 30 }
    },
    RPD_ITEM: {
        weaponId: 'weapon31',
        name: 'RPD', type: '机枪', icon: '🔫', iconImage: 'assets/icons/rpd-equip.png',
        dropImage: 'assets/weapons/rpd-equip.png', equipImage: 'assets/weapons/rpd-equip.png', slotImage: 'assets/icons/rpd-equip.png',
        category: 'weapon_ranged', rarity: 'common', level: 4, price: 100,
        weaponCategory: 'mainhand', weaponType: 'rpd', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/rpd-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '5+力量×0.23+精神×0.20' }, { name: '射程', value: '1450' }],
        desc: 'RPD轻机枪，600发/分钟，100发弹鼓供弹；持续火力稳定，但换弹与散布恢复较慢',
        equipSlot: 'weapon',
        attack: { range: 1450, knockback: 3, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1180, damageFalloff: { start: 580, minMultiplier: 0.28 } },
        heatParams: { overheatTime: 7000, overheatRecoverTime: 2200, overheatCooldownTime: 2800 },
        attackKey: 'rpd', animConfigKey: 'rpd', fireSound: 'assets/sounds/weapons/rpd_fire.wav', equipSound: 'assets/sounds/weapons/rpd_equip.wav', canvasImageProp: 'rpdImage',
        ammoConfig: { max: 100, reloadTime: 4500, reloadSound: 'assets/sounds/weapons/rpd_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 5, enhanceFlat: 0.3, attrs: [{ key: 'str', base: 0.23, perEnhance: 0.035 }, { key: 'wis', base: 0.20, perEnhance: 0.025 }] },
        spreadParams: { startShots: 4, maxShots: 18, recoveryMs: 650, maxAngle: 32 }
    },
    M249_ITEM: {
        weaponId: 'weapon32',
        name: 'M249 SAW', type: '机枪', icon: '🔫', iconImage: 'assets/icons/m249-equip.png',
        dropImage: 'assets/weapons/m249-equip.png', equipImage: 'assets/weapons/m249-equip.png', slotImage: 'assets/icons/m249-equip.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8, price: 200,
        weaponCategory: 'mainhand', weaponType: 'm249', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/m249-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '5+力量×0.19+精神×0.18' }, { name: '射程', value: '1500' }],
        desc: 'M249班用自动武器，800发/分钟，100发弹袋供弹；高射速与快换枪管兼顾持续压制',
        equipSlot: 'weapon',
        attack: { range: 1500, knockback: 1, attackInterval: 75, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1260, damageFalloff: { start: 650, minMultiplier: 0.34 } },
        heatParams: { overheatTime: 5200, overheatRecoverTime: 2000, overheatCooldownTime: 2200 },
        attackKey: 'm249', animConfigKey: 'm249', fireSound: 'assets/sounds/weapons/m249_fire.wav', equipSound: 'assets/sounds/weapons/m249_equip.wav', canvasImageProp: 'm249Image',
        ammoConfig: { max: 100, reloadTime: 3200, reloadSound: 'assets/sounds/weapons/m249_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 5, enhanceFlat: 0.25, attrs: [{ key: 'str', base: 0.19, perEnhance: 0.029 }, { key: 'wis', base: 0.18, perEnhance: 0.028 }] },
        spreadParams: { startShots: 7, maxShots: 22, recoveryMs: 450, maxAngle: 25 }
    },
    ULTIMAX100_ITEM: {
        weaponId: 'weapon33',
        name: 'Ultimax 100 Mk8', type: '机枪', icon: '🔫', iconImage: 'assets/icons/ultimax100-equip.png',
        dropImage: 'assets/weapons/ultimax100-equip.png', equipImage: 'assets/weapons/ultimax100-equip.png', slotImage: 'assets/icons/ultimax100-equip.png',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8, price: 200,
        weaponCategory: 'mainhand', weaponType: 'ultimax100', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/ultimax100-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '6+力量×0.26+精神×0.25' }, { name: '射程', value: '1550' }],
        desc: 'Ultimax 100 Mk8轻机枪，600发/分钟，100发弹鼓供弹；恒定后坐结构带来优秀连续射击精度',
        equipSlot: 'weapon',
        attack: { range: 1550, knockback: 2, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1280, damageFalloff: { start: 720, minMultiplier: 0.40 } },
        heatParams: { overheatTime: 6000, overheatRecoverTime: 1600, overheatCooldownTime: 3000 },
        attackKey: 'ultimax100', animConfigKey: 'ultimax100', fireSound: 'assets/sounds/weapons/ultimax100_fire.wav', equipSound: 'assets/sounds/weapons/ultimax100_equip.wav', canvasImageProp: 'ultimax100Image',
        ammoConfig: { max: 100, reloadTime: 3600, reloadSound: 'assets/sounds/weapons/ultimax100_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 6, enhanceFlat: 0.3, attrs: [{ key: 'str', base: 0.26, perEnhance: 0.038 }, { key: 'wis', base: 0.25, perEnhance: 0.037 }] },
        spreadParams: { startShots: 12, maxShots: 30, recoveryMs: 300, maxAngle: 15 }
    },
    MG42_ITEM: {
        weaponId: 'weapon34',
        name: 'MG42', type: '机枪', icon: '🔫', iconImage: 'assets/icons/mg42-equip.png',
        dropImage: 'assets/weapons/mg42-equip.png', equipImage: 'assets/weapons/mg42-equip.png', slotImage: 'assets/icons/mg42-equip.png',
        category: 'weapon_ranged', rarity: 'common', level: 4, price: 100,
        weaponCategory: 'mainhand', weaponType: 'mg42', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/mg42-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3.5+力量×0.13+精神×0.13' }, { name: '射程', value: '1400' }],
        desc: 'MG42通用机枪，1200发/分钟，100发弹箱供弹；极高射速换来快速过热与猛烈散布',
        equipSlot: 'weapon',
        attack: { range: 1400, knockback: 1, attackInterval: 50, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1330, damageFalloff: { start: 520, minMultiplier: 0.22 } },
        heatParams: { overheatTime: 3200, overheatRecoverTime: 1900, overheatCooldownTime: 2600 },
        attackKey: 'mg42', animConfigKey: 'mg42', fireSound: 'assets/sounds/weapons/mg42_fire.wav', equipSound: 'assets/sounds/weapons/mg42_equip.wav', canvasImageProp: 'mg42Image',
        ammoConfig: { max: 100, reloadTime: 3600, reloadSound: 'assets/sounds/weapons/mg42_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 3.5, enhanceFlat: 0.25, attrs: [{ key: 'str', base: 0.13, perEnhance: 0.02 }, { key: 'wis', base: 0.13, perEnhance: 0.02 }] },
        spreadParams: { startShots: 2, maxShots: 12, recoveryMs: 1000, maxAngle: 40 }
    },
    FUSION_CORE_LMG_ITEM: {
        weaponId: 'weapon35',
        name: '熔核轻机枪', type: '机枪', icon: '🔫', iconImage: 'assets/icons/fusion-core-lmg-equip.png',
        dropImage: 'assets/weapons/fusion-core-lmg-equip.png', equipImage: 'assets/weapons/fusion-core-lmg-equip.png', slotImage: 'assets/icons/fusion-core-lmg-equip.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15, price: 800,
        weaponCategory: 'mainhand', weaponType: 'fusion_core_lmg', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/fusion-core-lmg-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '14+力量×0.55+精神×0.50' }, { name: '射程', value: '1750' }],
        desc: '熔核轻机枪以重型弹药进行中远距离压制；第20发进入红热增压，过热后仍可持续射击并提升60%伤害',
        equipSlot: 'weapon',
        attack: { range: 1750, knockback: 4, attackInterval: 240, hitType: '橙红重型曳光弹（红热增压）', damageType: '物理', projectileSpeed: 1450, damageFalloff: { start: 900, minMultiplier: 0.52 } },
        heatParams: { overheatTime: 4800, overheatRecoverTime: 2600, overheatCooldownTime: 3200 },
        overdriveHeatParams: { shotsToOverheat: 20, continueFiring: true, damageMultiplier: 1.6 },
        attackKey: 'fusion_core_lmg', animConfigKey: 'fusion_core_lmg', fireSound: 'assets/sounds/weapons/fusion_core_lmg_fire.wav', equipSound: 'assets/sounds/weapons/fusion_core_lmg_equip.wav', canvasImageProp: 'fusionCoreLmgImage',
        ammoConfig: { max: 40, reloadTime: 3100, reloadSound: 'assets/sounds/weapons/fusion_core_lmg_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 14, enhanceFlat: 0.9, attrs: [{ key: 'str', base: 0.55, perEnhance: 0.085 }, { key: 'wis', base: 0.5, perEnhance: 0.08 }] },
        spreadParams: { startShots: 8, maxShots: 24, recoveryMs: 450, maxAngle: 18 }
    },
    SINGULARITY_LOOM_LMG_ITEM: {
        weaponId: 'weapon36',
        name: '奇点织机', type: '机枪', icon: '🔫', iconImage: 'assets/icons/singularity-loom-lmg-equip.png',
        dropImage: 'assets/weapons/singularity-loom-lmg-equip.png', equipImage: 'assets/weapons/singularity-loom-lmg-equip.png', slotImage: 'assets/icons/singularity-loom-lmg-equip.png',
        category: 'weapon_ranged', rarity: 'mythic', level: 18, price: 1600,
        weaponCategory: 'mainhand', weaponType: 'singularity_loom_lmg', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/singularity-loom-lmg-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '12+力量×0.42+精神×0.42' }, { name: '射程', value: '1800' }],
        desc: '神话轻机枪“奇点织机”；主弹命中后会以青白引力弧弹射至400像素内最近的另一个目标，造成65%伤害，弹射不会递归。',
        equipSlot: 'weapon',
        attack: { range: 1800, knockback: 2, attackInterval: 120, hitType: '青白奇点曳光弹（最近目标弹射）', damageType: '物理', projectileSpeed: 1500, damageFalloff: { start: 900, minMultiplier: 0.52 } },
        heatParams: { overheatTime: 7200, overheatRecoverTime: 2200, overheatCooldownTime: 3000 },
        ricochetParams: { range: 400, damageMultiplier: 0.65, knockback: 2 },
        attackKey: 'singularity_loom_lmg', animConfigKey: 'singularity_loom_lmg', fireSound: 'assets/sounds/weapons/singularity_loom_lmg_fire.wav', equipSound: 'assets/sounds/weapons/singularity_loom_lmg_equip.wav', canvasImageProp: 'singularityLoomLmgImage',
        ammoConfig: { max: 70, reloadTime: 3500, reloadSound: 'assets/sounds/weapons/singularity_loom_lmg_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 12, enhanceFlat: 0.9, attrs: [{ key: 'str', base: 0.42, perEnhance: 0.065 }, { key: 'wis', base: 0.42, perEnhance: 0.065 }] },
        spreadParams: { startShots: 10, maxShots: 28, recoveryMs: 360, maxAngle: 17 }
    },
    CELESTIAL_CARTOGRAPHER_LMG_ITEM: {
        weaponId: 'weapon37',
        name: '天穹测绘者', type: '机枪', icon: '🔫', iconImage: 'assets/icons/celestial-cartographer-lmg-equip.png',
        dropImage: 'assets/weapons/celestial-cartographer-lmg-equip.png', equipImage: 'assets/weapons/celestial-cartographer-lmg-equip.png', slotImage: 'assets/icons/celestial-cartographer-lmg-equip.png',
        category: 'weapon_ranged', rarity: 'legendary', level: 21, price: 3200,
        weaponCategory: 'mainhand', weaponType: 'celestial_cartographer_lmg', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/celestial-cartographer-lmg-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '13+力量×0.46+精神×0.46' }, { name: '射程', value: '1850' }],
        desc: '传说轻机枪“天穹测绘者”；连续有效命中第4次建立星图锚点，第8次完成测绘：命中另一目标会拉出经纬线扫过沿线敌人，继续压制锚点则降下天顶坠击。停火700ms后序列重置。',
        equipSlot: 'weapon',
        attack: { range: 1850, knockback: 3, attackInterval: 105, hitType: '蓝金星图弹（经纬线/天顶坠击）', damageType: '物理', projectileSpeed: 1540, damageFalloff: { start: 940, minMultiplier: 0.55 } },
        heatParams: { overheatTime: 7600, overheatRecoverTime: 2100, overheatCooldownTime: 2900 },
        constellationParams: {
            anchorHit: 4, resolveHit: 8, resetMs: 700, lineWidth: 58, lineMaxTargets: 6,
            lineDamageMultiplier: 0.6, focusDamageMultiplier: 1.05, focusSplashRadius: 110,
            focusSplashMultiplier: 0.35, focusSplashMaxTargets: 4, knockback: 2
        },
        attackKey: 'celestial_cartographer_lmg', animConfigKey: 'celestial_cartographer_lmg', fireSound: 'assets/sounds/weapons/celestial_cartographer_lmg_fire.wav', equipSound: 'assets/sounds/weapons/celestial_cartographer_lmg_equip.wav', canvasImageProp: 'celestialCartographerLmgImage',
        ammoConfig: { max: 80, reloadTime: 3400, reloadSound: 'assets/sounds/weapons/celestial_cartographer_lmg_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 13, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.46, perEnhance: 0.07 }, { key: 'wis', base: 0.46, perEnhance: 0.07 }] },
        spreadParams: { startShots: 11, maxShots: 30, recoveryMs: 340, maxAngle: 16 }
    },
    GRAVE_COVENANT_CANTOR_LMG_ITEM: {
        weaponId: 'weapon38',
        name: '冥约颂炮', type: '机枪', icon: '🔫', iconImage: 'assets/icons/grave-covenant-cantor-lmg-equip.png',
        dropImage: 'assets/weapons/grave-covenant-cantor-lmg-equip.png', equipImage: 'assets/weapons/grave-covenant-cantor-lmg-equip.png', slotImage: 'assets/icons/grave-covenant-cantor-lmg-equip.png',
        category: 'weapon_ranged', rarity: 'legendary', level: 21, price: 3200,
        weaponCategory: 'mainhand', weaponType: 'grave_covenant_cantor_lmg', weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/grave-covenant-cantor-lmg-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '15+力量×0.50+精神×0.48' }, { name: '射程', value: '1750' }],
        desc: '传说轻机枪“冥约颂炮”；有效命中依次刻下血、骨、烬三印，同一目标在5秒内集齐三印会触发黑弥撒，对130像素内最多5名敌人造成75%伤害。裁决伤害不会再次刻印。',
        equipSlot: 'weapon',
        attack: { range: 1750, knockback: 4, attackInterval: 135, hitType: '赤金冥约弹（血骨烬三印裁决）', damageType: '物理', projectileSpeed: 1470, damageFalloff: { start: 860, minMultiplier: 0.54 } },
        heatParams: { overheatTime: 7800, overheatRecoverTime: 2400, overheatCooldownTime: 3200 },
        runeLitanyParams: { markDurationMs: 5000, verdictRadius: 130, verdictMaxTargets: 5, verdictDamageMultiplier: 0.75, inheritanceRange: 360, knockback: 3 },
        attackKey: 'grave_covenant_cantor_lmg', animConfigKey: 'grave_covenant_cantor_lmg', fireSound: 'assets/sounds/weapons/grave_covenant_cantor_lmg_fire.wav', equipSound: 'assets/sounds/weapons/grave_covenant_cantor_lmg_equip.wav', canvasImageProp: 'graveCovenantCantorLmgImage',
        ammoConfig: { max: 72, reloadTime: 3600, reloadSound: 'assets/sounds/weapons/grave_covenant_cantor_lmg_reload.wav' }, fireMode: 'fullAuto',
        attackFormula: { base: 15, enhanceFlat: 1.05, attrs: [{ key: 'str', base: 0.50, perEnhance: 0.075 }, { key: 'wis', base: 0.48, perEnhance: 0.072 }] },
        spreadParams: { startShots: 8, maxShots: 24, recoveryMs: 430, maxAngle: 20 }
    },
    SUPER90_ITEM: {
        weaponId: 'weapon12',
        name: 'Super90', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/firearms/super90.png',
        dropImage: 'assets/icons/M4s90_icon.png',
        equipImage: 'assets/icons/M4s90_icon.png',
        slotImage: 'assets/icons/firearms/super90.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/M4s90_icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '650' }],
        desc: 'Super90 半自动散弹枪，一次击发6发弹丸，单发装填换弹机制，近距离毁灭性火力',
        equipSlot: 'weapon',
        attack: { range: 650, knockback: 12.5, attackInterval: 333, hitType: '散弹（6发弹丸）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 260, minMultiplier: 0.22 } },
        attackKey: 'super90', animConfigKey: 'shotgun', fireSound: 'assets/sounds/weapons/gunshot_600ms_clean.wav', pelletCount: 6, equipSound: 'assets/sounds/weapons/bolt_pull_1s_clean.wav', canvasImageProp: 'super90Image',
        // 腰射贴图上移 4px（瞄准态抵消回 0；只动贴图渲染，手臂/锚点/弹道不受影响）
        spriteOffsetY: -4, aimSpriteOffsetY: 4,
        ammoConfig: { max: 7, reloadTime: 400, singleReloadMode: true, reloadSound: 'assets/sounds/weapons/Super90-reload.mp3' }, fireMode: 'semiAuto',
        spreadParams: { startShots: 0, maxShots: 1, recoveryMs: 400, maxAngle: 20 },
        attackFormula: { base: 10, enhanceFlat: 1, attrs: [{ key: 'con', base: 0.2, perEnhance: 0.10 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }], variants: { slugMode: { base: 8, enhanceFlat: 5, attrs: [{ key: 'con', base: 0.6, perEnhance: 0.05 }, { key: 'wis', base: 1, perEnhance: 0.1 }] } } }
    },
    SAIGA12K_ITEM: {
        weaponId: 'weapon13',
        name: 'SAIGA-12K', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/firearms/saiga-12k.png',
        dropImage: 'assets/icons/S12k-icon.png',
        equipImage: 'assets/icons/S12k-icon.png',
        slotImage: 'assets/icons/firearms/saiga-12k.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/icons/S12k-icon.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '600' }],
        desc: 'SAIGA-12K 半自动散弹枪，一次击发4发弹丸，正常弹夹换弹，高射速近距离火力',
        equipSlot: 'weapon',
        attack: { range: 600, knockback: 12.5, attackInterval: 150, hitType: '散弹（4发弹丸）', damageType: '物理', projectileSpeed: 1248, damageFalloff: { start: 220, minMultiplier: 0.2 } },
        attackKey: 'saiga12k', animConfigKey: 'shotgun', fireSound: 'assets/sounds/weapons/gunshot_600ms_open.wav', pelletCount: 4, canvasImageProp: 'saiga12kImage',
        // 贴图下移 12px（腰射/瞄准同步；只动贴图渲染，手臂/锚点/弹道不受影响）
        spriteOffsetY: 12,
        ammoConfig: { max: 12, reloadTime: 2000 }, fireMode: 'fullAuto',
        spreadParams: { startShots: 0, maxShots: 1, recoveryMs: 300, maxAngle: 20 },
        attackFormula: { base: 8, enhanceFlat: 1, attrs: [{ key: 'con', base: 0.5, perEnhance: 0.15 }, { key: 'wis', base: 0.25, perEnhance: 0.10 }], variants: { slugMode: { base: 8, enhanceFlat: 5, attrs: [{ key: 'con', base: 0.6, perEnhance: 0.05 }, { key: 'wis', base: 1, perEnhance: 0.1 }] } } }
    },
    KINGHTS_SWORD_ITEM: {
        weaponId: 'weapon2',
        name: '骑士长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/knights_sword_v3_macro.png',
        dropImage: 'assets/weapons/knights_sword_v3_equip.png',
        equipImage: 'assets/weapons/knights_sword_ingame_v2.png',
        category: 'weapon_melee', rarity: 'uncommon', level: 5,
        weaponCategory: 'mainhand', weaponType: 'sword',
        weaponTypeTag: '近战武器',
        stats: [{ name: '物理攻击', value: '18-23' }],
        desc: '骑士团的标准制式长剑，剑身修长，锋利且坚韧。适合有一定基础的剑士使用。',
        equipSlot: 'weapon2',
        attack: { range: 165, knockback: 8, attackInterval: 500, hitType: '三段连击（扇形挥砍）', damageType: '物理' },
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
    'spriteOffsetX', 'spriteOffsetY', 'aimSpriteOffsetX', 'aimSpriteOffsetY', 'castAnimKey'
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
    // 法杖强化曲线属于版本平衡真值；旧存档只保留强化等级/改造，不保留过时倍率。
    if (cfg.weaponType === 'staff' && cfg.matkFormula) {
        item.matkFormula = cfg.matkFormula;
    }
    for (const field of COMPLETE_WEAPON_FIELDS) {
        if (cfg[field] !== undefined && item[field] === undefined) {
            item[field] = cfg[field];
        }
    }
    return item;
}
