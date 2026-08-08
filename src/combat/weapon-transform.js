
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM, Easing } from '../config/math-utils.js';

const WEAPON_SIZE_BASE = WEAPON_ANIM.size; // 126（2026-07-28 起 105→126，与人物 spriteSize 144 同步放大 20%）
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
        offBaseX: -23, offBaseY: 19,  // 副手锚定双持姿态低手位 (330,115)，与主手 holdOffset 同解
        holdOffsetKey: 'pistol',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    p4040: {
        // 全面对齐 G18（pistol）：主/副手锚点与 holdOffset 同口径
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -23, offBaseY: 19,
        holdOffsetKey: 'p4040',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    deagle: {
        // 全面对齐 G18（同 p4040）
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -23, offBaseY: 19,
        holdOffsetKey: 'deagle',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    revolver: {
        // .357 麦格农左轮：对齐 deagle（手枪族）
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -23, offBaseY: 19,
        holdOffsetKey: 'revolver',
        afterRotateOffsetX: (s) => s * 0.42,
        afterRotateOffsetY: 0,
        baseRotation: 0,
    },
    beretta93r: {
        // Beretta 93R：全面对齐 G18（pistol 条目；主手 (-9,-35.5)、副手 (-17,-33) 终值一致）
        mainBaseX: -15, mainBaseY: 16.5,
        offBaseX: -23, offBaseY: 19,
        holdOffsetKey: 'beretta93r',
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
    m416: {
        mainBaseX: (isDual) => isDual ? 0 : 8,
        mainBaseY: (isDual) => isDual ? 8 : 0,
        offBaseX: 0, offBaseY: -8,
        holdOffsetKey: 'm416',
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
     * @param {object} overrides - 可选覆盖字段 {holdOffsetX, holdOffsetY, idleRotation, idleScale}
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
        };
    }

    // ==================== 基础本地偏移（待机状态） ====================

    /**
     * 获取武器在玩家本地坐标系中的偏移（待机状态）
     * @param {string} weaponType - 武器类型（sword/bow/pistol/akm/pkm 等）
     * @param {number} playerSize - 玩家尺寸（dev-tool 预览传 WEAPON_ANIM.size=126；游戏传 player.size=18，
     *      位置 x/y 与该参数无关，仅 size/scale 字段受比例影响）
     * @param {boolean} isOffhand - 是否为副手
     * @param {boolean} isDualWield - 是否双持
     * @param {string} animState - 动画状态（idle/walk/running/attack）
     * @param {boolean} _facingRight - 是否朝右（本地偏移不使用，保持接口一致）
     * @param {object} overrides - 开发工具覆盖字段
     * @returns {object} {x, y, size, scale, baseRotation, idleRotation}
     */
    static getWeaponLocalOffset(weaponType, playerSize, isOffhand = false, isDualWield = false, animState = null, _facingRight = true, overrides = {}) {
        const cfg = this._getConfig(weaponType);
        const s = WEAPON_SIZE_BASE; // 126，不是 player.size（18）
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
        const holdX = wac.holdOffsetX || 0;
        const holdY = wac.holdOffsetY || 0;

        // 旋转后偏移（translate(0, -offset) 在旋转后坐标系中的等价）
        const afterX = typeof cfg.afterRotateOffsetX === 'function' ? cfg.afterRotateOffsetX(s) : cfg.afterRotateOffsetX;
        const afterY = typeof cfg.afterRotateOffsetY === 'function' ? cfg.afterRotateOffsetY(s) : cfg.afterRotateOffsetY;

        // 尺寸和缩放
        let size, scaleFactor;
        if (weaponType === 'sword' || weaponType === 'staff') {
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

    static getWeaponRotation(playerRotation, weaponType, animAngle = 0, animState = null, facingRight = true, overrides = {}) {
        const cfg = this._getConfig(weaponType);
        const wac = this._getStateConfig(weaponType, animState, overrides);
        // 使用 playerRotation 计算基础旋转（远程武器跟随鼠标，近战武器固定）
        let rot = playerRotation + cfg.baseRotation;
        if (wac.idleRotation) {
            let idleRot = wac.idleRotation * Math.PI / 180;
            // 朝左时镜像 idleRotation（对所有近战武器）
            const isMelee = weaponType === 'sword' || weaponType === 'staff' || weaponType === 'bow';
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

    /**
     * 获取玩家/实体的脚底偏移，用于把武器从逻辑脚底坐标系提升到视觉身体坐标系。
     */
    static _getFootOffsetY(player) {
        if (!player) return 0;
        if (typeof player.footOffsetY === 'number') return player.footOffsetY;
        const render = player.config?.render || {};
        if (typeof render.footOffsetY === 'number') return render.footOffsetY;
        return 0;
    }

    static localToWorld(player, localOffset, fixedRotation = null, facingRight = true, _animState = null, weaponType = null) {
        const rot = fixedRotation !== null ? fixedRotation : player.rotation;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        let x = player.x + cos * localOffset.x - sin * localOffset.y;
        // 朝左时镜像武器位置（对所有近战武器状态）
        const isMelee = weaponType === 'sword' || weaponType === 'staff' || weaponType === 'bow';
        if (!facingRight && isMelee) {
            x = player.x - (x - player.x);
        }
        return {
            x: x,
            // 玩家贴图中心已上移到 y - footOffsetY，武器也要同步上移
            y: player.y + sin * localOffset.x + cos * localOffset.y - this._getFootOffsetY(player),
        };
    }

    static getWeaponWorldPosition(player, weaponType, isOffhand = false, isDualWield = false, animState = null, overrides = {}, facingRightOverride = null) {
        const facingRight = facingRightOverride !== null ? facingRightOverride : Math.abs(player.rotation) < Math.PI / 2;
        const local = this.getWeaponLocalOffset(weaponType, player.size, isOffhand, isDualWield, animState, facingRight, overrides);
        const isMelee = weaponType === 'sword' || weaponType === 'staff' || weaponType === 'bow';
        const useFixedRotation = isMelee;
        const world = this.localToWorld(player, local, useFixedRotation ? 0 : null, facingRight, animState, weaponType);
        return { ...local, x: world.x, y: world.y };
    }

    // 兼容旧接口
    static getMeleeWorldPosition(player, isOffhand = false) {
        return this.getWeaponWorldPosition(player, 'sword', isOffhand, false);
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
    static getPerFrameWeaponPosition(player, weaponType, frameIndex, facingRight = true, cfgKey = 'attack') {
        return this.getInterpolatedPerFramePosition(player, weaponType, frameIndex / Math.max(1, (WeaponAnimConfig[weaponType]?.[cfgKey]?.frames?.length || 1) - 1), facingRight, cfgKey);
    }

    /**
     * 逐帧模式：按进度平滑插值 N 帧武器状态
     * @param {string} player - 玩家对象
     * @param {string} weaponType - 武器类型
     * @param {number} progress - 0~1
     * @param {boolean} facingRight - 是否朝右
     * @param {string} cfgKey - 配置块（'attack' / 'attack2' 二段连段）
     * @returns {object|null} {x, y, rotation, scale}
     */
    static getInterpolatedPerFramePosition(player, weaponType, progress, facingRight = true, cfgKey = 'attack') {
        const cfg = WeaponAnimConfig[weaponType] || {};
        const block = cfg[cfgKey] || cfg.attack;
        const perFrame = block && block.type === 'perFrame' ? block.frames : null;
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

        // 运动模糊（blurX/blurY，缺省 0）与拉伸（stretchX/stretchY，缺省 1）：线性插值
        // 挥砍峰值帧模糊最强，起势/收势清晰（A 方案帧级运动模糊 + B 方案挥砍拉伸）
        const lerpOpt = (key, def) => this._lerpPerFrame1D(perFrame.map(f => f[key] !== undefined ? f[key] : def), progress);

        return this._applyPerFrameToWorld(player, {
            offsetX: pos.x, offsetY: pos.y, rotation: rotation * 180 / Math.PI, scale,
            blurX: lerpOpt('blurX', 0), blurY: lerpOpt('blurY', 0),
            stretchX: lerpOpt('stretchX', 1), stretchY: lerpOpt('stretchY', 1),
        }, facingRight);
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

    /**
     * 平滑逐帧位置（Catmull-Rom 闭合样条）：
     * 适用于循环动画（如 walk 21 帧）——相邻帧的提取噪声被直线插值放大后表现为"瞬移/顿挫"，
     * 样条保证经过每个配置点且帧间切线连续（首尾闭合，循环无跳变）。
     * 仅 offsetX/offsetY 走样条；rotation/scale/blur/stretch 保持线性插值（数值稳定）。
     * 与 getInterpolatedPerFramePosition 同接口（cfgKey 支持 walkFrames/attack/attack2/dash）。
     */
    static getSmoothPerFramePosition(player, weaponType, progress, facingRight = true, cfgKey = 'walkFrames') {
        const cfg = WeaponAnimConfig[weaponType] || {};
        const block = cfg[cfgKey] || cfg.attack;
        const perFrame = block && block.type === 'perFrame' ? block.frames : null;
        if (!perFrame || perFrame.length === 0) return null;

        progress = Math.max(0, Math.min(1, progress));
        const n = perFrame.length;
        if (n === 1) return this._applyPerFrameToWorld(player, perFrame[0], facingRight);
        if (progress <= 0) return this._applyPerFrameToWorld(player, perFrame[0], facingRight);
        if (progress >= 1) return this._applyPerFrameToWorld(player, perFrame[n - 1], facingRight);

        // 样条段数 = 帧数（闭合循环）：raw ∈ [0,n)，i 为当前段，t 为段内进度
        const raw = progress * n;
        const i = Math.floor(raw);
        const t = raw - i;
        const idx = (k) => ((k % n) + n) % n; // 循环取模，首尾闭合
        const p0 = perFrame[idx(i - 1)];
        const p1 = perFrame[idx(i)];
        const p2 = perFrame[idx(i + 1)];
        const p3 = perFrame[idx(i + 2)];
        const v = (f, key, dflt) => (f && f[key] !== undefined ? f[key] : dflt);
        // Catmull-Rom 公式：0.5*(2P1 + (−P0+P2)t + (2P0−5P1+4P2−P3)t² + (−P0+3P1−3P2+P3)t³)
        const cr = (a, b, c, d) => 0.5 * (
            2 * b
            + (-a + c) * t
            + (2 * a - 5 * b + 4 * c - d) * t * t
            + (-a + 3 * b - 3 * c + d) * t * t * t
        );
        const lerp = (a, b) => a + (b - a) * t;

        const frame = {
            offsetX: cr(v(p0, 'offsetX', 0), v(p1, 'offsetX', 0), v(p2, 'offsetX', 0), v(p3, 'offsetX', 0)),
            offsetY: cr(v(p0, 'offsetY', 0), v(p1, 'offsetY', 0), v(p2, 'offsetY', 0), v(p3, 'offsetY', 0)),
            rotation: lerp(v(p1, 'rotation', 0), v(p2, 'rotation', 0)),
            scale: lerp(v(p1, 'scale', 1), v(p2, 'scale', 1)),
            blurX: lerp(v(p1, 'blurX', 0), v(p2, 'blurX', 0)),
            blurY: lerp(v(p1, 'blurY', 0), v(p2, 'blurY', 0)),
            stretchX: lerp(v(p1, 'stretchX', 1), v(p2, 'stretchX', 1)),
            stretchY: lerp(v(p1, 'stretchY', 1), v(p2, 'stretchY', 1)),
        };
        return this._applyPerFrameToWorld(player, frame, facingRight);
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
            y: player.y + offsetY - this._getFootOffsetY(player),
            rotation,
            scale: frame.scale !== undefined ? frame.scale : 1,
            blurX: frame.blurX || 0,
            blurY: frame.blurY || 0,
            stretchX: frame.stretchX !== undefined ? frame.stretchX : 1,
            stretchY: frame.stretchY !== undefined ? frame.stretchY : 1,
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

        if (weaponType === 'pistol' || weaponType === 'deagle' || weaponType === 'revolver' || weaponType === 'p4040' || weaponType === 'beretta93r') {
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
        } else if (weaponType === 'pkm' || weaponType === 'akm' || weaponType === 'm416' || weaponType === 'qbz191' || weaponType === 'qjb201' || weaponType === 'energy_lmg') {
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
        } else if (weaponType === 'sword' || weaponType === 'staff') {
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
        // 武器尺寸基于 WEAPON_ANIM.size（126），不是 player.size（18）
        const s = WEAPON_ANIM.size; // 126
        const ms = s * MELEE_SCALE; // 78.75
        const cfg = WeaponAnimConfig[weaponType] || {};
        
        // 支持按状态读取缩放值
        // 优先顺序：scaleOverride > cfg[animState] > cfg.idleScale
        let scale;
        if (scaleOverride !== null) {
            scale = scaleOverride;
        } else if (animState && cfg[animState] && cfg[animState].idleScale !== undefined) {
            scale = cfg[animState].idleScale;
        } else {
            scale = cfg.idleScale || 1;
        }

        if (weaponType === 'sword' || weaponType === 'staff') {
            return { width: ms * 0.63 * scale, height: ms * scale };
        } else if (weaponType === 'bow') {
            return { width: s * scale * 1.10, height: s * scale * 1.10, useAspectRatio: true };
        } else if (weaponType === 'pistol' || weaponType === 'deagle' || weaponType === 'revolver' || weaponType === 'p4040' || weaponType === 'beretta93r') {
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
