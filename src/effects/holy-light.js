import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * 圣光降临特效（2026-08-02 v2 定稿：干净锥形光束 + 仅底部接触地面处不规则淡出）
 *
 * - 主体为规整锥形光束（天上宽 → 落地窄）：NORMAL 软填充 + ADD 宽辉光 + 白金色细内芯，
 *   直边、呼吸微闪（sin 相位）；
 * - **仅底部 dissolveRatio 段（默认 28%）与地面接触处做不规则淡出**：
 *   切成 10 片，每片左右边缘随机锯齿 + 逐片随机透明度 + 越靠地越淡——接触面自然消散，
 *   主体其余部分保持干净整齐；
 * - 目标脚下金色光池椭圆（ADD）；目标身上金色粒子向上飘散；末 fadeMs 整体线性淡出；
 * - 深度 = 目标精灵 depth + 2。
 *
 * 生命周期由 EffectManager.update 驱动，active=false 后自动移除。
 */
class HolyLightEffect {
    constructor(source, target, options = {}) {
        this.source = source;
        this.target = target;
        this.fadeMs = options.fadeMs || 400;
        this.life = (options.durationMs || 2000) + this.fadeMs;
        this.maxLife = this.life;
        this.active = true;
        this.beamTopWidth = options.beamTopWidth ?? 60;
        this.beamBottomWidth = options.beamBottomWidth ?? 110;
        this.beamHeight = options.beamHeight ?? 1400;
        this.dissolveRatio = options.dissolveRatio ?? 0.28;
        this._bottomEdges = [];
        this._graphics = null;      // 软填充（NORMAL）
        this._glowGraphics = null;  // 辉光/内芯/光池（ADD）
        this._emitter = null;       // 上升金色粒子
        this._createPhaser();
    }

