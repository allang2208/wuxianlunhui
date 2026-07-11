import { WEAPON_ANIM } from '../config/math-utils.js';
import { loadImage } from '../utils/image-loader.js';

class ThrustEffect {
    constructor(source, range, width) {
        this.source = source; this.range = range || 100; this.width = width || 20;
        this.life = 350; this.maxLife = 350; this.active = true; this.progress = 0; this.speed = 18.72;
        if (!source || typeof source.x !== 'number' || typeof source.y !== 'number' || typeof source.rotation !== 'number') {
            console.warn('ThrustEffect: invalid source', source);
            this.active = false; this.source = { x: 0, y: 0, rotation: 0 };
        }
        if (!ThrustEffect._img) {
            ThrustEffect._img = loadImage('assets/icons/sword_hilt_icon.png');
        }
        this._mainSprite = null;
        this._trailSprites = [];
        this._ensureSprites();
    }

    _ensureSprites() {
        const scene = window.__phaserScene;
        if (!scene || this._mainSprite) return;
        this._mainSprite = scene.add.image(0, 0, 'sword_hilt_icon');
        this._mainSprite.setOrigin(0.5, 0.5);
        this._mainSprite.setDepth(this.source.y + 50);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._mainSprite);
        for (let i = 0; i < 3; i++) {
            const s = scene.add.image(0, 0, 'sword_hilt_icon');
            s.setOrigin(0.5, 0.5);
            s.setDepth(this.source.y + 49);
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(s);
            this._trailSprites.push(s);
        }
    }

    update(dt = 16.67) {
        this.life -= dt;
        this.progress += this.speed * (dt / 1000);
        if (this.progress > 1) this.progress = 1;
        if (this.life <= 0) {
            this.active = false;
            this._destroySprites();
            return;
        }
        this._syncSprites();
    }

    _destroySprites() {
        if (this._mainSprite) { this._mainSprite.destroy(); this._mainSprite = null; }
        this._trailSprites.forEach(s => s.destroy());
        this._trailSprites = [];
    }

    _syncSprites() {
        this._ensureSprites();
        if (!this._mainSprite || !this._mainSprite.active) return;
        const alpha = Math.min(1, this.life / 150);
        const src = this.source;
        const startDist = 20;
        const endDist = this.range * 0.8;
        const currentDist = startDist + (endDist - startDist) * this.progress;
        const s = WEAPON_ANIM.size;
        const size = s * 0.4 * (0.6 + this.progress * 0.4);

        const fx = src.x + Math.cos(src.rotation) * currentDist;
        const fy = src.y + Math.sin(src.rotation) * currentDist;
        this._mainSprite.setPosition(fx, fy);
        this._mainSprite.setRotation(src.rotation + Math.PI / 4);
        this._mainSprite.setDisplaySize(size, size);
        this._mainSprite.setAlpha(alpha);
        this._mainSprite.setDepth(fy + 50);

        this._trailSprites.forEach((sprite, i) => {
            const trailDist = currentDist - (i + 1) * 15;
            let visible = false;
            if (trailDist >= startDist) {
                const tx = src.x + Math.cos(src.rotation) * trailDist;
                const ty = src.y + Math.sin(src.rotation) * trailDist;
                const tSize = size * (1 - (i + 1) * 0.2);
                sprite.setPosition(tx, ty);
                sprite.setRotation(src.rotation + Math.PI / 4);
                sprite.setDisplaySize(tSize, tSize);
                sprite.setAlpha(alpha * (0.3 - (i + 1) * 0.08));
                sprite.setDepth(ty + 49);
                sprite.setVisible(true);
                visible = true;
            }
            if (!visible) sprite.setVisible(false);
        });
    }
}

export { ThrustEffect };
