/**
 * 技能 / 近战 / AOE 的 3D 命中形状抽象层
 *
 * 所有形状都通过 `intersectsEntity(entity)` 与统一 Collider 交互。
 */

import { MathUtils } from '../config/math-utils.js';

/**
 * 检查目标 Collider 是否与给定高度区间有重叠
 * @param {Collider} collider
 * @param {number} minZ
 * @param {number} maxZ
 */
function hasVerticalOverlap(collider, minZ, maxZ) {
    if (!collider) return false;
    return collider.bottomZ < maxZ && collider.topZ > minZ;
}

/**
 * 地面圆形 AOE（例如火球爆炸、旋风、胖子僵尸尸体光环）
 */
export class GroundCircle {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.radius = radius;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        if (!entity.collider.isGroundTarget) return false;
        return entity.collider.intersectsGroundCircle(this.x, this.y, this.radius);
    }
}

/**
 * 地面椭圆 AOE（例如胖子僵尸尸体腐蚀领域）
 * rx/ry 分别为地面椭圆 X/Y 半径；把实体 footprint 半径膨胀进轴长做保守判定。
 */
export class GroundEllipse {
    constructor(x, y, rx, ry) {
        this.x = x;
        this.y = y;
        this.rx = rx;
        this.ry = ry;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        if (!entity.collider.isGroundTarget) return false;
        const c = entity.collider;
        const dx = c.x - this.x;
        const dy = c.y - this.y;
        const rx = this.rx + c.radius;
        const ry = this.ry + c.radius;
        if (rx <= 0 || ry <= 0) return false;
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
}

/**
 * 地面矩形 AOE（例如胖子僵尸尸体腐蚀领域）
 */
export class GroundRect {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        if (!entity.collider.isGroundTarget) return false;
        return entity.collider.intersectsGroundRect(this.x, this.y, this.width, this.height);
    }
}

/**
 * 垂直扇形（例如斩击、推击）
 */
export class VerticalSector {
    /**
     * @param {number} x 扇形原点 X
     * @param {number} y 扇形原点 Y
     * @param {number} angle 扇形朝向（弧度）
     * @param {number} radius 扇形半径
     * @param {number} arcAngle 扇形张角（弧度）
     * @param {number} minZ 最低命中高度
     * @param {number} maxZ 最高命中高度
     */
    constructor(x, y, angle, radius, arcAngle, minZ = 0, maxZ = 200) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.radius = radius;
        this.arcAngle = arcAngle;
        this.minZ = minZ;
        this.maxZ = maxZ;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        const c = entity.collider;
        if (!hasVerticalOverlap(c, this.minZ, this.maxZ)) return false;
        // 水平面：把实体 footprint 半径加进扇形半径，避免边缘只擦到 footprint 中心 miss
        return MathUtils.pointInSector(c.x, c.y, this.x, this.y, this.angle, this.radius + c.radius, this.arcAngle);
    }
}

/**
 * 垂直矩形（例如突刺、夜与火之光束）
 */
export class VerticalRect {
    /**
     * @param {number} x 矩形起点 X（贴近施法者一侧）
     * @param {number} y 矩形起点 Y
     * @param {number} angle 矩形朝向（弧度）
     * @param {number} length 矩形向前长度
     * @param {number} width 矩形宽度
     * @param {number} minZ 最低命中高度
     * @param {number} maxZ 最高命中高度
     * @param {number} backExtension 向起点后方延伸的长度（默认 0）
     */
    constructor(x, y, angle, length, width, minZ = 0, maxZ = 200, backExtension = 0) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.length = length;
        this.width = width;
        this.minZ = minZ;
        this.maxZ = maxZ;
        this.backExtension = backExtension ?? 0;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        const c = entity.collider;
        if (!hasVerticalOverlap(c, this.minZ, this.maxZ)) return false;

        // 把实体中心转换到矩形本地坐标系
        const dx = c.x - this.x;
        const dy = c.y - this.y;
        const cos = Math.cos(-this.angle);
        const sin = Math.sin(-this.angle);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const halfW = this.width / 2;
        return lx >= -this.backExtension - c.radius && lx <= this.length + c.radius && Math.abs(ly) <= halfW + c.radius;
    }
}

/**
 * 球体（用于爆炸中心等需要 3D 球型检测的场景）
 */
export class Sphere {
    constructor(x, y, z, radius) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.radius = radius;
    }

    intersectsEntity(entity) {
        if (!entity || !entity.collider) return false;
        const c = entity.collider;
        const dx = this.x - c.x;
        const dy = this.y - c.y;
        const dz = this.z - c.centerZ;
        const rr = this.radius + c.radius;
        return dx * dx + dy * dy + dz * dz <= rr * rr;
    }
}
