import { Easing } from '../config/math-utils.js';

function _parseHexColor(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return { r: 255, g: 255, b: 255, hex: 0xffffff };
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return { r, g, b, hex: (r << 16) | (g << 8) | b };
}

class DashConvergeEffect {
    constructor(x, y, target) {
        this.x = x; this.y = y;
        this.target = target || null;
        this.life = 600; this.maxLife = 600; this.active = true;
        this.particles = [];
        for (let i = 0; i < 16; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 80 + Math.random() * 120;
            this.particles.push({
                sx: Math.cos(angle) * dist,
                sy: Math.sin(angle) * dist,
                delay: Math.random() * 200,
                size: 2 + Math.random() * 3,
                speed: 9.36 + Math.random() * 15.6,
                color: _parseHexColor(['#ffd700', '#ffaa33', '#ffcc00', '#ffe066'][Math.floor(Math.random() * 4)])
            });
        }
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 48);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        if (this.target && this.target.active) {
            this.x = this.target.x;
            this.y = this.target.y;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const elapsed = this.maxLife - this.life;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 48);
        this.particles.forEach(p => {
            if (elapsed < p.delay) return;
            const t = Math.min(1, (elapsed - p.delay) / (this.maxLife - p.delay));
            const easeT = Easing.easeOutQuad(t);
            const px = p.sx * (1 - easeT);
            const py = p.sy * (1 - easeT);
            const alpha = t < 0.3 ? t / 0.3 : (1 - t) * 1.5;
            const size = p.size * (1 - t * 0.5);
            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(px, py, size);
            g.fillStyle(p.color.hex, alpha * 0.4);
            g.fillCircle(px - p.sx * p.speed * 3, py - p.sy * p.speed * 3, size * 1.5);
        });
        if (elapsed > 400) {
            const flashT = Math.min(1, (elapsed - 400) / 200);
            g.fillStyle(0xffd700, flashT * 0.6);
            g.fillCircle(0, 0, 8 + flashT * 12);
        }
    }

    }

class DashAuraEffect {
    constructor(x, y, target) {
        this.x = x; this.y = y;
        this.target = target || null;
        this.life = 1200; this.maxLife = 1200; this.active = true;
        this.rings = [];
        for (let i = 0; i < 3; i++) {
            this.rings.push({
                radius: 15 + i * 10,
                speed: 1.248 + Math.random() * 1.872,
                offset: Math.random() * Math.PI * 2,
                particles: Array.from({ length: 6 + i * 2 }, (_, j) => ({
                    angle: (j / (6 + i * 2)) * Math.PI * 2 + Math.random() * 0.5,
                    size: 1.5 + Math.random() * 2,
                    color: _parseHexColor(['#ffd700', '#ffaa33', '#ffe066', '#ffcc88'][Math.floor(Math.random() * 4)])
                }))
            });
        }
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 47);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        if (this.target && this.target.active) {
            this.x = this.target.x;
            this.y = this.target.y;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const progress = 1 - this.life / this.maxLife;
        const alpha = progress < 0.2 ? progress / 0.2 : (1 - progress) * 1.25;
        const now = Date.now();
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 47);
        this.rings.forEach((ring, i) => {
            const ringAlpha = 0.6 - i * 0.15;
            ring.particles.forEach(p => {
                const angle = p.angle + now * ring.speed * 0.001 + ring.offset;
                const px = Math.cos(angle) * ring.radius;
                const py = Math.sin(angle) * ring.radius;
                const pulse = 1 + Math.sin(now * 0.003 + p.angle * 3) * 0.2;
                const size = p.size * pulse;
                g.fillStyle(p.color.hex, alpha * ringAlpha);
                g.fillCircle(px, py, size);
                g.fillStyle(p.color.hex, alpha * ringAlpha * 0.3);
                g.fillCircle(px, py, size * 2.5);
            });
        });
    }

    }

