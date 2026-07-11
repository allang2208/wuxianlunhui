import { GoldManager } from '../systems/gold-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EventBus } from '../core/event-bus.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { SystemUI } from './system-ui.js';

const ShopSystem = {
    _isOpen: false,
    _currentNPC: null,
    _selectedSellItems: [],

    _items: [
        { id: 'rusty_sword', weaponId: 'weapon1', name: '生锈的长剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png', category: 'weapon_melee', rarity: 'common', type: '单手剑', price: 100, equipSlot: 'weapon', weaponType: 'sword', weaponCategory: 'mainhand', weaponTypeTag: '近战武器', equipImage: 'assets/weapons/1-rusty_sword_euip.png', stats: [{ name: '物理攻击', value: '12-18' }, { name: '暴击率', value: '+3%' }], desc: '一把锈迹斑斑的旧剑', level: 1, attack: { range: 124, knockback: 6, attackInterval: 500, hitType: '突刺（扇形判定）', damageType: '物理' }, animation: { type: 'thrust（突刺）', totalMs: '1100ms (200+500+400)', windupMs: 200, swingMs: 500, recoveryMs: 400, idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°', holdOffset: '(-20, 11)', weaponSize: 63, timingMul: '1.0x (标准)', description: '三段式突刺动画：预备→前刺→回位。 windup 阶段剑身向后上方扬起，swing 阶段快速向前突刺，recover 阶段回到待机姿态。' } },
        { id: 'knights_sword', weaponId: 'weapon2', name: '骑士长剑', icon: '⚔', iconImage: 'assets/icons/knights_sword_v3_macro.png', category: 'weapon_melee', rarity: 'uncommon', type: '单手剑', price: 100, equipSlot: 'weapon2', weaponType: 'sword', weaponCategory: 'mainhand', weaponTypeTag: '近战武器', equipImage: 'assets/weapons/knights_sword_v3_equip.png', stats: [{ name: '物理攻击', value: '18-23' }], desc: '骑士团的标准制式长剑，剑身修长，锋利且坚韧。适合有一定基础的剑士使用。', level: 5, attack: { range: 155, rangeBonus: 50, knockback: 8, attackInterval: 500, hitType: '突刺（扇形判定）', damageType: '物理' }, skillOverrides: { dashAttackThrust: { animation: { totalMs: 600, dashDist: 173, chargeMs: 0, thrustMs: 600, recoverMs: 0 }, hitCheck: { shape: 'rectangle', width: 75, length: 350, hitArc: 0, lengthBonus: 50, backOffset: -30 } } } },
        { id: 'rune_sword', weaponId: 'weapon4', name: '符文长剑', icon: '⚔', iconImage: 'assets/icons/EXsword_icon.png', category: 'weapon_melee', rarity: 'uncommon', type: '单手剑', price: 100, equipSlot: 'weapon', weaponType: 'sword', weaponCategory: 'mainhand', weaponTypeTag: '近战武器', equipImage: 'assets/weapons/EXsword_equipped_v2_.png', stats: [{ name: '物理攻击', value: '45-55' }, { name: '暴击率', value: '+5%' }], desc: '剑身上铭刻着上古符文的传奇长剑，符文之力蕴含其中，持有者能感受到符文中流淌的力量。剑刃在挥动时会留下淡蓝色的符文残影，威力远超凡铁。', level: 5, attack: { range: 124, knockback: 6, attackInterval: 500, hitType: '突刺（扇形判定）', damageType: '物理' }, animation: { type: 'thrust（突刺）', totalMs: '1100ms (200+500+400)', windupMs: 200, swingMs: 500, recoveryMs: 400, idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°', holdOffset: '(-20, 11)', weaponSize: 63, timingMul: '1.0x (标准)', description: '三段式突刺动画：预备→前刺→回位。符文长剑的刺击带有符文残影，威力远超凡铁。' } },
        { id: 'night_flame_sword', weaponId: 'weapon5', name: '夜与火之剑', icon: '⚔', iconImage: 'assets/icons/Nightandflame_macro.png', category: 'weapon_melee', rarity: 'rare', type: '单手剑', price: 100, equipSlot: 'weapon', weaponType: 'sword', weaponCategory: 'mainhand', weaponTypeTag: '近战武器', equipImage: 'assets/weapons/Nightandflame_equip.png', stats: [{ name: '物理攻击', value: '60-75' }, { name: '暴击率', value: '+5%' }], desc: '一把在暗夜中燃烧着淡蓝色火焰的传奇之剑，传说中它同时寄宿着夜之力与火之力。持有者可以释放其中的火焰之力，发射毁灭性的光柱。', level: 10, attack: { range: 124, knockback: 6, attackInterval: 500, hitType: '突刺（扇形判定）', damageType: '物理' }, animation: { type: 'thrust（突刺）', totalMs: '1100ms (200+500+400)', windupMs: 200, swingMs: 500, recoveryMs: 400, idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°', holdOffset: '(-20, 11)', weaponSize: 63, timingMul: '1.0x (标准)', description: '三段式突刺动画：预备→前刺→回位。夜与火之剑的刺击带有淡蓝色火焰轨迹，可释放毁灭性光柱。' }, specialAttack: { cooldown: 10, damageMul: 0.25, width: 30, length: 700, duration: 3000, tickInterval: 200 } },
        { id: 'small_shield', weaponId: 'weapon17', name: '小圆盾', icon: '🛡', iconImage: 'assets/icons/woodshied.png', equipImage: 'assets/weapons/woodshied-equip.png', dropImage: 'assets/items/woodshied_dropped.png', slotImage: 'assets/icons/woodshied.png', category: 'weapon_shield', rarity: 'common', type: '盾', price: 80, equipSlot: 'offhand', weaponType: 'shield', weaponCategory: 'offhand', weaponTypeTag: '副手武器', isTwoHanded: false, stats: [{ name: '物理防御', value: '15' }, { name: '防御减伤', value: '50%' }], desc: '一块用硬木削成的圆盾，虽然简陋，但足以挡住致命的攻击。', level: 1, attack: { range: 0, knockback: 0, attackInterval: 0, hitType: '格挡', damageType: '物理' }, weaponAsset: { image: 'assets/weapons/woodshied-equip.png' }, defense: { base: 15, perEnhance: 1.5, damageReduction: 0.5, staminaCost: 20, parryWindow: 1000, parryStun: 1000, parryKnockback: 100 } },
        { id: 'small_shield', weaponId: 'weapon17', name: '小圆盾', icon: '🛡', iconImage: 'assets/icons/woodshied.png', equipImage: 'assets/weapons/woodshied-equip.png', dropImage: 'assets/items/woodshied_dropped.png', slotImage: 'assets/icons/woodshied.png', category: 'weapon_shield', rarity: 'common', type: '盾', price: 80, equipSlot: 'offhand', weaponType: 'shield', weaponCategory: 'offhand', weaponTypeTag: '副手武器', isTwoHanded: false, stats: [{ name: '物理防御', value: '15' }, { name: '防御减伤', value: '50%' }], desc: '一块用硬木削成的圆盾，虽然简陋，但足以挡住致命的攻击。', level: 1, attack: { range: 0, knockback: 0, attackInterval: 0, hitType: '格挡', damageType: '物理' }, weaponAsset: { image: 'assets/weapons/woodshied-equip.png' }, defense: { base: 15, perEnhance: 1.5, damageReduction: 0.5, staminaCost: 20, parryWindow: 1000, parryStun: 1000, parryKnockback: 100 } },
        { id: 'g18', weaponId: 'weapon9', name: 'G18', icon: '🔫', iconImage: 'assets/icons/G18icon.png', category: 'weapon_ranged', rarity: 'rare', type: '手枪', price: 400, equipSlot: 'weapon', weaponType: 'pistol', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: false, dropImage: 'assets/weapons/G18equip.png', equipImage: 'assets/weapons/G18equip.png', slotImage: 'assets/icons/G18icon.png', stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '650' }], desc: 'G18 全自动手枪，1100发/分钟，淡金色曳光弹，可双持', level: 5, attack: { range: 650, knockback: 0, attackInterval: 55, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '55ms (约)', windupMs: '≈12', swingMs: '≈18', recoveryMs: '≈25', holdOffset: '(0, 4)', weaponSize: 84, timingMul: '0.06x (极速)', recoilAmount: '0.15rad', description: 'G18 以1100RPM的射速连续射击，单次开火动画仅约55ms。可双持，双持时左右手同时开火。' }, weaponAsset: { image: 'assets/weapons/G18equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' }, attackKey: 'pistol', offhandAttackKey: 'pistolOffhand', animConfigKey: 'pistol', fireSound: 'assets/sounds/akm_burst.mp3', isDarkGold: false, canvasImageProp: 'pistolImage', ammoConfig: { max: 12, reloadTime: 1000 }, fireMode: 'fullAuto', attackFormula: { base: 5, enhanceFlat: 1, attrs: [{ key: 'dex', base: 0.35, perEnhance: 0.15 }, { key: 'wis', base: 0.4, perEnhance: 0.15 }] }, spreadParams: { startDelay: 0, maxTime: 300, maxAngle: 25 } },
        { id: 'p4040', weaponId: 'weapon18', name: 'P4040', icon: '🔫', iconImage: 'assets/weapons/P4040-icon.png', category: 'weapon_ranged', rarity: 'epic', type: '手枪', price: 600, equipSlot: 'weapon', weaponType: 'pistol', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: false, dropImage: 'assets/weapons/P4040-equip.png', equipImage: 'assets/weapons/P4040-equip.png', slotImage: 'assets/weapons/P4040-icon.png', stats: [{ name: '物理攻击', value: '2-4' }, { name: '射程', value: '750' }], desc: 'P4040半自动手枪，可双持，精准射击', level: 15, attack: { range: 750, knockback: 2, attackInterval: 300, hitType: '淡金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248, bulletSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '300ms (约)', windupMs: '≈75', swingMs: '≈100', recoveryMs: '≈125', holdOffset: '(0, 4)', weaponSize: 84, timingMul: '0.5x (慢速)', recoilAmount: '0.08rad', description: 'P4040 以较慢射速开火，单次开火动画约300ms。后坐力抖动幅度较小，与射击频率一致。' }, weaponAsset: { image: 'assets/weapons/P4040-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' }, attackKey: 'p4040', offhandAttackKey: 'p4040Offhand', animConfigKey: 'p4040', fireSound: 'assets/sounds/apex2_shot_1s.wav', isDarkGold: true, canvasImageProp: 'pistolImage', ammoConfig: { max: 12, reloadTime: 1200 }, fireMode: 'semiAuto', attackFormula: { base: 8, enhanceFlat: 1, attrs: [{ key: 'dex', base: 0.75, perEnhance: 0.15 }, { key: 'wis', base: 1, perEnhance: 0.25 }] }, spreadParams: { startDelay: 0, maxTime: 0, maxAngle: 1 } },
        { id: 'pkm', weaponId: 'weapon6', name: 'PKM', icon: '🔫', iconImage: 'assets/icons/pkm_side_clean.png', category: 'weapon_ranged', rarity: 'rare', type: '机枪', price: 500, equipSlot: 'weapon2', weaponType: 'pkm', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/pkm_topdown.png', stats: [{ name: '物理攻击', value: '10+力量×0.5+精神×0.4' }, { name: '射程', value: '1200' }], desc: 'PKM通用机枪，650发/分钟，亮金色曳光弹，火力压制利器', level: 10, attack: { range: 1200, knockback: 3, attackInterval: 92, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, attackFormula: { base: 10, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.5, perEnhance: 0.15 }, { key: 'wis', base: 0.4, perEnhance: 0.12 }] }, animation: { type: 'recoil（后坐力抖动）', totalMs: '92ms (约)', windupMs: '≈20', swingMs: '≈30', recoveryMs: '≈42', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.1x (高速)', recoilAmount: '0.12rad', description: 'PKM 以650RPM的射速连续射击，单次开火动画约92ms。采用后坐力抖动模式：每次开火枪身快速上扬后回位。timingMul=0.1 确保动画总时长小于92ms的射击间隔。' }, weaponAsset: { image: 'assets/weapons/pkm_topdown.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'akm', weaponId: 'weapon7', name: 'AKM', icon: '🔫', iconImage: 'assets/icons/akm-equip.png', category: 'weapon_ranged', rarity: 'rare', type: '自动步枪', price: 600, equipSlot: 'weapon', weaponType: 'akm', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png', equipImage: 'assets/weapons/akm-equip.png', slotImage: 'assets/weapons/akm-equip.png', stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }], desc: 'AKM自动步枪，600发/分钟，亮金色曳光弹，可靠耐用的经典步枪', level: 10, attack: { range: 1200, knockback: 2, attackInterval: 100, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '100ms (约)', windupMs: '≈20', swingMs: '≈30', recoveryMs: '≈50', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.1x (高速)', recoilAmount: '0.12rad', description: 'AKM 以600RPM的射速连续射击，单次开火动画约100ms。采用后坐力抖动模式，与PKM共用相同动画系统。' }, weaponAsset: { image: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'qbz191', weaponId: 'weapon8', name: 'QBZ-191', icon: '🔫', iconImage: 'assets/icons/191icon.png', category: 'weapon_ranged', rarity: 'rare', type: '自动步枪', price: 700, equipSlot: 'weapon', weaponType: 'qbz191', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/191equip_clean.png', equipImage: 'assets/weapons/191equip_clean.png', slotImage: 'assets/weapons/191equip_clean.png', stats: [{ name: '物理攻击', value: '3-6' }, { name: '射程', value: '1200' }], desc: 'QBZ-191自动步枪，850发/分钟，亮金色曳光弹，新一代国产步枪', level: 12, attack: { range: 1200, knockback: 2, attackInterval: 70, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '70ms (约)', windupMs: '≈15', swingMs: '≈20', recoveryMs: '≈35', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.07x (高速)', recoilAmount: '0.10rad', description: 'QBZ-191 以850RPM的射速连续射击，单次开火动画约70ms。采用后坐力抖动模式，与PKM/AKM共用相同动画系统。' }, weaponAsset: { image: 'assets/weapons/191equip_clean.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'desert_eagle', weaponId: 'weapon10', name: '沙漠之鹰', icon: '🔫', iconImage: 'assets/icons/DesertEagle_icon.png', category: 'weapon_ranged', rarity: 'epic', type: '手枪', price: 800, equipSlot: 'weapon', weaponType: 'pistol', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: false, dropImage: 'assets/weapons/Desert eagle-eqiup.png', equipImage: 'assets/weapons/Desert eagle-eqiup.png', slotImage: 'assets/icons/DesertEagle_icon.png', stats: [{ name: '物理攻击', value: '3-8' }, { name: '射程', value: '750' }], desc: '沙漠之鹰半自动手枪，深黄色曳光弹，可双持，连续开火2秒后计算散布', level: 15, attack: { range: 750, knockback: 10, attackInterval: 800, hitType: '深黄色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '800ms (约)', windupMs: '≈200', swingMs: '≈300', recoveryMs: '≈300', holdOffset: '(0, 4)', weaponSize: 84, timingMul: '0.5x (慢速)', recoilAmount: '0.10rad', description: '沙漠之鹰以较慢射速开火，单次开火动画约800ms。后坐力抖动幅度较小，与射击频率一致。' }, weaponAsset: { image: 'assets/weapons/Desert eagle-eqiup.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' }, attackKey: 'deagle', offhandAttackKey: 'deagleOffhand', animConfigKey: 'deagle', fireSound: 'assets/sounds/cs_deagle_35_80.wav', isDarkGold: true, canvasImageProp: 'deagleImage', ammoConfig: { max: 6, reloadTime: 1750 }, fireMode: 'semiAuto', attackFormula: { base: 30, enhanceFlat: 0, attrs: [{ key: 'dex', base: 1, perEnhance: 0 }, { key: 'wis', base: 2, perEnhance: 0 }] }, spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 30 } },
        { id: 'qjb201', weaponId: 'weapon11', name: 'QJB-201', icon: '🔫', iconImage: 'assets/icons/201-icon.png', category: 'weapon_ranged', rarity: 'rare', type: '机枪', price: 900, equipSlot: 'weapon', weaponType: 'qjb201', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/201equip.png', equipImage: 'assets/weapons/201equip.png', slotImage: 'assets/icons/201-icon.png', stats: [{ name: '物理攻击', value: '7+力量×0.35+精神×0.5' }, { name: '射程', value: '1200' }], desc: 'QJB-201班用机枪，1000发/分钟，亮金色曳光弹，轻量化设计的国产机枪，机动性与火力兼备', level: 12, attack: { range: 1200, knockback: 1, attackInterval: 60, hitType: '亮金色曳光弹（直线弹道）', damageType: '物理', projectileSpeed: 1248 }, attackFormula: { base: 7, enhanceFlat: 1, attrs: [{ key: 'str', base: 0.35, perEnhance: 0.10 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }] }, animation: { type: 'recoil（后坐力抖动）', totalMs: '60ms (约)', windupMs: '≈12', swingMs: '≈18', recoveryMs: '≈30', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.06x (高速)', recoilAmount: '0.08rad', description: 'QJB-201 以1000RPM的射速连续射击，单次开火动画约60ms。采用后坐力抖动模式，轻量化设计带来更小的后坐力。' }, weaponAsset: { image: 'assets/weapons/201equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'super90', weaponId: 'weapon12', name: 'Super90', icon: '🔫', iconImage: 'assets/icons/M4s90_icon.png', category: 'weapon_ranged', rarity: 'epic', type: '散弹枪', price: 1200, equipSlot: 'weapon', weaponType: 'shotgun', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/M4s90_equip.png', equipImage: 'assets/weapons/M4s90_equip.png', slotImage: 'assets/icons/M4s90_icon.png', stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '500' }], desc: 'Super90 半自动散弹枪，一次击发6发弹丸，单发装填换弹机制，近距离毁灭性火力', level: 15, attack: { range: 500, knockback: 12.5, attackInterval: 333, hitType: '散弹（6发弹丸）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '500ms (约)', windupMs: '≈100', swingMs: '≈200', recoveryMs: '≈200', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.5x (慢速)', recoilAmount: '0.15rad', description: 'Super90 以较慢射速开火，单次开火动画约500ms。一次击发6发弹丸，近距离毁灭性火力。' }, weaponAsset: { image: 'assets/weapons/M4s90_equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'saiga12k', weaponId: 'weapon13', name: 'SAIGA-12K', icon: '🔫', iconImage: 'assets/icons/S12k-icon.png', category: 'weapon_ranged', rarity: 'epic', type: '散弹枪', price: 1500, equipSlot: 'weapon', weaponType: 'shotgun', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/S12k-equip.png', equipImage: 'assets/weapons/S12k-equip.png', slotImage: 'assets/icons/S12k-icon.png', stats: [{ name: '物理攻击', value: '1-3' }, { name: '射程', value: '400' }], desc: 'SAIGA-12K 半自动散弹枪，一次击发4发弹丸，正常弹夹换弹，高射速近距离火力', level: 15, attack: { range: 400, knockback: 12.5, attackInterval: 150, hitType: '散弹（4发弹丸）', damageType: '物理', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '150ms (约)', windupMs: '≈30', swingMs: '≈60', recoveryMs: '≈60', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.15x (高速)', recoilAmount: '0.15rad', description: 'SAIGA-12K 以高射速开火，单次开火动画约150ms。一次击发4发弹丸，散布±20°。' }, weaponAsset: { image: 'assets/weapons/S12k-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' } },
        { id: 'energy_lmg', weaponId: 'weapon15', name: '能量轻机枪', icon: '🔫', iconImage: 'assets/icons/devotion-icon.png', category: 'weapon_ranged', rarity: 'epic', type: '机枪', price: 2000, equipSlot: 'weapon', weaponType: 'energy_lmg', weaponCategory: 'mainhand', weaponTypeTag: '远程武器', isTwoHanded: true, dropImage: 'assets/weapons/devotion-equip.png', equipImage: 'assets/weapons/devotion-equip.png', slotImage: 'assets/icons/devotion-icon.png', stats: [{ name: '魔法攻击', value: '6+力量/精神' }, { name: '射程', value: '1200' }], desc: '能量轻机枪，无限子弹，亮绿色曳光弹，持续开火射速线性提升，过热冷却系统', level: 15, attack: { range: 1200, knockback: 0, attackInterval: 333, hitType: '亮绿色曳光弹（直线弹道）', damageType: '魔法', projectileSpeed: 1248 }, animation: { type: 'recoil（后坐力抖动）', totalMs: '333ms (约)', windupMs: '≈50', swingMs: '≈75', recoveryMs: '≈125', holdOffset: '(0, 6)', weaponSize: 96, timingMul: '0.25x (高速)', recoilAmount: '0.10rad', description: '能量轻机枪以可变射速连续射击，初始333ms间隔，持续开火后逐渐加速至50ms。采用后坐力抖动模式，亮绿色曳光弹。' }, weaponAsset: { image: 'assets/weapons/devotion-equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' }, energyLMGParams: { baseCooldown: 333, maxCooldown: 50, rampUpTime: 2500, overheatTime: 4000, overheatRecoverTime: 2500, overheatCooldownTime: 4000, spreadMaxTime: 2500, maxSpreadAngle: 15 } },
        { id: 'hp_potion', name: '治疗药水', icon: '🧪', iconImage: 'assets/items/health_potion.png', category: 'consumable', rarity: 'common', type: '消耗品', price: 100, stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜。饮用后可恢复30点生命值。', stack: 1, maxStack: 99 },
        { id: 'mp_potion', name: '魔力药水', icon: '💧', iconImage: 'assets/items/mana_potion.png', category: 'consumable', rarity: 'common', type: '消耗品', price: 100, stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气。饮用后可恢复25点魔法值。', stack: 1, maxStack: 99 }
    ],

    open(npc) {
        UIState.open('shop');
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = getElement('shopPanel');
        if (panel) panel.classList.add('active');
        this._setupSellGridDrop();
        this._updateUI();
    },

    close() {
        UIState.close('shop');
        this._isOpen = false;
        this._currentNPC = null;
        this._returnAllSellItems();
        const panel = getElement('shopPanel');
        if (panel) panel.classList.remove('active');
        TimerManager.setTimeout(() => {
            if (!UIState.isOpen('shop') && !UIState.isOpen('enhance') && !UIState.isOpen('craft') && !UIState.isOpen('enchant')) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (UIState.isOpen('shop')) this.close();
        else this.open();
    },

    // 金币操作方法（使用 GoldManager 集中管理）
    _getBackpackGold() {
        return (GoldManager) ? GoldManager.getGold() : 0;
    },

    _deductGold(amount) {
        return (GoldManager) ? GoldManager.deductGold(amount) : false;
    },

    _addGold(amount) {
        return (GoldManager) ? GoldManager.addGold(amount) : false;
    },

    buy(itemId) {
        const player = Game.player;
        if (!player) return;
        const item = this._items.find(i => i.id === itemId);
        if (!item) return;
        // 检查背包是否已满
        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
            EquipManager._showBackpackFullNotice();
            return;
        }
        if (this._getBackpackGold() < item.price) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币不足！', '#ff4444'));
            return;
        }
        if (!this._deductGold(item.price)) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币不足！', '#ff4444'));
            return;
        }
        const itemClone = JSON.parse(JSON.stringify(item));
        delete itemClone.id;
        delete itemClone.price;
        EquipManager.addToInventory(itemClone);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `购买成功：${item.name}`, '#ffd700'));
        this._updateUI();
    },

    // 从背包移动物品到出售栏
    addToSellGrid(bpIndex) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.findIndex(i => i.slot === bpIndex);
        if (idx < 0) return;
        const item = bp[idx];
        if (item.category === 'gold' || item.name === '金币') {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '金币不可卖出！', '#ff4444'));
            return;
        }
        // 从背包移除
        bp.splice(idx, 1);
        this._selectedSellItems.push({ item: JSON.parse(JSON.stringify(item)), source: 'backpack', bpIndex });
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    // 从装备栏移动物品到出售栏
    addEquipToSellGrid(slotKey) {
        const item = Game.player.equipments[slotKey];
        if (!item) return;
        // 从装备栏移除
        Game.player.equipments[slotKey] = null;
        EquipManager._clearWeaponState(slotKey);
        this._selectedSellItems.push({ item: JSON.parse(JSON.stringify(item)), source: 'equip', slotKey });
        EquipManager.updateEquipSlots();
        this._updateUI();
    },

    // 从出售栏移除并还原到背包
    removeFromSellGrid(index) {
        const sel = this._selectedSellItems[index];
        if (!sel) return;
        const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < EquipManager.maxBackpackSlots) slot++;
        if (slot >= EquipManager.maxBackpackSlots) {
            EquipManager._showBackpackFullNotice();
            return;
        }
        const clone = JSON.parse(JSON.stringify(sel.item));
        clone.slot = slot;
        if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
        EquipManager.backpackItems.push(clone);
        this._selectedSellItems.splice(index, 1);
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    // 关闭时归还所有出售栏物品
    _returnAllSellItems() {
        for (const sel of this._selectedSellItems) {
            const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
            let slot = 0;
            while (usedSlots.has(slot) && slot < 36) slot++;
            if (slot >= 36) continue;
            const clone = JSON.parse(JSON.stringify(sel.item));
            clone.slot = slot;
            if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
            EquipManager.backpackItems.push(clone);
        }
        this._selectedSellItems = [];
        EquipManager.updateInventorySlots();
    },

    confirmSell() {
        const player = Game.player;
        if (!player) return;
        if (this._selectedSellItems.length === 0) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '出售栏为空！', '#ff4444'));
            return;
        }
        let totalGold = 0;
        for (const sel of this._selectedSellItems) {
            const sellPrice = Math.max(1, Math.floor((sel.item.price || 50) * 0.5));
            totalGold += sellPrice;
        }
        this._addGold(totalGold);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `卖出 ${this._selectedSellItems.length} 件物品，获得 ${totalGold} 金币`, '#ffd700'));
        if (SoundManager) {
            SoundManager.playFile('assets/sounds/sell.wav');
        }
        this._selectedSellItems = [];
        this._updateUI();
    },

    // 设置出售栏为拖放目标
    _setupSellGridDrop() {
        const sellGrid = getElement('shopSellGrid');
        if (!sellGrid) return;
        sellGrid.ondragover = (e) => {
            if (!EquipManager._dragDropManager._dragSrc) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            sellGrid.classList.add('drag-over');
        };
        sellGrid.ondragleave = (_e) => {
            sellGrid.classList.remove('drag-over');
        };
        sellGrid.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sellGrid.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold') {
                    this.addToSellGrid(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item) {
                    this.addEquipToSellGrid(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };
    },

    _updateUI() {
        const player = Game.player;
        const moneyEl = getElement('shopMoney');
        if (moneyEl && player) moneyEl.textContent = `💰 ${this._getBackpackGold()}`;

        const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };

        const buyGrid = getElement('shopBuyGrid');
        if (buyGrid) {
            buyGrid.innerHTML = '';
            this._items.forEach(item => {
                const cell = document.createElement('div');
                cell.className = 'shop-buy-cell';
                const rarityKey = item.rarity || 'common';
                const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                const iconHtml = item.iconImage
                    ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                    : item.icon;
                cell.innerHTML = `
                    <div class="buy-cell-rarity rarity-${rarityKey}">${rarityLabel}</div>
                    <div class="buy-cell-icon">${iconHtml}</div>
                    <div class="buy-cell-name">${item.name}</div>
                `;
                cell.ondblclick = () => this.buy(item.id);
                cell.oncontextmenu = (e) => { e.preventDefault(); this.buy(item.id); };
                // 浮窗事件绑定
                const tooltip = getElement('equipTooltip');
                cell.onmouseenter = function(e) {
                    if (tooltip._pinned) return;
                    EquipTooltipManager.renderTooltip(item);
                    tooltip.classList.add('visible');
                    EquipTooltipManager._positionTooltip(e);
                    cell._ttMoveHandler = EquipTooltipManager._positionTooltip;
                    document.addEventListener('mousemove', cell._ttMoveHandler);
                };
                cell.onmouseleave = function() {
                    if (tooltip._pinned) return;
                    tooltip.classList.remove('visible');
                    if (cell._ttMoveHandler) {
                        document.removeEventListener('mousemove', cell._ttMoveHandler);
                        cell._ttMoveHandler = null;
                    }
                };
                cell.onmousedown = function(e) {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    if (tooltip._pinned) {
                        tooltip.classList.remove('visible', 'pinned');
                        tooltip._pinned = false;
                    } else {
                        EquipTooltipManager.renderTooltip(item);
                        tooltip.classList.add('visible', 'pinned');
                        tooltip._pinned = true;
                        EquipTooltipManager._positionTooltip(e);
                        if (cell._ttMoveHandler) {
                            document.removeEventListener('mousemove', cell._ttMoveHandler);
                            cell._ttMoveHandler = null;
                        }
                    }
                };
                buyGrid.appendChild(cell);
            });
        }

        const sellGrid = getElement('shopSellGrid');
        if (sellGrid) {
            sellGrid.innerHTML = '';
            if (this._selectedSellItems.length === 0) {
                const emptyHint = document.createElement('div');
                emptyHint.className = 'shop-empty-hint';
                emptyHint.textContent = '双击或右键点击背包/装备栏物品，或拖动至此';
                sellGrid.appendChild(emptyHint);
            } else {
                this._selectedSellItems.forEach((sel, index) => {
                    const item = sel.item;
                    const cell = document.createElement('div');
                    cell.className = 'shop-sell-cell has-item';
                    const rarityKey = item.rarity || 'common';
                    const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                    const sellPrice = Math.max(1, Math.floor((item.price || 50) * 0.5));
                    const iconHtml = item.iconImage
                        ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                        : (item.icon || '❓');
                    cell.innerHTML = `
                        <div class="sell-cell-rarity rarity-${rarityKey}">${rarityLabel}</div>
                        <div class="sell-cell-icon">${iconHtml}</div>
                        <div class="sell-cell-name">${item.name}</div>
                        <div class="sell-cell-price">💰 ${sellPrice}</div>
                    `;
                    cell.ondblclick = () => this.removeFromSellGrid(index);
                    cell.oncontextmenu = (e) => { e.preventDefault(); this.removeFromSellGrid(index); };
                    // 使出售栏格子可拖动
                    cell.draggable = true;
                    cell.ondragstart = (e) => {
                        EquipManager._dragDropManager._dragSrc = { type: 'sell', slot: index };
                        EquipManager._dragDropManager._dropHandled = false;
                        e.dataTransfer.setData('text/plain', String(index));
                        e.dataTransfer.effectAllowed = 'move';
                        cell.classList.add('dragging');
                    };
                    cell.ondragend = (_e) => {
                        cell.classList.remove('dragging');
                        if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                            this.removeFromSellGrid(index);
                        }
                        EquipManager._dragDropManager._dropHandled = false;
                        EquipManager._dragDropManager._dragSrc = null;
                    };
                    // 浮窗事件绑定
                    const tooltip = getElement('equipTooltip');
                    cell.onmouseenter = function(e) {
                        if (tooltip._pinned) return;
                        EquipTooltipManager.renderTooltip(item);
                        tooltip.classList.add('visible');
                        EquipTooltipManager._positionTooltip(e);
                        cell._ttMoveHandler = EquipTooltipManager._positionTooltip;
                        document.addEventListener('mousemove', cell._ttMoveHandler);
                    };
                    cell.onmouseleave = function() {
                        if (tooltip._pinned) return;
                        tooltip.classList.remove('visible');
                        if (cell._ttMoveHandler) {
                            document.removeEventListener('mousemove', cell._ttMoveHandler);
                            cell._ttMoveHandler = null;
                        }
                    };
                    cell.onmousedown = function(e) {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        if (tooltip._pinned) {
                            tooltip.classList.remove('visible', 'pinned');
                            tooltip._pinned = false;
                        } else {
                            EquipTooltipManager.renderTooltip(item);
                            tooltip.classList.add('visible', 'pinned');
                            tooltip._pinned = true;
                            EquipTooltipManager._positionTooltip(e);
                            if (cell._ttMoveHandler) {
                                document.removeEventListener('mousemove', cell._ttMoveHandler);
                                cell._ttMoveHandler = null;
                            }
                        }
                    };
                    sellGrid.appendChild(cell);
                });
            }
        }
    }
};

// 模块加载时注册跨 UI 事件监听
EventBus.on('shop:addToSellGrid', (idx) => ShopSystem.addToSellGrid(idx));

export { ShopSystem };
