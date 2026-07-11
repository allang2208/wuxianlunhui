import { loadImage } from '../utils/image-loader.js';

class ShellCasingEffect {
    constructor(x, y, angle) {
        this.x = x; this.y = y; this.angle = angle;
        this.life = 800; this.maxLife = 800; this.active = true;
        if (!ShellCasingEffect._sharedImage) { ShellCasingEffect._sharedImage = loadImage('assets/ammo/shell_ground.png'); }
        this.image = ShellCasingEffect._sharedImage;
        this._sprite = null;
        this._initPhysics(angle);
        this._ensureSprite();
    }

    _initPhysics(angle) {
        const ejectAngle = angle + Math.PI * 0.7 + (Math.random() - 0.5) * 0.5;
        const speed = 156 + Math.random() * 124.8;
        this.vx = Math.cos(ejectAngle) * speed;
        this.vy = Math.sin(ejectAngle) * speed;
        this.rot = 0; this.rotSpeed = (Math.random() - 0.5) * 0.4;
        this.grounded = false;
        this.groundY = this.y + (Math.random() * 5);
    }

    reset(x, y, angle) {
        this.x = x; this.y = y; this.angle = angle;
        this.life = this.maxLife; this.active = true;
        this._initPhysics(angle);
        this._ensureSprite();
    }

    _ensureSprite() {
        const scene = window.__phaserScene;
        if (this._sprite || !scene) return;
        this._sprite = scene.add.image(this.x, this.y, 'shell_ground');
        this._sprite.setOrigin(0.5, 0.5);
        this._sprite.setDepth(this.y + 42);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._sprite);
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._sprite) { this._sprite.destroy(); this._sprite = null; }
            return;
        }
        if (!this.grounded) {
            this.x += this.vx * (dt / 1000); this.y += this.vy * (dt / 1000);
            this.vy += 10.8 * (dt / 1000);
            this.rot += this.rotSpeed;
            this.vx *= 0.98;
            if (this.y >= this.groundY) {
                this.grounded = true;
                this.y = this.groundY;
                this.vx *= 0.3;
            }
        }
        this._syncSprite();
    }

    _syncSprite() {
        if (!this._sprite || !this._sprite.active) return;
        const alpha = Math.min(1, this.life / 200);
        this._sprite.setPosition(this.x, this.y);
        this._sprite.setRotation(this.rot);
        this._sprite.setAlpha(alpha);
        this._sprite.setDepth(this.y + 42);
        this._sprite.setDisplaySize(12, 8);
        this._sprite.setVisible(true);
    }

    }

export { ShellCasingEffect };