    _createPhaser() {
        const scene = window.__phaserScene;
        if (!scene) return;
        this._graphics = scene.add.graphics();
        this._glowGraphics = scene.add.graphics();
        this._glowGraphics.setBlendMode('ADD');
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._graphics);
            scene.worldEffectsGroup.add(this._glowGraphics);
        }
        // 金色上升粒子（impact_dot 兜底 ensure；连续发射，跟随目标位置）
        if (!scene.textures.exists('impact_dot') && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        if (scene.textures.exists('impact_dot')) {
            this._emitter = scene.add.particles(0, 0, 'impact_dot', {
                emitting: true,
                frequency: 55,
                speedY: { min: -60, max: -180 },
                speedX: { min: -18, max: 18 },
                scale: { start: 1.6, end: 0.15 },
                alpha: { start: 0.9, end: 0 },
                lifespan: { min: 900, max: 1500 },
                tint: [0xffd27a, 0xffe9a8, 0xffcc55, 0xfff6d8],
                blendMode: 'ADD',
            });
            this._emitter.addToUpdateList();
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._emitter);
        }
        this._buildGeometry();
        this._redraw();
    }

    /** 构建底部不规则淡出段（创建时生成一次，静态锯齿；位置每帧随目标） */
    _buildGeometry() {
        const topHalf = this.beamTopWidth / 2;
        const bottomHalf = this.beamBottomWidth / 2;
        const segs = 10;
        const pts = [];
        for (let i = 0; i <= segs; i++) {
            const kb = i / segs; // 底部段内进度 0→1
            const k = (1 - this.dissolveRatio) + this.dissolveRatio * kb; // 全高进度
            const base = topHalf + (bottomHalf - topHalf) * k;
            const jit = (Math.random() * 2 - 1) * (4 + 12 * kb);
            pts.push({
                kb,
                half: Math.max(4, base + jit),
                // 越靠地越淡 + 逐片随机（底部不规则消散）
                a: (0.55 + Math.random() * 0.45) * (0.45 + 0.55 * (1 - kb)),
            });
        }
        this._bottomEdges = pts;
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            this._destroyPhaser();
            return;
        }
        // 粒子位置跟随目标；淡出期停发（余粒飘完随销毁）
        const groundY = this.target ? this.target.y : (this._lastY || 0);
        const chestY = groundY - ((this.target && this.target.bodyHeight) || 120) * 0.5;
        if (this._emitter) {
            this._emitter.setPosition(this.target ? this.target.x : (this._lastX || 0), chestY);
            if (this.life <= this.fadeMs && this._emitter.emitting) this._emitter.emitting = false;
        }
        this._lastX = this.target ? this.target.x : (this._lastX || 0);
        this._lastY = groundY;
        this._redraw();
    }

    _destroyPhaser() {
        if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
        if (this._glowGraphics) { this._glowGraphics.destroy(); this._glowGraphics = null; }
        if (this._emitter) { this._emitter.destroy(); this._emitter = null; }
    }

    _quad(g, x0, y0, x1, y1, x2, y2, x3, y3) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.lineTo(x2, y2);
        g.lineTo(x3, y3);
        g.closePath();
        g.fillPath();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active || this._bottomEdges.length < 2) return;
        const t = this.target;
        const x = t ? t.x : (this._lastX || 0);
        const groundY = t ? t.y : (this._lastY || 0);
        const skyY = groundY - this.beamHeight;
        const dissolveTopY = groundY - this.beamHeight * this.dissolveRatio;
        const midHalf = this.beamTopWidth / 2 + (this.beamBottomWidth / 2 - this.beamTopWidth / 2) * (1 - this.dissolveRatio);
        const topHalf = this.beamTopWidth / 2;
        // 淡出（末 fadeMs 线性）+ 呼吸微闪（上一版本同款）
        const fade = this.life >= this.fadeMs ? 1 : Math.max(0, this.life / this.fadeMs);
        const shimmer = 0.82 + 0.18 * Math.sin(this.maxLife - this.life);
        const alpha = Math.min(1, fade * shimmer);
        const depth = (this.target && this.target._phaserSprite ? this.target._phaserSprite.depth : groundY + 10) + 2;

        const g = this._graphics;
        const glow = this._glowGraphics;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(depth);
        glow.clear();
        glow.setPosition(0, 0);
        glow.setDepth(depth);

        // ① 主体干净段（skyY → dissolveTopY，直边）
        g.fillStyle(0xffcc66, 0.20 * alpha);
        this._quad(g, x - topHalf, skyY, x + topHalf, skyY, x + midHalf, dissolveTopY, x - midHalf, dissolveTopY);
        glow.fillStyle(0xffd27a, 0.30 * alpha);
        this._quad(g, x - topHalf - 24, skyY, x + topHalf + 24, skyY, x + midHalf + 26, dissolveTopY, x - midHalf - 26, dissolveTopY);
        glow.fillStyle(0xfff6d8, 0.55 * alpha);
        this._quad(g, x - 7, skyY, x + 7, skyY, x + 8, dissolveTopY, x - 8, dissolveTopY);

        // ② 底部不规则淡出段（锯齿边缘 + 逐片随机透明度，越靠地越淡）
        const slices = this._bottomEdges.length - 1;
        for (let i = 0; i < slices; i++) {
            const p0 = this._bottomEdges[i];
            const p1 = this._bottomEdges[i + 1];
            const a = alpha * p0.a;
            const y0 = dissolveTopY + (groundY - dissolveTopY) * p0.kb;
            const y1 = dissolveTopY + (groundY - dissolveTopY) * p1.kb;
            g.fillStyle(0xffcc66, 0.20 * a);
            this._quad(g, x - p0.half, y0, x + p0.half, y0, x + p1.half, y1, x - p1.half, y1);
            glow.fillStyle(0xffd27a, 0.30 * a);
            this._quad(g, x - p0.half - 20, y0, x + p0.half + 20, y0, x + p1.half + 22, y1, x - p1.half - 22, y1);
            glow.fillStyle(0xfff6d8, 0.50 * a);
            this._quad(g, x - 7, y0, x + 7, y0, x + 8, y1, x - 8, y1);
        }

        // ③ 脚下金色光池（透视椭圆）
        glow.fillStyle(0xffd27a, 0.28 * alpha);
        glow.fillEllipse(x, groundY, (this.beamBottomWidth + 40) * 0.5, (this.beamBottomWidth + 40) * 0.5 * PERSPECTIVE_SCALE_Y);
    }
}

export { HolyLightEffect };
