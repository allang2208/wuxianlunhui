import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { surfaceEffectAtPoint } from '../physics/elevation.js';
import { FogVisualAdapter } from './fog-visual-adapter.js';

/**
 * 地表持续区域特效基类（GroundZone，2026-07-28 自提灯燃烧区抽出的模板）
 *
 * 适用：地面燃烧区、油池+火焰、毒雾、酸液等"落地成区、持续伤害、粒子氛围"的地表特效。
 * 三层分离（提灯工作流规格收口）：
 *   ① 底面贴花（NORMAL 混合椭圆，growMs 扩散，呼吸明暗）depth y-1000
 *   ② 反光描边（ADD 混合，错相位呼吸）depth y-999
 *   ③ 区域粒子簇（(0,0) 发射器 + explode 世界坐标 + delayedCall 销毁）depth y-998
 * 生命周期：timer（存活）→ tickTimer（伤害周期）→ oilFrac（扩散）→ flameTimer（喷发周期）。
 * 伤害逻辑由调用方 onTick(zone, entities) 提供（读自己的 matk/伤害公式），本类不管数值。
 *
 * 用法：
 *   const zone = new GroundZone({ x, y, radius, duration, tickMs,
 *     onTick: (z, entities) => { ... }, ... });
 *   zones.push(zone);                          // 调用方持有数组
 *   zone.update(dt, entities);                 // 实体 update 中驱动
 *   zone.destroy();                            // _destroyCustomEffects / 到期统一清理
 */

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

export class GroundZone {
    /**
     * @param {object} o
     * @param {number} o.x / o.y 区域中心（世界坐标）
     * @param {number} o.radius 区域半径
     * @param {number} [o.duration=4000] 存活时长 ms
     * @param {number} [o.tickMs=500] 伤害周期 ms
     * @param {object} [o.surfaceContext] 释放时解析的承载面高度快照；缺省按区域中心解析一次
     * @param {function} o.onTick (zone, entities) => void 伤害/效果周期回调（必需）
     * @param {object} [o.oil] 底面：{ color=0x8a6d1f, alpha=0.5, growMs=300, breathe={to=0.55,duration=600} }；传 null 不要底面
     * @param {object} [o.gloss] 反光：{ color=0xffe9a0, alpha=0.35, lineWidth=10, breathe={to=0.3,duration=450} }；传 null 不要反光
     * @param {object} [o.flame] 区域粒子簇：{ morphMs=70, points=3, burstCount=20, texture='impact_dot',
     *   speed={min:20,max:70}, scale={start:3.3,end:0.3}, alpha={start:0.85,end:0}, lifespan=550,
     *   tint=[0xffffff,0xffcc55,0xff8833], blendMode='ADD', jitterX=80, jitterY=40, emitterTtlMs=700 }；传 null 不要粒子
     */
    constructor(o) {
        this.x = o.x;
        this.y = o.y;
        this.surfaceContext = o.surfaceContext || surfaceEffectAtPoint(this.x, this.y, { impactZ: 0 });
        this.displayY = this.y - (Number(this.surfaceContext?.z) || 0);
        this.radius = o.radius ?? 300;
        this.timer = o.duration ?? 4000;
        this.tickMs = o.tickMs ?? 500;
        this.onTick = o.onTick || null;
        this.tickTimer = 0;
        this.flameTimer = 0;
        this.oilFrac = o.oil ? 0.05 : 1; // 无底面时视为已扩散完成
        this._oilCfg = o.oil === null ? null : {
            color: 0x8a6d1f, alpha: 0.5, growMs: 300,
            breathe: { to: 0.55, duration: 600 }, ...(o.oil || {}),
        };
        // 反光：显式 o.gloss > o.oil.gloss > 默认；传 null 关闭
        const glossInput = o.gloss !== undefined ? o.gloss : (o.oil && o.oil.gloss);
        this._glossCfg = (glossInput === null || (o.oil === null && o.gloss === undefined)) ? null : {
            color: 0xffe9a0, alpha: 0.35, lineWidth: 10, breathe: { to: 0.3, duration: 450 },
            ...(glossInput || {}),
        };
        this._flameCfg = o.flame === null ? null : {
            morphMs: 70, points: 3, burstCount: 20, texture: 'impact_dot',
            speed: { min: 20, max: 70 }, scale: { start: 3.3, end: 0.3 },
            alpha: { start: 0.85, end: 0 }, lifespan: 550,
            tint: [0xffffff, 0xffcc55, 0xff8833], blendMode: 'ADD',
            jitterX: 80, jitterY: 40, emitterTtlMs: 700, ...(o.flame || {}),
        };
        this._gfx = []; // 底面/反光图形引用（destroy 统一清理）
        this._emitters = [];
        this._fogVisible = true;
        this.active = true;
        this._build();
        FogVisualAdapter.register(this);
        _getScene()?.syncFogVisualEffect?.(this);
    }

    getFogPosition() {
        return { x: this.x, y: this.y };
    }

    getFogVisuals() {
        return [this._gfx, this._emitters];
    }

    setFogVisible(visible) {
        this._fogVisible = visible;
        for (let i = this._emitters.length - 1; i >= 0; i--) {
            const emitter = this._emitters[i];
            if (!emitter?.active) {
                this._emitters.splice(i, 1);
            }
        }
    }

