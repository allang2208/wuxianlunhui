/**
 * 世界-122 陷阱 数值配置（唯一真源，2026-08-07）
 * 注意：本文件必须保持零依赖（纯数据），BootScene/面板/BUILD_ITEMS 均引用它；
 * 不要在这里 import 任何运行模块，避免初始化时序循环。
 */

export const TRAP_GRADES = ['F', 'E', 'D', 'C', 'B', 'A'];

export const TRAP_CONFIG = {
    spike: {
        displayName: '地刺',
        desc: '踩踏触发，冷却后再次生效',
        tex: 'trap_spike_F',
        w: 72, h: 52, footOffsetY: 26,
        grades: {
            F: { cost: 60, hp: 300, damage: 28, triggerRadius: 34, effectRadius: 34, cooldownMs: 1800 },
            E: { cost: 90, hp: 380, damage: 42, triggerRadius: 36, effectRadius: 36, cooldownMs: 1600 },
            D: { cost: 135, hp: 480, damage: 60, triggerRadius: 38, effectRadius: 38, cooldownMs: 1400 },
            C: { cost: 200, hp: 600, damage: 82, triggerRadius: 40, effectRadius: 40, cooldownMs: 1250 },
            B: { cost: 300, hp: 760, damage: 108, triggerRadius: 42, effectRadius: 42, cooldownMs: 1100 },
            A: { cost: 450, hp: 960, damage: 140, triggerRadius: 44, effectRadius: 44, cooldownMs: 950 },
        },
    },
    mine: {
        displayName: '地雷',
        desc: '踩踏触发范围爆炸，重装后可再次布防',
        tex: 'trap_mine_F',
        w: 70, h: 50, footOffsetY: 25,
        grades: {
            F: { cost: 110, hp: 260, damage: 85, triggerRadius: 32, effectRadius: 70, cooldownMs: 4500 },
            E: { cost: 165, hp: 330, damage: 125, triggerRadius: 34, effectRadius: 80, cooldownMs: 4200 },
            D: { cost: 250, hp: 420, damage: 180, triggerRadius: 36, effectRadius: 92, cooldownMs: 3900 },
            C: { cost: 370, hp: 530, damage: 250, triggerRadius: 38, effectRadius: 106, cooldownMs: 3600 },
            B: { cost: 550, hp: 670, damage: 340, triggerRadius: 40, effectRadius: 122, cooldownMs: 3300 },
            A: { cost: 820, hp: 850, damage: 460, triggerRadius: 42, effectRadius: 140, cooldownMs: 3000, stunChance: 0.5, stunMs: 1200 },
        },
    },
    tar: {
        displayName: '减速带',
        desc: '范围内怪物持续减速，A 档附加定身',
        tex: 'trap_tar_F',
        w: 92, h: 68, footOffsetY: 34,
        grades: {
            F: { cost: 70, hp: 350, damage: 0, triggerRadius: 40, effectRadius: 70, cooldownMs: 300, slowMul: 0.80, slowDuration: 1500 },
            E: { cost: 105, hp: 440, damage: 0, triggerRadius: 42, effectRadius: 82, cooldownMs: 300, slowMul: 0.74, slowDuration: 1700 },
            D: { cost: 160, hp: 550, damage: 0, triggerRadius: 44, effectRadius: 94, cooldownMs: 300, slowMul: 0.68, slowDuration: 1900 },
            C: { cost: 240, hp: 690, damage: 0, triggerRadius: 46, effectRadius: 108, cooldownMs: 300, slowMul: 0.62, slowDuration: 2100 },
            B: { cost: 360, hp: 860, damage: 0, triggerRadius: 48, effectRadius: 122, cooldownMs: 300, slowMul: 0.55, slowDuration: 2300 },
            A: { cost: 540, hp: 1080, damage: 0, triggerRadius: 50, effectRadius: 138, cooldownMs: 300, slowMul: 0.48, slowDuration: 2500, bindChance: 0.3, bindMs: 900 },
        },
    },
    burn: {
        displayName: '燃烧区',
        desc: '范围内怪物持续灼烧',
        tex: 'trap_burn_F',
        w: 88, h: 64, footOffsetY: 32,
        grades: {
            F: { cost: 100, hp: 300, damage: 10, triggerRadius: 42, effectRadius: 72, cooldownMs: 350, burnTickMs: 500, burnDuration: 6000 },
            E: { cost: 150, hp: 380, damage: 15, triggerRadius: 44, effectRadius: 84, cooldownMs: 350, burnTickMs: 450, burnDuration: 7000 },
            D: { cost: 225, hp: 480, damage: 22, triggerRadius: 46, effectRadius: 96, cooldownMs: 350, burnTickMs: 400, burnDuration: 8000 },
            C: { cost: 340, hp: 600, damage: 31, triggerRadius: 48, effectRadius: 110, cooldownMs: 350, burnTickMs: 350, burnDuration: 9000 },
            B: { cost: 500, hp: 760, damage: 43, triggerRadius: 50, effectRadius: 124, cooldownMs: 350, burnTickMs: 300, burnDuration: 10000 },
            A: { cost: 750, hp: 950, damage: 58, triggerRadius: 52, effectRadius: 140, cooldownMs: 350, burnTickMs: 250, burnDuration: 12000 },
        },
    },
};

export const TRAP_SELL_RATIO = 0.5;

export const TRAP_SPACING = 60;

export function getTrapDef(type, grade) {
    const t = TRAP_CONFIG[type];
    if (!t) return null;
    const g = t.grades[grade];
    if (!g) return null;
    return { type, grade, ...t, gradeCfg: g };
}

export function getTrapCost(type, grade) {
    const d = getTrapDef(type, grade);
    return d ? d.gradeCfg.cost : 0;
}
