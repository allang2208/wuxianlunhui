import { Easing } from '../config/math-utils.js';

        const WeaponAnimConfig = {
            bow: { holdOffsetX: -20, holdOffsetY: 11, timingMul: 1.0, animType: 'frameSequence' },
            pistol: { holdOffsetX: 0, holdOffsetY: 4, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.15 },
            sword: { holdOffsetX: -20, holdOffsetY: 11, timingMul: 1.0, animType: 'thrust' },
            stab: {
                // 刺击动画通用配置（可被所有剑类武器复用）
                windupMs: 150,      // 蓄力时间（ms）
                stabMs: 200,        // 刺击时间（ms）— 快速有力
                recoverMs: 350,     // 收回时间（ms）— 缓慢收回
                windupDist: 0.35,   // 蓄力回退距离（倍率）
                stabDist: 0.893,    // 前刺距离：75px / 84 = 0.893，固定75px
                recoverSnapDist: 8, // 瞬移后剩余距离（px），用于平滑过渡
                easeIn: Easing.easeInCubic,    // 蓄力缓动：前急后缓
                easeOut: Easing.easeOutQuad,   // 刺击缓动：快速爆发
                easeRecover: Easing.easeInOutCubic, // 收回缓动：平滑
                // 角度变化（可选，留空则使用 WEAPON_ANIM 默认值）
                idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
            }
        };

        // ItemFactory — 物品工厂，为每个物品创建独立实例

export { WeaponAnimConfig };
