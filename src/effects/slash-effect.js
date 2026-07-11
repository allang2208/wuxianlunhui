
function _hexToRgbObj(hex) {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return { r, g, b, hex };
}

class SlashEffect {
    constructor(x, y, angle, range, arc) {
        this.x = x; this.y = y; this.angle = angle; this.range = range; this.arc = arc;
        this.life = 350; this.maxLife = 350; this.active = true;
        this.startAngle = angle - arc / 2; this.endAngle = angle + arc / 2;
        this.currentAngle = this.startAngle;
        this.swingSpeed = arc * 26;
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 50);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.currentAngle < this.endAngle) {
            this.currentAngle += this.swingSpeed * (dt / 1000);
            if (this.currentAngle > this.endAngle) this.currentAngle = this.endAngle;
        }
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const alpha = Math.min(1, this.life / 200);
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 50);

        const currentSweep = this.currentAngle - this.startAngle;
        if (currentSweep <= 0) return;

        // 用多层同心圆弧模拟径向渐变
        const rings = [
            { r: this.range * 0.05, color: 0xffffff, a: alpha * 0.7 },
            { r: this.range * 0.2, color: 0xe6d2b4, a: alpha * 0.5 },
            { r: this.range * 0.6, color: 0xd4c5a9, a: alpha * 0.2 },
            { r: this.range, color: 0xd4c5a9, a: 0 }
        ];
        for (let i = rings.length - 1; i >= 0; i--) {
            const ring = rings[i];
            g.fillStyle(ring.color, ring.a);
            g.beginPath();
            g.moveTo(0, 0);
            g.arc(0, 0, ring.r, this.startAngle, this.currentAngle);
            g.closePath();
            g.fillPath();
        }

        // 扇形边缘高光
        g.lineStyle(2.5, 0xffffff, alpha * 0.5);
        g.beginPath();
        g.arc(0, 0, this.range, this.startAngle, this.currentAngle);
        g.strokePath();

        // 两侧边缘线
        g.lineStyle(1.5, 0xe6d2b4, alpha * 0.4);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(this.startAngle) * this.range, Math.sin(this.startAngle) * this.range);
        g.moveTo(0, 0);
        g.lineTo(Math.cos(this.currentAngle) * this.range, Math.sin(this.currentAngle) * this.range);
        g.strokePath();
    }
}

export { SlashEffect };
