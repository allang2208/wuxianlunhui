import { WallSystem } from '../world/wall-system.js';
import { DamagePipeline } from './damage-pipeline.js';
import { segmentIntersectsCapsule } from '../physics/collision-3d.js';
import { segmentHitsTorso } from '../physics/torso-hitbox.js';
import { ELEVATION } from '../physics/collider.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import SpatialPartitionSystem from '../systems/spatial-partition-system.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { projectileWallContext } from './elevated-ranged.js';

class Projectile {
    constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false, isGold = false, isDarkGold = false, damageType = 'physical', _noRender = false, isGreen = false, isSpit = false, poisonChance = 0, poisonStacks = 1, textureKey = null) {
        this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
        this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
        this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
        this.textureKey = textureKey; // 显式 Phaser 纹理键（优先于 image 的箭头回退）
        this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
        this.isSpit = isSpit || false; // 是否为毒液投射物（SpitterZombie）
        this.isGold = isGold; // 是否为亮金色曳光弹（PKM）
        this.isDarkGold = isDarkGold; // 是否为深黄色曳光弹（沙漠之鹰）
        this.isGreen = isGreen; // 是否为亮绿色曳光弹（能量轻机枪）
        this.damageType = damageType; // 伤害类型：physical 或 magic
        this._noRender = _noRender;
        this.poisonChance = poisonChance; // 命中时附加中毒的概率（0~1）
        this.poisonStacks = poisonStacks; // 附加中毒层数
        this._embeddedWalls = null; // 出膛嵌墙记录（ProjectileFactory 创建时检测；"只出不进"判定用）

        // 伪3D直线弹道：z/vz 与 x/y 同步积分，命中走3D胶囊体。
        this.z = 0;
        this.prevZ = 0;
        this.vz = 0;
        this.visualAngle = angle;

        this._createPhaserSprite();
    }
    update(dt = 16.67) {
        const scale = dt / 1000;
        const dx = Math.cos(this.angle) * this.speed * scale, dy = Math.sin(this.angle) * this.speed * scale;
        const prevX = this.x, prevY = this.y;
        this.prevZ = this.z;
        this.x += dx;
        this.y += dy;
        this.z += (Number(this.vz) || 0) * scale;
        this.traveled += this.speed * scale;
        if (this.traveled >= this.maxRange) {
            this.active = false;
        } else if (this._isBlockedByWall(prevX, prevY)) {
            // 墙壁碰撞检测（含嵌墙"只出不进"判定：出膛嵌墙仅允许朝射手一侧越出）
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
                // 开发工具「友军伤害」开启时放行（isFriendlyFire 已随开关返回 false，
                // 同阵营硬过滤也要一并放行，否则枪弹打掩体/队友仍被跳过，2026-08-16）
                const devFF = (typeof window !== 'undefined' && window.Game && window.Game._devFriendlyFire);
                if (entity === this.source || !entity.active || !entity.hittable ||
                    isFriendlyFire(this.source, entity) ||
                    (!devFF && this.source && this.source._faction && entity._faction && this.source._faction === entity._faction) ||
                    this.hitTargets.has(entity)) continue;
                if (this._isHittingEntity(entity, prevX, prevY)) {
                    this.hitTargets.add(entity);
                    const damage = typeof this.damage === 'object' ? Math.floor(this.damage.min + Math.random() * (this.damage.max - this.damage.min + 1)) : this.damage;
                    // 毒液/中毒投射物：命中后按概率给目标叠加中毒
                    if ((this.isSpit || this.poisonChance > 0) && typeof entity.applyPoison === 'function') {
                        const chance = this.isSpit && this.poisonChance === 0 ? 1 : this.poisonChance;
                        if (Math.random() < chance) {
                            entity.applyPoison(this.poisonStacks);
                        }
                    }
                    // 命中效果按发射瞬间的快照判定（无快照时回退到当前武器，兼容非工厂创建的投射物）
                    const snap = this._effectSnapshot;
                    const weapon = snap
                        ? { _enchantEffects: snap.enchant, _craftEffects: snap.craft }
                        : (this.source ? (this.source.getCurrentWeapon ? this.source.getCurrentWeapon() : (this.source.equipments && this.source.weaponMode ? this.source.equipments[this.source.weaponMode] : null)) : null);
                    DamagePipeline.applyHit(this.source, entity, {
                        damage,
                        damageType: this.damageType || 'ranged',
                        currentWeapon: weapon,
                        isMelee: false,
                        // 投射物击退（工厂 create 的 knockback 选项驱动；无配置时为 0 不生效）
                        knockback: this.knockback || 0,
                        angle: this.angle
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
     * 墙体阻挡判定（含嵌墙"只出不进"规则）：
     * - 嵌墙之外的所有墙：撞线即死（铁律：子弹不能从墙外穿进墙内）
     * - 出膛时嵌入的 iso 面线：仅当本帧轨迹朝射手一侧跨回时放行（越回即恢复普通判定）；背向钻透即死
     * - 出膛时嵌入的矩形墙：矩形内不判死；离开时在射手一侧放行，另一侧钻出即死
     */
    _isBlockedByWall(prevX, prevY) {
        if (!WallSystem || !WallSystem.blocked) return false;
        const emb = this._embeddedWalls;
        // 普通墙（嵌墙面线 + 其阶梯块 + 嵌墙矩形除外）撞线即死
        const embeddedIgnore = emb ? {
            segs: new Set(emb.segs.map(e => e.seg)),
            rects: new Set([
                ...(emb.clearedRects || []),
                ...emb.rects.map(e => e.rect),
                ...emb.segs.flatMap(e => e.linked ? [...e.linked] : []),
            ]),
        } : null;
        const ignore = {
            ...(this._wallContext || projectileWallContext(this.source)),
            ...(embeddedIgnore || {}),
        };
        const z1 = this.prevZ + this.size / 2;
        const z2 = this.z + this.size / 2;
        if (typeof WallSystem.projectileBlocked === 'function') {
            if (WallSystem.projectileBlocked(prevX, prevY, z1, this.x, this.y, z2, ignore)) return true;
        } else if (WallSystem.blocked(prevX, prevY, this.x, this.y, ignore)) return true;
        if (!emb) return false;
        if (!emb.clearedRects) emb.clearedRects = new Set();
        // iso 面线嵌墙：只出不进
        for (let i = emb.segs.length - 1; i >= 0; i--) {
            const e = emb.segs[i];
            if (WallSystem._segSegIntersect(prevX, prevY, this.x, this.y, e.seg.x1, e.seg.y1, e.seg.x2, e.seg.y2)) {
                const curSign = Math.sign(WallSystem.segSide(e.seg, this.x, this.y)) || 1;
                if (curSign === e.shooterSign) {
                    // 已回到射手侧：面线恢复普通判定（再反向越线即死），其阶梯块永久放行（墙厚区）
                    if (e.linked) for (const w of e.linked) emb.clearedRects.add(w);
                    emb.segs.splice(i, 1);
                } else return true; // 背向钻透：销毁
                continue;
            }
            // 未跨线但在远侧越飞越远（背向远离墙面）：同样销毁——否则出膛在墙外的子弹直接穿墙飞走
            const sPrev = WallSystem.segSide(e.seg, prevX, prevY);
            const sCur = WallSystem.segSide(e.seg, this.x, this.y);
            if (Math.sign(sCur) !== e.shooterSign && Math.abs(sCur) > Math.abs(sPrev)) return true;
        }
        // 矩形墙嵌墙：矩形内不判，越出看方位
        for (let i = emb.rects.length - 1; i >= 0; i--) {
            const e = emb.rects[i];
            if (WallSystem.pointInRect(this.x, this.y, e.rect)) continue;
            const side = WallSystem.sideOfRect(this.x, this.y, e.rect);
            if (e.shooterSide === 'inside' || side === e.shooterSide) emb.rects.splice(i, 1); // 朝射手一侧越出：放行
            else return true; // 从另一侧钻出：销毁
        }
        return false;
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
     * 双重判定：
     * 1. 地面 footprint 椭圆：把本帧轨迹和 footprint 中心按 PERSPECTIVE_SCALE_Y
     *    做逆透视变换后，计算线段到圆心的距离。这样与红色 footprint 椭圆视觉一致。
     * 2. 身体圆柱/胶囊：把贴地飞行的投射物视为竖直厚度为 size 的圆柱
     *    （中心 z = size/2），与实体的 3D 胶囊体做连续碰撞检测。
     *
     * 3. 躯干矩形（屏幕空间）：把实体身体近似为锚定脚底的竖直矩形
     *    （render.projectileHitbox，缺省取 collisionWidth × 身高），
     *    让瞄准贴图身体位置的弹道也能命中（不影响近战判定）。
     *
     * 地面/低空目标： footprint 椭圆 OR 躯干矩形 OR 身体圆柱 任一命中即算命中。
     * 飞行目标：只使用身体圆柱，避免 footprint 命中空中单位脚部。
     */
    _isHittingEntity(entity, prevX, prevY) {
        if (!entity || !entity.active || !entity.collider) return false;
        const c = entity.collider;

        if (c.elevation === ELEVATION.FLYING) {
            return this._hitBodyCapsule(entity, prevX, prevY);
        }

        return this._hitFootprintEllipse(entity, prevX, prevY) ||
               this._hitTorsoRect(entity, prevX, prevY) ||
               this._hitBodyCapsule(entity, prevX, prevY);
    }

    /**
     * 躯干矩形判定（屏幕空间，仅投射物使用）。
     * 判定数据推导共享自 physics/torso-hitbox.js（render.projectileHitbox，
     * 缺省 collisionWidth × 身高）。矩形按投射物半径外扩后做线段相交。
     */
    _hitTorsoRect(entity, prevX, prevY) {
        return segmentHitsTorso(entity, prevX, prevY, this.x, this.y, this.size / 2);
    }

    /**
     * 地面 footprint 椭圆判定。
     * 在“逆透视”空间把椭圆变成圆，再做线段到圆心的最近距离判定。
     */
    _hitFootprintEllipse(entity, prevX, prevY) {
        const c = entity.collider;
        const projectileRadius = this.size / 2;
        const invScale = 1 / PERSPECTIVE_SCALE_Y;

        const ax = prevX;
        const ay = prevY * invScale;
        const bx = this.x;
        const by = this.y * invScale;
        const cx = c.x;
        const cy = c.y * invScale;

        const sx = bx - ax;
        const sy = by - ay;
        const dx = cx - ax;
        const dy = cy - ay;
        const len2 = sx * sx + sy * sy;

        let t = 0;
        if (len2 > 1e-6) {
            t = Math.max(0, Math.min(1, (dx * sx + dy * sy) / len2));
        }

        const closestX = ax + sx * t;
        const closestY = ay + sy * t;
        const ddx = cx - closestX;
        const dy2 = cy - closestY;
        const rr = c.radius + projectileRadius;
        return ddx * ddx + dy2 * dy2 <= rr * rr;
    }

    /**
     * 身体 3D 胶囊体判定。
     * 贴地投射物 z=0，直接撞胶囊体底端会漏判；这里把投射物中心抬升
     * size/2，使其竖直范围为 [z, z + size]，能够打到圆柱体下段。
     */
    _hitBodyCapsule(entity, prevX, prevY) {
        const c = entity.collider;
        const projectileRadius = this.size / 2;
        const segA = { x: prevX, y: prevY, z: this.prevZ + projectileRadius };
        const segB = { x: this.x, y: this.y, z: this.z + projectileRadius };
        const capsule = c.getCapsuleSegment();
        return segmentIntersectsCapsule(segA, segB, capsule, projectileRadius);
    }

    _getProjectileTextureKey() {
        if (this.textureKey) return this.textureKey;
        if (this.isSpit) return 'projectile_poison';
        if (this.isGreen || this.isGold || this.isDarkGold || this.isTracer) return 'projectile_tracer';
        if (this.image) return 'projectile_arrow';
        return 'projectile_bullet';
    }

    _getProjectileTint() {
        // 毒液投射物使用 project.png 自带颜色，不再叠加绿色 tint
        if (this.isSpit) return undefined;
        // 短粗圆柱弹配色（2026-07-28）：色相不变，亮度提升更鲜艳
        if (this.isGreen) return 0xc8ffd8;
        if (this.isGold) return 0xffffcc;
        if (this.isDarkGold) return 0xffe080;
        if (this.isTracer) return 0xfff5cc;
        return undefined;
    }

    _createPhaserSprite() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene || !phaserScene.projectilesGroup) return;
        const key = this._getProjectileTextureKey();
        const sprite = phaserScene.add.sprite(this.x, this.y - this.z, key);
        // 深度=脚底 y + 500（原 +12）：弹道贴图必须压在墙壁之上——贴墙飞行时被墙面盖住又露出的根因；
        // 物理上子弹不会穿墙（嵌墙"只出不进"），视觉上压墙永远成立
        sprite.setDepth((this.y || 0) + 500 + (this.depthBonus || 0));
        const tint = this._getProjectileTint();
        if (tint !== undefined) sprite.setTint(tint);
        phaserScene.projectilesGroup.add(sprite);
        this._phaserSprite = sprite;
        this._updatePhaserSprite();
    }

    _updatePhaserSprite() {
        if (!this._phaserSprite || !this._phaserSprite.active) return;
        this._phaserSprite.setPosition(this.x, this.y - this.z);
        // 显式纹理键投射物不随弹道旋转（球体光照贴图旋转会丢失光照方向）
        this._phaserSprite.setRotation(this.textureKey ? 0 : (this.visualAngle ?? this.angle));
        // 深度=脚底 y + 500（与 _createPhaserSprite 同口径）：弹道贴图必须压在墙壁之上——
        // 贴墙飞行时被墙面盖住又露出的根因；此处曾残留 y+12 覆盖掉创建时的 y+500，修复未生效
        this._phaserSprite.setDepth((this.y || 0) + 500 + (this.depthBonus || 0));
        if (this._noRender) {
            this._phaserSprite.setVisible(false);
            return;
        }
        this._phaserSprite.setVisible(true);
        if (this.textureKey) {
            // 显式纹理键投射物：按 size 方形显示（如毒蛆绿色毒球）
            const s = this.size * 2;
            this._phaserSprite.setDisplaySize(s, s);
        } else if (this.isSpit) {
            const s = this.size * 2.5;
            this._phaserSprite.setDisplaySize(s, s);
        } else if (this.isGreen || this.isGold || this.isDarkGold || this.isTracer) {
            // 短粗圆柱弹：长度较原长条减半、粗 1.5 倍（贴图为两头椭圆胶囊）
            const tailLen = this.isGreen ? 27 : this.isGold ? 25 : this.isDarkGold ? 22 : 20;
            const thickness = this.isGreen ? 15 : this.isGold ? 15 : this.isDarkGold ? 13.5 : 12;
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
        // 子类/外部可通过 _onBeforeDestroy 清理额外 Phaser 对象（如粒子拖尾）
        if (typeof this._onBeforeDestroy === 'function') {
            try { this._onBeforeDestroy(); } catch (_e) { /* 忽略清理异常 */ }
        }
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
