// Equipment Data Manager - Extracted from EquipManager
// Contains all equipment data definitions

export const EquipDataManager = {
    TEST_EQUIPMENTS: {
        helmet: { name: '新手布帽', type: '头盔', icon: '⛑', iconImage: 'assets/icons/helmet_icon.png', equipSlot: 'helmet', stats: [{ name: '物理防御', value: '+2', pos: true }, { name: '最大生命', value: '+15', pos: true }], desc: '一件破旧的头巾', level: 1, rarity: 'common' },
        necklace: { name: '粗制项链', type: '项链', icon: '📿', iconImage: '', equipSlot: 'necklace', stats: [{ name: '最大生命值', value: '+10', pos: true }, { name: '法力回复', value: '+1/秒', pos: true }], desc: '用绳子串起来的小石头', level: 1, rarity: 'common' },
        weapon: { weaponId: 'weapon1', name: '生锈的长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png', equipImage: 'assets/weapons/1-rusty_sword_euip.png', category: 'weapon_melee', equipSlot: 'weapon', stats: [{ name: '物理攻击', value: '12-18' }, { name: '暴击率', value: '+3%', pos: true }], desc: '一把锈迹斑斑的旧剑', level: 1, rarity: 'common', weaponType: 'sword' },
        armor: { name: '旧皮甲', type: '盔甲', icon: '🛡', iconImage: 'assets/icons/armor_icon.png', equipSlot: 'armor', stats: [{ name: '物理防御', value: '+5', pos: true }, { name: '最大生命', value: '+25', pos: true }, { name: '韧性', value: '+2', pos: true }], desc: '不知道传了多少手的皮甲', level: 1, rarity: 'common' },
        offhand: { name: '旧木盾', type: '副手', icon: '🛡', iconImage: 'assets/icons/shield_icon.png', category: 'armor', weaponCategory: 'offhand', equipSlot: 'offhand', stats: [{ name: '物理防御', value: '+3', pos: true }, { name: '格挡率', value: '+5%', pos: true }], desc: '用木板拼成的盾牌', level: 1, rarity: 'common' },
        weapon2: { weaponId: 'weapon14', name: '训练用弓', type: '弓', icon: '🏹', iconImage: 'assets/icons/trainingBOW.png', equipImage: 'assets/weapons/trainingBOW.png', category: 'weapon_ranged', rarity: 'common', level: 1, isTwoHanded: true, weaponCategory: 'mainhand', weaponType: 'bow', weaponTypeTag: '远程武器', weaponAsset: { framePrefix: 'assets/weapons/training_bow_frame_', frameCount: 9, framePad: 2 }, stats: [{ name: '物理攻击', value: '50-85' }, { name: '射程', value: '1500' }], desc: '一把适合初学者练习的弓，经过改良后拥有更远的射程和更强的威力', equipSlot: 'weapon', attack: { range: 1500, projectileSpeed: 30, knockback: 30, attackInterval: 1000, hitType: '箭矢（直线弹道）', damageType: '物理' } },
        ring1: null,
        gloves: { name: '皮手套', type: '手套', icon: '🧤', iconImage: 'assets/icons/gloves_icon.png', equipSlot: 'gloves', stats: [{ name: '物理攻击', value: '+2', pos: true }, { name: '攻击速度', value: '+3%', pos: true }], desc: '保护双手的皮手套', level: 1, rarity: 'common' },
        ring2: null,
        belt: { name: '腰带', type: '腰带', icon: '⛓', iconImage: 'assets/icons/belt_icon.png', equipSlot: 'belt', stats: [{ name: '最大体力', value: '+5', pos: true }, { name: '负重', value: '+10', pos: true }], desc: '一根普通的腰带', level: 1, rarity: 'common' },
        boots: { name: '旧皮靴', type: '靴子', icon: '👢', iconImage: 'assets/icons/boot_icon.png', equipSlot: 'boots', stats: [{ name: '移动速度', value: '+5%', pos: true }, { name: '闪避', value: '+2%', pos: true }], desc: '磨破了的旧靴子', level: 1, rarity: 'common' }
    },
    TEST_BACKPACK_ITEMS: [
        { slot: 0, name: '治疗药水', type: '消耗品', icon: '🧪', category: 'consumable', stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜', stack: 5 },
        { slot: 1, name: '魔力药水', type: '消耗品', icon: '💧', category: 'consumable', stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3 },
        { slot: 2, name: '金币', type: '货币', icon: '💰', category: 'gold', stats: [{ name: '数量', value: '10000' }], desc: '金光闪闪的硬币', stack: 10000, price: 1 }
    ],
    STEEL_BOW_ITEM: {
        name: '精钢长弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
        dropImage: 'assets/items/steel_bow_dropped.png',
        bowFrames: ['assets/weapons/steel_bow_frame_01.png','assets/weapons/steel_bow_frame_02.png','assets/weapons/steel_bow_frame_03.png','assets/weapons/steel_bow_frame_04.png','assets/weapons/steel_bow_frame_05.png','assets/weapons/steel_bow_frame_06.png','assets/weapons/steel_bow_frame_07.png','assets/weapons/steel_bow_frame_08.png'],
        stats: [{ name: '物理攻击', value: '15-25' }, { name: '射程', value: '800' }],
        desc: '由精钢打造的长弓，射程远，威力大',
        equipSlot: 'weapon2'
    },
    TEST_BOW_ITEM: {
        name: '训练用弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
        category: 'weapon_ranged', rarity: 'common', level: 1,
        weaponCategory: 'mainhand', weaponType: 'bow',
        weaponAsset: { framePrefix: 'assets/weapons/bow_frame_', frameCount: 8, framePad: 2 },
        stats: [{ name: '物理攻击', value: '8-14' }, { name: '射程', value: '600' }],
        desc: '一把简陋的弓，勉强能射出箭，适合初学者练习',
        equipSlot: 'weapon2'
    },
    G18_PISTOL_ITEM: {
        weaponId: 'weapon9',
        name: 'G18', type: '手枪', icon: '🔫', iconImage: 'assets/icons/G18icon.png',
        dropImage: 'assets/weapons/G18equip.png',
        equipImage: 'assets/weapons/G18equip.png',
        slotImage: 'assets/icons/G18icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 5,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/G18equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '650' }],
        desc: 'G18 全自动手枪，1100发/分钟，淡金色曳光弹，可双持',
        equipSlot: 'weapon',
        attack: { range: 650, knockback: 0, attackInterval: 55, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 13 }
    },
    DESERT_EAGLE_ITEM: {
        weaponId: 'weapon10',
        name: '沙漠之鹰', type: '手枪', icon: '🔫', iconImage: 'assets/icons/DesertEagle_icon.png',
        dropImage: 'assets/weapons/DesertEagle_equip.png',
        equipImage: 'assets/weapons/DesertEagle_equip.png',
        slotImage: 'assets/icons/DesertEagle_icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'pistol',
        weaponTypeTag: '远程武器', isTwoHanded: false,
        weaponAsset: { image: 'assets/weapons/DesertEagle_equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-8' }, { name: '射程', value: '750' }],
        desc: '沙漠之鹰半自动手枪，深黄色曳光弹，可双持，连续开火2秒后计算散布',
        equipSlot: 'weapon',
        attack: { range: 750, knockback: 10, attackInterval: 800, hitType: '深黄色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 20 },
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
    PKM_ITEM: {
        weaponId: 'weapon6',
        name: 'PKM', type: '机枪', icon: '🔫', iconImage: 'assets/icons/pkm_side_clean.png',
        dropImage: 'assets/weapons/pkm_topdown.png',
        equipImage: 'assets/weapons/pkm_topdown.png',
        slotImage: 'assets/icons/pkm_side_clean.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'pkm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/pkm_topdown.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '10-15' }, { name: '射程', value: '1200' }],
        desc: 'PKM通用机枪，650发/分钟，亮金色曳光弹，火力压制利器',
        equipSlot: 'weapon2',
        attack: { range: 1200, knockback: 3, attackInterval: 92, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 30 }
    },
    AKM_ITEM: {
        weaponId: 'weapon7',
        name: 'AKM', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/akm-equip.png',
        slotImage: 'assets/icons/akm-equip.png',
        equipImage: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png',
        category: 'weapon_ranged', rarity: 'rare', level: 10,
        weaponCategory: 'mainhand', weaponType: 'akm',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }],
        desc: 'AKM自动步枪，600发/分钟，亮金色曳光弹，可靠耐用的经典步枪',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 2, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 30 }
    },
    QBZ191_ITEM: {
        weaponId: 'weapon8',
        name: 'QBZ-191', type: '自动步枪', icon: '🔫', iconImage: 'assets/icons/191icon.png',
        slotImage: 'assets/icons/191icon.png',
        equipImage: 'assets/weapons/191equip_clean.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12,
        weaponCategory: 'mainhand', weaponType: 'qbz191',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/191equip_clean.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }],
        desc: 'QBZ-191自动步枪，850发/分钟，亮金色曳光弹，新一代国产步枪',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 2, attackInterval: 70, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 36 }
    },
    QJB201_ITEM: {
        weaponId: 'weapon11',
        name: 'QJB-201', type: '机枪', icon: '🔫', iconImage: 'assets/icons/201-icon.png',
        dropImage: 'assets/weapons/201equip.png',
        equipImage: 'assets/weapons/201equip.png',
        slotImage: 'assets/icons/201-icon.png',
        category: 'weapon_ranged', rarity: 'rare', level: 12,
        weaponCategory: 'mainhand', weaponType: 'qjb201',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/201equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }],
        desc: 'QJB-201班用机枪，1000发/分钟，亮金色曳光弹，轻量化设计的国产机枪，机动性与火力兼备',
        equipSlot: 'weapon',
        attack: { range: 1200, knockback: 1, attackInterval: 60, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 18 }
    },
    SUPER90_ITEM: {
        weaponId: 'weapon12',
        name: 'Super90', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/M4s90_icon.png',
        dropImage: 'assets/weapons/M4s90_equip.png',
        equipImage: 'assets/weapons/M4s90_equip.png',
        slotImage: 'assets/icons/M4s90_icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/M4s90_equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '500' }],
        desc: 'Super90 半自动散弹枪，一次击发6发弹丸，单发装填换弹机制，近距离毁灭性火力',
        equipSlot: 'weapon',
        attack: { range: 500, knockback: 12.5, attackInterval: 333, hitType: '散弹（6发弹丸）', damageType: '物理', projectileSpeed: 25 }
    },
    SAIGA12K_ITEM: {
        weaponId: 'weapon13',
        name: 'SAIGA-12K', type: '散弹枪', icon: '🔫', iconImage: 'assets/icons/S12k-icon.png',
        dropImage: 'assets/weapons/S12k-equip.png',
        equipImage: 'assets/weapons/S12k-equip.png',
        slotImage: 'assets/icons/S12k-icon.png',
        category: 'weapon_ranged', rarity: 'epic', level: 15,
        weaponCategory: 'mainhand', weaponType: 'shotgun',
        weaponTypeTag: '远程武器', isTwoHanded: true,
        weaponAsset: { image: 'assets/weapons/S12k-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '400' }],
        desc: 'SAIGA-12K 半自动散弹枪，一次击发4发弹丸，正常弹夹换弹，高射速近距离火力',
        equipSlot: 'weapon',
        attack: { range: 400, knockback: 12.5, attackInterval: 150, hitType: '散弹（4发弹丸）', damageType: '物理', projectileSpeed: 15 }
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
        attack: { range: 155, knockback: 8, attackInterval: 500, damageType: '物理' },
        specialAttack: {
            cooldown: 5,
            damageType: '物理',
            damageFormula: '武器攻击力 × (0.80 + 等级×0.05)',
            duration: 0.6
        },
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
                    hitArc: 0
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
        attack: { range: 155, knockback: 8, attackInterval: 500, damageType: '物理' },
        specialAttack: {
            cooldown: 5,
            damageType: '魔法+物理混合',
            damageFormula: '魔法伤害×1.2 + 物理伤害',
            duration: 30
        }
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
        specialAttack: {
            cooldown: 5,
            damageType: '魔法',
            damageFormula: '武器攻击力 × 0.25（每0.2秒一次）',
            duration: 3
        }
    },

};
