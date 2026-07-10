import { Easing } from '../config/math-utils.js';

        const WeaponAnimConfig = {
            bow: { holdOffsetX: 17, holdOffsetY: 3, attackInterval: 1500, rotateMs: 500, returnMs: 200, animType: 'frameSequence', idleRotation: 100, idleScale: 1.6 },
            pistol: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.15,
                renderParams: { gunLXOffset: 20, gunLY: 13, offhandGunLY: -13, muzzleOffset: 22, flashOffset: 28, shellCasingOffset: -8, recoilWindup: 0.04, recoilSwing: 0.1, recoilRecover: 0.04, shakeIntensity: 3 } },
            p4040: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.5, animType: 'recoil', recoilAmount: 0.08,
                renderParams: { gunLXOffset: 20, gunLY: 13, offhandGunLY: -13, muzzleOffset: 22, flashOffset: 28, shellCasingOffset: -8, recoilWindup: 0.02, recoilSwing: 0.05, recoilRecover: 0.02, shakeIntensity: 1 } },
            deagle: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.5, animType: 'recoil', recoilAmount: 0.08,
                renderParams: { gunLXOffset: 20, gunLY: 13, offhandGunLY: -13, muzzleOffset: 22, flashOffset: 28, shellCasingOffset: -8, recoilWindup: 0.02, recoilSwing: 0.05, recoilRecover: 0.02, shakeIntensity: 1 } },
            akm: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.1, animType: 'recoil', recoilAmount: 0.12,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.03, recoilSwing: 0.08, recoilRecover: 0.03, shakeIntensity: 4 } },
            pkm: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.1, animType: 'recoil', recoilAmount: 0.12,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.03, recoilSwing: 0.08, recoilRecover: 0.03, shakeIntensity: 4 } },
            qbz191: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.07, animType: 'recoil', recoilAmount: 0.10,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.03, recoilSwing: 0.08, recoilRecover: 0.03, shakeIntensity: 4 } },
            qjb201: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.08,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.03, recoilSwing: 0.08, recoilRecover: 0.03, shakeIntensity: 4 } },
            energy_lmg: { holdOffsetX: -8, holdOffsetY: 2, timingMul: 0.25, animType: 'recoil', recoilAmount: 0.10, idleRotation: 0, idleScale: 0.8,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.03, recoilSwing: 0.08, recoilRecover: 0.03, shakeIntensity: 4 } },
            shotgun: { holdOffsetX: 0, holdOffsetY: 0, timingMul: 0.5, animType: 'recoil', recoilAmount: 0.15,
                renderParams: { gunLXOffset: 24, gunLY: 0, muzzleOffset: 30, flashOffset: 38, shellCasingOffset: -10, recoilWindup: 0.04, recoilSwing: 0.12, recoilRecover: 0.04, shakeIntensity: 5 } },
            sword: { holdOffsetX: -35, holdOffsetY: 4, timingMul: 1.0, animType: 'thrust', idleRotation: -45, idleScale: 1.0, hitBox: { forwardRange: 155, backExtension: 55, width: 35 },
                idle: { holdOffsetX: -43, holdOffsetY: -18, idleRotation: -65, idleScale: 1.3 },
                walk: { holdOffsetX: -15, holdOffsetY: 23, idleRotation: 20, idleScale: 1.5 },
                running: { holdOffsetX: -76, holdOffsetY: -11, idleRotation: 110, idleScale: 1.5 }
            },
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
            },
            // 关键帧配置：攻击动画每帧武器位置（用于开发工具设定）
            // 结构：{ progress: 0-1, offsetX, offsetY, rotation, scale }
            // progress 对应攻击进度（0=开始, 1=结束）
            keyframes: {
                // 示例：剑类攻击关键帧（可由开发工具编辑）
                sword: {
                    attack: [
                        { progress: 0.00, offsetX: -30, offsetY: 5,  rotation: -45, scale: 1.3 },
                        { progress: 0.25, offsetX: -20, offsetY: 0,  rotation: -20, scale: 1.4 },
                        { progress: 0.50, offsetX: 40,  offsetY: -10, rotation: 30,  scale: 1.5 },
                        { progress: 0.75, offsetX: 20,  offsetY: 0,  rotation: 10,  scale: 1.4 },
                        { progress: 1.00, offsetX: -30, offsetY: 5,  rotation: -45, scale: 1.3 }
                    ],
                    walk: [
                        { progress: 0.19047619047619047, offsetX: -22.5, offsetY: 23.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.3333333333333333, offsetX: -19.5, offsetY: 17.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.5238095238095238, offsetX: -27.5, offsetY: 19.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.8571428571428571, offsetX: -37.5, offsetY: 18.078125, rotation: 20, scale: 1.5000000000000004 }
                    ]
                }
            }
        };

        // 辅助函数：获取武器按状态分层的配置
        // key: 武器配置键（如 'sword', 'pistol', 'bow'）
        // state: 动画状态（如 'idle', 'walk', 'running'）
        function getWeaponStateConfig(key, state) {
            const cfg = WeaponAnimConfig[key];
            if (!cfg) return null;
            const stateCfg = cfg[state] || {};
            return {
                holdOffsetX: stateCfg.holdOffsetX !== undefined ? stateCfg.holdOffsetX : cfg.holdOffsetX,
                holdOffsetY: stateCfg.holdOffsetY !== undefined ? stateCfg.holdOffsetY : cfg.holdOffsetY,
                idleRotation: stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : cfg.idleRotation,
                idleScale: stateCfg.idleScale !== undefined ? stateCfg.idleScale : cfg.idleScale,
                timingMul: cfg.timingMul,
                animType: cfg.animType,
                hitBox: cfg.hitBox,
                stab: cfg.stab,
                renderParams: cfg.renderParams
            };
        }

        // ItemFactory — 物品工厂，为每个物品创建独立实例

export { WeaponAnimConfig, getWeaponStateConfig };