class GoldenConvergeEffect {
    constructor(x, y, directionX, directionY, target, duration = 1600, convergeX, convergeY) {
        this.x = x; this.y = y;
        this.baseX = x; this.baseY = y;
        this.dirX = directionX; this.dirY = directionY;
        this.target = target || null;
        this.life = duration; this.maxLife = duration; this.active = true;
        this.lineCount = 24;
        this.fanAngle = (50 * Math.PI) / 180;
        this.lines = [];
        for (let i = 0; i < this.lineCount; i++) {
            this.lines.push({ radius: 120 + Math.random() * 360 });
        }
        this.convergeX = convergeX !== undefined ? convergeX : 150;
        this.convergeY = convergeY !== undefined ? convergeY : -10;
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 49);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        if (this.target && this.target.active) {
            this.x = this.target.x + (this.baseX - this.target.x);
            this.y = this.target.y + (this.baseY - this.target.y);
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const progress = 1 - this.life / this.maxLife;
        const alpha = 0.5 * (1 - progress * 0.5);
        const arcAngle = Math.atan2(-this.dirY, -this.dirX);
        const startAngle = arcAngle - this.fanAngle / 2;
        const angleStep = this.fanAngle / (this.lineCount - 1);
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 49);
        g.setRotation(this.target && this.target.rotation !== undefined ? this.target.rotation : 0);
        g.lineStyle(1.5, 0xffffff, alpha);
        for (let i = 0; i < this.lineCount; i++) {
            const angle = startAngle + i * angleStep;
            const currentRadius = this.lines[i].radius * (1 - Easing.easeOutQuad(progress));
            if (currentRadius <= 0) continue;
            const ex = Math.cos(angle) * currentRadius;
            const ey = Math.sin(angle) * currentRadius;
            g.beginPath();
            g.moveTo(this.convergeX + ex, this.convergeY + ey);
            g.lineTo(this.convergeX, this.convergeY);
            g.strokePath();
        }
    }

    
    setConverge(x, y) {
        this.convergeX = x;
        this.convergeY = y;
    }
}

class DashFireTrailEffect {
    constructor(x, y, directionX, directionY, target) {
        this.x = x; this.y = y;
        this.dirX = directionX; this.dirY = directionY;
        this.target = target || null;
        this.life = 600; this.maxLife = 600; this.active = true;
        this.particles = [];
        for (let i = 0; i < 48; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 60;
            const isRed = Math.random() < 0.8;
            const colorHex = isRed
                ? ['#ff3300', '#ff6600', '#ff0000', '#ff4400'][Math.floor(Math.random() * 4)]
                : ['#ffcc00', '#ffdd33', '#ffee66'][Math.floor(Math.random() * 3)];
            this.particles.push({
                sx: Math.cos(angle) * dist,
                sy: Math.sin(angle) * dist,
                delay: Math.random() * 300,
                size: 2 + Math.random() * 4,
                speed: 5 + Math.random() * 10,
                color: _parseHexColor(colorHex),
                flickerSpeed: 2 + Math.random() * 4
            });
        }
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 48);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        if (this.target && this.target.active) {
            this.x = this.target.x;
            this.y = this.target.y;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const elapsed = this.maxLife - this.life;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 48);
        this.particles.forEach(p => {
            if (elapsed < p.delay) return;
            const t = Math.min(1, (elapsed - p.delay) / (this.maxLife - p.delay));
            const easeT = Easing.easeOutQuad(t);
            const px = p.sx * (1 - easeT * 0.5);
            const py = p.sy * (1 - easeT * 0.5);
            const flicker = 0.7 + Math.sin(elapsed * 0.01 * p.flickerSpeed) * 0.3;
            const alpha = (t < 0.2 ? t / 0.2 : (1 - t) * 1.5) * flicker;
            const size = p.size * (1 - t * 0.3);
            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(px, py, size);
            g.fillStyle(p.color.hex, alpha * 0.3);
            g.fillCircle(px, py, size * 2);
        });
    }

    }

export { DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect, DashFireTrailEffect };
