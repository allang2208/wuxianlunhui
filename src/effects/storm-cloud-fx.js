import { burstParticles } from './combat-fx.js';

/**
 * 雷暴领域 Buff 视觉（2026-08-05 v2，参照暴风雪乌云做法 + 电系蓝色调）
 *
 * - 云团：运行时柔边贴图（stormCloudPuff，径向渐变羽化）叠出三层蓝调云团——
 *   底层深蓝黑、中层靛蓝、上层电光蓝高光，边缘不塑料（暴风雪同款手法）；
 * - 云内：电弧锯齿随机闪烁（不再额外画蓝色圆环描边）；
 * - 周边：蓝色云雾粒子缓慢弥漫（ADD）+ 云底电花迸溅 + 蓝色电弧小粒子向下坠落；
 * - 深度恒为 CLOUD_TOP_DEPTH（1<<28），不被墙体/实体遮挡（暴风雪同款）。
 * 由 EffectManager 驱动，雷云结束时 destroy 统一回收。
 */

const CLOUD_TOP_DEPTH = 1 << 28;

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

export class StormCloudFx {
    /**
     * @param {number} opts.radius - 雷云影响半径（雷暴领域 radius = 220 + 8×等级），
     *   云团/粒子按 radius/220 基准等比缩放，随等级扩大匹配影响范围
     */
    constructor(source, { heightOffset = 170, radius = 220 } = {}) {
        this.source = source;
        this.heightOffset = heightOffset;
        this.radius = radius;
        this._scale = Math.max(0.8, radius / 220);
        this.active = true;
        this._blobs = [];        // [{ img, ox, oy }]
        this._arcGfx = null;     // 电弧锯齿（闪烁）
        this._sparkTimer = 0;
        this._mistTimer = 0;
        this._fallTimer = 0;
        this._arcTimer = 0;
        this._fogVisible = true;
        this._build();
        _getScene()?.syncFogVisualEffect?.(this);
    }

    getFogPosition() {
        return { x: this.source?.x, y: this.source?.y };
    }

    getFogVisuals() {
        return [this._blobs, this._arcGfx];
    }

    setFogVisible(visible) {
        this._fogVisible = visible;
    }

