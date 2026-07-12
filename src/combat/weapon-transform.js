
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM, Easing } from '../config/math-utils.js';

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

    /**
     * 获取武器变换配置（开发工具用于反向计算）
     * @param {string} weaponType - 武器类型
     * @returns {object} WEAPON_TRANSFORM_CONFIG 中的配置项
     */
    static getWeaponTransformConfig(weaponType) {
        return this._getConfig(weaponType);
    }

    /**
     * 获取武器基础偏移和旋转后偏移（开发工具使用）
     * @param {string} weaponType - 武器类型
     * @param {boolean} isOffhand - 是否为副手
     * @param {boolean} isDualWield - 是否双持
     * @returns {object} {baseX, baseY, afterX, afterY}
     */
    static getWeaponBaseOffset(weaponType, isOffhand = false, isDualWield = false) {
        const cfg = this._getConfig(weaponType);
        const s = WEAPON_SIZE_BASE;
        const baseX = isOffhand
            ? cfg.offBaseX
            : (typeof cfg.mainBaseX === 'function' ? cfg.mainBaseX(isDualWield) : cfg.mainBaseX);
        const baseY = isOffhand
            ? cfg.offBaseY
            : (typeof cfg.mainBaseY === 'function' ? cfg.mainBaseY(isDualWield) : cfg.mainBaseY);
        const afterX = typeof cfg.afterRotateOffsetX === 'function' ? cfg.afterRotateOffsetX(s) : cfg.afterRotateOffsetX;
        const afterY = typeof cfg.afterRotateOffsetY === 'function' ? cfg.afterRotateOffsetY(s) : cfg.afterRotateOffsetY;
        return { baseX, baseY, afterX, afterY };
    }

    /**
     * 按状态读取武器动画配置，支持 overrides 覆盖（开发工具使用）
     * @param {string} weaponType - 武器类型
     * @param {string} animState - 动画状态
     * @param {object} overrides - 可选覆盖字段 {holdOffsetX, holdOffsetY, idleRotation, idleScale, handAnchors, gripOffset}
     * @returns {object} 合并后的状态配置
     */
    static _getStateConfig(weaponType, animState, overrides = {}) {
        const cfg = this._getConfig(weaponType);
        const globalCfg = WeaponAnimConfig[cfg.holdOffsetKey] || {};
        const stateCfg = globalCfg[animState] || {};

        const pick = (key) => {
            if (overrides[key] !== undefined) return overrides[key];
            if (stateCfg[key] !== undefined) return stateCfg[key];
            return globalCfg[key];
        };

        return {
            holdOffsetX: pick('holdOffsetX') || 0,
            holdOffsetY: pick('holdOffsetY') || 0,
            idleRotation: pick('idleRotation') || 0,
            idleScale: pick('idleScale') || 1,
            handAnchors: overrides.handAnchors !== undefined ? overrides.handAnchors : (globalCfg.handAnchors || {}),
            gripOffset: overrides.gripOffset !== undefined ? overrides.gripOffset : globalCfg.gripOffset,
        };
    }

    // ==================== 基础本地偏移（待机状态） ====================

    /**
     * 获取武器在玩家本地坐标系中的偏移（待机状态）
     * @param {string} weaponType - 武器类型（sword/bow/pistol/akm/pkm 等）
     * @param {number} playerSize - 玩家尺寸（默认 WEAPON_ANIM.size = 105）
     * @param {boolean} isOffhand - 是否为副手
     * @param {boolean} isDualWield - 是否双持
     * @param {string} animState - 动画状态（idle/walk/running/attack）
     * @param {boolean} _facingRight - 是否朝右（本地偏移不使用，保持接口一致）
     * @param {object} overrides - 开发工具覆盖字段
     * @returns {object} {x, y, size, scale, baseRotation, idleRotation}
     */
    static getWeaponLocalOffset(weaponType, playerSize, isOffhand = false, isDualWield = false, animState = null, _facingRight = true, overrides = {}) {
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

        // 武器配置偏移（holdOffsetX/Y）——支持按状态读取和 overrides
        const wac = this._getStateConfig(weaponType, animState, overrides);

        // ===== 新增：手部挂载点系统 =====
        const handAnchors = wac.handAnchors || {};
        const gripOffset = wac.gripOffset || null;
        let holdX, holdY;

        // 如果调用方显式传入了 holdOffsetX/Y 覆盖，优先使用传统 holdOffset（开发工具需要）
        const useHoldOffsetOverride = overrides && (overrides.holdOffsetX !== undefined || overrides.holdOffsetY !== undefined);

        if (!useHoldOffsetOverride && handAnchors && animState && handAnchors[animState]) {
            // 使用挂载点系统
            const anchor = handAnchors[animState];
            // 握把偏移旋转后的位置（握把在武器精灵坐标系中）
            let gripX = 0, gripY = 0;
            if (gripOffset) {
                // 握把偏移需要根据武器当前旋转角度旋转
                // 这里先计算基础位置，旋转在 localToWorld 中处理
                gripX = gripOffset.x;
                gripY = gripOffset.y;
            }
            // 武器精灵位置 = 挂载点 + gripOffset（在世界坐标系中由 localToWorld 处理旋转）
            holdX = anchor.x + gripX;
            holdY = anchor.y + gripY;
        } else {
            // 回退到现有 holdOffsetX/Y 系统（向后兼容）
            holdX = wac.holdOffsetX || 0;
            holdY = wac.holdOffsetY || 0;
        }

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
            // 新增：挂载点信息（供开发工具使用）
            handAnchor: handAnchors && handAnchors[animState] ? handAnchors[animState] : null,
            gripOffset: gripOffset,
        };
    }

    // 兼容旧接口：剑类主手
    static getMeleeLocalOffset(isOffhand = false) {
        return this.getWeaponLocalOffset('sword', WEAPON_SIZE_BASE, isOffhand, false);
    }

    // ==================== 手部挂载点系统 ====================

    /**
     * 获取手部挂载点世界坐标位置
     * @param {object} player - 玩家对象（含 x, y, rotation, size）
     * @param {string} weaponType - 武器类型
     * @param {string} animState - 动画状态（idle/walk/running/attack）
     * @param {boolean} facingRight - 是否朝右
     * @returns {object} {x, y} 世界坐标
     */
    static getHandAnchorPosition(player, weaponType, animState, facingRight = true) {
        const cfg = this._getConfig(weaponType);
        const wac = WeaponAnimConfig[cfg.holdOffsetKey] || {};
        const handAnchors = wac.handAnchors || {};
        const anchor = handAnchors[animState] || handAnchors.idle || { x: 0, y: 0 };

        // 方向镜像
        const x = facingRight ? anchor.x : -anchor.x;
        const y = anchor.y;

        // 转换为世界坐标（近战武器使用固定旋转，不随鼠标旋转）
        const isMelee = weaponType === 'sword' || weaponType === 'bow';
        return this.localToWorld(player, { x, y }, isMelee ? 0 : null, facingRight, animState, weaponType);
    }

    // ==================== 旋转计算 ====================

    static getWeaponRotation(playerRotation, weaponType, animAngle = 0, animState = null, facingRight = true, overrides = {}) {
        const cfg = this._getConfig(weaponType);
        const wac = this._getStateConfig(weaponType, animState, overrides);
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

    static localToWorld(player, localOffset, fixedRotation = null, facingRight = true, _animState = null, weaponType = null) {
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

    static getWeaponWorldPosition(player, weaponType, isOffhand = false, isDualWield = false, animState = null, overrides = {}) {
        const facingRight = Math.abs(player.rotation) < Math.PI / 2;
        const wac = WeaponAnimConfig[weaponType] || {};
        const handAnchors = wac.handAnchors || {};

        // 优先使用挂载点系统（如果配置了 handAnchors）
        if (handAnchors && animState && handAnchors[animState]) {
            const _anchor = handAnchors[animState];
            // 挂载点世界坐标
            const handWorld = this.getHandAnchorPosition(player, weaponType, animState, facingRight);

            // 握把偏移（武器精灵中心到握把点的偏移）
            const gripOffset = wac.gripOffset || { x: 0, y: 0 };

            // 获取武器旋转角度
            const rotation = this.getWeaponRotation(0, weaponType, 0, animState, facingRight);

            // 握把偏移根据武器旋转角度旋转
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const rotatedGripX = cos * gripOffset.x - sin * gripOffset.y;
            const rotatedGripY = sin * gripOffset.x + cos * gripOffset.y;

            // 武器精灵位置 = 手部挂载点 + 旋转后的握把偏移
            return {
                x: handWorld.x + rotatedGripX,
                y: handWorld.y + rotatedGripY,
                rotation: rotation,
            };
        }

        // 回退到现有 holdOffsetX/Y 系统（向后兼容）
        const local = this.getWeaponLocalOffset(weaponType, player.size, isOffhand, isDualWield, animState, facingRight, overrides);
        const isMelee = weaponType === 'sword' || weaponType === 'bow';
        const useFixedRotation = isMelee;
        const world = this.localToWorld(player, local, useFixedRotation ? 0 : null, facingRight, animState, weaponType);
        return { ...local, x: world.x, y: world.y };
    }

    // 兼容旧接口
    static getMeleeWorldPosition(player, isOffhand = false) {
        return this.getWeaponWorldPosition(player, 'sword', isOffhand, false);
    }

    /**
     * 根据关键帧偏移计算武器世界位置和旋转（统一挂载点 / holdOffset 两套系统）
     * @param {object} player - 玩家对象
     * @param {string} weaponType - 武器类型
     * @param {string} animState - 动画状态
     * @param {object} keyframeOffset - {offsetX, offsetY, rotation, scale}
     * @param {number} playerRotation - 玩家旋转（近战传 0，远程传 player.rotation）
     * @param {boolean} facingRight - 是否朝右
     * @returns {object} {x, y, rotation}
     */
    static getKeyframedWeaponPosition(player, weaponType, animState, keyframeOffset, playerRotation, facingRight) {
        const cfg = WeaponAnimConfig[weaponType] || {};
        const hasHandAnchors = cfg.handAnchors && typeof cfg.handAnchors === 'object';

        if (hasHandAnchors && animState) {
            const handAnchors = cfg.handAnchors || {};
            const anchor = handAnchors[animState] || handAnchors.idle || { x: 0, y: 0 };
            const anchorX = facingRight ? anchor.x : -anchor.x;
            const anchorY = anchor.y;
            // 关键帧偏移是相对 handAnchor 的世界空间偏移，朝左时同样要镜像
            const handOffsetX = (facingRight ? 1 : -1) * (keyframeOffset.offsetX || 0);
            const handOffsetY = keyframeOffset.offsetY || 0;
            const handWorldX = player.x + anchorX + handOffsetX;
            const handWorldY = player.y + anchorY + handOffsetY;
            const gripOffset = cfg.gripOffset || { x: 0, y: 0 };
            const rotationRad = (keyframeOffset.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rotationRad);
            const sin = Math.sin(rotationRad);
            const gripRotatedX = cos * gripOffset.x - sin * gripOffset.y;
            const gripRotatedY = sin * gripOffset.x + cos * gripOffset.y;
            return {
                x: handWorldX + gripRotatedX,
                y: handWorldY + gripRotatedY,
                rotation: this.getWeaponRotation(playerRotation, weaponType, 0, animState, facingRight) + rotationRad,
            };
        }

        // 旧系统：使用 overrides 替换 holdOffset/idleRotation/idleScale，避免修改原始配置
        const overrides = {
            holdOffsetX: keyframeOffset.offsetX,
            holdOffsetY: keyframeOffset.offsetY,
            idleRotation: keyframeOffset.rotation,
            idleScale: keyframeOffset.scale,
        };
        const worldPos = this.getWeaponWorldPosition(player, weaponType, false, false, animState, overrides);
        return {
            x: worldPos.x,
            y: worldPos.y,
            rotation: this.getWeaponRotation(playerRotation, weaponType, 0, animState, facingRight, overrides),
        };
    }

    /**
     * 逐帧模式：直接读取配置中每一帧的武器偏移/旋转/缩放
     * 坐标系为玩家本地屏幕坐标（X向右，Y向下），朝左时镜像X并翻转角度
     * @param {object} player - 玩家对象
     * @param {string} weaponType - 武器类型
     * @param {number} frameIndex - 帧索引
     * @param {boolean} facingRight - 是否朝右
     * @returns {object|null} {x, y, rotation, scale}
     */
    static getPerFrameWeaponPosition(player, weaponType, frameIndex, facingRight = true) {
        return this.getInterpolatedPerFramePosition(player, weaponType, frameIndex / Math.max(1, (WeaponAnimConfig[weaponType]?.attack?.frames?.length || 1) - 1), facingRight);
    }

    /**
     * 逐帧模式：按进度平滑插值 8 帧武器状态（Catmull-Rom 曲线）
     * @param {object} player - 玩家对象
     * @param {string} weaponType - 武器类型
     * @param {number} progress - 0~1
     * @param {boolean} facingRight - 是否朝右
     * @returns {object|null} {x, y, rotation, scale}
     */
    static getInterpolatedPerFramePosition(player, weaponType, progress, facingRight = true) {
        const cfg = WeaponAnimConfig[weaponType] || {};
        const perFrame = cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        if (!perFrame || perFrame.length === 0) return null;

        progress = Math.max(0, Math.min(1, progress));
        const n = perFrame.length;
        if (progress <= 0) {
            const f = perFrame[0];
            return this._applyPerFrameToWorld(player, f, facingRight);
        }
        if (progress >= 1) {
            const f = perFrame[n - 1];
            return this._applyPerFrameToWorld(player, f, facingRight);
        }

        // 位置：线性插值，保证武器严格经过每个配置点并与玩家手部贴合
        const pos = this._lerpPerFrame2D(perFrame, progress);

        // 旋转：先解卷绕，再线性插值
        let angles = perFrame.map(f => (f.rotation || 0) * Math.PI / 180);
        for (let i = 1; i < angles.length; i++) {
            let delta = angles[i] - angles[i - 1];
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            angles[i] = angles[i - 1] + delta;
        }
        const rotation = this._lerpPerFrame1D(angles, progress);

        // 缩放：线性插值
        const scales = perFrame.map(f => f.scale !== undefined ? f.scale : 1);
        const scale = this._lerpPerFrame1D(scales, progress);

        return this._applyPerFrameToWorld(player, { offsetX: pos.x, offsetY: pos.y, rotation: rotation * 180 / Math.PI, scale }, facingRight);
    }

    /**
     * 一维线性插值
     */
    static _lerpPerFrame1D(values, progress) {
        const n = values.length;
        if (n === 0) return 0;
        if (n === 1 || progress <= 0) return values[0];
        if (progress >= 1) return values[n - 1];

        const raw = progress * (n - 1);
        const i = Math.floor(raw);
        const t = raw - i;

        const p1 = values[i];
        const p2 = values[i + 1];
        return p1 + (p2 - p1) * t;
    }

    /**
     * 二维线性插值
     */
    static _lerpPerFrame2D(perFrame, progress) {
        const n = perFrame.length;
        if (n === 0) return { x: 0, y: 0 };
        if (n === 1 || progress <= 0) return { x: perFrame[0].offsetX || 0, y: perFrame[0].offsetY || 0 };
        if (progress >= 1) return { x: perFrame[n - 1].offsetX || 0, y: perFrame[n - 1].offsetY || 0 };

        const raw = progress * (n - 1);
        const i = Math.floor(raw);
        const t = raw - i;

        const p1 = perFrame[i];
        const p2 = perFrame[i + 1];
        return {
            x: (p1.offsetX || 0) + ((p2.offsetX || 0) - (p1.offsetX || 0)) * t,
            y: (p1.offsetY || 0) + ((p2.offsetY || 0) - (p1.offsetY || 0)) * t,
        };
    }

    static _applyPerFrameToWorld(player, frame, facingRight) {
        const offsetX = (facingRight ? 1 : -1) * (frame.offsetX || 0);
        const offsetY = frame.offsetY || 0;
        let rotation = (frame.rotation || 0) * Math.PI / 180;
        if (!facingRight) {
            rotation = Math.PI - rotation;
        }
        return {
            x: player.x + offsetX,
            y: player.y + offsetY,
            rotation,
            scale: frame.scale !== undefined ? frame.scale : 1,
        };
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
                recoilX = -s * (rp.recoilWindup || 0.04) * Easing.easeOutQuad(anim.timer / wa.windupMs);
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
                recoilX = -s * (rp.recoilWindup || 0.03) * Easing.easeOutQuad(anim.timer / wa.windupMs);
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
                recoilX = -s * (rp.recoilWindup || 0.04) * Easing.easeOutQuad(anim.timer / wa.windupMs);
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

export { WeaponTransform };
