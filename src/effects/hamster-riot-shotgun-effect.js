/**
 * 仓鼠防暴队霰弹开火特效。
 * 纯视觉：短促枪口闪光 + 45° 内散射火花，不创建弹道、不参与命中结算。
 */
export class HamsterRiotShotgunEffect {
    constructor(options = {}) {
        this.x = Number(options.x) || 0;
        this.y = Number(options.y) || 0;
        this.fogX = Number(options.fogX) || this.x;
        this.fogY = Number(options.fogY) || this.y;
        this.angle = Number(options.angle) || 0;
        this.range = Math.min(300, Math.max(1, Number(options.range) || 300));
        this.arc = Math.max(1, Number(options.arcDegrees) || 45) * Math.PI / 180;
        this.maxLife = Math.max(120, Number(options.durationMs) || 240);
        this.life = this.maxLife;
        this.depth = Number.isFinite(options.depth) ? options.depth : null;
        this.active = true;
        this._graphics = null;
        this._sparks = [];
        this._buildSparks(Math.max(8, Math.floor(Number(options.sparkCount) || 30)));
        this._ensureGraphics();
    }

    _buildSparks(count) {
        const colors = [0xfff4c4, 0xffd36b, 0xffa12e, 0xff6d1f];
        for (let index = 0; index < count; index++) {
            const localAngle = (Math.random() - 0.5) * this.arc;
            this._sparks.push({
                angle: this.angle + localAngle,
                distance: this.range * (0.22 + Math.pow(Math.random(), 0.72) * 0.78),
                travelMs: 85 + Math.random() * 95,
                delayMs: Math.random() * 34,
                tail: 7 + Math.random() * 18,
                width: 0.8 + Math.random() * 1.45,
                alpha: 0.62 + Math.random() * 0.34,
                color: colors[index % colors.length],
            });
        }
    }

    _effectDepth() {
        if (Number.isFinite(this.depth)) return this.depth;
        const naturalDepth = this.fogY + 60;
        const wallSystem = typeof window !== 'undefined' ? window.WallSystem : null;
        return wallSystem?.junctionCorrectedDepth
            ? wallSystem.junctionCorrectedDepth(this.fogX, this.fogY, naturalDepth)
            : naturalDepth;
    }

    _ensureGraphics() {
        if (this._graphics && !this._graphics.active) this._graphics = null;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (this._graphics || !scene?.add) return;
        this._graphics = scene.add.graphics();
        this._graphics.setBlendMode('ADD');
        this._graphics.setDepth(this._effectDepth());
        scene.worldEffectsGroup?.add(this._graphics);
    }

    getFogPosition() {
        return { x: this.fogX, y: this.fogY };
    }

    getFogVisuals() {
        return this._graphics;
    }

    update(dt = 16.67) {
        this.life = Math.max(0, this.life - Math.max(0, Number(dt) || 0));
        this._ensureGraphics();
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics?.active) this._graphics.destroy();
            this._graphics = null;
            return;
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics?.active) return;
        const elapsed = this.maxLife - this.life;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this._effectDepth());

        // 枪口仅在释放初段爆亮；不绘制持续射线或扇区填充面。
        const flash = Math.max(0, 1 - elapsed / 95);
        if (flash > 0) {
            const forwardX = Math.cos(this.angle);
            const forwardY = Math.sin(this.angle);
            g.fillStyle(0xff9a27, 0.28 * flash);
            g.fillCircle(0, 0, 18 + (1 - flash) * 8);
            g.fillStyle(0xffe6a0, 0.82 * flash);
            g.fillCircle(0, 0, 7 + (1 - flash) * 5);
            g.lineStyle(3.2, 0xffffdd, 0.92 * flash);
            g.lineBetween(-forwardX * 3, -forwardY * 3, forwardX * 28, forwardY * 28);
            g.lineStyle(1.4, 0xffb13c, 0.75 * flash);
            const sideX = -forwardY;
            const sideY = forwardX;
            g.lineBetween(-sideX * 12, -sideY * 12, sideX * 12, sideY * 12);
        }

        for (const spark of this._sparks) {
            const localElapsed = elapsed - spark.delayMs;
            if (localElapsed <= 0 || localElapsed >= spark.travelMs) continue;
            const progress = Math.min(1, localElapsed / spark.travelMs);
            const eased = 1 - Math.pow(1 - progress, 2.25);
            const distance = spark.distance * eased;
            const tailDistance = Math.min(spark.tail, distance);
            const cos = Math.cos(spark.angle);
            const sin = Math.sin(spark.angle);
            const headX = cos * distance;
            const headY = sin * distance;
            const tailX = cos * Math.max(0, distance - tailDistance);
            const tailY = sin * Math.max(0, distance - tailDistance);
            const alpha = spark.alpha * Math.pow(1 - progress, 0.72);
            g.lineStyle(spark.width, spark.color, alpha);
            g.lineBetween(tailX, tailY, headX, headY);
            g.fillStyle(0xffffd8, alpha * 0.88);
            g.fillCircle(headX, headY, Math.max(0.7, spark.width * 0.72));
        }
    }
}
