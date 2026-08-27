import { SoundManager } from '../ui/sound-manager.js';
import { isMachineGun } from '../config/gun-ammo.js';

/**
 * GunFeel — 枪械手感反馈中枢（移植自 Godot 3-dfps / Sakanako FPS 审计结论）
 *
 * 引擎/维度无关的四件套：
 * 1. Trauma² 震屏：addTrauma 累积（0~1 截断），实际振幅 = trauma²
 *    （小命中细腻、大事件猛烈），平滑伪噪声驱动（非 Math.random 白噪声，不毛刺）
 * 2. Zoom Punch：开火瞬间轻微推近视角（2D 等价 FOV punch），指数快速回落
 * 3. Hitstop：击杀瞬间全局时间冻结（timeScale 0.12，约 70ms），强化击杀确认
 * 4. Hitmarker 三级化：命中白 / 暴击金 / 击杀红 + 三级音效（tick / 高音 tick / 确认音）
 *
 * 调用方：Player._fireRanged（onShot）、DamagePipeline.applyHit（onPlayerHit）
 * 消费方：GameScene._updateCamera（震屏/zoom）、GameScene._syncCrosshair（hitmarker 绘制）
 * 主循环：game.js loop 调 update(真实dt) 并用 timeScale() 缩放世界 dt
 *
 * 纯状态模块：不直接操作 DOM/Canvas，不触碰 window，Node 测试环境可安全 import。
 */
export const GunFeel = {
    // ---- trauma 震屏 ----
    trauma: 0,
    shakeX: 0,
    shakeY: 0,
    TRAUMA_DECAY: 3.2,      // 指数衰减速率（/s）
    SHAKE_MAX_PX: 14,       // 满 trauma 时的最大位移（世界像素）
    // ---- zoom punch ----
    zoomPunch: 0,
    ZOOM_DECAY: 7.0,
    ZOOM_MAX: 0.03,
    // ---- hitstop ----
    _hitstopMs: 0,
    HITSTOP_SCALE: 0.12,
    // ---- hitmarker ----
    hitmarker: { t: 0, dur: 0, tier: 0 },   // tier: 1 命中 / 2 暴击 / 3 击杀
    HITMARK_MS: { 1: 120, 2: 150, 3: 220 },
    HITMARK_COLORS: { 1: '#FAFAF2', 2: '#FFD54A', 3: '#FF4D4D' },
    _hitSoundCd: 0,
    _t: 0,

    /** 累积创伤值（0~1 截断；同一帧多弹丸命中天然被上限收束） */
    addTrauma(amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    },

    /** 视角推近脉冲（取较大值，连发不叠加爆） */
    punchZoom(amount) {
        this.zoomPunch = Math.min(this.ZOOM_MAX, Math.max(this.zoomPunch, amount));
    },

    /** 击杀冻结：只刷新为更长的剩余时间，不叠加 */
    hitstop(ms) {
        if (ms > this._hitstopMs) this._hitstopMs = ms;
    },

    /** 主循环用：世界 dt 缩放系数（hitstop 期间 < 1） */
    timeScale() {
        return this._hitstopMs > 0 ? this.HITSTOP_SCALE : 1;
    },

    /**
     * 玩家开火反馈：按武器类型给微震 + zoom punch。
     * 重武器（机枪/霰弹）另有 Camera.triggerShake 大力震屏，这里只补细腻的底层震感。
     */
    onShot(item) {
        const wt = item && (item.weaponType || item.rangedType) || '';
        let trauma = 0.06;
        let zoom = 0.010;
        if (wt === 'shotgun') { trauma = 0.14; zoom = 0.020; }
        else if (isMachineGun(wt)) { trauma = 0.08; zoom = 0.012; }
        else if (wt === 'pistol') { trauma = 0.05; zoom = 0.008; }
        else if (wt === 'bow') { trauma = 0.03; zoom = 0.006; }
        this.addTrauma(trauma);
        this.punchZoom(zoom);
    },

    /**
     * 玩家直接命中反馈（DamagePipeline 远程命中调用）：
     * hitmarker 分级 + 三级音效（节流防多弹丸刷音）+ trauma + 击杀 hitstop
     */
    onPlayerHit({ killed = false, crit = false } = {}) {
        const tier = killed ? 3 : (crit ? 2 : 1);
        this.hitmarker.tier = tier;
        this.hitmarker.dur = this.HITMARK_MS[tier];
        this.hitmarker.t = this.hitmarker.dur;

        const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        const cd = killed ? 70 : 45;
        if (now >= this._hitSoundCd && SoundManager && typeof SoundManager.play === 'function') {
            this._hitSoundCd = now + cd;
            SoundManager.play(killed ? 'kill_confirm' : (crit ? 'hitmark_crit' : 'hitmark'));
        }

        this.addTrauma(killed ? 0.30 : (crit ? 0.16 : 0.10));
        if (killed) this.hitstop(70);
    },

    /**
     * 每帧更新（真实 dt，毫秒；不随 hitstop 缩放，保证冻结能快速恢复）
     * 震屏偏移写入 shakeX/shakeY，由相机消费
     */
    update(dtMs) {
        const dt = dtMs / 1000;
        this._t += dt;
        if (this._hitstopMs > 0) this._hitstopMs = Math.max(0, this._hitstopMs - dtMs);
        this.trauma *= Math.exp(-this.TRAUMA_DECAY * dt);
        if (this.trauma < 0.001) this.trauma = 0;
        const s = this.trauma * this.trauma;
        // 平滑伪噪声（不可通约正弦叠加，类 Perlin 体感，无白噪声毛刺）
        const t = this._t;
        this.shakeX = (Math.sin(t * 29.7) + Math.sin(t * 47.3 + 1.7) + Math.sin(t * 13.1 + 4.2)) / 3 * this.SHAKE_MAX_PX * s;
        this.shakeY = (Math.sin(t * 33.1 + 2.3) + Math.sin(t * 44.7 + 0.6) + Math.sin(t * 11.9 + 5.1)) / 3 * this.SHAKE_MAX_PX * s;
        this.zoomPunch *= Math.exp(-this.ZOOM_DECAY * dt);
        if (this.zoomPunch < 0.0005) this.zoomPunch = 0;
        if (this.hitmarker.t > 0) this.hitmarker.t = Math.max(0, this.hitmarker.t - dtMs);
    },

    /** 场景切换/重开局兜底：清空全部瞬时状态 */
    reset() {
        this.trauma = 0;
        this.shakeX = 0;
        this.shakeY = 0;
        this.zoomPunch = 0;
        this._hitstopMs = 0;
        this.hitmarker.t = 0;
        this.hitmarker.tier = 0;
        this._hitSoundCd = 0;
    }
};
