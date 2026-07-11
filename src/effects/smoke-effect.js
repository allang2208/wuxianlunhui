
class SmokeEffect {
    constructor(x, y, size = 60) {
        this.x = x; this.y = y; this.size = size;
        this.life = 3000; this.maxLife = 3000; this.active = true;
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 40);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const progress = 1 - this.life / this.maxLife;
        const currentSize = this.size * (0.4 + progress * 0.8);
        const alpha = 0.5 * (1 - progress);
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 40);
        // 多层同心圆模拟柔和烟雾
        g.fillStyle(0xaaaaaa, alpha * 0.2);
        g.fillCircle(0, 0, currentSize);
        g.fillStyle(0x999999, alpha * 0.25);
        g.fillCircle(0, 0, currentSize * 0.7);
        g.fillStyle(0x888888, alpha * 0.3);
        g.fillCircle(0, 0, currentSize * 0.4);
    }

    }

export { SmokeEffect };
