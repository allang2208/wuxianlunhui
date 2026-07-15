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
                        // 友军伤害免疫：跳过同阵营目标（放在 hitTargets 检查之前，避免同一友军被反复判断）
                        if (entity === this.source || !entity.active || !entity.hittable ||
                            (this.source && this.source._faction && entity._faction && this.source._faction === entity._faction) ||
                            this.hitTargets.has(entity)) continue;
                        if (this._isHittingEntity(entity, prevX, prevY)) {
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
                                currentWeapon: weapon,
                                isMelee: false
                            });
                            if (this.piercing) { this.piercing--; if (this.piercing <= 0) this.active = false; }
                            else { this.active = false; }
                            if (!this.active) break;
                        }
                    }
                }
                this._updatePhaserSprite();
                if (!this.active) this._destroyPhaserSprite();
            }
            /**
             * 投射物与实体的命中判定（支持 swept，防止高速穿体/穿墙）。
             * 矩形碰撞体：将 entity 按投射物 size 扩张后，检测当前点/前一点是否在扩张矩形内，
             *            或前一点到当前点的线段是否穿过扩张矩形边。
             * 圆形/其他：将 entity 半径按投射物 size 扩张后，检测线段到圆心最近距离。
             */
            _isHittingEntity(entity, prevX, prevY) {
                if (!entity || !entity.active) return false;
                const usePrev = prevX !== undefined && prevY !== undefined;
                // 投射物命中边界：用 size/2 作为半径扩展，避免过大的视觉投射物把命中框撑得比实际大一圈
                const hitMargin = this.size / 2;
                if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
                    const eminX = entity.x - entity.collisionWidth / 2 - hitMargin;
                    const emaxX = entity.x + entity.collisionWidth / 2 + hitMargin;
                    const eminY = entity.y - entity.collisionHeight / 2 - hitMargin;
                    const emaxY = entity.y + entity.collisionHeight / 2 + hitMargin;
                    // 当前点命中
                    if (this.x >= eminX && this.x <= emaxX && this.y >= eminY && this.y <= emaxY) return true;
                    if (usePrev) {
                        // 前一点命中
                        if (prevX >= eminX && prevX <= emaxX && prevY >= eminY && prevY <= emaxY) return true;
                        // 线段穿过扩张矩形四条边
                        if (
                            this._segmentsIntersect(prevX, prevY, this.x, this.y, eminX, eminY, emaxX, eminY) ||
                            this._segmentsIntersect(prevX, prevY, this.x, this.y, eminX, emaxY, emaxX, emaxY) ||
                            this._segmentsIntersect(prevX, prevY, this.x, this.y, eminX, eminY, eminX, emaxY) ||
                            this._segmentsIntersect(prevX, prevY, this.x, this.y, emaxX, eminY, emaxX, emaxY)
                        ) return true;
                    }
                    return false;
                }
                // 圆形/其他：扩张半径 = collisionRadius + projectile hit margin
                const expandedR = (entity.collisionRadius || entity.size * 0.6 || 10) + hitMargin;
                const distToCenter = usePrev
                    ? this._segmentPointDistance(prevX, prevY, this.x, this.y, entity.x, entity.y)
                    : Math.hypot(this.x - entity.x, this.y - entity.y);
                return distToCenter <= expandedR;
            }

            _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
                const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
                if (d === 0) return false;
                const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
                const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
                return t >= 0 && t <= 1 && u >= 0 && u <= 1;
            }

            _segmentPointDistance(ax, ay, bx, by, px, py) {
                const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
                if (len2 === 0) return Math.hypot(px - ax, py - ay);
                let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2;
                t = Math.max(0, Math.min(1, t));
                return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
            }

            _getProjectileTextureKey() {
                if (this.isSpit) return 'projectile_poison';
                if (this.isGreen || this.isGold || this.isDarkGold || this.isTracer) return 'projectile_tracer';
                if (this.image) return 'projectile_arrow';
                return 'projectile_bullet';
            }

            _getProjectileTint() {
                // 毒液投射物使用 project.png 自带颜色，不再叠加绿色 tint
                if (this.isSpit) return undefined;
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
                    const s = this.size * 2.5;
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
