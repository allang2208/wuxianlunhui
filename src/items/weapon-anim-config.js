import { Easing } from '../config/math-utils.js';

        const WeaponAnimConfig = {
            bow: { holdOffsetX: 17, holdOffsetY: 3, attackInterval: 1500, rotateMs: 500, returnMs: 200, animType: 'frameSequence', idleRotation: 100, idleScale: 1.6 },
            pistol: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.15 },
            deagle: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.5, animType: 'recoil', recoilAmount: 0.08 },
            akm: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.1, animType: 'recoil', recoilAmount: 0.12 },
            pkm: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.1, animType: 'recoil', recoilAmount: 0.12 },
            qbz191: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.07, animType: 'recoil', recoilAmount: 0.10 },
            qjb201: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.08 },
            shotgun: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.5, animType: 'recoil', recoilAmount: 0.15 },
            sword: { holdOffsetX: -35, holdOffsetY: 4, timingMul: 1.0, animType: 'thrust', idleRotation: -45, idleScale: 1.0, hitBox: { forwardRange: 155, backExtension: 55, width: 35 } },
            stab: {
                // 刺击动画通用配置（可被所有剑类武器复用）
                windupMs: 150,      // 蓄力时间（ms）
                stabMs: 200,        // 刺击时间（ms）— 快速有力
                recoverMs: 350,     // 收回时间（ms）— 缓慢收回
                windupDist: 0.35,   // 蓄力回退距离（倍率）
                stabDist: 0.893,    // 前刺距离：94px / 105 = 0.893，固定94px（已放大25%）
                recoverSnapDist: 10, // 瞬移后剩余距离（px），用于平滑过渡
                easeIn: Easing.easeInCubic,    // 蓄力缓动：前急后缓
                easeOut: Easing.easeOutQuad,   // 刺击缓动：快速爆发
                easeRecover: Easing.easeInOutCubic, // 收回缓动：平滑
                // 角度变化（可选，留空则使用 WEAPON_ANIM 默认值）
                idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
            }
        };

        // ItemFactory — 物品工厂，为每个物品创建独立实例

export { WeaponAnimConfig };
