import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { isCraftableWeapon } from '../config/gun-ammo.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EquipManager } from './equip-manager.js';
import { SystemUI } from './system-ui.js';

const CraftSystem = {
    _isOpen: false,
    _currentNPC: null,
    _equippedItem: null,
    _equippedSlot: null,
    _modifications: {}, // 每个装备的改造数据 { weaponId: { slot1: 'muzzle_brake', ... } }

    // 编辑模式状态
    _isEditing: false,
    _editSlotIndex: null,
    _editDragType: null, // 'cell' | 'target' | null
    _editDragOffset: { x: 0, y: 0 },
    _editTempSlots: null, // 编辑时使用的临时副本

    // 枪械改造配置（每种武器独立的slots和options）
    _WEAPON_CRAFT_CONFIGS: {
        weapon2: {
            slots: [
                { id: 'blade', name: '剑刃', x: 0.08, y: 0.12, lineTarget: { x: 0.49712643678160917, y: 0.11543624161073829 } },
                { id: 'guard', name: '护手', x: 0.08, y: 0.42, lineTarget: { x: 0.49712643678160917, y: 0.6748322147651015 } },
                { id: 'grip', name: '握把', x: 0.074712643678161, y: 0.661275167785234, lineTarget: { x: 0.5, y: 0.793288590604029 } },
                { id: 'blade_body_1', name: '剑身', x: 0.92, y: 0.12, lineTarget: { x: 0.5, y: 0.35 } },
                { id: 'blade_body_2', name: '剑身', x: 0.92, y: 0.4, lineTarget: { x: 0.5, y: 0.4 } },
                { id: 'pommel', name: '配重', x: 0.92, y: 0.7, lineTarget: { x: 0.5028735632183908, y: 0.8969798657718135 } },
            ],
            options: {
                blade: [
                    { id: 'light_blade', name: '轻量化剑刃', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'hardened_edge', name: '淬火硬化刃口', icon: '🔥', desc: '增加 10% 暴击率',
                      effects: { critChancePercent: 0.10 } },
                    { id: 'heavy_blunt', name: '厚重钝化', icon: '🛡️', desc: '增加 20% 防御穿透',
                      effects: { armorPenetrationPercent: 0.20 } },
                    { id: 'sharpened_edge', name: '精细研磨开锋', icon: '✨', desc: '增加 5% 伤害',
                      effects: { damagePercent: 0.05 } },
                ],
                guard: [
                    { id: 'small_disc_guard', name: '小型圆盘护手', icon: '🔘', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'wide_cross_guard', name: '宽十字护手', icon: '⚔️', desc: '装备时获得次级格挡效果：受到近战攻击有 50% 概率减少 50% 伤害',
                      effects: { secondaryBlock: true } },
                    { id: 'no_guard', name: '无护手', icon: '❌', desc: '减少攻击间隔 100ms，减少 5 点攻击体力消耗，防御力减少 25%',
                      effects: { attackIntervalDelta: -100, staminaCostDelta: -5, defensePercent: -0.25 } },
                ],
                grip: [
                    { id: 'wrapped_long_grip', name: '缠绳附加长柄', icon: '🧵', desc: '减少 5 点攻击和技能体力消耗',
                      effects: { staminaCostDelta: -5, skillStaminaCostDelta: -5 } },
                    { id: 'short_compact_grip', name: '短柄紧凑型握把', icon: '✂️', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                ],
                blade_body_1: [
                    { id: 'damascus_steel', name: '大马士革钢', icon: '🌊', desc: '冲刺突刺多造成一次伤害',
                      effects: { dashDoubleHit: true } },
                    { id: 'quench_hardened', name: '淬火硬化', icon: '🔥', desc: '防御穿透 +20%',
                      effects: { armorPenetrationPercent: 0.20 } },
                    { id: 'extended_blade', name: '延长剑身', icon: '📏', desc: '攻击距离 +25px（包括技能）',
                      effects: { rangeDelta: 25 } },
                    { id: 'light_blade_body', name: '轻量化剑身', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'hollow_blade', name: '镂空', icon: '💀', desc: '攻击敌人时附加流血效果：每秒受到当前生命值 10% 的物理伤害',
                      effects: { bleedingOnHit: true } },
                ],
                blade_body_2: [
                    { id: 'damascus_steel', name: '大马士革钢', icon: '🌊', desc: '冲刺突刺多造成一次伤害',
                      effects: { dashDoubleHit: true } },
                    { id: 'quench_hardened', name: '淬火硬化', icon: '🔥', desc: '防御穿透 +20%',
                      effects: { armorPenetrationPercent: 0.20 } },
                    { id: 'extended_blade', name: '延长剑身', icon: '📏', desc: '攻击距离 +25px（包括技能）',
                      effects: { rangeDelta: 25 } },
                    { id: 'light_blade_body', name: '轻量化剑身', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'hollow_blade', name: '镂空', icon: '💀', desc: '攻击敌人时附加流血效果：每秒受到当前生命值 10% 的物理伤害',
                      effects: { bleedingOnHit: true } },
                ],
                pommel: [
                    { id: 'weighted_pommel', name: '配重锤增重', icon: '⚒️', desc: '增加 5 点攻击体力消耗，攻击 +8%',
                      effects: { staminaCostDelta: 5, damagePercent: 0.08 } },
                    { id: 'hollow_orb', name: '镂空小球', icon: '🔮', desc: '减少 5 点攻击体力消耗',
                      effects: { staminaCostDelta: -5 } },
                ],
            }
        },
        weapon4: {
            slots: [
                { id: 'blade', name: '剑刃', x: 0.08, y: 0.12, lineTarget: { x: 0.49712643678160917, y: 0.11543624161073829 } },
                { id: 'guard', name: '护手', x: 0.08, y: 0.42, lineTarget: { x: 0.49712643678160917, y: 0.6748322147651015 } },
                { id: 'grip', name: '握把', x: 0.074712643678161, y: 0.661275167785234, lineTarget: { x: 0.5, y: 0.793288590604029 } },
                { id: 'blade_body_1', name: '剑身', x: 0.92, y: 0.12, lineTarget: { x: 0.5, y: 0.35 } },
                { id: 'blade_body_2', name: '剑身', x: 0.92, y: 0.4, lineTarget: { x: 0.5, y: 0.4 } },
                { id: 'pommel', name: '配重', x: 0.92, y: 0.7, lineTarget: { x: 0.5028735632183908, y: 0.8969798657718135 } },
            ],
            options: {
                blade: [
                    { id: 'light_blade', name: '轻量化剑刃', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'hardened_edge', name: '淬火硬化刃口', icon: '🔥', desc: '增加 10% 暴击率',
                      effects: { critChancePercent: 0.10 } },
                    { id: 'heavy_blunt', name: '厚重钝化', icon: '🛡️', desc: '增加 20% 防御穿透',
                      effects: { armorPenetrationPercent: 0.20 } },
                    { id: 'magic_blade', name: '魔力刀刃', icon: '🔮', desc: '攻击时给目标添加1层魔力易伤，持续5秒',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 1 } },
                ],
                guard: [
                    { id: 'small_disc_guard', name: '小型圆盘护手', icon: '🔘', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'wide_cross_guard', name: '宽十字护手', icon: '⚔️', desc: '装备时获得次级格挡效果：受到近战攻击有 50% 概率减少 50% 伤害',
                      effects: { secondaryBlock: true } },
                    { id: 'no_guard', name: '无护手', icon: '❌', desc: '减少攻击间隔 100ms，减少 5 点攻击体力消耗，防御力减少 25%',
                      effects: { attackIntervalDelta: -100, staminaCostDelta: -5, defensePercent: -0.25 } },
                ],
                grip: [
                    { id: 'wrapped_long_grip', name: '缠绳附加长柄', icon: '🧵', desc: '减少 5 点攻击和技能体力消耗',
                      effects: { staminaCostDelta: -5, skillStaminaCostDelta: -5 } },
                    { id: 'short_compact_grip', name: '短柄紧凑型握把', icon: '✂️', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                ],
                blade_body_1: [
                    { id: 'rune_restructure', name: '符文重构', icon: '✨', desc: '右键特殊攻击额外生成2把魔法剑，依次向外20px',
                      effects: { runeRestructureCount: 2 } },
                    { id: 'sharp_rune', name: '锐利符文', icon: '⚔', desc: '右键特殊攻击魔法防御穿透+20%',
                      effects: { magicPenetrationPercent: 0.20 } },
                    { id: 'eagle_eye_rune', name: '鹰眼符文', icon: '👁', desc: '右键特殊攻击魔法剑攻击距离+150px',
                      effects: { specialRangeDelta: 150 } },
                    { id: 'destruction_rune', name: '毁灭符文', icon: '💥', desc: '右键特殊攻击魔法剑击中后给敌人附加2层魔力易伤',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 2 } },
                ],
                blade_body_2: [
                    { id: 'rune_restructure', name: '符文重构', icon: '✨', desc: '右键特殊攻击额外生成2把魔法剑，依次向外20px',
                      effects: { runeRestructureCount: 2 } },
                    { id: 'sharp_rune', name: '锐利符文', icon: '⚔', desc: '右键特殊攻击魔法防御穿透+20%',
                      effects: { magicPenetrationPercent: 0.20 } },
                    { id: 'eagle_eye_rune', name: '鹰眼符文', icon: '👁', desc: '右键特殊攻击魔法剑攻击距离+150px',
                      effects: { specialRangeDelta: 150 } },
                    { id: 'destruction_rune', name: '毁灭符文', icon: '💥', desc: '右键特殊攻击魔法剑击中后给敌人附加2层魔力易伤',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 2 } },
                ],
                pommel: [
                    { id: 'light_pommel', name: '轻量化剑身', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'weighted_pommel', name: '配重锤增重', icon: '⚒️', desc: '增加 5 点攻击体力消耗，攻击+8%',
                      effects: { staminaCostDelta: 5, damagePercent: 0.08 } },
                    { id: 'hollow_orb', name: '镂空小球', icon: '🔮', desc: '减少 5 点攻击体力消耗',
                      effects: { staminaCostDelta: -5 } },
                ],
            }
        },
        weapon5: {
            slots: [
                { id: 'blade', name: '剑刃', x: 0.08, y: 0.12, lineTarget: { x: 0.49712643678160917, y: 0.11543624161073829 } },
                { id: 'guard', name: '护手', x: 0.08, y: 0.42, lineTarget: { x: 0.49712643678160917, y: 0.6748322147651015 } },
                { id: 'grip', name: '握把', x: 0.074712643678161, y: 0.661275167785234, lineTarget: { x: 0.5, y: 0.793288590604029 } },
                { id: 'blade_body_1', name: '剑身', x: 0.92, y: 0.12, lineTarget: { x: 0.5, y: 0.35 } },
                { id: 'blade_body_2', name: '剑身', x: 0.92, y: 0.4, lineTarget: { x: 0.5, y: 0.4 } },
                { id: 'pommel', name: '配重', x: 0.92, y: 0.7, lineTarget: { x: 0.5028735632183908, y: 0.8969798657718135 } },
            ],
            options: {
                blade: [
                    { id: 'light_blade', name: '轻量化剑刃', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'hardened_edge', name: '淬火硬化刃口', icon: '🔥', desc: '增加 10% 暴击率',
                      effects: { critChancePercent: 0.10 } },
                    { id: 'heavy_blunt', name: '厚重钝化', icon: '🛡️', desc: '增加 20% 防御穿透',
                      effects: { armorPenetrationPercent: 0.20 } },
                    { id: 'vulnerability_blade', name: '易伤刀刃', icon: '🔮', desc: '攻击时给目标添加1层魔力易伤，持续5秒',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 1 } },
                    { id: 'enchanted_blade', name: '附魔刀刃', icon: '✨', desc: '每次攻击命中时附加一次武器攻击力的魔法伤害',
                      effects: { enchantedBlade: true } },
                ],
                guard: [
                    { id: 'small_disc_guard', name: '小型圆盘护手', icon: '🔘', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'wide_cross_guard', name: '宽十字护手', icon: '⚔️', desc: '装备时获得次级格挡效果：受到近战攻击有 50% 概率减少 50% 伤害',
                      effects: { secondaryBlock: true } },
                    { id: 'no_guard', name: '无护手', icon: '❌', desc: '减少攻击间隔 100ms，减少 5 点攻击体力消耗，防御力减少 25%',
                      effects: { attackIntervalDelta: -100, staminaCostDelta: -5, defensePercent: -0.25 } },
                ],
                grip: [
                    { id: 'wrapped_long_grip', name: '缠绳附加长柄', icon: '🧵', desc: '减少 5 点攻击和技能体力消耗',
                      effects: { staminaCostDelta: -5, skillStaminaCostDelta: -5 } },
                    { id: 'short_compact_grip', name: '短柄紧凑型握把', icon: '✂️', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                ],
                blade_body_1: [
                    { id: 'rune_restructure', name: '符文重构', icon: '✨', desc: '右键特殊攻击持续时间+0.5s，期间持续计算伤害',
                      effects: { specialDurationDelta: 500 } },
                    { id: 'sharp_rune', name: '锐利符文', icon: '⚔', desc: '右键特殊攻击魔法防御穿透+20%',
                      effects: { magicPenetrationPercent: 0.20 } },
                    { id: 'eagle_eye_rune', name: '鹰眼符文', icon: '👁', desc: '右键特殊攻击攻击距离+200px',
                      effects: { specialRangeDelta: 200 } },
                    { id: 'destruction_rune', name: '毁灭符文', icon: '💥', desc: '右键特殊攻击每次击中后给敌人附加2层魔力易伤',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 2 } },
                ],
                blade_body_2: [
                    { id: 'rune_restructure', name: '符文重构', icon: '✨', desc: '右键特殊攻击持续时间+0.5s，期间持续计算伤害',
                      effects: { specialDurationDelta: 500 } },
                    { id: 'sharp_rune', name: '锐利符文', icon: '⚔', desc: '右键特殊攻击魔法防御穿透+20%',
                      effects: { magicPenetrationPercent: 0.20 } },
                    { id: 'eagle_eye_rune', name: '鹰眼符文', icon: '👁', desc: '右键特殊攻击攻击距离+200px',
                      effects: { specialRangeDelta: 200 } },
                    { id: 'destruction_rune', name: '毁灭符文', icon: '💥', desc: '右键特殊攻击每次击中后给敌人附加2层魔力易伤',
                      effects: { magicVulnerabilityOnHit: true, magicVulnerabilityStacks: 2 } },
                ],
                pommel: [
                    { id: 'light_pommel', name: '轻量化剑身', icon: '⚡', desc: '减少攻击间隔 50ms',
                      effects: { attackIntervalDelta: -50 } },
                    { id: 'weighted_pommel', name: '配重锤增重', icon: '⚒️', desc: '增加 5 点攻击体力消耗，攻击+8%',
                      effects: { staminaCostDelta: 5, damagePercent: 0.08 } },
                    { id: 'hollow_orb', name: '镂空小球', icon: '🔮', desc: '减少 5 点攻击体力消耗',
                      effects: { staminaCostDelta: -5 } },
                ],
            }
        },
        weapon6: {
            slots: [
                // 左列（从上到下，分散排列，向中间靠拢）
                { id: 'muzzle',   name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.497, y: 0.232 } },
                { id: 'barrel',   name: '枪管', x: 0.08, y: 0.40, lineTarget: { x: 0.497, y: 0.278 } },
                { id: 'sight',    name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.499, y: 0.490 } },
                // 右列（从上到下，分散排列，向中间靠拢）
                { id: 'magazine', name: '弹夹', x: 0.92, y: 0.08, lineTarget: { x: 0.401, y: 0.488 } },
                { id: 'bullet',   name: '子弹', x: 0.92, y: 0.32, lineTarget: { x: 0.401, y: 0.488 } },
                { id: 'grip',     name: '握把', x: 0.92, y: 0.45, lineTarget: { x: 0.503, y: 0.555 } },
                { id: 'stock',    name: '后托', x: 0.92, y: 0.70, lineTarget: { x: 0.497, y: 0.664 } },
            ],
            options: {
                muzzle: [
                    { id: 'suppressor', name: '消音器', icon: '🔇', desc: '射程 -300px，击退 +5px',
                      effects: { rangeDelta: -300, knockbackDelta: 5 } },
                    { id: 'flash_hider', name: '鸟笼消焰器', icon: '🔥', desc: '射程 +150px，最大散布角度 -10°',
                      effects: { rangeDelta: 150, maxSpreadAngleDelta: -10 } },
                    { id: 'muzzle_brake', name: 'DTK制退器', icon: '⚙', desc: '散布开始 +0.5秒，最大散布时间 +0.5秒',
                      effects: { spreadStartDelta: 500, spreadTimeDelta: 500 } },
                ],
                barrel: [
                    { id: 'long_barrel', name: '长枪管', icon: '📏', desc: '射程 +200px，子弹速度 +20%，散布开始 +1秒，最大散布 +1秒',
                      effects: { rangeDelta: 200, projectileSpeedPercent: 0.20, spreadStartDelta: 1000, spreadTimeDelta: 1000 } },
                    { id: 'short_barrel', name: '短枪管', icon: '✂️', desc: '射程 -200px，散布开始 +0.5秒，移动速度+5%',
                      effects: { rangeDelta: -200, spreadStartDelta: 500, moveSpeedPercent: 0.05 } },
                ],
                magazine: [
                    { id: 'light_mag', name: '轻型弹夹', icon: '⚡', desc: '换弹时间 -1.5秒，弹夹 -30发，移动速度增加10%',
                      effects: { reloadTimeDelta: -1500, magazineDelta: -30, moveSpeedPercent: 0.10 } },
                    { id: 'extended_mag', name: '扩容弹箱', icon: '📦', desc: '弹夹 +25发，移动速度减少10%，换弹时间 +0.5秒',
                      effects: { magazineDelta: 25, moveSpeedPercent: -0.10, reloadTimeDelta: 500 } },
                ],
                bullet: [
                    { id: 'ap_ammo', name: '钢芯穿甲弹', icon: '🛡️', desc: '攻击时无视目标35%防御力',
                      effects: { armorPenetrationPercent: 0.35 } },
                    { id: 'sniper_ammo', name: '高精度狙击弹', icon: '🎯', desc: '射程+200px，散布达到最大时间+0.5秒',
                      effects: { rangeDelta: 200, spreadTimeDelta: 500 } },
                ],
                stock: [
                    { id: 'skeleton_stock', name: '骨架枪托', icon: '🦴', desc: '移动速度+5%，散布开始 +0.5秒，最大散布 -1秒',
                      effects: { moveSpeedPercent: 0.05, spreadStartDelta: 500, spreadTimeDelta: -1000 } },
                    { id: 'solid_core_stock', name: '稳固核心枪托', icon: '🛡️', desc: '散布开始 +0.5秒，最大散布 +1秒',
                      effects: { spreadStartDelta: 500, spreadTimeDelta: 1000 } },
                ],
                grip: [
                    { id: 'light_grip', name: '轻型后握', icon: '✋', desc: '移动速度 +10%，最大散布角度 +10°',
                      effects: { moveSpeedPercent: 0.10, maxSpreadAngleDelta: 10 } },
                    { id: 'heavy_grip', name: '重型后握', icon: '✊', desc: '散布开始 +0.25秒，最大散布角度 -5°',
                      effects: { spreadStartDelta: 250, maxSpreadAngleDelta: -5 } },
                ],
                sight: [
                    { id: 'red_dot', name: '全景红点瞄具', icon: '🔴', desc: '散布开始 +1秒，单倍瞄准模式',
                      effects: { spreadStartDelta: 1000, redDotScope: true } },
                    { id: 'russian_3x_scope', name: '俄制三倍镜', icon: '🔭', desc: '散布开始 +1秒，高倍镜瞄准模式',
                      effects: { spreadStartDelta: 1000, highPowerScope: true } },
                ]
            }
        }
    },

    open(npc) {
        UIState.open('craft');
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = getElement('craftPanel');
        if (panel) panel.classList.add('active');
        this._setupDragDrop();
        this._updateUI();
        this._updateEditBar();
    },

    close() {
        try {
            if (this._equippedItem) {
                this._returnEquippedItem();
            }
            UIState.close('craft');
            this._isOpen = false;
            this._currentNPC = null;
            this._closeModPopup();
            this.exitEditMode();
        } catch (e) {
            console.error('[CraftSystem.close] error:', e);
        }
        const panel = getElement('craftPanel');
        if (panel) panel.classList.remove('active');
        TimerManager.setTimeout(() => {
            if (!UIState.isOpen('craft') && !UIState.isOpen('shop') && !UIState.isOpen('enhance') && !UIState.isOpen('enchant')) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (UIState.isOpen('craft')) this.close();
        else this.open();
    },

    // ===== 编辑栏控制 =====
    _updateEditBar() {
        const editBar = getElement('craftEditBar');
        const editBtn = getElement('craftEditBtn');
        const saveBtn = getElement('craftSaveBtn');
        const cancelBtn = getElement('craftCancelBtn');
        const editHint = getElement('craftEditHint');
        if (!editBar) return;

        const hasWeapon = this._equippedItem && isCraftableWeapon(this._equippedItem);
        editBar.style.display = 'flex';

        if (this._isEditing) {
            editBar.classList.add('editing');
            editBtn.style.display = 'none';
            saveBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            editHint.textContent = '拖动格子调整位置，拖动虚线端点调整指向';
        } else {
            editBar.classList.remove('editing');
            editBtn.style.display = hasWeapon ? 'inline-block' : 'none';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            editHint.textContent = hasWeapon ? '点击"调整布局"开始编辑' : '';
        }
    },

    enterEditMode() {
        if (!this._equippedItem || !isCraftableWeapon(this._equippedItem)) return;
        this._isEditing = true;
        // 深拷贝当前武器的slots配置作为临时编辑数据
        this._editTempSlots = JSON.parse(JSON.stringify(this._getCraftConfig(this._equippedItem.weaponId).slots));
        this._updateEditBar();
        this._renderMods();
        this._editMoveHandler = (e) => this._onEditMove(e);
        this._editEndHandler = () => this._onEditEnd();
        document.addEventListener('mousemove', this._editMoveHandler);
        document.addEventListener('touchmove', this._editMoveHandler, { passive: false });
        document.addEventListener('mouseup', this._editEndHandler);
        document.addEventListener('touchend', this._editEndHandler);
    },

    exitEditMode() {
        if (this._editMoveHandler) {
            document.removeEventListener('mousemove', this._editMoveHandler);
            document.removeEventListener('touchmove', this._editMoveHandler);
            this._editMoveHandler = null;
        }
        if (this._editEndHandler) {
            document.removeEventListener('mouseup', this._editEndHandler);
            document.removeEventListener('touchend', this._editEndHandler);
            this._editEndHandler = null;
        }
        this._isEditing = false;
        this._editTempSlots = null;
        this._editSlotIndex = null;
        this._editDragType = null;
        this._updateEditBar();
        this._renderMods();
    },

    saveEditMode() {
        if (!this._isEditing || !this._editTempSlots) return;
        // 保存临时数据到当前武器的配置
        this._getCraftConfig(this._equippedItem.weaponId).slots = JSON.parse(JSON.stringify(this._editTempSlots));
        console.log('[CraftSystem] 布局已保存:', this._equippedItem.weaponId, JSON.stringify(this._editTempSlots, null, 2));
        this.exitEditMode();
    },

    _setupDragDrop() {
        const dropZone = getElement('craftDropZone');
        const modContainer = getElement('craftModContainer');
        if (!dropZone) return;

        // 共用：拖入改造栏的处理逻辑
        const handleDropIn = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold' && isCraftableWeapon(item)) {
                    this._equipFromBackpack(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item && isCraftableWeapon(item)) {
                    this._equipFromSlot(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dropZone.classList.add('drag-over');
        };

        const handleDragLeave = (_e) => {
            dropZone.classList.remove('drag-over');
        };

        // dropZone 接收拖入
        dropZone.ondragover = handleDragOver;
        dropZone.ondragleave = handleDragLeave;
        dropZone.ondrop = handleDropIn;

        // modContainer 也接收拖入（覆盖在上方，确保拖入任意位置都能触发）
        if (modContainer) {
            modContainer.ondragover = handleDragOver;
            modContainer.ondragleave = handleDragLeave;
            modContainer.ondrop = handleDropIn;
        }

        // 共用：从改造栏拖出的处理逻辑
        const handleDragStart = (e) => {
            if (!this._equippedItem) return;
            EquipManager._dragDropManager._dragSrc = { type: 'craft', slot: 'craft' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'craft');
            e.dataTransfer.effectAllowed = 'move';
            dropZone.classList.add('dragging');
            // 创建自定义拖动图片：背包格子大小的装备方块
            const canvas = document.createElement('canvas');
            canvas.width = 56; canvas.height = 56;
            const ctx = canvas.getContext('2d');
            // 背景（背包格子样式）
            ctx.fillStyle = '#2a2520';
            ctx.fillRect(0, 0, 56, 56);
            ctx.strokeStyle = '#5a4d3f';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, 56, 56);
            // 绘制装备图标
            const imgSrc = this._equippedItem.equipImage || this._equippedItem.slotImage || this._equippedItem.iconImage;
            if (imgSrc) {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 4, 4, 48, 48);
                    e.dataTransfer.setDragImage(canvas, 28, 28);
                };
                img.onerror = () => {
                    ctx.fillStyle = '#d4c5a9';
                    ctx.font = '24px serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this._equippedItem.icon || '❓', 28, 36);
                    e.dataTransfer.setDragImage(canvas, 28, 28);
                };
                img.src = imgSrc;
            } else {
                ctx.fillStyle = '#d4c5a9';
                ctx.font = '24px serif';
                ctx.textAlign = 'center';
                ctx.fillText(this._equippedItem.icon || '❓', 28, 36);
                e.dataTransfer.setDragImage(canvas, 28, 28);
            }
        };

        const handleDragEnd = (_e) => {
            dropZone.classList.remove('dragging');
        };

        dropZone.ondragstart = handleDragStart;
        dropZone.ondragend = handleDragEnd;

        // 右键卸下：绑定到 dropZone 和 modContainer，确保任意位置右键都能卸下
        const handleContextMenu = (e) => {
            e.preventDefault();
            if (this._equippedItem) {
                this._returnEquippedItem();
                this._updateUI();
            }
        };
        dropZone.oncontextmenu = handleContextMenu;
        if (modContainer) {
            modContainer.oncontextmenu = handleContextMenu;
        }
    },

    _equipFromBackpack(idx) {
        const item = EquipManager.backpackItems.find(i => i.slot === idx);
        console.log('[CraftSystem] _equipFromBackpack:', idx, item ? item.name : 'null', 'equipImage:', item ? item.equipImage : 'null', 'weaponAsset:', item ? item.weaponAsset : 'null');
        if (!item || !isCraftableWeapon(item)) return;
        // 先归还当前装备
        if (this._equippedItem) this._returnEquippedItem();
        // 从背包移除（原地删除，保持数组引用一致）
        const bpIndex = EquipManager.backpackItems.findIndex(i => i.slot === idx);
        if (bpIndex !== -1) EquipManager.backpackItems.splice(bpIndex, 1);
        // 放入改造槽（深拷贝，避免与背包共享引用）
        this._equippedItem = JSON.parse(JSON.stringify(item));
        // 深拷贝后修复：如果 equipImage 缺失但 weaponAsset.image 存在，自动设置 equipImage
        if (!this._equippedItem.equipImage && item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            this._equippedItem.equipImage = item.weaponAsset.image;
        }
        // 深拷贝可能丢失 weaponAsset 中的非字符串属性，强制从原始 item 复制关键字段
        if (item.equipImage) this._equippedItem.equipImage = item.equipImage;
        if (item.slotImage) this._equippedItem.slotImage = item.slotImage;
        if (item.iconImage) this._equippedItem.iconImage = item.iconImage;
        if (item.weaponAsset && typeof item.weaponAsset === 'object') {
            if (!this._equippedItem.weaponAsset) this._equippedItem.weaponAsset = {};
            if (item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
                this._equippedItem.weaponAsset.image = item.weaponAsset.image;
            }
            if (item.weaponAsset.muzzleImage && typeof item.weaponAsset.muzzleImage === 'string') {
                this._equippedItem.weaponAsset.muzzleImage = item.weaponAsset.muzzleImage;
            }
        }
        // 确保每个装备实例有唯一标识
        if (!this._equippedItem.itemId) {
            this._equippedItem.itemId = Date.now() + '_' + Math.floor(Math.random() * 1000);
        }
        // 恢复该装备的改造数据（如果之前改造过）
        if (this._equippedItem._craftData) {
            this._applyModEffects();
        }
        this._equippedSlot = { type: 'inventory', idx: idx };
        // 刷新背包显示
        if (typeof EquipManager !== 'undefined' && EquipManager.updateInventorySlots) {
            EquipManager.updateInventorySlots();
        }
        this._updateUI();
    },

    _equipFromSlot(slotKey) {
        const item = Game.player.equipments[slotKey];
        console.log('[CraftSystem] _equipFromSlot:', slotKey, item ? item.name : 'null', 'equipImage:', item ? item.equipImage : 'null', 'weaponAsset:', item ? item.weaponAsset : 'null');
        if (!item || !isCraftableWeapon(item)) return;
        // 先归还当前装备到背包
        if (this._equippedItem) this._returnEquippedItem();
        // 从装备槽移除
        Game.player.equipments[slotKey] = null;
        if (Game.player.equipCallbacks && Game.player.equipCallbacks[slotKey]) {
            Game.player.equipCallbacks[slotKey](null);
        }
        // 放入改造槽（深拷贝，避免与装备栏共享引用）
        this._equippedItem = JSON.parse(JSON.stringify(item));
        // 深拷贝后修复：如果 equipImage 缺失但 weaponAsset.image 存在，自动设置 equipImage
        if (!this._equippedItem.equipImage && item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            this._equippedItem.equipImage = item.weaponAsset.image;
        }
        // 深拷贝可能丢失 weaponAsset 中的非字符串属性，强制从原始 item 复制关键字段
        if (item.equipImage) this._equippedItem.equipImage = item.equipImage;
        if (item.slotImage) this._equippedItem.slotImage = item.slotImage;
        if (item.iconImage) this._equippedItem.iconImage = item.iconImage;
        if (item.weaponAsset && typeof item.weaponAsset === 'object') {
            if (!this._equippedItem.weaponAsset) this._equippedItem.weaponAsset = {};
            if (item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
                this._equippedItem.weaponAsset.image = item.weaponAsset.image;
            }
            if (item.weaponAsset.muzzleImage && typeof item.weaponAsset.muzzleImage === 'string') {
                this._equippedItem.weaponAsset.muzzleImage = item.weaponAsset.muzzleImage;
            }
        }
        // 确保每个装备实例有唯一标识
        if (!this._equippedItem.itemId) {
            this._equippedItem.itemId = Date.now() + '_' + Math.floor(Math.random() * 1000);
        }
        // 恢复该装备的改造数据（如果之前改造过）
        if (this._equippedItem._craftData) {
            this._applyModEffects();
        }
        this._equippedSlot = { type: 'equip', slot: slotKey };
        console.log('[CraftSystem] 改造槽装备:', this._equippedItem.name, 'equipImage:', this._equippedItem.equipImage);
        // 刷新装备栏和背包显示（关键：装备栏必须立即更新）
        if (typeof EquipManager !== 'undefined') {
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
            if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        }
        this._updateUI();
    },

    _returnEquippedItem() {
        if (!this._equippedItem) {
            console.warn('[CraftSystem] _returnEquippedItem: _equippedItem 为 null');
            return;
        }
        console.log('[CraftSystem] 归还装备:', this._equippedItem.name, 'from', this._equippedSlot);
        // 安全获取背包数组
        if (!EquipManager.backpackItems) {
            EquipManager.backpackItems = [];
        }
        // 归还到背包（找第一个空位）
        const emptySlot = EquipManager._findFirstEmptySlot ? EquipManager._findFirstEmptySlot() : -1;
        console.log('[CraftSystem] 空位:', emptySlot, '背包物品数:', EquipManager.backpackItems.length);
        if (emptySlot !== -1) {
            this._equippedItem.slot = emptySlot;
            EquipManager.backpackItems.push(this._equippedItem);
            console.log('[CraftSystem] 已放入背包 slot', emptySlot);
        } else {
            // 背包满：装备掉落在地上，并显示与背包已满一致的提示
            Game.dropItem(Game.player.x, Game.player.y, this._equippedItem);
            let el = getElement('backpackFullNotice');
            if (el) el.remove();
            el = document.createElement('div');
            el.id = 'backpackFullNotice';
            el.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#d4c5a9;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 3s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
            el.textContent = '当前背包已满，装备自动掉落附近地上';
            document.body.appendChild(el);
            TimerManager.setTimeout(() => { if (el && el.parentNode) el.remove(); }, 3000);
            console.log('[CraftSystem] 背包满，装备已掉落在地上');
        }
        // 如果来自装备槽，清空该装备槽（防止视觉上仍显示）
        if (this._equippedSlot && this._equippedSlot.type === 'equip') {
            Game.player.equipments[this._equippedSlot.slot] = null;
            if (Game.player.equipCallbacks && Game.player.equipCallbacks[this._equippedSlot.slot]) {
                Game.player.equipCallbacks[this._equippedSlot.slot](null);
            }
        }
        this._equippedItem = null;
        this._equippedSlot = null;
        // 刷新所有栏位显示
        if (typeof EquipManager !== 'undefined') {
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
            if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
        }
    },

    _updateUI() {
        const dropZone = getElement('craftDropZone');
        const placeholder = getElement('craftDropPlaceholder');
        const weaponDisplay = getElement('craftWeaponDisplay');
        const modContainer = getElement('craftModContainer');

        // 清除旧图片
        if (weaponDisplay) weaponDisplay.innerHTML = '';

        if (!this._equippedItem) {
            // 无装备：显示提示，隐藏武器贴图
            if (dropZone) dropZone.classList.remove('has-item');
            if (placeholder) {
                placeholder.style.display = 'flex';
                placeholder.innerHTML = '<span>📥</span><span>拖入或右键装备</span>';
            }
            if (weaponDisplay) weaponDisplay.style.display = 'none';
            if (modContainer) modContainer.style.display = 'none';
            this._updateEditBar();
            return;
        }

        // 有装备：显示武器贴图
        if (dropZone) dropZone.classList.add('has-item');
        if (placeholder) placeholder.style.display = 'none';
        if (weaponDisplay) weaponDisplay.style.display = 'flex'; // ← 关键：显示贴图区域

        // 尝试获取图片路径（多重 fallback）
        let imgSrc = null;
        const item = this._equippedItem;

        // 1. 优先使用 weaponAsset.image（hold/top-down 图片，用于改造栏展示）
        if (item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            imgSrc = item.weaponAsset.image;
        }
        else if (item.equipImage) imgSrc = item.equipImage;
        else if (item.slotImage) imgSrc = item.slotImage;
        else if (item.iconImage) imgSrc = item.iconImage;

        // 2. 从 ItemDatabase 根据 id 查找
        if (!imgSrc && item.id && typeof ItemDatabase !== 'undefined') {
            const dbItem = ItemDatabase.get(item.id);
            if (dbItem) {
                if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                    imgSrc = dbItem.weaponAsset.image;
                }
                if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
            }
        }

        // 3. 从 ItemDatabase 根据 weaponId 查找
        if (!imgSrc && item.weaponId && typeof ItemDatabase !== 'undefined') {
            const weaponIdMap = {
                'weapon1': 'rusty_sword', 'weapon2': 'knights_sword',
                'weapon4': 'rune_sword', 'weapon5': 'night_flame_sword', 'weapon6': 'pkm',
                'weapon7': 'akm', 'weapon8': 'qbz191', 'weapon9': 'g18_pistol',
                'weapon10': 'desert_eagle', 'weapon11': 'qjb201', 'weapon12': 'super90'
            };
            const itemId = weaponIdMap[item.weaponId];
            if (itemId) {
                const dbItem = ItemDatabase.get(itemId);
                if (dbItem) {
                    if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                        imgSrc = dbItem.weaponAsset.image;
                    }
                    if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
                }
            }
        }

        console.log('[CraftSystem] _updateUI imgSrc:', imgSrc, 'item:', item.name, 'equipImage:', item.equipImage, 'slotImage:', item.slotImage, 'iconImage:', item.iconImage);

        if (imgSrc) {
            const imgEl = document.createElement('img');
            imgEl.src = imgSrc;
            imgEl.style.cssText = 'height:100%;width:auto;max-width:100%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));transform:rotate(0deg);';
            if (weaponDisplay) weaponDisplay.appendChild(imgEl);
        } else {
            console.warn('[CraftSystem] 无可用贴图:', item.name, item);
            // 显示默认图标
            if (weaponDisplay) {
                weaponDisplay.innerHTML = '<div style="font-size:48px;color:#8a7d6b;">🔧</div>';
            }
        }

        // 如果是枪械类武器，显示改造格子
        if (this._equippedItem && isCraftableWeapon(this._equippedItem)) {
            if (modContainer) modContainer.style.display = 'flex';
            // 使用 requestAnimationFrame 确保布局完成后再渲染格子
            requestAnimationFrame(() => this._renderMods());
        } else {
            if (modContainer) modContainer.style.display = 'none';
        }
        this._updateEditBar();
    },

    _renderMods() {
        const modContainer = getElement('craftModContainer');
        const modGrid = getElement('craftModGrid');
        const svg = getElement('craftLinesSvg');
        if (!modContainer || !modGrid || !svg) return;
        if (!this._equippedItem) return; // 无装备时不渲染改造格子

        const config = this._getCraftConfig(this._equippedItem.weaponId);
        const itemMods = (this._equippedItem && this._equippedItem._craftData) ? this._equippedItem._craftData : {};

        modGrid.innerHTML = '';
        svg.innerHTML = '';

        const containerRect = modContainer.getBoundingClientRect();
        const w = containerRect.width || 340;
        const h = containerRect.height || 400;

        // 编辑模式下使用临时数据，否则使用正式配置
        const slots = this._isEditing && this._editTempSlots ? this._editTempSlots : config.slots;

        // 绘制线条和创建格子
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const slotX = slot.x * w;
            const slotY = slot.y * h;
            const targetX = slot.lineTarget.x * w;
            const targetY = slot.lineTarget.y * h;

            // 绘制线条（格子端固定，target端可调整）
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', slotX);
            line.setAttribute('y1', slotY);
            line.setAttribute('x2', targetX);
            line.setAttribute('y2', targetY);
            line.setAttribute('stroke', 'rgba(212, 197, 169, 0.6)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '4,3');
            svg.appendChild(line);

            // 编辑模式：在target端添加可拖拽的圆点
            if (this._isEditing) {
                const targetDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                targetDot.setAttribute('cx', targetX);
                targetDot.setAttribute('cy', targetY);
                targetDot.setAttribute('r', '6');
                targetDot.setAttribute('fill', '#d4c5a9');
                targetDot.setAttribute('stroke', '#7a6a5a');
                targetDot.setAttribute('stroke-width', '2');
                targetDot.setAttribute('cursor', 'move');
                targetDot.style.pointerEvents = 'auto';
                targetDot.dataset.slotIndex = i;
                targetDot.dataset.dragType = 'target';
                this._bindEditDrag(targetDot, i, 'target');
                svg.appendChild(targetDot);
            }

            // 创建格子
            const cell = document.createElement('div');
            cell.className = 'craft-mod-cell';
            if (this._isEditing) {
                cell.classList.add('editing');
                cell.style.cursor = 'move';
                cell.dataset.slotIndex = i;
                cell.dataset.dragType = 'cell';
                this._bindEditDrag(cell, i, 'cell');
            }
            cell.style.left = `${slotX - 24}px`;
            cell.style.top = `${slotY - 24}px`;

            const equipped = itemMods[slot.id];
            if (equipped) {
                const option = config.options[slot.id]?.find(o => o.id === equipped);
                cell.innerHTML = `<div class="craft-mod-cell-icon">${option?.icon || '🔧'}</div><div class="craft-mod-cell-name">${option?.name || '已装备'}</div>`;
                cell.classList.add('equipped');
            } else {
                cell.innerHTML = `<div class="craft-mod-cell-icon">➕</div><div class="craft-mod-cell-name">${slot.name}</div>`;
            }

            // 编辑模式下禁用点击（防止触发配件选择）
            if (!this._isEditing) {
                cell.onclick = () => this._onModCellClick(slot.id);
            }
            cell.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._equippedItem) {
                    this._returnEquippedItem();
                    this._updateUI();
                }
            };
            // 让格子也支持拖动（改造槽整体拖出）
            if (!this._isEditing) {
                cell.draggable = true;
                cell.ondragstart = (e) => {
                    if (!this._equippedItem) { e.preventDefault(); return; }
                    EquipManager._dragDropManager._dragSrc = { type: 'craft', slot: 'craft' };
                    EquipManager._dragDropManager._dropHandled = false;
                    e.dataTransfer.setData('text/plain', 'craft');
                    e.dataTransfer.effectAllowed = 'move';
                    const dropZone = getElement('craftDropZone');
                    if (dropZone) dropZone.classList.add('dragging');
                };
                cell.ondragend = (_e) => {
                    const dropZone = getElement('craftDropZone');
                    if (dropZone) dropZone.classList.remove('dragging');
                    if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                        this._returnEquippedItem();
                        this._updateUI();
                    }
                    EquipManager._dragDropManager._dropHandled = false;
                    EquipManager._dragDropManager._dragSrc = null;
                };
            }
            modGrid.appendChild(cell);
        }
    },

    // 绑定编辑拖动事件（仅绑定 start 事件）
    _bindEditDrag(element, slotIndex, dragType) {
        const startDrag = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this._isEditing || !this._editTempSlots) return;
            this._editSlotIndex = slotIndex;
            this._editDragType = dragType;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            this._editDragOffset = { x: clientX, y: clientY };
        };

        element.addEventListener('mousedown', startDrag);
        element.addEventListener('touchstart', startDrag, { passive: false });
    },

    _onEditMove(e) {
        if (this._editSlotIndex === null || !this._editDragType || !this._editTempSlots) return;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const dx = clientX - this._editDragOffset.x;
        const dy = clientY - this._editDragOffset.y;

        const modContainer = getElement('craftModContainer');
        const rect = modContainer.getBoundingClientRect();
        const w = rect.width || 340;
        const h = rect.height || 400;

        const slot = this._editTempSlots[this._editSlotIndex];
        if (this._editDragType === 'cell') {
            // 拖动格子：更新格子的 x, y（相对坐标，0-1）
            const newX = Math.max(0, Math.min(1, slot.x + dx / w));
            const newY = Math.max(0, Math.min(1, slot.y + dy / h));
            slot.x = newX;
            slot.y = newY;
        } else if (this._editDragType === 'target') {
            // 拖动虚线target端：更新 lineTarget
            const newX = Math.max(0, Math.min(1, slot.lineTarget.x + dx / w));
            const newY = Math.max(0, Math.min(1, slot.lineTarget.y + dy / h));
            slot.lineTarget.x = newX;
            slot.lineTarget.y = newY;
        }

        this._editDragOffset = { x: clientX, y: clientY };
        this._renderMods();
    },

    _onEditEnd() {
        this._editSlotIndex = null;
        this._editDragType = null;
    },

    _onModCellClick(slotId) {
        const config = this._getCraftConfig(this._equippedItem.weaponId);
        const options = config.options[slotId];
        if (!options || options.length === 0) return;

        const popup = getElement('craftModPopup');
        const body = getElement('craftModPopupBody');
        if (!popup || !body) return;

        body.innerHTML = '';
        const itemMods = (this._equippedItem && this._equippedItem._craftData) ? this._equippedItem._craftData : {};
        const current = itemMods[slotId];

        for (const opt of options) {
            const row = document.createElement('div');
            row.className = 'craft-mod-option' + (current === opt.id ? ' selected' : '');
            const _ticketCost = current ? 4 : 1;
            const ticketLabel = current ? '🔧 替换需4张改造券' : '🔧 需1张改造券';
            row.innerHTML = `
                <div class="craft-mod-option-icon">${opt.icon}</div>
                <div class="craft-mod-option-info">
                    <div class="craft-mod-option-name">${opt.name}</div>
                    <div class="craft-mod-option-desc">${opt.desc}</div>
                    <div class="craft-mod-option-cost" style="color:#e8a838;font-size:11px;margin-top:2px;">${ticketLabel}</div>
                </div>
                <div class="craft-mod-option-action">${current === opt.id ? '✓ 已装备' : '点击装备'}</div>
            `;
            row.onclick = () => {
                this._equipMod(slotId, opt.id);
                this._closeModPopup();
            };
            body.appendChild(row);
        }

        popup.style.display = 'block';
        // 添加点击外部关闭（下一帧避免立即触发）
        requestAnimationFrame(() => {
            this._popupCloseHandler = (e) => {
                if (!popup.contains(e.target)) {
                    this._closeModPopup();
                }
            };
            document.addEventListener('mousedown', this._popupCloseHandler);
        });
    },

    _closeModPopup() {
        const popup = getElement('craftModPopup');
        if (popup) popup.style.display = 'none';
        if (this._popupCloseHandler) {
            document.removeEventListener('mousedown', this._popupCloseHandler);
            this._popupCloseHandler = null;
        }
    },

    _equipMod(slotId, modId) {
        // 将改造数据绑定到具体装备实例
        if (!this._equippedItem) return;

        const hasExisting = this._equippedItem._craftData && this._equippedItem._craftData[slotId];
        const ticketCost = hasExisting ? 4 : 1;
        const ticketName = hasExisting ? '改造券×4（替换已改造配件）' : '改造券×1';

        // 检查改造券
        const bp = EquipManager.backpackItems || [];
        const ticketIdx = bp.findIndex(i => i.name === '改造券');
        if (ticketIdx === -1) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造券不足！需要${ticketName}`, '#ff4444'));
            return;
        }
        const ticketItem = bp[ticketIdx];
        if ((ticketItem.stack || 1) < ticketCost) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造券不足！需要${ticketName}，当前只有${ticketItem.stack || 1}张`, '#ff4444'));
            return;
        }
        // 消耗改造券
        if (ticketItem.stack > ticketCost) {
            ticketItem.stack -= ticketCost;
        } else {
            bp.splice(ticketIdx, 1);
        }
        EquipManager.updateInventorySlots();

        if (!this._equippedItem._craftData) this._equippedItem._craftData = {};
        this._equippedItem._craftData[slotId] = modId;
        this._equippedItem._isCrafted = true;
        // 同步到全局 _modifications（仅用于UI渲染参考）
        const wid = this._equippedItem.weaponId || 'weapon6';
        if (!this._modifications[wid]) this._modifications[wid] = {};
        this._modifications[wid][slotId] = modId;
        this._applyModEffects();
        this._renderMods();
        EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造成功！消耗${ticketName}`, '#ffd700'));
    },

    _applyModEffects() {
        if (!this._equippedItem) return;
        const weaponConfig = this._getCraftConfig(this._equippedItem.weaponId);
        const itemMods = this._equippedItem._craftData || {};

        // 收集所有效果
        let rangeDelta = 0;
        let knockbackDelta = 0;
        let spreadTimeDelta = 0;
        let spreadStartDelta = 0;
        let reloadTimeDelta = 0;
        let magazineDelta = 0;
        let projectileSpeedPercent = 0;
        let moveSpeedPercent = 0;
        let hideMuzzleFlash = false;
        let highPowerScope = false;
        let redDotScope = false;
        let maxSpreadAngleDelta = 0;
        // 新增改造效果（Super90专属）
        let damagePercent = 0;
        let slugMode = false;
        let flechetteMode = false;
        let piercingBonus = 0;
        let magazineOverride = 0;
        let critChancePercent = 0;
        let slugRecoilRecovery = 0;
        let fastReload = false;
        // 半自动武器效果
        let attackIntervalDelta = 0;
        let recoilRecoveryDelta = 0;
        let shotSpreadDelta = 0;
        // 骑士长剑改造效果
        let staminaCostDelta = 0;
        let skillStaminaCostDelta = 0;
        let defensePercent = 0;
        let secondaryBlock = false;
        let dashDoubleHit = false;
        let bleedingOnHit = false;
        // 能量轻机枪改造效果
        let overheatTimeDelta = 0;
        let overheatRecoverDelta = 0;
        // 符文长剑/夜与火之剑改造效果
        let magicVulnerabilityOnHit = false;
        let magicVulnerabilityStacks = 0;
        let magicPenetrationPercent = 0;
        let enchantedBlade = false;
        let runeRestructureCount = 0;
        let specialRangeDelta = 0;
        let specialDurationDelta = 0;

        for (const slotId in itemMods) {
            const modId = itemMods[slotId];
            const slotOpts = weaponConfig.options[slotId];
            if (!slotOpts) continue;
            const opt = slotOpts.find(o => o.id === modId);
            if (!opt || !opt.effects) continue;

            if (opt.effects.rangeDelta) rangeDelta += opt.effects.rangeDelta;
            if (opt.effects.knockbackDelta) knockbackDelta += opt.effects.knockbackDelta;
            if (opt.effects.spreadTimeDelta) spreadTimeDelta += opt.effects.spreadTimeDelta;
            if (opt.effects.spreadStartDelta) spreadStartDelta += opt.effects.spreadStartDelta;
            if (opt.effects.reloadTimeDelta) reloadTimeDelta += opt.effects.reloadTimeDelta;
            if (opt.effects.magazineDelta) magazineDelta += opt.effects.magazineDelta;
            if (opt.effects.projectileSpeedPercent) projectileSpeedPercent += opt.effects.projectileSpeedPercent;
            if (opt.effects.moveSpeedPercent) moveSpeedPercent += opt.effects.moveSpeedPercent;
            if (opt.effects.maxSpreadAngleDelta) maxSpreadAngleDelta += opt.effects.maxSpreadAngleDelta;
            if (opt.effects.hideMuzzleFlash) hideMuzzleFlash = true;
            if (opt.effects.highPowerScope) highPowerScope = true;
            if (opt.effects.redDotScope) redDotScope = true;
            // 新增效果处理
            if (opt.effects.damagePercent) damagePercent += opt.effects.damagePercent;
            if (opt.effects.slugMode) slugMode = true;
            if (opt.effects.flechetteMode) flechetteMode = true;
            if (opt.effects.piercingBonus) piercingBonus += opt.effects.piercingBonus;
            if (opt.effects.magazineOverride) magazineOverride = opt.effects.magazineOverride;
            if (opt.effects.critChancePercent) critChancePercent += opt.effects.critChancePercent;
            if (opt.effects.slugRecoilRecovery) slugRecoilRecovery += opt.effects.slugRecoilRecovery;
            if (opt.effects.fastReload) fastReload = true;
            // 半自动武器效果收集
            if (opt.effects.attackIntervalDelta) attackIntervalDelta += opt.effects.attackIntervalDelta;
            if (opt.effects.recoilRecoveryDelta) recoilRecoveryDelta += opt.effects.recoilRecoveryDelta;
            if (opt.effects.shotSpreadDelta) shotSpreadDelta += opt.effects.shotSpreadDelta;
            // 骑士长剑改造效果
            if (opt.effects.staminaCostDelta) staminaCostDelta += opt.effects.staminaCostDelta;
            if (opt.effects.skillStaminaCostDelta) skillStaminaCostDelta += opt.effects.skillStaminaCostDelta;
            if (opt.effects.defensePercent) defensePercent += opt.effects.defensePercent;
            if (opt.effects.secondaryBlock) secondaryBlock = true;
            if (opt.effects.dashDoubleHit) dashDoubleHit = true;
            if (opt.effects.bleedingOnHit) bleedingOnHit = true;
            // 能量轻机枪改造效果
            if (opt.effects.overheatTimeDelta) overheatTimeDelta += opt.effects.overheatTimeDelta;
            if (opt.effects.overheatRecoverDelta) overheatRecoverDelta += opt.effects.overheatRecoverDelta;
            // 符文长剑/夜与火之剑改造效果
            if (opt.effects.magicVulnerabilityOnHit) magicVulnerabilityOnHit = true;
            if (opt.effects.magicVulnerabilityStacks) magicVulnerabilityStacks += opt.effects.magicVulnerabilityStacks;
            if (opt.effects.magicPenetrationPercent) magicPenetrationPercent += opt.effects.magicPenetrationPercent;
            if (opt.effects.enchantedBlade) enchantedBlade = true;
            if (opt.effects.runeRestructureCount) runeRestructureCount += opt.effects.runeRestructureCount;
            if (opt.effects.specialRangeDelta) specialRangeDelta += opt.effects.specialRangeDelta;
            if (opt.effects.specialDurationDelta) specialDurationDelta += opt.effects.specialDurationDelta;
        }

        // 将改造效果绑定到具体装备实例
        this._equippedItem._craftEffects = {
            rangeDelta, knockbackDelta, spreadTimeDelta, spreadStartDelta,
            reloadTimeDelta, magazineDelta, projectileSpeedPercent, moveSpeedPercent, maxSpreadAngleDelta, hideMuzzleFlash, highPowerScope, redDotScope,
            damagePercent, slugMode, flechetteMode, piercingBonus, magazineOverride, critChancePercent, slugRecoilRecovery, fastReload,
            attackIntervalDelta, recoilRecoveryDelta, shotSpreadDelta,
            staminaCostDelta, skillStaminaCostDelta, defensePercent, secondaryBlock, dashDoubleHit, bleedingOnHit,
            overheatTimeDelta, overheatRecoverDelta,
            magicVulnerabilityOnHit, magicVulnerabilityStacks, magicPenetrationPercent, enchantedBlade,
            runeRestructureCount, specialRangeDelta, specialDurationDelta
        };
        // 重新初始化弹药状态（应用弹夹容量和换弹时间改造）
        if (Game.player._initAmmoForSlot) {
            const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
            for (const slot of slots) {
                const item = Game.player.equipments[slot];
                if (item && item.weaponId === this._equippedItem.weaponId) {
                    Game.player._initAmmoForSlot(slot);
                }
            }
        }
    },

    // 获取某武器的改造配置
    _getCraftConfig(weaponId) {
        return this._WEAPON_CRAFT_CONFIGS[weaponId] || this._WEAPON_CRAFT_CONFIGS['weapon6'];
    },

    // 获取某武器当前的改造效果（供外部调用）
    getWeaponEffects(weaponId) {
        // 从当前装备实例获取改造效果
        if (this._equippedItem && this._equippedItem.weaponId === weaponId) {
            return this._equippedItem._craftEffects || null;
        }
        // 从玩家装备槽中查找
        const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
        for (const slot of slots) {
            const item = Game.player.equipments[slot];
            if (item && item.weaponId === weaponId && item._craftEffects) {
                return item._craftEffects;
            }
        }
        return null;
    }
}

// 为其他枪械复制PKM的初始改造栏位结构，瞄具通用PKM配置
const pkmSightOptions = CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.options.sight;
['weapon7', 'weapon9', 'weapon10'].forEach(wid => {
    if (wid === 'weapon7') {
        CraftSystem._WEAPON_CRAFT_CONFIGS[wid] = JSON.parse(JSON.stringify({
            slots: CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.slots,
            options: CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.options
        }));
    } else {
        CraftSystem._WEAPON_CRAFT_CONFIGS[wid] = {
            slots: JSON.parse(JSON.stringify(CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.slots)),
            options: { sight: JSON.parse(JSON.stringify(pkmSightOptions)), bullet: [
                { id: 'standard_ammo', name: '标准弹药', icon: '🔘', desc: '无特殊效果', effects: {} }
            ] }
        };
    }
});
// 修改 weapon9 的改造配置：复制 weapon10 的完整改造选项
const w9Slots = CraftSystem._WEAPON_CRAFT_CONFIGS.weapon9.slots;
// 将 grip 改为 trigger
const w9gripIdx = w9Slots.findIndex(s => s.id === 'grip');
if (w9gripIdx >= 0) { w9Slots[w9gripIdx].id = 'trigger'; w9Slots[w9gripIdx].name = '扳机'; }
// 删除 stock
const w9stockIdx = w9Slots.findIndex(s => s.id === 'stock');
if (w9stockIdx >= 0) w9Slots.splice(w9stockIdx, 1);
// 为 weapon9 添加完整改造选项（复制 weapon10）
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon9.options = JSON.parse(JSON.stringify(CraftSystem._WEAPON_CRAFT_CONFIGS.weapon10.options));

// 修改 weapon10 的改造配置：握把→扳机，删除后托，添加完整改造选项
const w10Slots = CraftSystem._WEAPON_CRAFT_CONFIGS.weapon10.slots;
// 将 grip 改为 trigger
const gripIdx = w10Slots.findIndex(s => s.id === 'grip');
if (gripIdx >= 0) { w10Slots[gripIdx].id = 'trigger'; w10Slots[gripIdx].name = '扳机'; }
// 删除 stock
const stockIdx = w10Slots.findIndex(s => s.id === 'stock');
if (stockIdx >= 0) w10Slots.splice(stockIdx, 1);
// 为 weapon10 添加完整改造选项
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon10.options = {
    muzzle: [
        { id: 'multi_chamber_brake', name: '多室枪口制退器', icon: '⚙', desc: '后坐力恢复时间-200ms，每次射击扩散角度-2°',
          effects: { recoilRecoveryDelta: -200, shotSpreadDelta: -2 } },
        { id: 'large_caliber_suppressor', name: '大口径消音器', icon: '🔇', desc: '后坐力恢复时间-100ms，射程-200px，击退+30px',
          effects: { recoilRecoveryDelta: -100, rangeDelta: -200, knockbackDelta: 30 } }
    ],
    barrel: [
        { id: 'competition_barrel', name: '加长竞赛枪管', icon: '📏', desc: '射程+300px，后坐力恢复时间-100ms',
          effects: { rangeDelta: 300, recoilRecoveryDelta: -100 } },
        { id: 'lightweight_barrel', name: '轻量化短枪管', icon: '✂️', desc: '移动速度+5%，后坐力恢复时间+50ms',
          effects: { moveSpeedPercent: 0.05, recoilRecoveryDelta: 50 } }
    ],
    bullet: [
        { id: 'fmj_ammo', name: 'FMJ钢芯弹', icon: '🔘', desc: '穿透目标+1，伤害+5%',
          effects: { piercingBonus: 1, damagePercent: 0.05 } },
        { id: 'hollow_point', name: '空尖弹', icon: '💥', desc: '击退+30px，伤害+5%',
          effects: { knockbackDelta: 30, damagePercent: 0.05 } }
    ],
    trigger: [
        { id: 'light_trigger', name: '轻量化击发组件', icon: '⚡', desc: '射击间隔-300ms',
          effects: { attackIntervalDelta: -300 } },
        { id: 'curved_trigger', name: '弧形竞技扳机片', icon: '⌇', desc: '后坐力恢复时间-100ms',
          effects: { recoilRecoveryDelta: -100 } }
    ],
    magazine: [
        { id: 'extended_mag', name: '扩容弹夹', icon: '📦', desc: '备弹+2',
          effects: { magazineDelta: 2 } },
        { id: 'carbon_fiber_mag', name: '碳纤维快速弹夹', icon: '⚡', desc: '换弹时间-500ms',
          effects: { reloadTimeDelta: -500 } }
    ],
    sight: JSON.parse(JSON.stringify(pkmSightOptions))
};

// QJB-201：复制PKM的完整改造，使用独立布局
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon11 = {
    slots: [
        { id: 'muzzle',   name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.5027471264367817, y: 0.28569127516778575 } },
        { id: 'barrel',   name: '枪管', x: 0.08, y: 0.4,  lineTarget: { x: 0.5027471264367817, y: 0.32665771812080613 } },
        { id: 'sight',    name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.499, y: 0.49 } },
        { id: 'magazine', name: '弹夹', x: 0.92, y: 0.08, lineTarget: { x: 0.501574712643679, y: 0.42424161073825417 } },
        { id: 'bullet',   name: '子弹', x: 0.92, y: 0.32, lineTarget: { x: 0.5015747126436789, y: 0.42256375838926086 } },
        { id: 'grip',     name: '握把', x: 0.92, y: 0.45, lineTarget: { x: 0.503, y: 0.555 } },
        { id: 'stock',    name: '后托', x: 0.92, y: 0.7,  lineTarget: { x: 0.497, y: 0.664 } }
    ],
    options: {
        muzzle: [
            { id: 'suppressor', name: '多口径战术消音器', icon: '🔇', desc: '射程 -200px，击退 +8px，最大散布角度 -10°',
              effects: { rangeDelta: -200, knockbackDelta: 8, maxSpreadAngleDelta: -10 } },
            { id: 'flash_hider', name: '消焰器', icon: '🔥', desc: '隐藏枪口火焰',
              effects: { hideMuzzleFlash: true } },
            { id: 'muzzle_brake', name: '双排孔枪口制退器', icon: '⚙', desc: '最大散布时间 +0.5秒，最大散布角度 -10°',
              effects: { spreadTimeDelta: 500, maxSpreadAngleDelta: -10 } },
        ],
        barrel: [
            { id: 'long_barrel', name: '长枪管', icon: '📏', desc: '射程 +200px，子弹速度 +20%，散布开始 +1秒，最大散布 +1秒',
              effects: { rangeDelta: 200, projectileSpeedPercent: 0.20, spreadStartDelta: 1000, spreadTimeDelta: 1000 } },
            { id: 'short_barrel', name: '短枪管', icon: '✂️', desc: '射程 -200px，散布开始 +0.5秒，移动速度+5%',
              effects: { rangeDelta: -200, spreadStartDelta: 500, moveSpeedPercent: 0.05 } },
        ],
        magazine: [
            { id: 'light_mag', name: '轻型弹夹', icon: '⚡', desc: '换弹时间 -1.5秒，弹夹 -30发，移动速度增加10%',
              effects: { reloadTimeDelta: -1500, magazineDelta: -30, moveSpeedPercent: 0.10 } },
            { id: 'extended_mag', name: '扩容弹箱', icon: '📦', desc: '弹夹 +25发，移动速度减少10%，换弹时间 +0.5秒',
              effects: { magazineDelta: 25, moveSpeedPercent: -0.10, reloadTimeDelta: 500 } },
        ],
        bullet: [
            { id: 'ap_ammo', name: '钢芯穿甲弹', icon: '🛡️', desc: '攻击时无视目标35%防御力',
              effects: { armorPenetrationPercent: 0.35 } },
            { id: 'sniper_ammo', name: '高精度狙击弹', icon: '🎯', desc: '射程+200px，散布达到最大时间+0.5秒',
              effects: { rangeDelta: 200, spreadTimeDelta: 500 } },
        ],
        stock: [
            { id: 'skeleton_stock', name: '骨架枪托', icon: '🦴', desc: '移动速度+5%，散布开始 +0.5秒，最大散布 -1秒',
              effects: { moveSpeedPercent: 0.05, spreadStartDelta: 500, spreadTimeDelta: -1000 } },
            { id: 'solid_core_stock', name: '稳固核心枪托', icon: '🛡️', desc: '散布开始 +0.5秒，最大散布 +1秒',
              effects: { spreadStartDelta: 500, spreadTimeDelta: 1000 } },
        ],
        grip: [
            { id: 'light_grip', name: '轻型后握', icon: '✋', desc: '移动速度 +10%，最大散布角度 +10°',
              effects: { moveSpeedPercent: 0.10, maxSpreadAngleDelta: 10 } },
            { id: 'heavy_grip', name: '重型后握', icon: '✊', desc: '散布开始 +0.25秒，最大散布角度 -5°',
              effects: { spreadStartDelta: 250, maxSpreadAngleDelta: -5 } },
        ],
        sight: [
            { id: 'red_dot', name: '全景红点瞄具', icon: '🔴', desc: '散布开始 +1秒，单倍瞄准模式',
              effects: { spreadStartDelta: 1000, redDotScope: true } },
            { id: 'russian_3x_scope', name: '俄制三倍镜', icon: '🔭', desc: '散布开始 +1秒，高倍镜瞄准模式',
              effects: { spreadStartDelta: 1000, highPowerScope: true } },
        ]
    }
};

// QBZ-191：复制 QBZ201 的改造项目，独立配置
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon8 = JSON.parse(JSON.stringify(CraftSystem._WEAPON_CRAFT_CONFIGS.weapon11));

// Super90 专属改造配置
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon12 = {
    slots: [
        { id: 'muzzle',   name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.5027471264367817, y: 0.3091812080536913 } },
        { id: 'barrel',   name: '枪管', x: 0.08, y: 0.4,  lineTarget: { x: 0.4998735632183908, y: 0.37867114093959836 } },
        { id: 'sight',    name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.5018735632183907, y: 0.5151677852349006 } },
        { id: 'bullet',   name: '子弹', x: 0.9171264367816092, y: 0.2033, lineTarget: { x: 0.5015, y: 0.4661 } },
        { id: 'magazine', name: '弹夹', x: 0.92, y: 0.45, lineTarget: { x: 0.503, y: 0.467717449664428 } },
        { id: 'grip',     name: '握把', x: 0.92, y: 0.65, lineTarget: { x: 0.5001264367816092, y: 0.5683885906040267 } },
        { id: 'stock',    name: '后托', x: 0.92, y: 0.85, lineTarget: { x: 0.5027, y: 0.664 } }
    ],
    options: {
        muzzle: [
            { id: 'choke', name: '收束器', icon: '🔧', desc: '散布角度 -5°',
              effects: { maxSpreadAngleDelta: -5 } },
            { id: 'shotgun_suppressor', name: '消音器', icon: '🔇', desc: '射程 -300px，击退 +5px，隐藏枪口火焰',
              effects: { rangeDelta: -300, knockbackDelta: 5, hideMuzzleFlash: true } }
        ],
        barrel: [
            { id: 'long_barrel', name: '标准长枪管', icon: '📏', desc: '射程 +150px，伤害 +5%',
              effects: { rangeDelta: 150, damagePercent: 0.05 } },
            { id: 'short_barrel', name: '短枪管', icon: '✂️', desc: '备弹 5/5，移动速度 +10%，暴击率 +10%',
              effects: { magazineOverride: 5, moveSpeedPercent: 0.10, critChancePercent: 0.10 } }
        ],
        bullet: [
            { id: 'slug', name: '独头弹', icon: '🔘', desc: '单发弹丸，基础散布为零，连续射击增加散布，射程 +225px，攻击力公式修改',
              effects: { slugMode: true, rangeDelta: 225 } },
            { id: 'flechette', name: '箭型弹', icon: '➡', desc: '伤害 -10%，穿透目标 +1',
              effects: { flechetteMode: true, damagePercent: -0.10, piercingBonus: 1 } }
        ],
        magazine: [
            { id: 'fast_loader', name: '快速装填器', icon: '⚡', desc: '每次装填2发弹药',
              effects: { fastReload: true } }
        ],
        stock: [
            { id: 'ar_folding', name: 'AR式折叠套件', icon: '🦴', desc: '移动速度 +10%，独头弹模式下后坐力恢复时间 -100ms',
              effects: { moveSpeedPercent: 0.10, slugRecoilRecovery: -100 } },
            { id: 'tactical_stock', name: '一体化战术枪托', icon: '🛡️', desc: '散布角度 -5°，独头弹模式下后坐力恢复时间 -200ms',
              effects: { maxSpreadAngleDelta: -5, slugRecoilRecovery: -200 } },
            { id: 'bullpup', name: '无托改造', icon: '⚡', desc: '移动速度 +20%，散布角度 +5°',
              effects: { moveSpeedPercent: 0.20, maxSpreadAngleDelta: 5 } }
        ],
        grip: [
            { id: 'angled_grip', name: '战术斜握把', icon: '✋', desc: '射击散布 -5°',
              effects: { maxSpreadAngleDelta: -5 } },
            { id: 'pistol_grip', name: '分离式手枪握把', icon: '🔫', desc: '移动速度 +10%，射击散布 +5°',
              effects: { moveSpeedPercent: 0.10, maxSpreadAngleDelta: 5 } }
        ],
        sight: JSON.parse(JSON.stringify(pkmSightOptions))
    }
};

// SAIGA-12K 改造配置（全面复制 Super90）
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon13 = {
    slots: [
        { id: 'muzzle',   name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.5027471264367817, y: 0.3091812080536913 } },
        { id: 'barrel',   name: '枪管', x: 0.08, y: 0.4,  lineTarget: { x: 0.4998735632183908, y: 0.37867114093959836 } },
        { id: 'sight',    name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.5018735632183907, y: 0.5151677852349006 } },
        { id: 'bullet',   name: '子弹', x: 0.9171264367816092, y: 0.2033, lineTarget: { x: 0.5015, y: 0.4661 } },
        { id: 'magazine', name: '弹夹', x: 0.92, y: 0.45, lineTarget: { x: 0.49725287356321834, y: 0.4677174496644279 } },
        { id: 'grip',     name: '握把', x: 0.92, y: 0.65, lineTarget: { x: 0.5001264367816092, y: 0.5499322147651002 } },
        { id: 'stock',    name: '后托', x: 0.92, y: 0.85, lineTarget: { x: 0.5027, y: 0.664 } }
    ],
    options: {
        muzzle: [
            { id: 'choke', name: '收束器', icon: '🔧', desc: '散布角度 -5°',
              effects: { maxSpreadAngleDelta: -5 } },
            { id: 'shotgun_suppressor', name: '消音器', icon: '🔇', desc: '射程 -300px，击退 +5px，隐藏枪口火焰',
              effects: { rangeDelta: -300, knockbackDelta: 5, hideMuzzleFlash: true } }
        ],
        barrel: [
            { id: 'long_barrel', name: '标准长枪管', icon: '📏', desc: '射程 +150px，伤害 +5%',
              effects: { rangeDelta: 150, damagePercent: 0.05 } },
            { id: 'short_barrel', name: '短枪管', icon: '✂️', desc: '移动速度 +10%，暴击率 +10%，散布 +5°',
              effects: { moveSpeedPercent: 0.10, critChancePercent: 0.10, maxSpreadAngleDelta: 5 } }
        ],
        bullet: [
            { id: 'slug', name: '独头弹', icon: '🔘', desc: '单发弹丸，基础散布为零，连续射击增加散布，射程 +225px，攻击力公式修改',
              effects: { slugMode: true, rangeDelta: 225 } },
            { id: 'flechette', name: '箭型弹', icon: '➡', desc: '伤害 -10%，穿透目标 +1',
              effects: { flechetteMode: true, damagePercent: -0.10, piercingBonus: 1 } }
        ],
        magazine: [
            { id: 'drum_mag', name: '大弹鼓', icon: '📦', desc: '备弹数 +8，换弹时间 +500ms',
              effects: { magazineDelta: 8, reloadTimeDelta: 500 } },
            { id: 'light_extended', name: '轻型扩容弹夹', icon: '⚡', desc: '移动速度 +10%，换弹时间 -500ms',
              effects: { moveSpeedPercent: 0.10, reloadTimeDelta: -500 } }
        ],
        stock: [
            { id: 'ar_folding', name: 'AR式折叠套件', icon: '🦴', desc: '移动速度 +10%，独头弹模式下后坐力恢复时间 -100ms',
              effects: { moveSpeedPercent: 0.10, slugRecoilRecovery: -100 } },
            { id: 'tactical_stock', name: '一体化战术枪托', icon: '🛡️', desc: '散布角度 -5°，独头弹模式下后坐力恢复时间 -200ms',
              effects: { maxSpreadAngleDelta: -5, slugRecoilRecovery: -200 } },
            { id: 'bullpup', name: '无托改造', icon: '⚡', desc: '移动速度 +20%，散布角度 +5°',
              effects: { moveSpeedPercent: 0.20, maxSpreadAngleDelta: 5 } }
        ],
        grip: [
            { id: 'angled_grip', name: '战术斜握把', icon: '✋', desc: '射击散布 -5°',
              effects: { maxSpreadAngleDelta: -5 } },
            { id: 'pistol_grip', name: '分离式手枪握把', icon: '🔫', desc: '移动速度 +10%，射击散布 +5°',
              effects: { moveSpeedPercent: 0.10, maxSpreadAngleDelta: 5 } }
        ],
        sight: JSON.parse(JSON.stringify(pkmSightOptions))
    }
}

// 能量轻机枪专属改造配置
CraftSystem._WEAPON_CRAFT_CONFIGS.weapon15 = {
    slots: [
        { id: 'muzzle',   name: '枪口', x: 0.08, y: 0.15, lineTarget: { x: 0.497, y: 0.232 } },
        { id: 'barrel',   name: '枪管', x: 0.08, y: 0.40, lineTarget: { x: 0.497, y: 0.278 } },
        { id: 'sight',    name: '瞄具', x: 0.08, y: 0.65, lineTarget: { x: 0.499, y: 0.490 } },
        { id: 'magazine', name: '弹夹', x: 0.92, y: 0.08, lineTarget: { x: 0.401, y: 0.488 } },
        { id: 'bullet',   name: '子弹', x: 0.92, y: 0.32, lineTarget: { x: 0.401, y: 0.488 } },
        { id: 'grip',     name: '握把', x: 0.92, y: 0.45, lineTarget: { x: 0.503, y: 0.555 } },
        { id: 'stock',    name: '后托', x: 0.92, y: 0.70, lineTarget: { x: 0.497, y: 0.664 } },
    ],
    options: {
        muzzle: [
            { id: 'special_brake', name: '特制制退器', icon: '⚙', desc: '最大散布时间 +0.5秒，最大散布角度 -10°',
              effects: { spreadTimeDelta: 500, maxSpreadAngleDelta: -10 } },
            { id: 'border_radiator', name: '边境散热器', icon: '❄️', desc: '达到过热时间 +1秒',
              effects: { overheatTimeDelta: 1000 } },
        ],
        barrel: [
            { id: 'long_barrel', name: '长枪管', icon: '📏', desc: '射程 +200px，子弹速度 +20%，散布开始 +1秒，最大散布 +1秒',
              effects: { rangeDelta: 200, projectileSpeedPercent: 0.20, spreadStartDelta: 1000, spreadTimeDelta: 1000 } },
            { id: 'short_barrel', name: '短枪管', icon: '✂️', desc: '射程 -200px，散布开始 +0.5秒，移动速度 +10%',
              effects: { rangeDelta: -200, spreadStartDelta: 500, moveSpeedPercent: 0.10 } },
        ],
        magazine: [
            { id: 'energy_extended', name: '能量扩容弹箱', icon: '📦', desc: '过热时间 +2秒，移动速度 -10%',
              effects: { overheatTimeDelta: 2000, moveSpeedPercent: -0.10 } },
            { id: 'energy_fast', name: '快速能量弹夹', icon: '⚡', desc: '过热时间 -1秒，移动速度 +10%',
              effects: { overheatTimeDelta: -1000, moveSpeedPercent: 0.10 } },
        ],
        bullet: [
            { id: 'high_energy', name: '高能量子弹', icon: '🔘', desc: '射程 +200px，伤害 +5%，散布开始 -0.5秒',
              effects: { rangeDelta: 200, damagePercent: 0.05, spreadStartDelta: -500 } },
            { id: 'piercing_ammo', name: '强穿透子弹', icon: '🛡️', desc: '穿透目标 +2',
              effects: { piercingBonus: 2 } },
        ],
        stock: JSON.parse(JSON.stringify(CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.options.stock)),
        grip: JSON.parse(JSON.stringify(CraftSystem._WEAPON_CRAFT_CONFIGS.weapon6.options.grip)),
        sight: JSON.parse(JSON.stringify(pkmSightOptions))
    }
};

export { CraftSystem };
