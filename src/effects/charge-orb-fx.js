import { burstParticles } from './combat-fx.js';

/**
 * 蓄力汇聚光球（2026-08-05，贯穿雷枪蓄力期专属，可作蓄力型技能模板）
 *
 * - 锚点：每帧取手部世界坐标（调用方传入 anchorFn，贯穿雷枪 = 手层内容质心，
 *   SKILL.md 手部分层沉淀：拳头中心 = 手层内容质心，像素级可复现）；
 * - 逐步积蓄：光球半径随蓄力进度 4 → radiusMax 逐步放大（蓝白辉光呼吸），
 *   同时蓝色粒子从手部周围四面八方汇聚到手部（椭圆环随机点 → 速度指向手部）；
 * - 施法成功：finish() 手部光球向外爆散（粒子四散）后销毁；
 *   蓄力取消：cancel() 淡出销毁（不爆散）。
 * 由 EffectManager 驱动，active=false 自动移除。
 */

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

export class ChargeOrbFx {
    /**
     * @param {object} source - 施法者（伤害/深度参照）
     * @param {object} opts
     * @param {Function} opts.anchorFn - () => ({x, y}) 每帧取手部世界坐标
     * @param {number} opts.durationMs - 蓄力总时长（决定放大进度）
     * @param {number} opts.radiusMax - 满蓄时光球半径
     */
    constructor(source, { anchorFn, durationMs = 2500, radiusMax = 38, palette = null } = {}) {
        this.source = source;
        this.anchorFn = anchorFn || null;
        this.durationMs = durationMs;
        this.radiusMax = radiusMax;
        // 配色板（默认电系蓝；光系等可传金色系覆盖）
        this._palette = palette || {
            tints: [0xffffff, 0xbcdcff, 0x7fb8ff, 0x4b6fff],
            glowOuter: 0x4b6fff,
            glowInner: 0x9fc6ff,
            core: 0x9fc6ff,
        };
        this.active = true;
        this._elapsed = 0;
        this._spawnTimer = 0;
        this._orbGfx = null;
        this._glowGfx = null;
        this._fade = null; // { t, ms } 淡出中
        this._build();
    }

    getFogPosition() {
        return this._anchor();
    }

    getFogVisuals() {
        return [this._orbGfx, this._glowGfx];
    }

    progress() {
        return Math.min(1, this._elapsed / this.durationMs);
    }

    _anchor() {
        if (this.anchorFn) {
            const a = this.anchorFn();
            if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return a;
        }
        const p = this.source;
        return { x: p.x, y: p.y - ((p.bodyHeight || 120) * 0.5) - 30 };
    }

    _build() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        this._orbGfx = scene.add.graphics();
        this._glowGfx = scene.add.graphics();
        this._glowGfx.setBlendMode('ADD');
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._orbGfx);
            scene.worldEffectsGroup.add(this._glowGfx);
        }
    }

    update(dt = 16.67) {
        if (this._fade) {
            this._fade.t -= dt / this._fade.ms;
            if (this._fade.t <= 0) {
                this.destroy();
                return;
            }
            this._drawOrb(this._fade.t);
            return;
        }
        this._elapsed += dt;
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = 46;
            this._spawnConverge();
        }
        this._drawOrb(1);
    }

    /** 粒子从手部周围四面八方汇聚到手部（椭圆环随机点，速度指向手部） */
    _spawnConverge() {
        const a = this._anchor();
        const p = this.progress();
        for (let i = 0; i < 3; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 26 + Math.random() * 56;
            const sx = a.x + Math.cos(ang) * dist;
            const sy = a.y + Math.sin(ang) * dist * 0.6;
            const toAngle = Math.atan2(a.y - sy, a.x - sx);
            const speed = 120 + Math.random() * 130;
            // 寿命精确匹配到达时间：粒子飞到/即将到手部即消散，视觉上"收进"光球而非飘过
            const life = Math.max(80, (dist / speed) * 1000);
            burstParticles({
                texture: 'impact_dot',
                x: sx,
                y: sy,
                count: 1,
                config: {
                    speed: { min: speed * 0.85, max: speed * 1.15 },
                    angle: { min: toAngle - 0.035, max: toAngle + 0.035 },
                    scale: { start: 1.8 + p * 2.0, end: 0.1 },
                    alpha: { start: 0.95, end: 0 },
                    lifespan: { min: life, max: life + 60 },
                    tint: this._palette.tints,
                    blendMode: 'ADD',
                },
                destroyAfterMs: life + 130,
                depth: Math.floor(a.y) + 30,
            });
        }
    }

    _drawOrb(alphaMul = 1) {
        if (!this._orbGfx || !this._orbGfx.active || !this._glowGfx || !this._glowGfx.active) return;
        const a = this._anchor();
        const p = this.progress();
        const r = Math.max(3, 4 + p * (this.radiusMax - 4));
        const breathe = 0.75 + 0.25 * Math.sin(Date.now() * 0.02);
        const depth = Math.floor(a.y) + 30;
        const orb = this._orbGfx;
        const glow = this._glowGfx;
        orb.clear();
        glow.clear();
        orb.setDepth(depth);
        glow.setDepth(depth);
        // ADD 蓝辉光：外层先随进度铺开（积蓄感）
        glow.fillStyle(this._palette.glowOuter, (0.18 + 0.14 * p) * breathe * alphaMul);
        glow.fillCircle(a.x, a.y, r * (1.5 + p * 0.8));
        glow.fillStyle(this._palette.glowInner, 0.30 * breathe * alphaMul);
        glow.fillCircle(a.x, a.y, r * 1.1);
        // NORMAL 白蓝芯：蓄力过半后浮现并随进度变亮（逐步变大的手部能量团）
        if (p > 0.35) {
            const coreA = (p - 0.35) / 0.65;
            orb.fillStyle(this._palette.core, 0.40 * coreA * alphaMul);
            orb.fillCircle(a.x, a.y, r * 0.9);
            orb.fillStyle(0xffffff, Math.min(0.85, coreA * 1.8) * alphaMul);
            orb.fillCircle(a.x, a.y, r * 0.52);
        }
    }

    /** 施法成功：手部光球向外爆散后销毁 */
    finish() {
        const a = this._anchor();
        const p = this.progress();
        burstParticles({
            texture: 'impact_dot',
            x: a.x,
            y: a.y,
            count: 24,
            jitter: 12,
            config: {
                speed: { min: 130, max: 540 },
                angle: { min: 0, max: 360 },
                gravityY: -40,
                scale: { start: 2.4 + p * 1.6, end: 0.15 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 320, max: 680 },
                tint: this._palette.tints,
                blendMode: 'ADD',
            },
            destroyAfterMs: 800,
            depth: Math.floor(a.y) + 30,
        });
        this._startFade(150);
    }

    /** 蓄力取消：光球淡出销毁（不爆散） */
    cancel() {
        this._startFade(220);
    }

    _startFade(ms) {
        if (this._fade) return;
        this._fade = { t: 1, ms };
    }

    destroy() {
        if (this._orbGfx && this._orbGfx.active) this._orbGfx.destroy();
        this._orbGfx = null;
        if (this._glowGfx && this._glowGfx.active) this._glowGfx.destroy();
        this._glowGfx = null;
        this.active = false;
    }
}
