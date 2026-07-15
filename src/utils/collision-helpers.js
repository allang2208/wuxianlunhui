/**
 * 碰撞辅助函数
 * 统一把矩形/圆形/六边形碰撞体转换为“点到该形状的最短距离”，
 * 供投射物、近战攻击、实体分离等系统使用。
 */

/**
 * 获取实体的等效碰撞半径（用于墙体、快速排斥等仍需圆形的场景）
 */
export function getEntityCollisionRadius(entity) {
    if (!entity) return 10;
    if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
        return Math.max(entity.collisionWidth, entity.collisionHeight) / 2;
    }
    return entity.collisionRadius || entity.size * 0.6 || 10;
}

/**
 * 计算点 (px,py) 到 entity 碰撞形状边缘的最短距离。
 * - 矩形：点到矩形最近边的距离（内部为 0）
 * - 圆形/六边形：点到圆心的距离减去半径
 */
export function distanceToEntityShape(entity, px, py) {
    if (!entity) return Infinity;
    if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
        const dx = px - entity.x;
        const dy = py - entity.y;
        const hw = entity.collisionWidth / 2;
        const hh = entity.collisionHeight / 2;
        const closestX = Math.max(-hw, Math.min(hw, dx));
        const closestY = Math.max(-hh, Math.min(hh, dy));
        return Math.hypot(dx - closestX, dy - closestY);
    }
    const r = entity.collisionRadius || entity.size * 0.6 || 10;
    return Math.hypot(px - entity.x, py - entity.y) - r;
}

/**
 * 判断点 (px,py) 是否进入 entity 碰撞体 + extraRadius 的范围内。
 * 典型用法：投射物半径 this.size，调用 isPointInEntityShape(entity, x, y, this.size)。
 */
export function isPointInEntityShape(entity, px, py, extraRadius = 0) {
    return distanceToEntityShape(entity, px, py) <= extraRadius;
}

/**
 * 判断 entity 的碰撞矩形是否与面向攻击矩形相交。
 * 攻击矩形由原点 (originX,originY)、射程 range、半宽 width、后摆 backExt 和朝向 facingDir 定义。
 * 非矩形碰撞体回退到“点是否在扩张后的矩形内”近似判定。
 */
export function isEntityInAttackRect(entity, originX, originY, range, width, backExt, facingDir) {
    if (!entity || !entity.active) return false;
    const r = entity.collisionRadius || entity.size * 0.6 || 12;

    // 攻击矩形（世界坐标，轴对齐）
    let aminX, amaxX, aminY, amaxY;
    switch (facingDir) {
        case 'right':
            aminX = originX - backExt; amaxX = originX + range;
            aminY = originY - width;   amaxY = originY + width;
            break;
        case 'left':
            aminX = originX - range;   amaxX = originX + backExt;
            aminY = originY - width;   amaxY = originY + width;
            break;
        case 'down':
            aminX = originX - width;   amaxX = originX + width;
            aminY = originY - backExt; amaxY = originY + range;
            break;
        case 'up':
            aminX = originX - width;   amaxX = originX + width;
            aminY = originY - range;   amaxY = originY + backExt;
            break;
        default:
            aminX = originX - range;   amaxX = originX + range;
            aminY = originY - width;   amaxY = originY + width;
    }

    if (entity.collisionShape === 'rect' && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
        const eminX = entity.x - entity.collisionWidth / 2;
        const emaxX = entity.x + entity.collisionWidth / 2;
        const eminY = entity.y - entity.collisionHeight / 2;
        const emaxY = entity.y + entity.collisionHeight / 2;
        return !(emaxX < aminX || eminX > amaxX || emaxY < aminY || eminY > amaxY);
    }

    // 圆形/六边形回退：判断圆心是否在扩张后的矩形内
    const cx = entity.x, cy = entity.y;
    const closestX = Math.max(aminX, Math.min(amaxX, cx));
    const closestY = Math.max(aminY, Math.min(amaxY, cy));
    return Math.hypot(cx - closestX, cy - closestY) <= r;
}
