import { HexHitbox } from '../components/hitbox.js';
import { Collider, ELEVATION } from '../physics/collider.js';

class Entity {
    constructor(x, y) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.active = true;
        this.hittable = false;
        this.components = new Map();
        this.hitbox = null;

        // 兼容旧字段：子类会在 super 之后覆盖这些值
        this.size = 0;
        this.collisionShape = 'circle';
        this.collisionRadius = 0;
        this.collisionWidth = 0;
        this.collisionHeight = 0;

        // 伪 3D 高度系统（新增，不影响现有属性）
        this.z = 0;
        this.elevation = ELEVATION.GROUND;
        this.collider = Collider.fromEntity(this);
        this.collider.attach(this);
    }

    addComponent(name, comp) {
        this.components.set(name, comp);
        comp.entity = this;
    }

    /**
     * 初始化六边形包围盒
     * @param {number} radius - 六边形半径
     * @param {number[]} damageMultipliers - 6点伤害倍率
     * @param {number[]} radii - 6点独立半径（可选）
     */
    initHitbox(radius, damageMultipliers, radii) {
        this.hitbox = new HexHitbox(radius, damageMultipliers, radii);
        this.hitbox.updateWorldPosition(this);
    }

    update() {
        // 每帧同步六边形顶点世界坐标
        if (this.hitbox) {
            this.hitbox.updateWorldPosition(this);
        }
        // 同步 3D 碰撞体位置
        if (this.collider) {
            this.collider.syncPosition();
        }
    }

    takeDamage(_damage, _source) {}
    applyKnockback(_angle, _force) {}

    /**
     * 当子类设置完碰撞相关字段后调用，重建规范 Collider
     */
    rebuildCollider() {
        this.collider = Collider.fromEntity(this);
        this.collider.attach(this);
    }

    /**
     * 地面 footprint 半径（统一入口）
     * 优先使用 Collider，回退到旧字段。
     */
    get groundRadius() {
        if (this.collider) return this.collider.radius;
        if (this.collisionRadius > 0) return this.collisionRadius;
        if (this.collisionShape === 'rect' && this.collisionWidth > 0 && this.collisionHeight > 0) {
            return Math.max(this.collisionWidth, this.collisionHeight) / 2;
        }
        if (this.size > 0) return this.size * 0.6;
        return 10;
    }

    /**
     * 实体高度（统一入口）
     */
    get bodyHeight() {
        if (this.collider) return this.collider.height;
        if (this.collisionHeight > 0) return this.collisionHeight;
        const render = this.config?.render;
        if (render?.spriteSize > 0) return render.spriteSize;
        return (this.size || 10) * 2;
    }

    /**
     * 获取碰撞形状（用于兼容现有系统）
     * 优先使用显式设置的矩形碰撞体；没有矩形再回退到六边形/圆形。
     * @returns {{type:string, radius:number, width?:number, height?:number}}
     */
    getCollisionShape() {
        if (this.collisionShape === 'rect' && this.collisionWidth > 0 && this.collisionHeight > 0) {
            return {
                type: 'rect',
                width: this.collisionWidth,
                height: this.collisionHeight,
                radius: Math.max(this.collisionWidth, this.collisionHeight) / 2
            };
        }
        if (this.hitbox) {
            return { type: 'hex', radius: this.hitbox.getApproxRadius() };
        }
        return { type: 'circle', radius: this.collider ? this.collider.radius : (this.collisionRadius || this.size * 0.6 || 10) };
    }
}

export { Entity, ELEVATION };
