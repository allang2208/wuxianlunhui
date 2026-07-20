import { Input } from '../ui/input.js';
import { Entity } from './entity.js';
import { loadImage } from '../utils/image-loader.js';
import { RARITY_COLORS } from '../config/rarity.js';

        /**
         * 烘培带稀有度轮廓光晕的纹理（离屏 canvas，一次性生成缓存，渲染零开销）。
         * 替代 per-object filter（每掉落物一个渲染通道，数量多时严重掉帧）。
         * 光晕宽度按显示比例烘培：显示 48px 时约 10px 可见光晕，由深至浅向外渐变。
         */
        function bakeGlowTexture(phaserScene, image, rarity) {
            const keyBase = image.src || 'drop';
            const glowKey = 'dropglow_' + keyBase.replace(/[^a-zA-Z0-9]/g, '_') + '_' + (rarity || 'common');
            if (phaserScene.textures.exists(glowKey)) return glowKey;
            const BASE = 128, BLUR = 24, PAD = 28, PASSES = 5;
            const scale = BASE / Math.max(image.naturalWidth, image.naturalHeight);
            const w = Math.max(1, Math.round(image.naturalWidth * scale));
            const h = Math.max(1, Math.round(image.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w + PAD * 2;
            canvas.height = h + PAD * 2;
            const ctx = canvas.getContext('2d');
            // 多次叠画 shadowBlur 累积出浓郁外发光（由深至浅向外渐变）
            ctx.shadowColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
            ctx.shadowBlur = BLUR;
            for (let i = 0; i < PASSES; i++) ctx.drawImage(image, PAD, PAD, w, h);
            // 顶层原图：贴图本体清晰显示在光晕之上
            ctx.shadowBlur = 0;
            ctx.drawImage(image, PAD, PAD, w, h);
            phaserScene.textures.addImage(glowKey, canvas);
            return glowKey;
        }

        class DropItem extends Entity {
            constructor(x, y, itemData) {
                super(x, y);
                this.x = x; this.y = y; this.itemData = itemData || {};
                this.size = 0; this.active = true; this.life = Infinity;
                this.bobOffset = 0;
                // 金币使用新的动画贴图
                let imageSrc = 'assets/items/scroll.png';
                if (itemData.category === 'gold' || itemData.name === '金币') {
                    imageSrc = 'assets/items/gold_transparent_07.png';
                } else if (itemData.iconImage) {
                    imageSrc = itemData.iconImage;
                } else if (itemData.equipImage) {
                    // 所有装备一律使用持有的贴图（equipImage）
                    imageSrc = itemData.equipImage;
                } else if (itemData.dropImage) {
                    imageSrc = itemData.dropImage;
                }
                this.image = loadImage(imageSrc);
                this.pickupRange = 45;
                // 掉落物不参与实体间碰撞分离
                this.noCollision = true;
            }
            update(dt) {
                // 装备不随时间消失（life = Infinity）
                this.bobOffset += dt * 0.003;
                this._syncPhaserSprite();
                if (!this.active) this._destroyPhaserSprite();
            }
            _syncPhaserSprite() {
                const phaserScene = window.__phaserScene;
                if (!phaserScene || !phaserScene.dropItemsGroup) return;
                if (!this._phaserSprite || !this._phaserSprite.active) {
                    let key = 'drop_placeholder';
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) {
                        // 使用烘培的稀有度光晕纹理（替代 filter 实时渲染，解决卡顿+不明显）
                        key = bakeGlowTexture(phaserScene, this.image, this.itemData.rarity);
                    }
                    const sprite = phaserScene.add.sprite(this.x, this.y, key);
                    sprite.setOrigin(0.5, 0.5);
                    sprite.setDepth(this.y + 5);
                    phaserScene.dropItemsGroup.add(sprite);
                    // 掉落物不需要物理驱动，关闭自动移动减少开销
                    if (sprite.body) {
                        sprite.body.moves = false;
                        sprite.body.immovable = true;
                    }
                    const label = phaserScene.add.text(this.x, this.y + 20, '', {
                        fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
                        fontSize: '11px',
                        color: '#d4c5a9e6',
                        align: 'center'
                    });
                    label.setOrigin(0.5, 0);
                    label.setDepth(this.y + 6);
                    phaserScene.dropItemsGroup.add(label);
                    this._phaserSprite = sprite;
                    this._phaserLabel = label;
                }

                const bobY = Math.sin(this.bobOffset) * 4;
                const camera = phaserScene.cameras.main;
                const mx = Input.mouse.x + camera.scrollX;
                const my = Input.mouse.y + camera.scrollY;
                const hover = Math.sqrt((mx - this.x) ** 2 + (my - (this.y + bobY)) ** 2) < 52;
                // 贴图放大 50%：32→48，悬停 40→60；贴图保持上下浮动
                const size = hover ? 60 : 48;

                this._phaserSprite.setPosition(this.x, this.y + bobY);
                this._phaserSprite.setDepth(this.y + bobY + 5);
                this._phaserSprite.setDisplaySize(size, size);
                if (this._lastHover !== hover) {
                    this._lastHover = hover;
                    this._phaserSprite.setTint(hover ? 0xffffaa : 0xffffff);
                }
                const name = this.itemData.name || '';
                const labelText = hover ? `${name}\n[点击拾取]` : name;
                this._phaserLabel.setText(labelText);
                this._phaserLabel.setStyle({
                    fontSize: hover ? '13px' : '11px',
                    color: hover ? '#ffeb96' : '#d4c5a9e6'
                });
                // 装备文字固定在物品原始位置下方，不随贴图浮动
                this._phaserLabel.setPosition(this.x, this.y + 28);
                this._phaserLabel.setDepth(this.y + 11);
                this._phaserLabel.setVisible(true);
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

export { DropItem };
