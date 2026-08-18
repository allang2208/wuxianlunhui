/**
 * 碰撞辅助函数（已精简）
 * 现在仅保留距离入口，内部优先使用统一 3D Collider 的地面 footprint。
 */
import { distanceToIsoFootprint } from '../physics/iso-footprint.js';

/**
 * 计算点 (px,py) 到 entity 地面 footprint 边缘的最短距离。
 * 统一使用 Collider.groundRadius；无 Collider 时回退到旧字段。
 */
export function distanceToEntityShape(entity, px, py) {
    if (!entity) return Infinity;
    const c = entity.collider;
    if (c) {
        if (entity.collisionShape === 'iso_rect') {
            return distanceToIsoFootprint(px, py, entity);
        }
        // 矩形 footprint（掩体/门闸等长条建筑）：点到 AABB 的最短距离，比"圆心距 − 半径"
        // 精确——否则 198×133 的长墙被当成半径 26 的小圆，贴墙怪的真实距离被高估
        // （实测贴墙 24px 被算成 101.7px），触发攻击动画但 dynamicRange 命中判定落空
        // （2026-08-16 世界-122 实机复现：僵尸啃掩体零伤害）。
        if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
            const halfW = entity.collisionWidth / 2;
            const halfH = entity.collisionHeight / 2;
            const closestX = Math.max(c.x - halfW, Math.min(px, c.x + halfW));
            const closestY = Math.max(c.y - halfH, Math.min(py, c.y + halfH));
            return Math.hypot(px - closestX, py - closestY);
        }
        return Math.hypot(px - c.x, py - c.y) - c.radius;
    }
    // 兜底：兼容尚未生成 Collider 的实体
    const r = entity.collisionRadius || entity.size * 0.6 || 10;
    return Math.hypot(px - entity.x, py - entity.y) - r;
}
