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

        // 兼容旧字段：子类会在 super 之后覆盖这些值
        this.size = 0;
        this.collisionShape = 'circle';
        this.collisionRadius = 0;
        this.collisionWidth = 0;
        this.collisionHeight = 0;

        // 伪 3D 高度系统（新增，不影响现有属性）
        this.z = 0;
        this.elevation = ELEVATION.GROUND;
        // 碰撞体相对于逻辑坐标的偏移，用于前倾/攻击等动画让 footprint 对齐视觉重心
        this.colliderOffsetX = 0;
        this.colliderOffsetY = 0;
        this.collider = Collider.fromEntity(this);
        this.collider.attach(this);
    }

    addComponent(name, comp) {
        this.components.set(name, comp);
        comp.entity = this;
    }

    update() {
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
     * 地面 footprint 半径（统一入口 / 唯一来源）
     * 优先使用 Collider，回退到旧字段。
     *
     * 【强绑定约定】以下四处只允许读取本 getter，禁止各自独立取值，
     * 修改任何一处的半径配置（如 collisionRadius）会同步传导到其余全部：
     * 1. 脚下阴影面积（GameScene._syncEntityShadows）
     * 2. 脚下椭圆判定/调试红椭圆（GameScene._syncCollisionRadii）
     * 3. 实体间圆-圆分离（game.js resolveCollisions）
     * 4. 墙壁/树木碰撞与被近战、投射物命中的 footprint 判定
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
        return { type: 'circle', radius: this.collider ? this.collider.radius : (this.collisionRadius || this.size * 0.6 || 10) };
    }
}

export { Entity, ELEVATION };
