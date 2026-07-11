

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
                idle: { holdOffsetX: -34, holdOffsetY: 4, idleRotation: 0, idleScale: 1.5 },
                walk: { holdOffsetX: -15, holdOffsetY: 23, idleRotation: 20, idleScale: 1.5 },
                running: { holdOffsetX: -76, holdOffsetY: -11, idleRotation: 110, idleScale: 1.5 },

                // 新增：手部挂载点（相对于玩家中心的偏移）
                // 值与 holdOffsetX/Y 一致，确保挂载点系统与旧系统位置匹配
                handAnchors: {
                    idle:    { x: -34,  y: 4 },  // 与 idle.holdOffsetX/Y 一致
                    walk:    { x: -15,  y: 23 },   // 与 walk.holdOffsetX/Y 一致
                    running: { x: -76,  y: -11 },  // 与 running.holdOffsetX/Y 一致
                    attack:  { x: -35,  y: 4 },     // 与基础 holdOffsetX/Y 一致
                },

                // 握把偏移：武器精灵中心到握把点的偏移
                // 剑的握把在精灵底部中央，所以gripOffset是(0, 正数)
                gripOffset: { x: 0, y: 32 }, // 根据实际精灵调整
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
            // 结构：{ progress: 0-1, handOffsetX, handOffsetY, rotation, scale }
            // progress 对应攻击进度（0=开始, 1=结束）
            // handOffsetX/Y 是相对于 attack 基础挂载点的偏移
            keyframes: {
                sword: {
                    attack: [
                        { progress: 0, handOffsetX: -5.5, handOffsetY: -32.92, rotation: -45, scale: 1.5 },
                        { progress: 0.25, handOffsetX: -0.5, handOffsetY: -58.92, rotation: -75, scale: 1.5 },
                        { progress: 0.375, handOffsetX: 0.5, handOffsetY: -70.92, rotation: -90, scale: 1.5 },
                        { progress: 0.5, handOffsetX: 4.5, handOffsetY: -78.92, rotation: -60, scale: 1.5 },
                        { progress: 0.625, handOffsetX: 16.5, handOffsetY: -77.92, rotation: -30, scale: 1.5 },
                        { progress: 0.75, handOffsetX: 37.5, handOffsetY: -55.92, rotation: -10, scale: 1.5 },
                        { progress: 0.875, handOffsetX: 45.5, handOffsetY: -25.92, rotation: -40, scale: 1.5 }
                    ],
                    walk: [
                        { progress: 0.19047619047619047, handOffsetX: -37.5, handOffsetY: 26.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.3333333333333333, handOffsetX: -34.5, handOffsetY: 20.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.5238095238095238, handOffsetX: -42.5, handOffsetY: 22.078125, rotation: 20, scale: 1.5000000000000004 },
                        { progress: 0.8571428571428571, handOffsetX: -52.5, handOffsetY: 21.078125, rotation: 20, scale: 1.5000000000000004 }
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
                handAnchors: cfg.handAnchors || null,
                gripOffset: cfg.gripOffset || null,
                timingMul: cfg.timingMul,
                animType: cfg.animType,
                hitBox: cfg.hitBox,
                stab: cfg.stab,
                renderParams: cfg.renderParams
            };
        }

        // ItemFactory — 物品工厂，为每个物品创建独立实例

export { WeaponAnimConfig, getWeaponStateConfig };
