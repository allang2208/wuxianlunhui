
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM, Easing } from '../config/math-utils.js';
import { PISTOL_FAMILY, AUTO_GUN_FAMILY, MACHINE_GUN_FAMILY } from '../config/weapon-families.js';

const WEAPON_SIZE_BASE = WEAPON_ANIM.size; // 126（2026-07-28 起 105→126，与人物 spriteSize 144 同步放大 20%）
const MELEE_SCALE = 0.75;

// 手枪族 5 型配置逐字段相同（仅 holdOffsetKey 不同；主/副手锚点与 holdOffset 同口径对齐 G18），工厂生成
const _makePistolTransform = (holdOffsetKey) => ({
    mainBaseX: -15, mainBaseY: 16.5,
    offBaseX: -23, offBaseY: 19,  // 副手锚定双持姿态低手位 (330,115)，与主手 holdOffset 同解
    holdOffsetKey,
    afterRotateOffsetX: (s) => s * 0.42,
    afterRotateOffsetY: 0,
    baseRotation: 0,
});

// 机枪族 7 型（含霰弹枪）配置逐字段相同（仅 holdOffsetKey 不同），工厂生成
const _makeMachineGunTransform = (holdOffsetKey) => ({
    mainBaseX: (isDual) => isDual ? 0 : 8,
    mainBaseY: (isDual) => isDual ? 8 : 0,
    offBaseX: 0, offBaseY: -8,
    holdOffsetKey,
    afterRotateOffsetX: (s) => s * 0.42,
    afterRotateOffsetY: 0,
    baseRotation: 0,
});

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
    ...Object.fromEntries(PISTOL_FAMILY.map((key) => [key, _makePistolTransform(key)])),
    ...Object.fromEntries(MACHINE_GUN_FAMILY.map((key) => [key, _makeMachineGunTransform(key)])),
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

    /**
     * 高架表面抬升：人物沿楼梯/墙顶改变 z 时，武器必须同步上移。
     * `z` 是实体脚底高度真源。
     */
    static _getElevationZ(player) {
        if (!player) return 0;
        return player.z || 0;
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
            // 玩家贴图中心已上移到 y - footOffsetY - elevationZ，武器也要同步上移
            y: player.y + sin * localOffset.x + cos * localOffset.y
                - this._getFootOffsetY(player) - this._getElevationZ(player),
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

    // ==================== perFrame 预计算缓存（Phase 4，2026-08-13） ====================
    // 逐帧值数组（位置/旋转/缩放/模糊/拉伸）只依赖配置内容，与 progress/玩家位置无关——
    // 原实现每次调用都 perFrame.map(...) 重建 6 个数组 + 旋转解卷绕，每帧产生数十次小数组分配。
    // 键 = frames 数组对象身份（WeakMap，自动回收）。失效策略：
    // - 配置热重载（weapon-anim-config.js Object.assign 整块替换）→ 新数组身份，自动失效；
    // - dev-tool 种子/整块替换（_getPerFrameFrames 新建 frames 数组）→ 自动失效；
    // - dev-tool 原地改单帧（_syncPerFrameFromWeaponParams: perFrame[idx] = {...}，数组身份不变）
    //   → 由该处显式调用 WeaponTransform.invalidatePerFrameCache() 全清。
    // 缓存只存"配置派生数组"；每次调用仍新建返回对象（消费端 GameScene 收势分支会原地改
    // start.x/start.rotation，共享引用会串数据——见 Phase 4 报告消费端审计）。
    static _perFramePre = new WeakMap();

    static invalidatePerFrameCache() {
        this._perFramePre = new WeakMap();
    }

    static _getPerFramePrecomputed(perFrame) {
        let pre = this._perFramePre.get(perFrame);
        if (pre) return pre;
        const n = perFrame.length;
        // 逐元素默认值口径与原调用点严格一致：
        // 位置/模糊/拉伸走 v() 语义（!== undefined 判缺省），旋转解卷绕走 (f.rotation || 0) 原口径
        const ox = new Array(n), oy = new Array(n), rotDeg = new Array(n), rotUnwrapped = new Array(n);
        const scale = new Array(n), blurX = new Array(n), blurY = new Array(n), stretchX = new Array(n), stretchY = new Array(n);
        for (let i = 0; i < n; i++) {
            const f = perFrame[i];
            ox[i] = f.offsetX !== undefined ? f.offsetX : 0;
            oy[i] = f.offsetY !== undefined ? f.offsetY : 0;
            rotDeg[i] = f.rotation !== undefined ? f.rotation : 0;
            rotUnwrapped[i] = (f.rotation || 0) * Math.PI / 180;
            scale[i] = f.scale !== undefined ? f.scale : 1;
            blurX[i] = f.blurX !== undefined ? f.blurX : 0;
            blurY[i] = f.blurY !== undefined ? f.blurY : 0;
            stretchX[i] = f.stretchX !== undefined ? f.stretchX : 1;
            stretchY[i] = f.stretchY !== undefined ? f.stretchY : 1;
        }
        // 旋转解卷绕：与原 getInterpolatedPerFramePosition 的 map + 逐元素 unwrap 循环逐值一致
        for (let i = 1; i < n; i++) {
            let delta = rotUnwrapped[i] - rotUnwrapped[i - 1];
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            rotUnwrapped[i] = rotUnwrapped[i - 1] + delta;
        }
        pre = { ox, oy, rotDeg, rotUnwrapped, scale, blurX, blurY, stretchX, stretchY };
        this._perFramePre.set(perFrame, pre);
        return pre;
    }

    // _lerpPerFrame2D 的数组版：输入为预计算 ox/oy，公式/分支次序与原逐帧读取逐值等价
    static _lerpPerFrame2DArr(ox, oy, progress) {
        const n = ox.length;
        if (n === 0) return { x: 0, y: 0 };
        if (n === 1 || progress <= 0) return { x: ox[0], y: oy[0] };
        if (progress >= 1) return { x: ox[n - 1], y: oy[n - 1] };

        const raw = progress * (n - 1);
        const i = Math.floor(raw);
        const t = raw - i;

        return {
            x: ox[i] + (ox[i + 1] - ox[i]) * t,
            y: oy[i] + (oy[i + 1] - oy[i]) * t,
        };
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

        // 预计算缓存（同 frames 数组只算一次，消除每帧 6 次 map 小数组分配；数组值与原 map 结果逐值等价）
        const pre = this._getPerFramePrecomputed(perFrame);

        // 位置：线性插值，保证武器严格经过每个配置点并与玩家手部贴合
        // 剑柄锚手块（anchor='grip'）：阶梯映射（SKILL 2026-08-03 一段跟手教训的落地）——
        // 位置钉在当前精灵帧锚点：旧平滑 lerp 的进度映射是 progress×(n-1)，而精灵帧 k
        // 覆盖 [k/n,(k+1)/n)——武器在帧窗中段就提前跑向下一点，帧窗末尾已偏离 92%
        //（实机用户目击「帧结束武器脱手」的根因）。旋转保留帧窗内向下一帧的 lerp
        //（绕钉住的剑柄扫刃，不甩手）；缩放/模糊/拉伸随帧走。非 grip 块（dash 等）不动。
        if (block.anchor === 'grip') {
            const raw = progress * n;                 // 帧窗对齐：精灵帧 k 覆盖 [k/n,(k+1)/n)
            const k = Math.min(n - 1, Math.floor(raw));
            const frac = raw - k;
            const k2 = Math.min(n - 1, k + 1);
            const rot = pre.rotUnwrapped[k] + (pre.rotUnwrapped[k2] - pre.rotUnwrapped[k]) * frac;
            return this._applyPerFrameToWorld(player, {
                offsetX: pre.ox[k], offsetY: pre.oy[k], rotation: rot * 180 / Math.PI,
                scale: pre.scale[k],
                blurX: pre.blurX[k], blurY: pre.blurY[k],
                stretchX: pre.stretchX[k], stretchY: pre.stretchY[k],
            }, facingRight);
        }

        const pos = this._lerpPerFrame2DArr(pre.ox, pre.oy, progress);

        // 旋转：解卷绕已在缓存内完成，此处线性插值
        const rotation = this._lerpPerFrame1D(pre.rotUnwrapped, progress);

        // 缩放：线性插值
        const scale = this._lerpPerFrame1D(pre.scale, progress);

        // 运动模糊（blurX/blurY，缺省 0）与拉伸（stretchX/stretchY，缺省 1）：线性插值
        // 挥砍峰值帧模糊最强，起势/收势清晰（A 方案帧级运动模糊 + B 方案挥砍拉伸）
        return this._applyPerFrameToWorld(player, {
            offsetX: pos.x, offsetY: pos.y, rotation: rotation * 180 / Math.PI, scale,
            blurX: this._lerpPerFrame1D(pre.blurX, progress),
            blurY: this._lerpPerFrame1D(pre.blurY, progress),
            stretchX: this._lerpPerFrame1D(pre.stretchX, progress),
            stretchY: this._lerpPerFrame1D(pre.stretchY, progress),
        }, facingRight);
    }

    /**
     * 冲刺攻击 Lerp 模式：剑柄锚手 + 起始/结束双端点线性插值。
     * 以 from/to 为参考（剑柄位置 + 剑身角度），progress 0→1 线性移动/旋转：
     *   - 位置：剑柄锚点从 from.{x,y} 线性移到 to.{x,y}（相对玩家局部偏移）
     *   - 角度：剑身绕剑柄从 from.rotation 线性转到 to.rotation（解卷绕防 ±π 绕远）
     * 返回 {x, y, rotation, scale, stretchX, stretchY, blurX, blurY}，
     * 其中 (x,y) 是**剑柄锚点世界位置**（配合 GameScene 的 weaponSprite.setOrigin(grip)），
     * 与 perFrame 路径返回结构一致，消费端可复用。
     * @param {object} player - 玩家对象
     * @param {number} progress - 0~1
     * @param {boolean} facingRight - 是否朝右
     * @param {object} cfg - dashLerp 配置 { from:{x,y,rotation}, to:{x,y,rotation}, scale, stretchX, stretchY, blurPeak }
     */
    static getLerpDashPosition(player, progress, facingRight = true, cfg = {}) {
        const from = cfg.from || { x: 0, y: 0, rotation: 0 };
        const to = cfg.to || { x: 0, y: 0, rotation: 0 };
        const t = Math.max(0, Math.min(1, progress));

        // 位置：线性插值（剑柄锚点相对玩家脚底局部偏移）
        const lx = (from.x || 0) + ((to.x || 0) - (from.x || 0)) * t;
        const ly = (from.y || 0) + ((to.y || 0) - (from.y || 0)) * t;
        const offsetX = (facingRight ? 1 : -1) * lx;

        // 角度：字面线性插值（端点角度由作者指定扫向，如 -90°→+90° 后→前 180°；
        // 不做短弧解卷绕，否则会反向扫，违背 dash 数据的设计意图）。
        // 朝左镜像同 perFrame 口径：Math.PI - rotation
        let a0 = (from.rotation || 0) * Math.PI / 180;
        let a1 = (to.rotation || 0) * Math.PI / 180;
        let rotation = a0 + (a1 - a0) * t;
        if (!facingRight) {
            rotation = Math.PI - rotation;
        }

        // 残影强度：由轨迹速度推导（位移速率 + 角度速率归一），blurPeak 配置上限；端点清零
        const dx = (to.x || 0) - (from.x || 0);
        const dy = (to.y || 0) - (from.y || 0);
        const speed = Math.hypot(dx, dy);
        const angSpeed = Math.abs(a1 - a0);
        const peak = (cfg.blurPeak !== undefined ? cfg.blurPeak : 12) || 0;
        const intensity = Math.max(speed / 220, angSpeed / 3.2); // 归一：~220px 位移或 ~3.2rad 旋转=满强度
        const blur = peak > 0 ? Math.min(1, intensity) * peak : 0;
        // 峰值在轨迹中段（t=0.5 最强，端点无模糊）
        const bell = (t <= 0 || t >= 1) ? 0 : Math.sin(t * Math.PI);
        const blurX = cfg.blurX !== undefined ? cfg.blurX : blur * 0.6 * bell;
        const blurY = cfg.blurY !== undefined ? cfg.blurY : blur * bell;

        return {
            x: player.x + offsetX,
            y: player.y + ly - this._getFootOffsetY(player) - this._getElevationZ(player),
            rotation,
            scale: cfg.scale !== undefined ? cfg.scale : 1,
            stretchX: cfg.stretchX !== undefined ? cfg.stretchX : 1,
            stretchY: cfg.stretchY !== undefined ? cfg.stretchY : 1,
            blurX,
            blurY,
            grip: cfg.grip || { x: 0.5, y: 0.5 },
        };
    }

    /**
     * 冲刺攻击剑柄锚手（dashHand 模式）：
     * 以 sword.dash 30 点中心轨迹反推「握把点」——dash 旧轨迹是 DevTool 按武器贴图中心调定的
     * （用户实机验收"大体正确"），中心轨迹与握把点相差 R(rot)·(0, -gripOffset)。
     * 因此握把点 = 中心 − R(rot)·(0, -gripOffset)，即：
     *   hand.x = center.x - gripOffset * sin(center.rotation)
     *   hand.y = center.y + gripOffset * cos(center.rotation)
     * 角度不再沿用旧轨迹角度，而是按 dashHand.fromRotation → toRotation 线性扫过
     * 180°（默认 -90° → +90°，即"后 → 前"）。返回结构与 perFrame 一致，
     * 额外带 gripX/gripY（归一化剑柄 origin），GameScene 直接用 origin 钉住剑柄。
     */
    static getDashHandPosition(player, weaponType, progress) {
        const center = this.getInterpolatedPerFramePosition(player, weaponType, progress, true, 'dash');
        if (!center) return null;

        const wac = WeaponAnimConfig[weaponType] || {};
        if (!wac.dashHand) return null;
        const gripOffset = typeof wac.gripOffset === 'number' ? wac.gripOffset : 40;
        const handCfg = wac.dashHand || {};
        const fromDeg = handCfg.fromRotation !== undefined ? handCfg.fromRotation : -90;
        const toDeg = handCfg.toRotation !== undefined ? handCfg.toRotation : 90;
        const t = Math.max(0, Math.min(1, progress));
        const fromRot = fromDeg * Math.PI / 180;
        const toRot = toDeg * Math.PI / 180;
        const rotation = fromRot + (toRot - fromRot) * t;

        const handX = center.x - gripOffset * Math.sin(center.rotation);
        const handY = center.y + gripOffset * Math.cos(center.rotation);
        const size = this.getWeaponSize(weaponType, center.scale, 'attack');

        return {
            ...center,
            x: handX,
            y: handY,
            rotation,
            gripX: handCfg.gripX !== undefined ? handCfg.gripX : 0.5,
            gripY: 0.5 + gripOffset / Math.max(1, size.height || 1),
        };
    }

    /**
     * 冲刺收势起点（与 dashHand 末帧同姿态）：
     * 收势分支仍以武器中心为 origin，因此把 dashHand 末帧的握把点 + 180° 扫击末角
     * 反推回中心点：中心 = 握把 + R(rotation)·(0, -gripOffset)。
     * 这样 freeze 末帧（origin=剑柄）→ recover 首帧（origin=中心）剑柄位置连续，
     * 只从 dashHand.toRotation 滑向 idle，不会跳回旧 dash 轨迹的 115°。
     */
    static getDashRecoverStartPosition(player, weaponType) {
        const wac = WeaponAnimConfig[weaponType] || {};
        if (!wac.dashHand) return null; // 无 dashHand 配置时保持旧 dash 轨迹收势口径
        const hand = this.getDashHandPosition(player, weaponType, 1);
        if (!hand) return null;
        const gripOffset = typeof wac.gripOffset === 'number' ? wac.gripOffset : 40;
        const centerX = hand.x + gripOffset * Math.sin(hand.rotation);
        const centerY = hand.y - gripOffset * Math.cos(hand.rotation);
        return {
            ...hand,
            x: centerX,
            y: centerY,
        };
    }

    /**
     * 逐帧剑柄锚手（anchor='grip' 模式，2026-08-16，dashHand 同款思路移植）：
     * perFrame 块 anchor==='grip' 时，frames 的 offsetX/offsetY 直接是**握把点（拳头）**
     * 本地偏移（不再贴图中心），GameScene 把 weaponSprite.origin 设为剑柄——
     * 剑柄钉在手上，旋转绕剑柄（消除"中心 origin + 旋转大步长时帧间握把甩离手"的系统性偏差：
     * 中心 origin 模型下 f0→f1/f9→f10 帧间中点握把偏离实测可达 ~21~39 display px）。
     * 位置插值与世界换算与 getInterpolatedPerFramePosition 同口径，仅追加 gripX/gripY；
     * sizeState 用于让 walking 等姿态沿用自身的显示尺寸口径。
     */
    static getInterpolatedGripPerFramePosition(player, weaponType, progress, facingRight = true, cfgKey = 'attack', sizeState = 'attack') {
        const pos = this.getInterpolatedPerFramePosition(player, weaponType, progress, facingRight, cfgKey);
        if (!pos) return null;
        const wac = WeaponAnimConfig[weaponType] || {};
        const gripOffset = typeof wac.gripOffset === 'number' ? wac.gripOffset : 40;
        const size = this.getWeaponSize(weaponType, pos.scale, sizeState);
        return {
            ...pos,
            gripX: 0.5,
            gripY: 0.5 + gripOffset / Math.max(1, size.height || 1),
        };
    }

    /**
     * 普通攻击收势起点（与 anchor='grip' 末帧同姿态）：
     * 收势分支仍以武器中心为 origin，把末帧握把点 + 末帧刃向反推回中心：
     * 中心 = 握把 + R(rotation)·(0, -gripOffset)（同 getDashRecoverStartPosition 公式）。
     * 无 anchor='grip' 配置时返回 null，调用方回退旧中心轨迹末帧。
     */
    static getAttackRecoverStartPosition(player, weaponType, cfgKey = 'attack') {
        const wac = WeaponAnimConfig[weaponType] || {};
        const block = wac[cfgKey] || wac.attack;
        if (!block || block.anchor !== 'grip') return null;
        const hand = this.getInterpolatedGripPerFramePosition(player, weaponType, 1, true, cfgKey);
        if (!hand) return null;
        const gripOffset = typeof wac.gripOffset === 'number' ? wac.gripOffset : 40;
        return {
            ...hand,
            x: hand.x + gripOffset * Math.sin(hand.rotation),
            y: hand.y - gripOffset * Math.cos(hand.rotation),
        };
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
        // 预计算缓存（与 getInterpolatedPerFramePosition 共享，值与 v() 逐帧读取逐值等价）
        const pre = this._getPerFramePrecomputed(perFrame);
        const i0 = idx(i - 1), i1 = idx(i), i2 = idx(i + 1), i3 = idx(i + 2);
        // Catmull-Rom 公式：0.5*(2P1 + (−P0+P2)t + (2P0−5P1+4P2−P3)t² + (−P0+3P1−3P2+P3)t³)
        const cr = (a, b, c, d) => 0.5 * (
            2 * b
            + (-a + c) * t
            + (2 * a - 5 * b + 4 * c - d) * t * t
            + (-a + 3 * b - 3 * c + d) * t * t * t
        );
        const lerp = (a, b) => a + (b - a) * t;

        const frame = {
            offsetX: cr(pre.ox[i0], pre.ox[i1], pre.ox[i2], pre.ox[i3]),
            offsetY: cr(pre.oy[i0], pre.oy[i1], pre.oy[i2], pre.oy[i3]),
            rotation: lerp(pre.rotDeg[i1], pre.rotDeg[i2]),
            scale: lerp(pre.scale[i1], pre.scale[i2]),
            blurX: lerp(pre.blurX[i1], pre.blurX[i2]),
            blurY: lerp(pre.blurY[i1], pre.blurY[i2]),
            stretchX: lerp(pre.stretchX[i1], pre.stretchX[i2]),
            stretchY: lerp(pre.stretchY[i1], pre.stretchY[i2]),
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
            y: player.y + offsetY - this._getFootOffsetY(player) - this._getElevationZ(player),
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

        // 枪械后坐力三态共享逻辑，仅默认参数按族区分（剑类攻击动画已禁用，武器保持静止，无分支）
        const recoilDef = PISTOL_FAMILY.includes(weaponType)
            ? { windup: 0.04, swing: 0.1, recover: 0.04, shake: 3 }
            : AUTO_GUN_FAMILY.includes(weaponType)
                ? { windup: 0.03, swing: 0.08, recover: 0.03, shake: 4 }
                : weaponType === 'shotgun'
                    ? { windup: 0.04, swing: 0.12, recover: 0.04, shake: 5 }
                    : null;
        if (recoilDef) {
            if (anim.state === 'windup') {
                recoilX = -s * (rp.recoilWindup || recoilDef.windup) * Easing.easeOutQuad(anim.timer / wa.windupMs);
            } else if (anim.state === 'swing') {
                const st = anim.timer / wa.swingMs;
                recoilX = s * (rp.recoilSwing || recoilDef.swing) * (1 - st);
                recoilY = (Math.random() - 0.5) * (rp.shakeIntensity || recoilDef.shake) * (1 - st);
            } else if (anim.state === 'recover') {
                const rt = anim.timer / wa.recoverMs;
                recoilX = -s * (rp.recoilRecover || recoilDef.recover) * (1 - rt);
            }
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
        } else if (PISTOL_FAMILY.includes(weaponType)) {
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
