import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * 芦影镰螳“双镰裂扇”的 Phaser 纯视觉剑气。
 * 两道填充式锐利弯月共享玩法层的起点、锁定方向、射程与扇区张角；
 * 本类不读取目标、不创建碰撞形状，也不参与伤害或流血结算。
 */
export class ReedMantisSweepEffect {
    constructor(options = {}) {
        this.x = Number(options.x) || 0;
        this.y = Number(options.y) || 0;
        this.angle = Number(options.angle) || 0;
        this.range = Math.max(1, Number(options.range) || 280);
        this.arc = Math.max(1, Number(options.arcDegrees) || 120) * Math.PI / 180;
        this.innerRadius = Math.max(0, Number(options.innerRadius) || 58);
        this.bladeWidth = Math.max(2, Number(options.bladeWidth) || 18);
        this.maxLife = Math.max(120, Number(options.durationMs) || 360);
        this.life = this.maxLife;
        const parsedDepth = Number(options.depth);
        this.depth = options.depth != null && Number.isFinite(parsedDepth) ? parsedDepth : null;
        this.active = true;
        this._graphics = null;
        this._glowGraphics = null;
        this._ensureGraphics();
        this._redraw();
    }

    getFogPosition() {
        return { x: this.x, y: this.y };
    }

    getFogVisuals() {
        return [this._graphics, this._glowGraphics];
    }

    _effectDepth() {
        if (Number.isFinite(this.depth)) return this.depth;
        const naturalDepth = this.y + 10.12;
        const wallSystem = typeof window !== 'undefined' ? window.WallSystem : null;
        return wallSystem?.junctionCorrectedDepth
            ? wallSystem.junctionCorrectedDepth(this.x, this.y, naturalDepth)
            : naturalDepth;
    }

    _ensureGraphics() {
        if (this._graphics && !this._graphics.active) this._graphics = null;
        if (this._glowGraphics && !this._glowGraphics.active) this._glowGraphics = null;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene?.add) return;
        if (this._graphics && this._glowGraphics) return;
        this._destroyGraphics();
        this._graphics = scene.add.graphics();
        this._glowGraphics = scene.add.graphics();
        this._glowGraphics.setBlendMode('ADD');
        scene.worldEffectsGroup?.add(this._graphics);
        scene.worldEffectsGroup?.add(this._glowGraphics);
    }

    _destroyGraphics() {
        if (this._graphics?.active) this._graphics.destroy();
        if (this._glowGraphics?.active) this._glowGraphics.destroy();
        this._graphics = null;
        this._glowGraphics = null;
    }

    // EffectManager 的强制清场钩子；场景切换时也成对销毁 NORMAL/ADD 两层。
    _destroyPhaserSprite() {
        this._destroyGraphics();
    }

    update(dt = 16.67) {
        this.life = Math.max(0, this.life - Math.max(0, Number(dt) || 0));
        if (this.life <= 0) {
            this.active = false;
            this._destroyGraphics();
            return;
        }
        this._ensureGraphics();
        this._redraw();
    }

    _pathPoint(side, progress) {
        const t = Math.max(0, Math.min(1, progress));
        const eased = 1 - Math.pow(1 - t, 2.4);
        const halfArc = this.arc / 2;
        const theta = this.angle + side * halfArc * (0.04 + eased * 0.96);
        const radius = this.innerRadius + (this.range - this.innerRadius) * eased;
        return {
            x: Math.cos(theta) * radius,
            y: Math.sin(theta) * radius * PERSPECTIVE_SCALE_Y,
        };
    }

    _buildRibbon(side, start, end, halfWidth) {
        const steps = 18;
        const left = [];
        const right = [];
        for (let index = 0; index <= steps; index++) {
            const along = index / steps;
            const t = start + (end - start) * along;
            const point = this._pathPoint(side, t);
            const before = this._pathPoint(side, Math.max(0, t - 0.008));
            const after = this._pathPoint(side, Math.min(1, t + 0.008));
            const tangentX = after.x - before.x;
            const tangentY = after.y - before.y;
            const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
            const normalX = -tangentY / tangentLength;
            const normalY = tangentX / tangentLength;
            // 两端收成刀尖，中段略微鼓起，避免粗描边式“软管”观感。
            const taper = Math.pow(Math.sin(along * Math.PI), 0.58);
            const width = halfWidth * taper;
            left.push({ x: point.x + normalX * width, y: point.y + normalY * width });
            right.push({ x: point.x - normalX * width, y: point.y - normalY * width });
        }
        return left.concat(right.reverse());
    }

    _fillRibbon(graphics, side, start, end, width, color, alpha) {
        if (alpha <= 0 || end - start <= 0.006) return;
        graphics.fillStyle(color, alpha);
        graphics.fillPoints(this._buildRibbon(side, start, end, width), true);
    }

    _drawBlade(body, glow, side, start, end, alpha) {
        // 深色承托保证亮色地面上仍有清晰刃缘；ADD 层只负责辉光和锐芯。
        this._fillRibbon(body, side, start, end, this.bladeWidth * 0.78, 0x152515, 0.48 * alpha);
        this._fillRibbon(body, side, start, end, this.bladeWidth * 0.48, 0x45642f, 0.52 * alpha);
        this._fillRibbon(glow, side, start, end, this.bladeWidth * 1.18, 0x6ea957, 0.13 * alpha);
        this._fillRibbon(glow, side, start, end, this.bladeWidth * 0.66, 0xa9e479, 0.34 * alpha);
        this._fillRibbon(glow, side, start, end, this.bladeWidth * 0.19, 0xf0ffe4, 0.88 * alpha);

        const tip = this._pathPoint(side, end);
        const before = this._pathPoint(side, Math.max(start, end - 0.035));
        const dx = tip.x - before.x;
        const dy = tip.y - before.y;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const nx = -dy / length;
        const ny = dx / length;
        glow.fillStyle(0xf7ffed, 0.82 * alpha);
        glow.fillPoints([
            { x: tip.x + dx / length * 10, y: tip.y + dy / length * 10 },
            { x: before.x + nx * 2.2, y: before.y + ny * 2.2 },
            { x: before.x - nx * 2.2, y: before.y - ny * 2.2 },
        ], true);
    }

    _redraw() {
        const body = this._graphics;
        const glow = this._glowGraphics;
        if (!body?.active || !glow?.active) return;

        const elapsed = this.maxLife - this.life;
        const headProgress = Math.min(1, elapsed / 205);
        const tailProgress = Math.min(1, Math.max(0, elapsed - 72) / 285);
        const head = 1 - Math.pow(1 - headProgress, 3.1);
        const tail = Math.pow(tailProgress, 1.35);
        const fadeIn = Math.min(1, elapsed / 42);
        const fadeOut = Math.min(1, this.life / 128);
        const alpha = fadeIn * fadeOut;
        const depth = this._effectDepth();

        body.clear();
        glow.clear();
        for (const graphics of [body, glow]) {
            graphics.setPosition(this.x, this.y);
        }
        body.setDepth(depth);
        glow.setDepth(depth + 0.01);

        this._drawBlade(body, glow, -1, tail, head, alpha);
        this._drawBlade(body, glow, 1, tail, head, alpha);
    }
}
