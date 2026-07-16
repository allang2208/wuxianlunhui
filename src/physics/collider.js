/**
 * 统一 3D 碰撞体
 *
 * 每个实体只保留一个 Collider：
 * - 地面 footprint：圆形（半径 groundRadius）
 * - 垂直体积：胶囊体（两端半球 + 中段圆柱）
 *
 * 不改动实体的现有属性（size / collisionRadius / collisionWidth / collisionHeight /
 * collisionShape / hitbox），只把它们作为推导 Collider 的输入。
 */

export const ELEVATION = {
    GROUND: 'ground',
    AIR: 'air',
    FLYING: 'flying'
};

export class Collider {
    /**
     * @param {number} radius 地面圆形 footprint 半径，也是胶囊体半径
     * @param {number} height 实体总高度（从 z 到 z+height）
     * @param {number} z 离地高度
     * @param {string} elevation 见 ELEVATION
     */
    constructor(radius = 10, height = 20, z = 0, elevation = ELEVATION.GROUND) {
        this.x = 0;
        this.y = 0;
        this.radius = Math.max(0, radius);
        this.height = Math.max(0, height);
        this.z = z;
        this.elevation = elevation;

        /** @private */
        this._entity = null;
    }

    /**
     * 从实体现有属性推导 Collider（不修改实体属性）
     * @param {object} entity
     * @returns {Collider}
     */
    static fromEntity(entity) {
        const radius = Collider._deriveGroundRadius(entity);
        const height = Collider._deriveHeight(entity, radius);
        const z = entity.z || 0;
        const elevation = entity.elevation || ELEVATION.GROUND;
        const collider = new Collider(radius, height, z, elevation);
        collider.x = entity.x || 0;
        collider.y = entity.y || 0;
        return collider;
    }

    static _deriveGroundRadius(entity) {
        if (entity.collisionRadius > 0) {
            return entity.collisionRadius;
        }
        if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
            return Math.max(entity.collisionWidth, entity.collisionHeight) / 2;
        }
        if (entity.size > 0) {
            return entity.size * 0.6;
        }
        return 10;
    }

    static _deriveHeight(entity, radius) {
        const cfg = entity.config || {};
        const render = cfg.render || {};
        if (cfg.height > 0) return cfg.height;
        if (render.spriteSize > 0) return render.spriteSize;
        if (entity.collisionHeight > 0) return entity.collisionHeight;
        if (radius > 0) return radius * 2;
        return 64;
    }

    attach(entity) {
        this._entity = entity;
        this.syncPosition();
    }

    syncPosition() {
        if (!this._entity) return;
        this.x = (this._entity.x || 0) + (this._entity.colliderOffsetX || 0);
        this.y = (this._entity.y || 0) + (this._entity.colliderOffsetY || 0);
        this.z = this._entity.z || 0;
        this.elevation = this._entity.elevation || ELEVATION.GROUND;
    }

    get bottomZ() {
        return this.z;
    }

    get topZ() {
        return this.z + this.height;
    }

    get centerZ() {
        return this.z + this.height * 0.5;
    }

    /**
     * 地面 footprint 圆
     * @returns {{x:number, y:number, r:number}}
     */
    get footprint() {
        return { x: this.x, y: this.y, r: this.radius };
    }

    /**
     * 胶囊体轴线线段（用于 3D 投射物/近战命中）
     * @returns {{a:{x,y,z}, b:{x,y,z}, r:number}}
     */
    getCapsuleSegment() {
        const r = this.radius;
        const halfInner = Math.max(0, this.height - 2 * r) * 0.5;
        const cz = this.centerZ;
        return {
            a: { x: this.x, y: this.y, z: cz - halfInner },
            b: { x: this.x, y: this.y, z: cz + halfInner },
            r
        };
    }

    /**
     * 地面圆与圆是否相交
     */
    intersectsGroundCircle(cx, cy, r) {
        const dx = this.x - cx;
        const dy = this.y - cy;
        const rr = this.radius + r;
        return dx * dx + dy * dy <= rr * rr;
    }

    /**
     * 地面圆与轴对齐矩形是否相交
     */
    intersectsGroundRect(rx, ry, rw, rh) {
        const halfW = Math.abs(rw) * 0.5;
        const halfH = Math.abs(rh) * 0.5;
        const closestX = Math.max(rx - halfW, Math.min(this.x, rx + halfW));
        const closestY = Math.max(ry - halfH, Math.min(this.y, ry + halfH));
        const dx = this.x - closestX;
        const dy = this.y - closestY;
        return dx * dx + dy * dy <= this.radius * this.radius;
    }

    /**
     * 点是否在垂直柱体内（footprint + 高度范围）
     */
    containsPoint(x, y, z = 0) {
        const dx = x - this.x;
        const dy = y - this.y;
        if (dx * dx + dy * dy > this.radius * this.radius) return false;
        return z >= this.z && z <= this.topZ;
    }

    /**
     * 该碰撞体是否能被地面效果命中
     */
    get isGroundTarget() {
        return this.elevation === ELEVATION.GROUND || this.elevation === ELEVATION.AIR;
    }
}
