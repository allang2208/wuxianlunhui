/**
 * 碰撞辅助函数（已精简）
 * 现在仅保留距离入口，内部优先使用统一 3D Collider 的地面 footprint。
 */

/**
 * 计算点 (px,py) 到 entity 地面 footprint 边缘的最短距离。
 * 统一使用 Collider.groundRadius；无 Collider 时回退到旧字段。
 */
export function distanceToEntityShape(entity, px, py) {
    if (!entity) return Infinity;
    const c = entity.collider;
    if (c) {
        return Math.hypot(px - c.x, py - c.y) - c.radius;
    }
    // 兜底：兼容尚未生成 Collider 的实体
    const r = entity.collisionRadius || entity.size * 0.6 || 10;
    return Math.hypot(px - entity.x, py - entity.y) - r;
}
