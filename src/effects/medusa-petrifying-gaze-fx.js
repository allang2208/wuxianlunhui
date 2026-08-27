/**
 * 美杜莎石化凝视：从当前精灵眼部锚点展开、覆盖实际判定扇形的短时体积光。
 * 只负责视觉；range / arcDegrees 由技能配置同源传入，不参与命中结算。
 */
class MedusaPetrifyingGazeFx {
    constructor(source, options = {}) {
        this.source = source;
        this.angle = Number(options.angle) || 0;
        this.range = Math.max(1, Number(options.range) || 500);
        this.arcDegrees = Math.max(1, Number(options.arcDegrees) || 80);
        this.duration = Math.max(160, Number(options.durationMs) || 720);
        this.life = this.duration;
        this.active = true;
        this._elapsed = 0;
        this._forcedFadeDuration = 0;
        this._forcedFadeRemaining = 0;

        const visual = options.visual || {};
        const anchor = visual.eyeAnchor || {};
        this._eyeAnchorX = Number.isFinite(Number(anchor.x)) ? Number(anchor.x) : 0.455;
        this._eyeAnchorY = Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : 0.19;
        this._fadeInMs = Math.max(1, Number(visual.fadeInMs) || 90);
        this._fadeOutMs = Math.max(1, Number(visual.fadeOutMs) || 280);
        this._expandMs = Math.max(1, Number(visual.expandMs) || 120);
        this._bodyGraphics = null;
        this._glowGraphics = null;

        // 参数只创建一次，逐帧只推进相位，避免施法时产生跳闪和临时数组抖动。
        this._motes = Array.from({ length: 18 }, (_, index) => ({
            radial: 0.12 + (index / 18) * 0.84,
            angular: (Math.random() - 0.5) * 0.82,
            phase: Math.random() * Math.PI * 2,
            speed: 0.002 + Math.random() * 0.0025,
            size: 1.2 + Math.random() * 2.1,
        }));

        this._ensureGraphics();
        this._redraw();
    }

    getFogVisuals() {
        return [this._bodyGraphics, this._glowGraphics];
    }

    requestFadeOut(durationMs = 140) {
        if (!this.active) return;
        const duration = Math.max(1, Number(durationMs) || 140);
        if (this._forcedFadeRemaining > 0 && this._forcedFadeRemaining <= duration) return;
        this._forcedFadeDuration = duration;
        this._forcedFadeRemaining = duration;
    }

    update(dt = 16.67) {
        const step = Math.max(0, Number(dt) || 0);
        this._elapsed += step;
        this.life = Math.max(0, this.life - step);

        if ((!this.source || this.source.active === false || this.source._isDead)
            && this._forcedFadeRemaining <= 0) {
            this.requestFadeOut(120);
        }
        if (this._forcedFadeRemaining > 0) {
            this._forcedFadeRemaining = Math.max(0, this._forcedFadeRemaining - step);
        }
        if (this.life <= 0
            || (this._forcedFadeDuration > 0 && this._forcedFadeRemaining <= 0)) {
            this.destroy();
            return;
        }

        this._ensureGraphics();
        this._redraw();
    }

