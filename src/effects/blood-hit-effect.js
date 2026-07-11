
function _parseHexColor(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return { r: 180, g: 30, b: 30, hex: 0xb41e1e };
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return { r, g, b, hex: (r << 16) | (g << 8) | b };
}

class BloodHitEffect {
    constructor(x, y, angle = null) {
        this.x = x; this.y = y;
        this.life = 600; this.maxLife = 600; this.active = true;
        this.particles = [];
        const particleCount = 12 + Math.floor(Math.random() * 8);
        for (let i = 0; i < particleCount; i++) {
            const pAngle = (angle !== null)
                ? angle + (Math.random() - 0.5) * Math.PI * 0.6
                : Math.random() * Math.PI * 2;
            const speed = 93.6 + Math.random() * 218.4;
            const size = 2 + Math.random() * 4;
            const upwardOffset = (angle !== null) ? 0 : -1.5;
            this.particles.push({
                x: 0, y: 0,
                vx: Math.cos(pAngle) * speed,
                vy: Math.sin(pAngle) * speed + upwardOffset,
                size: size,
                color: this._randomBloodColor(),
                life: 400 + Math.random() * 200,
                maxLife: 400 + Math.random() * 200,
                gravity: 0.08 + Math.random() * 0.05
            });
        }
        this.splash = { size: 8 + Math.random() * 6, life: 200, maxLife: 200 };
        this._graphics = null;
        this._ensureGraphics();
    }

    _randomBloodColor() {
        const colors = [
            '#8a1c1c', '#a02020', '#b83030', '#c04040',
            '#7a1515', '#9a2525', '#d03535', '#e84545'
        ];
        return _parseHexColor(colors[Math.floor(Math.random() * colors.length)]);
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 46);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.splash.life -= dt;
        this.particles.forEach(p => {
            p.life -= dt;
            p.x += p.vx * (dt / 1000);
            p.y += p.vy * (dt / 1000);
            p.vy += p.gravity;
            p.vx *= 0.96;
            p.size *= 0.995;
        });
        this.particles = this.particles.filter(p => p.life > 0);
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 46);

        if (this.splash.life > 0) {
            const splashAlpha = Math.min(1, this.splash.life / 100);
            const splashSize = this.splash.size * (1 + (1 - this.splash.life / this.splash.maxLife) * 0.5);
            g.fillStyle(0xb41e1e, splashAlpha);
            g.fillCircle(0, 0, splashSize);
            g.lineStyle(1.5, 0xdc3c3c, splashAlpha * 0.5);
            g.strokeCircle(0, 0, splashSize);
        }

        this.particles.forEach(p => {
            const alpha = Math.min(1, p.life / 150);
            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(p.x, p.y, p.size);
            if (p.size > 3) {
                g.fillStyle(0xa01414, alpha * 0.5);
                g.fillCircle(p.x - p.vx * 1.5, p.y - p.vy * 1.5, p.size * 0.6);
            }
        });
    }

    }

const _HitEffect = BloodHitEffect;

export { BloodHitEffect };
