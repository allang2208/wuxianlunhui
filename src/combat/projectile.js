import { WallSystem } from '../world/wall-system.js';
import { DamagePipeline } from './damage-pipeline.js';
import { segmentIntersectsCapsule } from '../physics/collision-3d.js';
import SpatialPartitionSystem from '../systems/spatial-partition-system.js';

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

        // 伪 3D：地面投射物 z=0；未来可扩展为抛物线/对空投射物
        this.z = 0;
        this.prevZ = 0;

        this._createPhaserSprite();
    }
    update(dt = 16.67) {
        const scale = dt / 1000;
        const dx = Math.cos(this.angle) * this.speed * scale, dy = Math.sin(this.angle) * this.speed * scale;
        const prevX = this.x, prevY = this.y;
        this.prevZ = this.z;
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

            // 空间网格 broadphase：只查询路径附近的实体
            const candidates = this._getCandidateEntities(prevX, prevY);
            for (const entity of candidates) {
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
     * 使用 SpatialPartitionSystem 做 broadphase，只返回路径附近可能命中的实体。
     * 如果空间网格不可用，回退到全量遍历。
     */
    _getCandidateEntities(prevX, prevY) {
        if (!SpatialPartitionSystem || typeof SpatialPartitionSystem.queryRadius !== 'function') {
            return this.entities ? Array.from(this.entities.values()) : [];
        }

        const midX = (prevX + this.x) * 0.5;
        const midY = (prevY + this.y) * 0.5;
        // 查询半径覆盖本帧飞行距离 + 最大常见实体半径余量，确保不遗漏
        const stepLen = Math.hypot(this.x - prevX, this.y - prevY);
        const queryR = Math.max(128, stepLen + 160);
        return SpatialPartitionSystem.queryRadius(midX, midY, queryR, this.source);
    }

    /**
     * 投射物与实体的命中判定。
     *
     * 地面投射物（z=0）改用 2D footprint 检测：
     * 之前把投射物当成 z=0 的 3D 球体去撞垂直胶囊体，结果只能碰到胶囊体底端
     * 一个点，导致绝大多数子弹“穿过”橙色圆柱体。
     *
     * 现在：
     * - 目标 elevation 为 ground/air 时，用本帧轨迹线段到 footprint 圆心的 2D
     *   距离判定，半径 = collider.radius + projectileRadius，与红色 footprint 一致；
     * - 飞行/空中目标仍保留 3D 胶囊体检测。
     */
    _isHittingEntity(entity, prevX, prevY) {
        if (!entity || !entity.active || !entity.collider) return false;
        const c = entity.collider;
        const projectileRadius = this.size / 2;

        if (c.elevation === 'ground' || c.elevation === 'air') {
            const sx = this.x - prevX;
            const sy = this.y - prevY;
            const dx = c.x - prevX;
            const dy = c.y - prevY;
            const len2 = sx * sx + sy * sy;
            let t = 0;
            if (len2 > 1e-6) {
                t = Math.max(0, Math.min(1, (dx * sx + dy * sy) / len2));
            }
            const cx = prevX + sx * t;
            const cy = prevY + sy * t;
            const ddx = c.x - cx;
            const ddy = c.y - cy;
            const rr = c.radius + projectileRadius;
            return ddx * ddx + ddy * ddy <= rr * rr;
        }

        const segA = { x: prevX, y: prevY, z: this.prevZ };
        const segB = { x: this.x, y: this.y, z: this.z };
        const capsule = c.getCapsuleSegment();
        return segmentIntersectsCapsule(segA, segB, capsule, projectileRadius);
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
        sprite.setDepth((this.y || 0) + 12);
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
        this._phaserSprite.setDepth((this.y || 0) + 12);
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