    _ensureGraphics() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || this._bodyGraphics || this._glowGraphics) return;
        this._bodyGraphics = scene.add.graphics();
        this._glowGraphics = scene.add.graphics();
        this._glowGraphics.setBlendMode('ADD');
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._bodyGraphics);
            scene.worldEffectsGroup.add(this._glowGraphics);
        }
    }

    _eyeWorldPosition() {
        const sprite = this.source?._phaserSprite;
        if (sprite?.active) {
            const originX = Number.isFinite(Number(sprite.originX)) ? Number(sprite.originX) : 0.5;
            const originY = Number.isFinite(Number(sprite.originY)) ? Number(sprite.originY) : 0.5;
            let localX = (this._eyeAnchorX - originX) * (Number(sprite.displayWidth) || 220);
            if (sprite.flipX) localX = -localX;
            return {
                x: sprite.x + localX,
                y: sprite.y + (this._eyeAnchorY - originY) * (Number(sprite.displayHeight) || 220),
                depth: (Number(sprite.depth) || 0) + 0.02,
            };
        }
        return {
            x: (this.source?.collider?.x ?? this.source?.x ?? 0) + Math.cos(this.angle) * 8,
            y: (this.source?.collider?.y ?? this.source?.y ?? 0) - 160,
            depth: (Number(this.source?.y) || 0) + 0.02,
        };
    }

    _sectorPoints(length, halfArc, segments = 26) {
        const points = [{ x: 0, y: 0 }];
        for (let i = 0; i <= segments; i++) {
            const a = -halfArc + (halfArc * 2 * i / segments);
            points.push({ x: Math.cos(a) * length, y: Math.sin(a) * length });
        }
        return points;
    }

    _fillSector(graphics, length, halfArc, color, alpha) {
        if (!graphics || alpha <= 0 || length <= 0) return;
        graphics.fillStyle(color, alpha);
        graphics.fillPoints(this._sectorPoints(length, halfArc), true);
    }

    _redraw() {
        const body = this._bodyGraphics;
        const glow = this._glowGraphics;
        if (!body?.active || !glow?.active) return;

        const origin = this._eyeWorldPosition();
        const fadeIn = Math.min(1, this._elapsed / this._fadeInMs);
        const naturalFade = Math.min(1, this.life / this._fadeOutMs);
        const forcedFade = this._forcedFadeDuration > 0
            ? Math.min(1, this._forcedFadeRemaining / this._forcedFadeDuration)
            : 1;
        const alpha = fadeIn * naturalFade * forcedFade;
        const growT = Math.min(1, this._elapsed / this._expandMs);
        const visibleLength = this.range * (1 - Math.pow(1 - growT, 3));
        const halfArc = this.arcDegrees * Math.PI / 360;
        const pulse = 0.92 + Math.sin(this._elapsed * 0.018) * 0.08;

        body.clear();
        glow.clear();
        for (const graphics of [body, glow]) {
            graphics.setPosition(origin.x, origin.y);
            graphics.setRotation(this.angle);
            graphics.setVisible(true);
        }
        body.setDepth(origin.depth);
        glow.setDepth(origin.depth + 0.01);

        // 最外层严格覆盖技能的完整 arcDegrees；向内叠加柔光，形成手电筒式体积锥。
        this._fillSector(body, visibleLength, halfArc, 0x172018, 0.18 * alpha);
        this._fillSector(body, visibleLength, halfArc * 0.94, 0x536341, 0.10 * alpha);
        this._fillSector(glow, visibleLength, halfArc, 0x91ad5e, 0.07 * alpha * pulse);
        this._fillSector(glow, visibleLength, halfArc * 0.82, 0xc9e783, 0.10 * alpha * pulse);
        this._fillSector(glow, visibleLength, halfArc * 0.56, 0xeaffb3, 0.13 * alpha * pulse);
        this._fillSector(glow, visibleLength, halfArc * 0.28, 0xf7ffe0, 0.16 * alpha * pulse);

        // 锥光中的稀疏漂尘只用色块，强化空气被照亮的感觉，不画边界线。
        for (const mote of this._motes) {
            const radial = (mote.radial + this._elapsed * 0.000035) % 0.94;
            const distance = visibleLength * radial;
            const moteAngle = halfArc * mote.angular
                + Math.sin(this._elapsed * mote.speed + mote.phase) * halfArc * 0.035;
            const edgeFade = Math.sin(Math.min(1, radial) * Math.PI);
            const moteAlpha = alpha * edgeFade * 0.28;
            glow.fillStyle(0xedffc6, moteAlpha * 0.35);
            glow.fillCircle(
                Math.cos(moteAngle) * distance,
                Math.sin(moteAngle) * distance,
                mote.size * 2.2
            );
            glow.fillStyle(0xfbffe8, moteAlpha);
            glow.fillCircle(
                Math.cos(moteAngle) * distance,
                Math.sin(moteAngle) * distance,
                mote.size
            );
        }

        // 两个眼点是光源，外层辉光把双点自然融合成同一个扇形照射口。
        const eyeSeparation = 2.4;
        for (const eyeY of [-eyeSeparation, eyeSeparation]) {
            glow.fillStyle(0xb9e66f, 0.28 * alpha);
            glow.fillCircle(0, eyeY, 8.5 * pulse);
            glow.fillStyle(0xeaffae, 0.62 * alpha);
            glow.fillCircle(0, eyeY, 4.2 * pulse);
            glow.fillStyle(0xffffff, 0.92 * alpha);
            glow.fillCircle(0, eyeY, 1.7 * pulse);
        }
    }

    destroy() {
        if (this._bodyGraphics?.active) this._bodyGraphics.destroy();
        if (this._glowGraphics?.active) this._glowGraphics.destroy();
        this._bodyGraphics = null;
        this._glowGraphics = null;
        this.active = false;
    }
}

export { MedusaPetrifyingGazeFx };
