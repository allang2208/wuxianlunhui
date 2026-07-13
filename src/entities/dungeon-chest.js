import { Entity } from './entity.js';
import { Game } from '../game.js';

/**
 * 地牢精英战斗奖励宝箱
 * 战斗结束后出现在场景中央，玩家靠近后自动打开
 */
export class DungeonChest extends Entity {
    constructor(x, y, options = {}) {
        super(x, y);
        this.x = x;
        this.y = y;
        this.openRange = options.openRange || 60;
        this.onOpen = options.onOpen || null;
        this.active = true;
        this.opened = false;
        this.name = '精英宝箱';
        this.bobOffset = Math.random() * Math.PI * 2;
        this.size = 0;
        this.hittable = false;
        this.noCollision = true;
    }

    update(dt) {
        if (!this.active) {
            this._destroyPhaserSprite();
            return;
        }
        this.bobOffset += dt * 0.003;
        this._syncPhaserSprite();
    }

    open() {
        if (this.opened) return;
        this.opened = true;
        this.active = false;
        if (typeof this.onOpen === 'function') {
            this.onOpen();
        }
        this._destroyPhaserSprite();
        if (Game && Game.entities) {
            Game.entities.delete('elite_chest');
        }
    }

    _syncPhaserSprite() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;

        if (!this._phaserSprite || !this._phaserSprite.active) {
            const sprite = phaserScene.add.text(this.x, this.y, '🎁', {
                fontSize: '40px',
                align: 'center'
            });
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(this.y);
            phaserScene.dropItemsGroup.add(sprite);

            const label = phaserScene.add.text(this.x, this.y + 28, '精英宝箱', {
                fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
                fontSize: '12px',
                color: '#d4c5a9e6',
                align: 'center'
            });
            label.setOrigin(0.5, 0);
            label.setDepth(this.y + 1);
            phaserScene.dropItemsGroup.add(label);

            this._phaserSprite = sprite;
            this._phaserLabel = label;
        }

        const bobY = Math.sin(this.bobOffset) * 4;
        this._phaserSprite.setPosition(this.x, this.y + bobY);
        this._phaserSprite.setDepth(this.y + bobY);
        this._phaserLabel.setPosition(this.x, this.y + bobY + 24);
        this._phaserLabel.setDepth(this.y + bobY + 1);
    }

    _destroyPhaserSprite() {
        if (this._phaserSprite) {
            this._phaserSprite.destroy();
            this._phaserSprite = null;
        }
        if (this._phaserLabel) {
            this._phaserLabel.destroy();
            this._phaserLabel = null;
        }
    }
}
