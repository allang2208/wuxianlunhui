import { loadImage } from '../utils/image-loader.js';

class MuzzleFlashEffect {
    constructor(x, y, angle, scale = 1.0) {
        this.x = x; this.y = y; this.angle = angle; this.scale = scale;
        this.life = 80; this.maxLife = 80; this.active = true;
        if (!MuzzleFlashEffect._sharedImage) { MuzzleFlashEffect._sharedImage = loadImage('assets/effects/muzzle_flash_01.png'); }
        this.image = MuzzleFlashEffect._sharedImage;
        this._sprite = null;
        this._createPhaserSprite();
    }

    reset(x, y, angle, scale = 1.0) {
        this.x = x; this.y = y; this.angle = angle; this.scale = scale;
        this.life = this.maxLife; this.active = true;
        this._syncSprite();
    }

    _createPhaserSprite() {
        const scene = window.__phaserScene;
        if (!scene) return;
        this._sprite = scene.add.image(this.x, this.y, 'muzzle_flash_01');
        this._sprite.setOrigin(0, 0.5);
        this._sprite.setDepth(this.y + 55);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._sprite);
        this._syncSprite();
    }

    _syncSprite() {
        if (!this._sprite || !this._sprite.active) return;
        const alpha = Math.max(0, this.life / this.maxLife);
        const s = 56 * (0.6 + alpha * 0.4) * this.scale;
        this._sprite.setPosition(this.x, this.y);
        this._sprite.setRotation(this.angle);
        this._sprite.setDisplaySize(s * 1.5, s * 0.7);
        this._sprite.setAlpha(alpha * 0.5);
        this._sprite.setDepth(this.y + 55);
        this._sprite.setVisible(true);
    }

    _destroyPhaserSprite() {
        if (this._sprite) {
            this._sprite.destroy();
            this._sprite = null;
        }
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            this._destroyPhaserSprite();
            return;
        }
        this._syncSprite();
    }

    }

export { MuzzleFlashEffect };
