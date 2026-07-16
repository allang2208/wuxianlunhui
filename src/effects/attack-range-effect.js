
class AttackRangeEffect {
    constructor(x, y, angle, range, width, type = 'line', duration = 200, alphaMul = 0.7, showStroke = true, backExtension = 0) {
        this.x = x; this.y = y; this.angle = angle; this.range = range; this.width = width;
        this.type = type; this.life = duration; this.maxLife = duration; this.active = true;
        this.alphaMul = alphaMul; this.showStroke = showStroke;
        this.backExtension = backExtension || 0;
        this._graphics = null;
        this._createPhaserGraphics();
    }

    _createPhaserGraphics() {
        const scene = window.__phaserScene;
        if (!scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 50);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            this._destroyPhaserGraphics();
            return;
        }
        this._redraw();
    }

    _destroyPhaserGraphics() {
        if (this._graphics) {
            this._graphics.destroy();
            this._graphics = null;
        }
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const fade = Math.min(1, this.life / (this.maxLife * 0.75)) * this.alphaMul;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 50);

        const fillAlpha = 0.35 * fade;
        const strokeAlpha = 0.8 * fade;
        g.fillStyle(0xff4444, fillAlpha);
        if (this.showStroke) g.lineStyle(2, 0xff6464, strokeAlpha);

        if (this.type === 'sector') {
            const halfArc = this.width / 2;
            g.beginPath();
            g.moveTo(0, 0);
            g.arc(0, 0, this.range, this.angle - halfArc, this.angle + halfArc);
            g.closePath();
            g.fillPath();
            if (this.showStroke) g.strokePath();
        } else if (this.type === 'triangle') {
            const halfW = this.width / 2;
            const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
            const perpX = -sin * halfW, perpY = cos * halfW;
            const backX = -cos * this.backExtension;
            const backY = -sin * this.backExtension;
            const v1x = backX + perpX, v1y = backY + perpY;
            const v2x = backX - perpX, v2y = backY - perpY;
            const v3x = cos * this.range - perpX, v3y = sin * this.range - perpY;
            const v4x = cos * this.range + perpX, v4y = sin * this.range + perpY;
            g.beginPath();
            g.moveTo(v1x, v1y);
            g.lineTo(v2x, v2y);
            g.lineTo(v3x, v3y);
            g.lineTo(v4x, v4y);
            g.closePath();
            g.fillPath();
            if (this.showStroke) g.strokePath();
        } else if (this.type === 'circle') {
            g.fillStyle(0xffffff, fillAlpha);
            g.fillCircle(0, 0, this.range);
            if (this.showStroke) {
                g.lineStyle(2, 0xffffff, strokeAlpha);
                g.strokeCircle(0, 0, this.range);
            }
        } else if (this.type === 'rect') {
            const hw = this.range / 2;
            const hh = this.width / 2;
            g.fillRect(-hw, -hh, this.range, this.width);
            if (this.showStroke) {
                g.lineStyle(2, 0xff6464, strokeAlpha);
                g.strokeRect(-hw, -hh, this.range, this.width);
            }
        } else {
            const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
            const ex = cos * this.range, ey = sin * this.range;
            const hw = this.width / 2;
            const perpX = -sin * hw, perpY = cos * hw;
            const backX = -cos * this.backExtension;
            const backY = -sin * this.backExtension;
            g.beginPath();
            g.moveTo(backX + perpX, backY + perpY);
            g.lineTo(ex + perpX, ey + perpY);
            g.lineTo(ex - perpX, ey - perpY);
            g.lineTo(backX - perpX, backY - perpY);
            g.closePath();
            g.fillPath();
            if (this.showStroke) g.strokePath();
        }
    }

    }

export { AttackRangeEffect };
