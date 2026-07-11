function _parseHexColor(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return { r: 160, g: 255, b: 255, hex: 0xa0ffff };
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return { r, g, b, hex: (r << 16) | (g << 8) | b };
}

export class WeaponEffect {
    constructor() {
        this.particles = [];
        this._glowLastState = false;
        this._glowTransitionStart = 0;
        this._graphics = null;
        this._hiltX = 0;
        this._hiltY = 0;
        this._rotation = 0;
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this._hiltY + 55);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    _destroyGraphics() {
        if (this._graphics) {
            this._graphics.destroy();
            this._graphics = null;
        }
    }

    _spawnWeaponGlowParticle(params) {
        const colors = ['#4a9eff', '#5bb8ff', '#6ec8ff', '#3d8bfa', '#2a7af5', '#7ad0ff', '#a0e0ff', '#5599ff'];
        const hiltX = (Math.random() - 0.5) * 4;
        const hiltY = (Math.random() - 0.5) * 4;
        const theta = params.rotation;
        const floatSpeed = 46.8 + Math.random() * 31.2;
        const cosA = -Math.sin(theta);
        const sinA = -Math.cos(theta);
        let pvx, pvy;
        if (params.isMoving) {
            const mouseWorld = params.screenToWorld(params.mouseX, params.mouseY);
            const dx = mouseWorld.x - params.x;
            const dy = mouseWorld.y - params.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
                const baseAngle = Math.atan2(-dy, -dx);
                const randomOffset = (Math.random() - 0.5) * (Math.PI / 6);
                const finalAngle = baseAngle + randomOffset;
                const wx = Math.cos(finalAngle);
                const wy = Math.sin(finalAngle);
                pvx = (wx * cosA - wy * sinA) * floatSpeed;
                pvy = (wx * sinA + wy * cosA) * floatSpeed;
            } else {
                pvx = -sinA * floatSpeed;
                pvy = -cosA * floatSpeed;
            }
        } else {
            const angle = Math.random() * Math.PI * 2;
            const wx = Math.cos(angle);
            const wy = Math.sin(angle);
            pvx = (wx * cosA - wy * sinA) * floatSpeed;
            pvy = (wx * sinA + wy * cosA) * floatSpeed;
        }
        this.particles.push({
            x: hiltX,
            y: hiltY,
            vx: pvx,
            vy: pvy,
            size: 0.3 + Math.random() * 0.2,
            color: _parseHexColor(colors[Math.floor(Math.random() * colors.length)]),
            life: 1200 + Math.random() * 600,
            maxLife: 1200 + Math.random() * 600,
            pulseOffset: Math.random() * Math.PI * 2,
            createdAt: Date.now()
        });
    }

    update(dt = 16.67, params) {
        const now = Date.now();
        if (typeof dt === 'object' && params === undefined) {
            params = dt;
            dt = params.dt || 16.67;
        }
        const { isMoving, isInCombat, hiltX, hiltY, rotation } = params || {};
        this._hiltX = hiltX || params.x || 0;
        this._hiltY = hiltY || params.y || 0;
        this._rotation = rotation || 0;
        this._ensureGraphics();

        if (this._glowLastState !== isMoving) {
            this._glowTransitionStart = now;
            this._glowLastState = isMoving;
        }

        const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;

        if (!isInCombat) {
            if (!isMoving) {
                if (Math.random() < 0.9) {
                    this._spawnWeaponGlowParticle(params);
                    this._spawnWeaponGlowParticle(params);
                }
            } else {
                if (Math.random() < 0.9) this._spawnWeaponGlowParticle(params);
            }
        } else {
            if (Math.random() < 0.3) this._spawnWeaponGlowParticle(params);
        }

        this.particles.forEach(p => {
            p.life -= dt;
            p.y += p.vy * (dt / 1000);
            p.x += p.vx * (dt / 1000);
            p.size *= 0.998;
        });

        if (this._glowTransitionStart > 0 && transitionElapsed > 1000) {
            this.particles = this.particles.filter(p => p.createdAt >= this._glowTransitionStart);
            this._glowTransitionStart = 0;
        } else {
            this.particles = this.particles.filter(p => p.life > 0);
        }

        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const now = Date.now();
        const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;
        const transitionRatio = Math.min(1, transitionElapsed / 1000);
        const oldLifeFactor = Math.max(0.2, 1 - 0.8 * transitionRatio);
        const g = this._graphics;
        g.clear();
        g.setPosition(this._hiltX, this._hiltY);
        g.setDepth(this._hiltY + 55);
        g.setRotation(this._rotation + Math.PI / 2);

        this.particles.forEach(p => {
            const isOld = this._glowTransitionStart > 0 && p.createdAt < this._glowTransitionStart;
            let lifeRatio = p.life / p.maxLife;
            if (isOld && transitionElapsed <= 1000) {
                lifeRatio = lifeRatio * oldLifeFactor;
            }
            const fadeIn = Math.min(1, (1 - lifeRatio) * 3);
            const fadeOut = Math.min(1, lifeRatio * 2);
            const alpha = Math.min(fadeIn, fadeOut) * 0.75;
            const pulse = 1 + Math.sin(now * 0.003 + p.pulseOffset) * 0.15;
            const size = p.size * pulse;

            g.fillStyle(p.color.hex, alpha);
            g.fillCircle(p.x, p.y, size);
            g.fillStyle(p.color.hex, alpha * 0.35);
            g.fillEllipse(p.x, p.y - size * 0.5, size * 1.8, size * 2.8);
            g.fillStyle(p.color.hex, alpha * 0.15);
            g.fillCircle(p.x, p.y, size * 3.5);
            g.fillStyle(0xe0f0ff, alpha * 0.9);
            g.fillCircle(p.x, p.y, size * 0.3);
        });
    }

    reset() {
        this.particles = [];
        this._glowLastState = false;
        this._glowTransitionStart = 0;
        this._destroyGraphics();
    }
}
