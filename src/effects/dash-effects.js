import { Easing } from '../config/math-utils.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

function _parseHexColor(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return { r: 255, g: 255, b: 255, hex: 0xffffff };
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return { r, g, b, hex: (r << 16) | (g << 8) | b };
}

class DashConvergeEffect {
    constructor(x, y, target, readyMs = 666) {
        this.x = x; this.y = y;
        this.target = target || null;
        this.readyMs = Math.max(1, Number(readyMs) || 666);
        this.active = true;
        this.phaseMs = 0;
        this.particles = [];
        const particleCount = 24;
        for (let i = 0; i < particleCount; i++) {
            const targetAngle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
            const sourceAngle = targetAngle + (Math.random() - 0.5) * 0.9;
            this.particles.push({
                targetAngle,
                sourceAngle,
                sourceScale: 2.8 + Math.random() * 2.2,
                delayRatio: Math.random() * 0.22,
                size: 1.4 + Math.random() * 1.8,
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
        this._graphics.setDepth(this.y - 998);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        const target = this.target;
        if (!target || !target.active || target._isDashing || !target._dashConvergeShown) {
            this._destroy();
            return;
        }
        this.phaseMs += Math.max(0, Number(dt) || 0);
        const anchor = this._footprintAnchor();
        this.x = anchor.x;
        this.y = anchor.y;
        this._redraw();
    }

    _destroy() {
        this.active = false;
        if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
    }

    _footprintAnchor() {
        const target = this.target;
        const targetX = Number(target?.x);
        const targetY = Number(target?.y);
        const colliderX = Number(target?.collider?.x);
        const colliderY = Number(target?.collider?.y);
        // 直接按实体本帧位置复算 Collider 中心，避免高速奔跑时读取到上一帧 syncPosition。
        const x = Number.isFinite(targetX)
            ? targetX + (Number(target?.colliderOffsetX) || 0)
            : (Number.isFinite(colliderX) ? colliderX : this.x);
        const physicalY = Number.isFinite(targetY)
            ? targetY + (Number(target?.colliderOffsetY) || 0)
            : (Number.isFinite(colliderY) ? colliderY : this.y);
        const targetZ = Number(target?.z);
        const colliderZ = Number(target?.collider?.bottomZ);
        const surfaceZ = Number.isFinite(targetZ) ? targetZ : (Number.isFinite(colliderZ) ? colliderZ : 0);
        return { x, y: physicalY - surfaceZ };
    }

    _footprintRadius() {
        return Math.max(
            12,
            Number(this.target?.collider?.radius)
                || Number(this.target?.groundRadius)
                || Number(this.target?.collisionRadius)
                || 22.5
        );
    }

    _strokeEllipseArc(g, radiusX, radiusY, amount) {
        const arcAmount = Math.max(0, Math.min(1, amount));
        if (arcAmount <= 0) return;
        const start = -Math.PI / 2;
        const steps = Math.max(2, Math.ceil(48 * arcAmount));
        g.beginPath();
        for (let i = 0; i <= steps; i++) {
            const angle = start + Math.PI * 2 * arcAmount * (i / steps);
            const px = Math.cos(angle) * radiusX;
            const py = Math.sin(angle) * radiusY;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.strokePath();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const chargeProgress = Math.max(0, Math.min(
            1,
            (Number(this.target?._sprintDuration) || 0) / this.readyMs
        ));
        const ready = this.target?._dashConvergeAuraActive === true;
        const radiusX = this._footprintRadius();
        const radiusY = radiusX * PERSPECTIVE_SCALE_Y;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y - 998);

        // 黄色光点从 footprint 外围收向椭圆边线，而不是堆到人物中心。
        this.particles.forEach(p => {
            const t = Math.max(0, Math.min(
                1,
                (chargeProgress - p.delayRatio) / (1 - p.delayRatio)
            ));
            if (t <= 0 || ready) return;
            const easeT = Easing.easeOutQuad(t);
            const targetX = Math.cos(p.targetAngle) * radiusX;
            const targetY = Math.sin(p.targetAngle) * radiusY;
            const sourceX = Math.cos(p.sourceAngle) * radiusX * p.sourceScale;
            const sourceY = Math.sin(p.sourceAngle) * radiusY * p.sourceScale;
            const px = sourceX + (targetX - sourceX) * easeT;
            const py = sourceY + (targetY - sourceY) * easeT;
            const trailT = Math.max(0, easeT - 0.12);
            const trailX = sourceX + (targetX - sourceX) * trailT;
            const trailY = sourceY + (targetY - sourceY) * trailT;
            const fadeIn = Math.min(1, t / 0.18);
            const alpha = fadeIn * (0.9 - t * 0.2);
            const size = p.size * (1 - t * 0.25);
            g.lineStyle(Math.max(1, size * 0.8), 0x9a5a00, alpha * 0.45);
            g.lineBetween(trailX, trailY, px, py);
            g.fillStyle(p.color.hex, alpha * 0.25);
            g.fillCircle(px, py, size * 2.4);
            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(px, py, size);
        });

        // 后半段逐步闭合 footprint；就绪后维持完整、带呼吸高光的金色环。
        const ringProgress = Easing.easeOutQuad(Math.max(0, Math.min(1, (chargeProgress - 0.42) / 0.58)));
        if (ringProgress > 0) {
            const pulse = ready ? 0.88 + Math.sin(this.phaseMs * 0.012) * 0.12 : 1;
            g.lineStyle(5, 0x6b3b00, 0.42 * ringProgress);
            this._strokeEllipseArc(g, radiusX, radiusY, ringProgress);
            g.lineStyle(3, 0xffbd24, 0.88 * ringProgress * pulse);
            this._strokeEllipseArc(g, radiusX, radiusY, ringProgress);
            g.lineStyle(1.2, 0xfff1a3, 0.95 * ringProgress * pulse);
            this._strokeEllipseArc(g, radiusX, radiusY, ringProgress);
        }

        if (ready) {
            const orbit = this.phaseMs * 0.0045;
            for (let i = 0; i < 4; i++) {
                const angle = orbit + i * Math.PI / 2;
                const px = Math.cos(angle) * radiusX;
                const py = Math.sin(angle) * radiusY;
                g.fillStyle(0xffd86b, 0.24);
                g.fillCircle(px, py, 5);
                g.fillStyle(0xffffd0, 0.95);
                g.fillCircle(px, py, 1.6);
            }
        }
    }

    getFogPosition() {
        return this.target ? { x: this.target.x, y: this.target.y } : { x: this.x, y: this.y };
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

for (const EffectType of [DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect, DashFireTrailEffect]) {
    EffectType.prototype.getFogVisuals = function getFogVisuals() {
        return this._graphics;
    };
}

export { DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect, DashFireTrailEffect };