    _trackEmitter(emitter, ttlMs) {
        if (!emitter) return null;
        const scene = _getScene();
        this._emitters.push(emitter);
        scene?.time?.delayedCall(ttlMs, () => {
            const index = this._emitters.indexOf(emitter);
            if (index >= 0) this._emitters.splice(index, 1);
            if (emitter.active) emitter.destroy();
        });
        return emitter;
    }

    _build() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        const radius = this.radius;
        // ① 底面贴花（NORMAL 混合——暗色在 ADD 下不可见）
        if (this._oilCfg) {
            const c = typeof this._oilCfg.color === 'string' ? parseInt(this._oilCfg.color, 16) : this._oilCfg.color;
            const oil = scene.add.graphics();
            oil.fillStyle(c, this._oilCfg.alpha);
            oil.fillEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
            oil.setPosition(this.x, this.displayY);
            oil.setScale(this.oilFrac);
            oil.setDepth(this.displayY - 1000); // 最低层（所有实体之下）
            this.oilGfx = oil;
            this._gfx.push(oil);
            const b = this._oilCfg.breathe || {};
            scene.tweens.add({ targets: oil, alpha: { from: 1, to: b.to ?? 0.55 }, duration: b.duration ?? 600, yoyo: true, repeat: -1 });
        }
        // ② 反光描边（ADD 混合，错相位呼吸）
        if (this._glossCfg) {
            const gc = typeof this._glossCfg.color === 'string' ? parseInt(this._glossCfg.color, 16) : this._glossCfg.color;
            const gloss = scene.add.graphics();
            gloss.lineStyle(this._glossCfg.lineWidth ?? 10, gc, this._glossCfg.alpha ?? 0.35);
            gloss.strokeEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
            gloss.setPosition(this.x, this.displayY);
            gloss.setScale(this.oilFrac);
            gloss.setBlendMode('ADD');
            gloss.setDepth(this.displayY - 999);
            this.glossGfx = gloss;
            this._gfx.push(gloss);
            const b = this._glossCfg.breathe || {};
            scene.tweens.add({ targets: gloss, alpha: { from: 1, to: b.to ?? 0.3 }, duration: b.duration ?? 450, yoyo: true, repeat: -1 });
        }
    }

    /** 区域粒子簇喷发一次（随机取区域内一点， jitter 范围内成簇） */
    _spawnFlame() {
        const scene = _getScene();
        const F = this._flameCfg;
        if (!scene || !scene.add || !F || !this._fogVisible) return;
        if (!scene.textures.exists(F.texture) && F.texture === 'impact_dot' && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        if (!scene.textures.exists(F.texture)) return;
        // 只在区域范围内喷发（跟随当前扩散进度）
        const spawnR = this.radius * this.oilFrac;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * spawnR;
        const fx = this.x + Math.cos(a) * rr;
        const fy = this.displayY + Math.sin(a) * rr * PERSPECTIVE_SCALE_Y;
        const em = scene.add.particles(0, 0, F.texture, {
            speed: F.speed, angle: { min: 0, max: 360 }, scale: F.scale,
            alpha: F.alpha, lifespan: F.lifespan, tint: F.tint, blendMode: F.blendMode,
            emitting: false,
        });
        // [Phaser 粒子坐标陷阱] 发射器留 (0,0)，explode 传世界坐标
        em.setDepth(fy - 998); // 实体之下、反光之上
        em.addToUpdateList();
        this._trackEmitter(em, F.emitterTtlMs ?? 700);
        for (let i = 0; i < F.burstCount; i++) {
            const jx = fx + (Math.random() - 0.5) * (F.jitterX ?? 80);
            const jy = fy + (Math.random() - 0.5) * (F.jitterY ?? 40) * PERSPECTIVE_SCALE_Y;
            em.explode(1, jx, jy);
        }
    }

    /** 每帧驱动（实体 update 中调用；返回 false 表示已到期销毁，调用方从数组移除） */
    update(dt, entities) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.destroy();
            return false;
        }
        this.tickTimer -= dt;
        if (this.tickTimer <= 0) {
            this.tickTimer = this.tickMs;
            if (this.onTick) this.onTick(this, entities);
        }
        // 底面扩散（growMs 内推到满）
        if (this._oilCfg && this.oilFrac < 1) {
            this.oilFrac = Math.min(1, this.oilFrac + dt / (this._oilCfg.growMs ?? 300));
            if (this.oilGfx && this.oilGfx.active) this.oilGfx.setScale(this.oilFrac);
            if (this.glossGfx && this.glossGfx.active) this.glossGfx.setScale(this.oilFrac);
        }
        // 粒子簇周期喷发
        if (this._flameCfg) {
            this.flameTimer -= dt;
            if (this.flameTimer <= 0) {
                this.flameTimer = this._flameCfg.morphMs ?? 70;
                for (let n = 0; n < (this._flameCfg.points ?? 3); n++) this._spawnFlame();
            }
        }
        return true;
    }

    /** 统一清理（到期/_destroyCustomEffects 调用；幂等） */
    destroy() {
        if (!this.active) return;
        this.active = false;
        FogVisualAdapter.unregister(this);
        const scene = _getScene();
        for (const g of this._gfx) {
            if (g && g.active) {
                if (scene && scene.tweens) scene.tweens.killTweensOf(g);
                if (typeof g.stop === 'function') g.stop();
                if (typeof g.destroy === 'function') g.destroy();
            }
        }
        this._gfx = [];
        for (const emitter of this._emitters) {
            if (emitter?.active) emitter.destroy();
        }
        this._emitters = [];
        this.oilGfx = null;
        this.glossGfx = null;
    }
}
