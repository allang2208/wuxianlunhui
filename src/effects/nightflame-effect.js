class NightFlameBeamEffect {
    constructor(x, y, angle, width, length, duration) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.width = width;
        this.length = length;
        this.duration = duration;
        this.life = duration;
        this.active = true;
        this._elapsed = 0;
        this._bodyGraphics = null;
        this._glowGraphics = null;
        this._renderDepth = null;

        // 固定随机参数，逐帧只推进位置，避免旧版每 100ms 生成一批直线造成闪烁和线条感。
        this._motes = Array.from({ length: 30 }, (_, index) => ({
            phase: index / 30 + Math.random() * 0.06,
            speed: 0.00016 + Math.random() * 0.0002,
            sway: 0.7 + Math.random() * 1.7,
            offset: (Math.random() - 0.5) * this.width * 0.92,
            size: 1.4 + Math.random() * 2.8,
            tone: Math.random(),
        }));
        this._wisps = Array.from({ length: 14 }, (_, index) => ({
            phase: index / 14 + Math.random() * 0.08,
            speed: 0.00008 + Math.random() * 0.00011,
            side: index % 2 === 0 ? -1 : 1,
            size: 4 + Math.random() * 7,
            sway: Math.random() * Math.PI * 2,
        }));
        this._ensureGraphics();
        this._redraw();
    }

    getFogVisuals() {
        return [this._bodyGraphics, this._glowGraphics];
    }

    setOrigin(x, y) {
        this.x = x;
        this.y = y;
        this._bodyGraphics?.setPosition(x, y);
        this._glowGraphics?.setPosition(x, y);
    }

    /**
     * 夜与火光柱必须盖住剑尖的发射接缝。深度由 GameScene 按当前
     * weaponSprite 每帧回写，不再用剑尖 y 猜测，避免左右/遮挡仲裁后掉到武器下层。
     */
    setDepth(depth) {
        if (!Number.isFinite(Number(depth))) return;
        this._renderDepth = Number(depth);
        this._bodyGraphics?.setDepth(this._renderDepth);
        this._glowGraphics?.setDepth(this._renderDepth + 0.01);
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (!scene || this._bodyGraphics || this._glowGraphics) return;
        this._bodyGraphics = scene.add.graphics();
        this._glowGraphics = scene.add.graphics();
        this._glowGraphics.setBlendMode('ADD');
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._bodyGraphics);
            scene.worldEffectsGroup.add(this._glowGraphics);
        }
    }

    _destroyGraphics() {
        if (this._bodyGraphics) this._bodyGraphics.destroy();
        if (this._glowGraphics) this._glowGraphics.destroy();
        this._bodyGraphics = null;
        this._glowGraphics = null;
    }

    update(dt = 16.67) {
        this.life -= dt;
        this._elapsed += dt;
        if (this.life <= 0) {
            this.active = false;
            this._destroyGraphics();
            return;
        }
        this._redraw();
    }

    _buildRibbon(length, halfWidth, phase, roughness = 0.1) {
        const steps = 18;
        const upper = [];
        const lower = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const middleSwell = Math.sin(t * Math.PI);
            const taper = 0.58 + middleSwell * 0.42;
            const flutter = 1 + Math.sin(phase + i * 1.47) * roughness;
            const centerShift = Math.sin(phase * 0.73 + i * 0.82)
                * halfWidth * roughness * (0.25 + middleSwell * 0.75);
            const w = halfWidth * taper * flutter;
            const px = length * t;
            upper.push({ x: px, y: centerShift - w });
            lower.push({ x: px, y: centerShift + w });
        }
        return upper.concat(lower.reverse());
    }

    _fillRibbon(graphics, length, halfWidth, color, alpha, phase, roughness) {
        if (alpha <= 0 || length <= 0) return;
        graphics.fillStyle(color, alpha);
        graphics.fillPoints(this._buildRibbon(length, halfWidth, phase, roughness), true);
    }

    _redraw() {
        const body = this._bodyGraphics;
        const glow = this._glowGraphics;
        if (!body || !glow || !body.active || !glow.active) return;

        const age = this.duration - this.life;
        const fadeIn = Math.min(1, age / 180);
        const fadeOut = Math.min(1, this.life / 380);
        const alpha = fadeIn * fadeOut;
        const growT = Math.min(1, age / 240);
        const growEase = 1 - Math.pow(1 - growT, 3);
        const visibleLength = this.length * growEase;
        const pulse = 0.88 + Math.sin(this._elapsed * 0.012) * 0.12;
        const phase = this._elapsed * 0.0055;
        const depth = Number.isFinite(this._renderDepth) ? this._renderDepth : this.y + 50;

        body.clear();
        glow.clear();
        for (const graphics of [body, glow]) {
            graphics.setPosition(this.x, this.y);
            graphics.setRotation(this.angle);
        }
        body.setDepth(depth);
        glow.setDepth(depth + 0.01);

        // 暗色承托与三层填充式柔光主体：只填面、不描边，保留直射方向但去掉“成排直线”。
        this._fillRibbon(body, visibleLength, this.width * 0.76, 0x07132f, 0.34 * alpha, phase, 0.12);
        this._fillRibbon(body, visibleLength, this.width * 0.5, 0x153f8f, 0.28 * alpha, phase + 1.1, 0.09);
        this._fillRibbon(glow, visibleLength, this.width * 1.18, 0x244dff, 0.09 * alpha * pulse, phase + 2.1, 0.14);
        this._fillRibbon(glow, visibleLength, this.width * 0.67, 0x3d8cff, 0.22 * alpha * pulse, phase + 0.7, 0.11);
        this._fillRibbon(glow, visibleLength, this.width * 0.28, 0x9cecff, 0.48 * alpha * pulse, phase + 1.7, 0.07);

        // 色块流：圆点沿光束向外推进，并在首尾自然淡出，借用雷枪的去线条化电流语言。
        for (const mote of this._motes) {
            const t = (mote.phase + this._elapsed * mote.speed) % 1;
            const px = this.length * t;
            if (px > visibleLength) continue;
            const edgeFade = Math.sin(t * Math.PI);
            const py = mote.offset * (0.45 + edgeFade * 0.55)
                + Math.sin(this._elapsed * 0.006 * mote.sway + mote.phase * 18) * this.width * 0.12;
            const moteAlpha = alpha * edgeFade * (0.42 + mote.tone * 0.38);
            const color = mote.tone > 0.7 ? 0xe3fbff : (mote.tone > 0.35 ? 0x7fdcff : 0x4e78ff);
            glow.fillStyle(color, moteAlpha * 0.34);
            glow.fillCircle(px, py, mote.size * 2.4);
            glow.fillStyle(color, moteAlpha);
            glow.fillCircle(px, py, mote.size);
        }

        // 蓝焰边缘不是细线，而是沿两侧流动、大小不一的柔软火舌色块。
        for (const wisp of this._wisps) {
            const t = (wisp.phase + this._elapsed * wisp.speed) % 1;
            const px = this.length * t;
            if (px > visibleLength) continue;
            const edgeFade = Math.sin(t * Math.PI);
            const py = wisp.side * this.width * (0.43 + edgeFade * 0.36)
                + Math.sin(this._elapsed * 0.004 + wisp.sway) * this.width * 0.16;
            const wispAlpha = alpha * edgeFade * 0.2;
            glow.fillStyle(0x3976ff, wispAlpha * 0.55);
            glow.fillCircle(px, py, wisp.size * 2.2);
            glow.fillStyle(0x69c8ff, wispAlpha);
            glow.fillCircle(px, py, wisp.size);
        }

        // 剑尖汇聚光团 + 射束末端散逸光团，强化“魔力从武器释放”而非画出一捆线。
        const sourceRadius = this.width * (0.38 + pulse * 0.08);
        glow.fillStyle(0x285dff, 0.2 * alpha);
        glow.fillCircle(0, 0, sourceRadius * 1.9);
        glow.fillStyle(0x62c6ff, 0.42 * alpha);
        glow.fillCircle(0, 0, sourceRadius);
        glow.fillStyle(0xe9fdff, 0.82 * alpha);
        glow.fillCircle(0, 0, sourceRadius * 0.34);

        const endRadius = this.width * (0.32 + pulse * 0.06);
        glow.fillStyle(0x315fff, 0.13 * alpha);
        glow.fillCircle(visibleLength, 0, endRadius * 2.2);
        glow.fillStyle(0x75d7ff, 0.34 * alpha);
        glow.fillCircle(visibleLength, 0, endRadius);
        glow.fillStyle(0xf2feff, 0.72 * alpha);
        glow.fillCircle(visibleLength, 0, endRadius * 0.28);
    }
}

export { NightFlameBeamEffect };
