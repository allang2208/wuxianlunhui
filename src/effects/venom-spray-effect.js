import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * One-shot king-cobra venom cone. Damage is resolved by the enemy; this class is
 * visual-only and deliberately shares the same origin, direction, range and arc.
 */
class VenomSprayEffect {
    constructor({
        x,
        y,
        angle,
        perspective = false,
        range,
        arcDegrees,
        durationMs = 1000,
        particleCount = 84,
        colors = null,
        hazeColor = 0x6f1b92,
        coreColor = 0xc886eb,
    }) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.perspective = perspective === true;
        this.range = Math.max(1, Number(range) || 420);
        this.arc = Math.max(1, Number(arcDegrees) || 82) * Math.PI / 180;
        this.maxLife = Math.max(100, Number(durationMs) || 1000);
        this.life = this.maxLife;
        this.active = true;
        this._graphics = null;
        this._particles = [];
        this._colors = Array.isArray(colors) && colors.length > 0
            ? colors
            : [0x43105f, 0x641786, 0x8427ad, 0xa948d2, 0xc878ea, 0x783098];
        this._hazeColor = hazeColor;
        this._coreColor = coreColor;
        this._buildParticles(Math.max(1, Math.floor(Number(particleCount) || 84)));
        this._ensureGraphics();
    }

    _buildParticles(count) {
        for (let i = 0; i < count; i++) {
            const localAngle = (Math.random() - 0.5) * this.arc;
            const distance = this.range * (0.18 + Math.sqrt(Math.random()) * 0.82);
            const travelMs = 260 + Math.random() * 260;
            this._particles.push({
                angle: this.angle + localAngle,
                distance,
                travelMs,
                delay: Math.random() * 120,
                size: 4 + Math.random() * 9,
                hazeScale: 1.8 + Math.random() * 2.8,
                alpha: 0.35 + Math.random() * 0.35,
                color: this._colors[Math.floor(Math.random() * this._colors.length)],
                drift: (Math.random() - 0.5) * 14,
            });
        }
    }

    _ensureGraphics() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setBlendMode('NORMAL');
        this._graphics.setDepth(this.y + 46);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    getFogPosition() { return { x: this.x, y: this.y }; }
    getFogVisuals() { return this._graphics; }

    _projectY(value) {
        return value * (this.perspective ? PERSPECTIVE_SCALE_Y : 1);
    }

    update(dt = 16.67) {
        this.life = Math.max(0, this.life - Math.max(0, Number(dt) || 0));
        this._ensureGraphics();
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) {
                this._graphics.destroy();
                this._graphics = null;
            }
            return;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics?.active) return;
        const elapsed = this.maxLife - this.life;
        const globalFade = Math.min(1, elapsed / 120) * Math.min(1, this.life / 320);
        const g = this._graphics;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(this.y + 46);

        // A faint haze body keeps the particle field legible as a single cone.
        const left = this.angle - this.arc / 2;
        const right = this.angle + this.arc / 2;
        g.fillStyle(this._hazeColor, 0.055 * globalFade);
        g.beginPath();
        g.moveTo(this.x, this.y);
        g.lineTo(
            this.x + Math.cos(left) * this.range,
            this.y + this._projectY(Math.sin(left) * this.range)
        );
        for (let i = 1; i <= 12; i++) {
            const a = left + (right - left) * i / 12;
            g.lineTo(
                this.x + Math.cos(a) * this.range,
                this.y + this._projectY(Math.sin(a) * this.range)
            );
        }
        g.closePath();
        g.fillPath();

        for (const particle of this._particles) {
            const localElapsed = elapsed - particle.delay;
            if (localElapsed <= 0) continue;
            const travel = Math.min(1, localElapsed / particle.travelMs);
            const eased = 1 - (1 - travel) * (1 - travel);
            const settle = Math.max(0, localElapsed - particle.travelMs) / 1000;
            const dist = particle.distance * eased;
            const px = this.x + Math.cos(particle.angle) * dist
                + Math.cos(particle.angle + Math.PI / 2) * particle.drift * settle;
            const py = this.y + this._projectY(
                Math.sin(particle.angle) * dist
                    + Math.sin(particle.angle + Math.PI / 2) * particle.drift * settle
            ) - settle * 8;
            const alpha = particle.alpha * globalFade * (0.75 + 0.25 * (1 - travel));
            const size = particle.size * (0.65 + travel * 0.7 + settle * 0.25);
            g.fillStyle(particle.color, alpha * 0.18);
            g.fillCircle(px, py, size * particle.hazeScale);
            g.fillStyle(particle.color, alpha * 0.5);
            g.fillCircle(px, py, size * 1.55);
            g.fillStyle(this._coreColor, alpha * 0.75);
            g.fillCircle(px, py, Math.max(1.25, size * 0.52));
        }
    }
}

export { VenomSprayEffect };
