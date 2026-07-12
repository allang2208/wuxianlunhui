import { WallSystem } from '../world/wall-system.js';
import { DamagePipeline } from './damage-pipeline.js';

        class Projectile {
            constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false, isGold = false, isDarkGold = false, damageType = 'physical', _noRender = false, isGreen = false, isSpit = false) {
                this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
                this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
                this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
                this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
                this.isSpit = isSpit || false; // 是否为毒液投射物（SpitterZombie）
                this.isGold = isGold; // 是否为亮金色曳光弹（PKM）
                this.isDarkGold = isDarkGold; // 是否为深黄色曳光弹（沙漠之鹰）
                this.isGreen = isGreen; // 是否为亮绿色曳光弹（能量轻机枪）
                this.damageType = damageType; // 伤害类型：physical 或 magic
                this._noRender = _noRender;
                this._createPhaserSprite();
            }
            update(dt = 16.67) {
                const scale = dt / 1000;
                const dx = Math.cos(this.angle) * this.speed * scale, dy = Math.sin(this.angle) * this.speed * scale;
                const prevX = this.x, prevY = this.y;
                this.x += dx; this.y += dy; this.traveled += this.speed * scale;
                if (this.traveled >= this.maxRange) {
                    this.active = false;
                } else if (WallSystem && WallSystem.blocked && WallSystem.blocked(prevX, prevY, this.x, this.y)) {
                    // 墙壁碰撞检测
                    this.active = false;
                } else {
                    // 清理已失效目标的命中记录
                    for (const target of Array.from(this.hitTargets)) {
                        if (!target.active) {
                            this.hitTargets.delete(target);
                        }
                    }
                    // 实体碰撞检测（this.entities 是 Map，需遍历 .values()）
                    const entityList = Array.from(this.entities.values());
                    for (const entity of entityList) {
                        if (entity === this.source || !entity.active || !entity.hittable || this.hitTargets.has(entity)) continue;
                        const dist = Math.sqrt((entity.x - this.x) ** 2 + (entity.y - this.y) ** 2);
                        if (dist < (entity.collisionRadius || 12) + this.size) {
                            // 友军伤害免疫：子弹穿透同阵营目标
                            if (this.source && this.source._faction && entity._faction && this.source._faction === entity._faction) {
                                continue;
                            }
                            this.hitTargets.add(entity);
                            const damage = typeof this.damage === 'object' ? Math.floor(this.damage.min + Math.random() * (this.damage.max - this.damage.min + 1)) : this.damage;
                            // 毒液投射物：命中后给目标加一层中毒
                            if (this.isSpit && typeof entity.applyPoison === 'function') {
                                entity.applyPoison(1);
                            }
                            const weapon = this.source ? (this.source.getCurrentWeapon ? this.source.getCurrentWeapon() : (this.source.equipments && this.source.weaponMode ? this.source.equipments[this.source.weaponMode] : null)) : null;
                            DamagePipeline.applyHit(this.source, entity, {
                                damage,
                                damageType: this.damageType || 'ranged',
                                currentWeapon: weapon
                            });
                            if (this.piercing) { this.piercing--; if (this.piercing < 0) this.active = false; }
                            else { this.active = false; }
                            if (!this.active) break;
                        }
                    }
                }
                this._updatePhaserSprite();
                if (!this.active) this._destroyPhaserSprite();
            }
            _getProjectileTextureKey() {
                if (this.isSpit) return 'projectile_spit';
                if (this.isGreen || this.isGold || this.isDarkGold || this.isTracer) return 'projectile_tracer';
                if (this.image) return 'projectile_arrow';
                return 'projectile_bullet';
            }

            _getProjectileTint() {
                if (this.isSpit) return 0x00ff00;
                if (this.isGreen) return 0xa0ffc0;
                if (this.isGold) return 0xfff8a0;
                if (this.isDarkGold) return 0xffd040;
                if (this.isTracer) return 0xffe8a0;
                return undefined;
            }

            _createPhaserSprite() {
                const phaserScene = window.__phaserScene;
                if (!phaserScene || !phaserScene.projectilesGroup) return;
                const key = this._getProjectileTextureKey();
                const sprite = phaserScene.add.sprite(this.x, this.y, key);
                sprite.setDepth(this.y || 0);
                const tint = this._getProjectileTint();
                if (tint !== undefined) sprite.setTint(tint);
                phaserScene.projectilesGroup.add(sprite);
                this._phaserSprite = sprite;
                this._updatePhaserSprite();
            }

            _updatePhaserSprite() {
                if (!this._phaserSprite || !this._phaserSprite.active) return;
                this._phaserSprite.setPosition(this.x, this.y);
                this._phaserSprite.setRotation(this.angle);
                this._phaserSprite.setDepth(this.y || 0);
                if (this._noRender) {
                    this._phaserSprite.setVisible(false);
                    return;
                }
                this._phaserSprite.setVisible(true);
                if (this.isSpit) {
                    const s = this.size * 1.4;
                    this._phaserSprite.setDisplaySize(s, s);
                } else if (this.isGreen || this.isGold || this.isDarkGold || this.isTracer) {
                    const tailLen = this.isGreen ? 55 : this.isGold ? 50 : this.isDarkGold ? 45 : 40;
                    const thickness = this.isGreen ? 10 : this.isGold ? 10 : this.isDarkGold ? 9 : 8;
                    this._phaserSprite.setDisplaySize(tailLen, thickness);
                } else if (this.image) {
                    const s = this.size * 10;
                    const w = s * 0.22;
                    this._phaserSprite.setDisplaySize(w, s);
                } else {
                    const s = this.size * 2;
                    this._phaserSprite.setDisplaySize(s, s);
                }
            }

            _destroyPhaserSprite() {
                if (this._phaserSprite) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }

            syncPhaserSprite() {
                const expectedKey = this._getProjectileTextureKey();
                if (this._phaserSprite && this._phaserSprite.active && this._phaserSprite.texture.key === expectedKey) {
                    this._updatePhaserSprite();
                } else {
                    this._destroyPhaserSprite();
                    this._createPhaserSprite();
                }
            }
        }

export { Projectile };
