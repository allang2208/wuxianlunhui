function _parseHexColor(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return { r: 160, g: 255, b: 160, hex: 0xa0ffa0 };
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return { r, g, b, hex: (r << 16) | (g << 8) | b };
}

class PoisonEffect {
    constructor() {
        this.particles = [];
        this._graphics = null;
        this._x = 0;
        this._y = 0;
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this._y + 45);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    _destroyGraphics() {
        if (this._graphics) {
            this._graphics.destroy();
            this._graphics = null;
        }
    }

    _spawnParticle(x, y) {
        const colors = ['#4a8a3a', '#5a9a4a', '#3d7a2d', '#6aaa5a', '#2a6a1a', '#7aba6a', '#8aca7a', '#a0da8a'];
        const angle = Math.random() * Math.PI * 2;
        const speed = 6.24 + Math.random() * 9.36;
        this.particles.push({
            x: x + (Math.random() - 0.5) * 6,
            y: y + (Math.random() - 0.5) * 6,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.075,
            size: 1.5 + Math.random() * 1.5,
            color: _parseHexColor(colors[Math.floor(Math.random() * colors.length)]),
            life: 800 + Math.random() * 600,
            maxLife: 800 + Math.random() * 600,
            pulseOffset: Math.random() * Math.PI * 2
        });
    }

    update(dt, worldX, worldY) {
        this._x = worldX;
        this._y = worldY;
        this._ensureGraphics();
        if (Math.random() < 0.35) this._spawnParticle(worldX, worldY);
        if (Math.random() < 0.25) this._spawnParticle(worldX, worldY);

        this.particles.forEach(p => {
            p.life -= dt;
            p.x += p.vx * (dt / 1000);
            p.y += p.vy * (dt / 1000);
            p.size *= 0.997;
        });
        this.particles = this.particles.filter(p => p.life > 0);
        this._redraw();
        if (this.particles.length === 0 && !this._graphics) {
            // 保留 graphics 以便下一帧继续生成
        }
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const now = Date.now();
        const g = this._graphics;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(this._y + 45);
        this.particles.forEach(p => {
            const lifeRatio = p.life / p.maxLife;
            const fadeIn = Math.min(1, (1 - lifeRatio) * 3);
            const fadeOut = Math.min(1, lifeRatio * 2);
            const alpha = Math.min(fadeIn, fadeOut) * 0.6;
            const pulse = 1 + Math.sin(now * 0.004 + p.pulseOffset) * 0.2;
            const size = p.size * pulse;
            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(p.x, p.y, size);
            g.fillStyle(p.color.hex, alpha * 0.3);
            g.fillCircle(p.x, p.y, size * 2.5);
            g.fillStyle(p.color.hex, alpha * 0.12);
            g.fillCircle(p.x, p.y, size * 4);
            g.fillStyle(0xa0e8a0, alpha * 0.8);
            g.fillCircle(p.x, p.y, size * 0.4);
        });
    }

    
    reset() {
        this.particles = [];
        this._destroyGraphics();
    }
}

export { PoisonEffect };
