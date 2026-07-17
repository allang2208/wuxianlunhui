import { loadImage } from '../utils/image-loader.js';

class ShellCasingEffect {
    /**
     * @param {number} x 弹出位置 X（枪械贴图中心）
     * @param {number} y 弹出位置 Y（枪械贴图中心，视觉身体高度）
     * @param {number} angle 开火方向（决定向后的抛壳方向）
     * @param {number} [groundY] 落地的脚底 Y（不传则退化为旧行为：出生高度 + 随机少量）
     */
    constructor(x, y, angle, groundY) {
        this.x = x; this.y = y; this.angle = angle;
        this.life = 800; this.maxLife = 800; this.active = true;
        if (!ShellCasingEffect._sharedImage) { ShellCasingEffect._sharedImage = loadImage('assets/ammo/shell_ground.png'); }
        this.image = ShellCasingEffect._sharedImage;
        this._sprite = null;
        this._initPhysics(angle, groundY);
        this._ensureSprite();
    }

    _initPhysics(angle, groundY) {
        // 抛壳方向：开火方向的后方（带随机散布）
        const ejectAngle = angle + Math.PI * 0.7 + (Math.random() - 0.5) * 0.5;
        const speed = 156 + Math.random() * 124.8;
        this.vx = Math.cos(ejectAngle) * speed;
        if (groundY !== undefined) {
            // 从枪械贴图中心弹出：先向上抛起，再受重力落到脚下
            this.vy = -(120 + Math.random() * 80);
            this.gravity = 1000;
            this.groundY = groundY + (Math.random() * 4);
        } else {
            // 旧行为（无贴图中心/落地参数时的回退）：贴地漂移
            this.vy = Math.sin(ejectAngle) * speed;
            this.gravity = 10.8;
            this.groundY = this.y + (Math.random() * 5);
        }
        this.rot = 0; this.rotSpeed = (Math.random() - 0.5) * 0.4;
        this.grounded = false;
    }

    reset(x, y, angle, groundY) {
        this.x = x; this.y = y; this.angle = angle;
        this.life = this.maxLife; this.active = true;
        this._initPhysics(angle, groundY);
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
            this.vy += this.gravity * (dt / 1000);
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
