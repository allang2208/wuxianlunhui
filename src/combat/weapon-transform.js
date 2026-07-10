import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM } from '../config/math-utils.js';

const WEAPON_SIZE_BASE = WEAPON_ANIM.size; // 105
const MELEE_SCALE = 0.75;

/**
 * 武器变换配置 — 每种武器类型的 Canvas 变换链参数
 * 统一从这里获取，避免在 player.js 和 GameScene.js 中重复硬编码
 */
const WEAPON_TRANSFORM_CONFIG = {
    sword: {
        mainBaseX: -7, mainBaseY: 0,
        offBaseX: -5, offBaseY: -16.5,
        holdOffsetKey: 'sword',
        afterRotateOffsetX: (s) => s * 0.75 * 0.85,  // ms * 0.85
        afterRotateOffsetY: 0,
        baseRotation: Math.PI / 2,
    },
    bow: {
        mainBaseX: -7, mainBaseY: 0,
        offBaseX: -5, offBaseY: -16.5,
        holdOffsetKey: 'bow',
        afterRotateOffsetX: 0,
        afterRotateOffsetY: 0,
        baseRotation: Math.PI / 2,
    },
    pistol: {
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -5, offBaseY: -16.5,
        holdOffsetKey: 'pistol',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    p4040: {
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -5, offBaseY: -16.5,
        holdOffsetKey: 'p4040',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    deagle: {
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -5, offBaseY: -16.5,
        holdOffsetKey: 'deagle',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    pkm: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'pkm',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    akm: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'akm',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    qbz191: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'qbz191',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    qjb201: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'qjb201',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    energy_lmg: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'energy_lmg',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    shotgun: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'shotgun',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
};

/**
 * WeaponTransform — 统一武器位置和变换计算
 * Canvas 和 Phaser 共享此模块，避免两边硬编码不一致
 */
class WeaponTransform {

    // ==================== 获取武器变换配置 ====================

    static _getConfig(weaponType) {
        return WEAPON_TRANSFORM_CONFIG[weaponType] || WEAPON_TRANSFORM_CONFIG.sword;
    }

    // ==================== 基础本地偏移（待机状态） ====================

    /**
     * 获取武器在玩家本地坐标系中的偏移（待机状态）
     * @param {string} weaponType - 武器类型（sword/bow/pistol/akm/pkm 等）
     * @param {number} playerSize - 玩家尺寸（默认 WEAPON_ANIM.size = 105）
     * @param {boolean} isOffhand - 是否为副手
     * @param {boolean} isDualWield - 是否双持
     * @returns {object} {x, y, size, scale, baseRotation, idleRotation}
     */
    static getWeaponLocalOffset(weaponType, playerSize, isOffhand = false, isDualWield = false, animState = null, facingRight = true) {
        const cfg = this._getConfig(weaponType);
        const s = WEAPON_SIZE_BASE; // 105，不是 player.size（18）
        const ms = s * MELEE_SCALE; // 78.75
        const scale = playerSize ? playerSize / WEAPON_SIZE_BASE : 1; // 缩放比例

        // 基础偏移（mainBase/offBase）
        const baseX = isOffhand
            ? cfg.offBaseX
            : (typeof cfg.mainBaseX === 'function' ? cfg.mainBaseX(isDualWield) : cfg.mainBaseX);
        const baseY = isOffhand
            ? cfg.offBaseY
            : (typeof cfg.mainBaseY === 'function' ? cfg.mainBaseY(isDualWield) : cfg.mainBaseY);

        // 武器配置偏移（holdOffsetX/Y）——支持按状态读取
        let wac;
        if (animState && WeaponAnimConfig[cfg.holdOffsetKey] && typeof WeaponAnimConfig[cfg.holdOffsetKey] === 'object') {
            const globalCfg = WeaponAnimConfig[cfg.holdOffsetKey];
            const stateCfg = globalCfg[animState] || {};
            wac = {
                holdOffsetX: stateCfg.holdOffsetX !== undefined ? stateCfg.holdOffsetX : globalCfg.holdOffsetX,
                holdOffsetY: stateCfg.holdOffsetY !== undefined ? stateCfg.holdOffsetY : globalCfg.holdOffsetY,
                idleRotation: stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : globalCfg.idleRotation,
                idleScale: stateCfg.idleScale !== undefined ? stateCfg.idleScale : globalCfg.idleScale,
            };
        } else {
            wac = WeaponAnimConfig[cfg.holdOffsetKey] || {};
        }
        let holdX = wac.holdOffsetX || 0;
        const holdY = wac.holdOffsetY || 0;

        // 方向镜像：朝左时，水平翻转 holdOffsetX
        // 配置值是相对于角色朝右时的位置，朝左时自动镜像
        // 注意：位置镜像现在在 localToWorld 中处理，这里不再镜像
        /*
        if (!facingRight) {
            holdX = -holdX;
        }
        */

        // 旋转后偏移（translate(0, -offset) 在旋转后坐标系中的等价）
        const afterX = typeof cfg.afterRotateOffsetX === 'function' ? cfg.afterRotateOffsetX(s) : cfg.afterRotateOffsetX;
        const afterY = typeof cfg.afterRotateOffsetY === 'function' ? cfg.afterRotateOffsetY(s) : cfg.afterRotateOffsetY;

        // 尺寸和缩放
        let size, scaleFactor;
        if (weaponType === 'sword') {
            size = ms;
            scaleFactor = wac.idleScale || 1;
        } else if (weaponType === 'bow') {
            size = s;
            scaleFactor = wac.idleScale || 1;
        } else {
            size = s;
            scaleFactor = wac.idleScale || 1;
        }

        return {
            x: baseX + holdX + afterX,
            y: baseY + holdY + afterY,
            size: size * scale,
            scale: scaleFactor * scale,
            baseRotation: cfg.baseRotation,
            idleRotation: (wac.idleRotation || 0) * Math.PI / 180,
            weaponType,
        };
    }

    // 兼容旧接口：剑类主手
    static getMeleeLocalOffset(isOffhand = false) {
        return this.getWeaponLocalOffset('sword', WEAPON_SIZE_BASE, isOffhand, false);
    }

    // ==================== 旋转计算 ====================

    static getWeaponRotation(playerRotation, weaponType, animAngle = 0, animState = null, facingRight = true) {
        const cfg = this._getConfig(weaponType);
        let wac;
        if (animState && WeaponAnimConfig[cfg.holdOffsetKey] && typeof WeaponAnimConfig[cfg.holdOffsetKey] === 'object') {
            const globalCfg = WeaponAnimConfig[cfg.holdOffsetKey];
            const stateCfg = globalCfg[animState] || {};
            wac = {
                idleRotation: stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : globalCfg.idleRotation,
            };
        } else {
            wac = WeaponAnimConfig[cfg.holdOffsetKey] || {};
        }
        // 使用 playerRotation 计算基础旋转（远程武器跟随鼠标，近战武器固定）
        let rot = playerRotation + cfg.baseRotation;
        if (wac.idleRotation) {
            let idleRot = wac.idleRotation * Math.PI / 180;
            // 朝左时镜像 idleRotation（对所有近战武器）
            const isMelee = weaponType === 'sword' || weaponType === 'bow';
            if (!facingRight && isMelee) {
                idleRot = Math.PI - idleRot;  // 调转方向（180度反转）
            }
            rot += idleRot;
        }
        rot += animAngle;
        return rot;
    }

    // 兼容旧接口
    static getMeleeRotation(playerRotation) {
        return this.getWeaponRotation(playerRotation, 'sword');
    }

    // ==================== 世界坐标转换 ====================

    static localToWorld(player, localOffset, fixedRotation = null, facingRight = true, animState = null, weaponType = null) {
        const rot = fixedRotation !== null ? fixedRotation : player.rotation;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        let x = player.x + cos * localOffset.x - sin * localOffset.y;
        // 朝左时镜像武器位置（对所有近战武器状态）
        const isMelee = weaponType === 'sword' || weaponType === 'bow';
        if (!facingRight && isMelee) {
            x = player.x - (x - player.x);
        }
        return {
            x: x,
            y: player.y + sin * localOffset.x + cos * localOffset.y,
        };
    }

    static getWeaponWorldPosition(player, weaponType, isOffhand = false, isDualWield = false, animState = null) {
        const facingRight = Math.abs(player.rotation) < Math.PI / 2;
        const local = this.getWeaponLocalOffset(weaponType, player.size, isOffhand, isDualWield, animState, facingRight);
        // 使用固定 rotation（朝右）计算世界坐标，武器不随鼠标旋转
        // 对所有近战武器使用固定 rotation
        const isMelee = weaponType === 'sword' || weaponType === 'bow';
        const useFixedRotation = isMelee;
        const world = this.localToWorld(player, local, useFixedRotation ? 0 : null, facingRight, animState, weaponType);
        return { ...local, x: world.x, y: world.y };
    }

    // 兼容旧接口
    static getMeleeWorldPosition(player, isOffhand = false) {
        return this.getWeaponWorldPosition(player, 'sword', isOffhand, false);
    }

    // ==================== 攻击动画偏移（动态） ====================

    /**
     * 获取攻击动画中的动态偏移（后坐力、位移等）
     * @param {string} weaponType - 武器类型
     * @param {object} anim - 攻击动画状态 {state, timer}
     * @param {number} s - 玩家尺寸
     * @returns {object} {recoilX, recoilY, animAngle}
     */
    static getAttackAnimOffset(weaponType, anim, s) {
        const wa = WEAPON_ANIM;
        let recoilX = 0, recoilY = 0, animAngle = 0;
        const wac = WeaponAnimConfig[weaponType] || {};
        const rp = wac.renderParams || {};

        if (weaponType === 'pistol' || weaponType === 'deagle' || weaponType === 'p4040') {
            if (anim.state === 'windup') {
                recoilX = -s * (rp.recoilWindup || 0.04) * easeOutQuad(anim.timer / wa.windupMs);
            } else if (anim.state === 'swing') {
                const st = anim.timer / wa.swingMs;
                recoilX = s * (rp.recoilSwing || 0.1) * (1 - st);
                recoilY = (Math.random() - 0.5) * (rp.shakeIntensity || 3) * (1 - st);
            } else if (anim.state === 'recover') {
                const rt = anim.timer / wa.recoverMs;
                recoilX = -s * (rp.recoilRecover || 0.04) * (1 - rt);
            }
        } else if (weaponType === 'pkm' || weaponType === 'akm' || weaponType === 'qbz191' || weaponType === 'qjb201' || weaponType === 'energy_lmg') {
            if (anim.state === 'windup') {
                recoilX = -s * (rp.recoilWindup || 0.03) * easeOutQuad(anim.timer / wa.windupMs);
            } else if (anim.state === 'swing') {
                const st = anim.timer / wa.swingMs;
                recoilX = s * (rp.recoilSwing || 0.08) * (1 - st);
                recoilY = (Math.random() - 0.5) * (rp.shakeIntensity || 4) * (1 - st);
            } else if (anim.state === 'recover') {
                const rt = anim.timer / wa.recoverMs;
                recoilX = -s * (rp.recoilRecover || 0.03) * (1 - rt);
            }
        } else if (weaponType === 'shotgun') {
            if (anim.state === 'windup') {
                recoilX = -s * (rp.recoilWindup || 0.04) * easeOutQuad(anim.timer / wa.windupMs);
            } else if (anim.state === 'swing') {
                const st = anim.timer / wa.swingMs;
                recoilX = s * (rp.recoilSwing || 0.12) * (1 - st);
                recoilY = (Math.random() - 0.5) * (rp.shakeIntensity || 5) * (1 - st);
            } else if (anim.state === 'recover') {
                const rt = anim.timer / wa.recoverMs;
                recoilX = -s * (rp.recoilRecover || 0.04) * (1 - rt);
            }
        } else if (weaponType === 'sword') {
            // 剑类攻击动画已禁用，武器保持静止
            // 刺击动画位移在 Canvas 中通过 ctx.translate 直接控制
            // 这里返回角度变化（已禁用）
            // if (anim.state === 'windup') { ... }
            // else if (anim.state === 'swing') { ... }
            // else if (anim.state === 'recover') { ... }
        }

        return { recoilX, recoilY, animAngle };
    }

    // ==================== 武器尺寸计算 ====================

    static getWeaponSize(weaponType, scaleOverride = null, animState = null) {
        // 武器尺寸基于 WEAPON_ANIM.size（105），不是 player.size（18）
        const s = WEAPON_ANIM.size; // 105
        const ms = s * MELEE_SCALE; // 78.75
        const cfg = WeaponAnimConfig[weaponType] || {};
        
        // 支持按状态读取缩放值
        // 优先顺序：scaleOverride > keyframes[animState] > cfg[animState] > cfg.idleScale
        let scale;
        if (scaleOverride !== null) {
            scale = scaleOverride;
        } else if (animState && WeaponAnimConfig.keyframes && WeaponAnimConfig.keyframes[weaponType] && WeaponAnimConfig.keyframes[weaponType][animState]) {
            // 从关键帧配置读取缩放值（取第一帧的scale作为基准）
            const kfList = WeaponAnimConfig.keyframes[weaponType][animState];
            scale = kfList && kfList.length > 0 ? kfList[0].scale : 1;
        } else if (animState && cfg[animState] && cfg[animState].idleScale !== undefined) {
            scale = cfg[animState].idleScale;
        } else {
            scale = cfg.idleScale || 1;
        }

        if (weaponType === 'sword') {
            return { width: ms * 0.63 * scale, height: ms * scale };
        } else if (weaponType === 'bow') {
            return { width: s * scale * 1.10, height: s * scale * 1.10, useAspectRatio: true };
        } else if (weaponType === 'pistol' || weaponType === 'deagle' || weaponType === 'p4040') {
            return { width: s * 0.275 * scale, height: s * 0.5 * scale };
        } else {
            return { width: s * 0.75 * scale, height: s * scale };
        }
    }

    // ==================== 攻击范围配置（判定 + 显示共享） ====================

    static getMeleeHitBox() {
        return WeaponAnimConfig.sword.hitBox;
    }
}

// 简单缓动函数（避免循环依赖）
function easeOutQuad(t) { return t * (2 - t); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export { WeaponTransform };