    _ensurePuffTexture(scene) {
        if (scene.textures.exists('stormCloudPuff')) return;
        const size = 128;
        const canvas = scene.textures.createCanvas('stormCloudPuff', size, size);
        const ctx = canvas.getContext();
        const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.72)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        canvas.refresh();
    }

    _cloudBase() {
        const p = this.source;
        return p.y - ((p.bodyHeight || 120) * 0.5) - this.heightOffset;
    }

    /** 三层蓝调云团：深蓝黑 → 靛蓝 → 电光蓝高光（尺寸/透明度/偏移逐层不同） */
    _build() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        this._ensurePuffTexture(scene);
        if (!scene.textures.exists('stormCloudPuff')) return;
        const layers = [
            { tint: 0x141b2e, count: 18, spread: 1.0, sizeMin: 0.62, sizeMax: 1.0, alpha: 0.92, yOff: 0 },
            { tint: 0x233a66, count: 14, spread: 0.84, sizeMin: 0.5, sizeMax: 0.82, alpha: 0.88, yOff: -0.16 },
            { tint: 0x3f66b8, count: 10, spread: 0.62, sizeMin: 0.4, sizeMax: 0.64, alpha: 0.82, yOff: -0.30 },
            { tint: 0x8fb8ff, count: 6, spread: 0.42, sizeMin: 0.28, sizeMax: 0.46, alpha: 0.72, yOff: -0.42 },
        ];
        for (const L of layers) {
            for (let i = 0; i < L.count; i++) {
                const rr = Math.sqrt(Math.random()) * L.spread;
                const a = Math.random() * Math.PI * 2;
                const ox = Math.cos(a) * rr * 96 * this._scale;
                const oy = Math.sin(a) * rr * 44 * this._scale + L.yOff * 58 * this._scale;
                const size = 92 * this._scale * (L.sizeMin + Math.random() * (L.sizeMax - L.sizeMin));
                const blob = scene.add.image(0, 0, 'stormCloudPuff');
                blob.setTint(L.tint);
                blob.setDisplaySize(size, size);
                blob.setAlpha(L.alpha * (0.75 + Math.random() * 0.25));
                blob.setDepth(CLOUD_TOP_DEPTH);
                this._blobs.push({ img: blob, ox, oy });
            }
        }
        // 云内电弧锯齿
        this._arcGfx = scene.add.graphics();
        this._arcGfx.setBlendMode('ADD');
        this._arcGfx.setDepth(CLOUD_TOP_DEPTH);
    }

    _syncBlobs() {
        const p = this.source;
        const base = this._cloudBase();
        for (const b of this._blobs) {
            if (!b.img || !b.img.active) continue;
            b.img.setPosition(p.x + b.ox, base + b.oy);
        }
    }

    /** 云内电弧锯齿：随机折线短闪（白蓝芯 + 蓝辉光） */
    _drawArc() {
        const p = this.source;
        if (!this._arcGfx || !this._arcGfx.active) return;
        const base = this._cloudBase();
        const scene = _getScene();
        if (!scene || !scene.tweens) return;
        const x0 = p.x + (Math.random() - 0.5) * 90 * this._scale;
        const y0 = base + 18 * this._scale;
        const segs = 4 + Math.floor(Math.random() * 3);
        const pts = [{ x: x0, y: y0 }];
        let cx = x0;
        let cy = y0;
        for (let i = 0; i < segs; i++) {
            cx += (Math.random() - 0.5) * 26 * this._scale;
            cy += (14 + Math.random() * 22) * this._scale;
            pts.push({ x: cx, y: cy });
        }
        const g = this._arcGfx;
        g.clear();
        g.lineStyle(3, 0x6a9fff, 0.9);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (const pt of pts) g.lineTo(pt.x, pt.y);
        g.strokePath();
        g.lineStyle(1.2, 0xffffff, 0.95);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (const pt of pts) g.lineTo(pt.x, pt.y);
        g.strokePath();
        const arc = { a: 1 };
        scene.tweens.add({
            targets: arc,
            a: 0,
            duration: 160 + Math.random() * 120,
            onUpdate: () => g.setAlpha(arc.a),
            onComplete: () => { if (g && g.active) g.clear(); },
        });
    }

    _spawnSpark() {
        const p = this.source;
        const base = this._cloudBase();
        const sx = p.x + (Math.random() - 0.5) * 110 * this._scale;
        const sy = base + 34;
        burstParticles({
            texture: 'impact_dot',
            x: sx,
            y: sy,
            count: 4,
            jitter: 10,
            config: {
                speed: { min: 40, max: 150 },
                angle: { min: 230, max: 310 },
                gravityY: 260,
                scale: { start: 2.0, end: 0.2 },
                alpha: { start: 0.9, end: 0 },
                lifespan: { min: 200, max: 420 },
                tint: [0xffffff, 0xbcdcff, 0x7fb8ff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 520,
            depth: CLOUD_TOP_DEPTH,
        });
    }

    /** 蓝色云雾：cloud 周围缓慢弥漫（ADD 低透明度） */
    _spawnMist() {
        const p = this.source;
        const base = this._cloudBase();
        const a = Math.random() * Math.PI * 2;
        const rr = (70 + Math.random() * 110) * this._scale;
        const mx = p.x + Math.cos(a) * rr;
        const my = base + Math.sin(a) * rr * 0.45 + (Math.random() - 0.5) * 30;
        burstParticles({
            texture: 'impact_dot',
            x: mx,
            y: my,
            count: 3,
            jitter: 12,
            config: {
                speed: { min: 4, max: 14 },
                angle: { min: 0, max: 360 },
                gravityY: -8,
                scale: { start: 2.2, end: 0.6 },
                alpha: { start: 0.22, end: 0 },
                lifespan: { min: 1200, max: 2000 },
                tint: [0x3f66b8, 0x6a9fff, 0x9fc6ff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 2200,
            depth: CLOUD_TOP_DEPTH,
        });
    }

    /** 电弧粒子坠落：云底向下洒落蓝色小电花 */
    _spawnFalling() {
        const p = this.source;
        const base = this._cloudBase();
        const sx = p.x + (Math.random() - 0.5) * 150 * this._scale;
        const sy = base + 26;
        burstParticles({
            texture: 'impact_dot',
            x: sx,
            y: sy,
            count: 2,
            jitter: 8,
            config: {
                speed: { min: 60, max: 220 },
                angle: { min: 85, max: 95 },
                gravityY: 520,
                scale: { start: 1.5, end: 0.15 },
                alpha: { start: 0.95, end: 0 },
                lifespan: { min: 500, max: 900 },
                tint: [0xffffff, 0xbcdcff, 0x7fb8ff, 0x4f7fe0],
                blendMode: 'ADD',
            },
            destroyAfterMs: 1000,
            depth: CLOUD_TOP_DEPTH,
        });
    }

    update(dt = 16.67) {
        const p = this.source;
        if (!p || !p.active || !p._stormDomainActive) {
            this.destroy();
            return;
        }
        this._syncBlobs();
        if (!this._fogVisible) return;
        this._sparkTimer -= dt;
        if (this._sparkTimer <= 0) {
            this._sparkTimer = 150;
            this._spawnSpark();
        }
        this._mistTimer -= dt;
        if (this._mistTimer <= 0) {
            this._mistTimer = 220;
            this._spawnMist();
        }
        this._fallTimer -= dt;
        if (this._fallTimer <= 0) {
            this._fallTimer = 130;
            this._spawnFalling();
        }
        this._arcTimer -= dt;
        if (this._arcTimer <= 0) {
            this._arcTimer = 260 + Math.random() * 260;
            this._drawArc();
        }
    }

    destroy() {
        for (const b of this._blobs) {
            if (b.img && b.img.active && typeof b.img.destroy === 'function') b.img.destroy();
        }
        this._blobs = [];
        if (this._arcGfx && this._arcGfx.active) { this._arcGfx.destroy(); }
        this._arcGfx = null;
        this.active = false;
    }
}
