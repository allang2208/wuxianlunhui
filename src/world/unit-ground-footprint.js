import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * 玩家、怪物、友军和 NPC 的统一地面 footprint。
 *
 * 项目碰撞协议把移动单位的地面体积统一为 Collider.radius；collisionWidth/Height 与
 * collisionShape:'rect' 描述的是躯干受击矩形，不得影响脚下阴影或红色 footprint。
 * centerOverride 仅用于渲染插值后的友军脚点，绝不覆盖半径。
 */
export function resolveUnitGroundFootprint(entity, fallbackRadius = 10, centerOverride = null) {
    const collider = entity?.collider;
    const centerX = Number.isFinite(Number(centerOverride?.x))
        ? Number(centerOverride.x)
        : (Number.isFinite(Number(collider?.x)) ? Number(collider.x) : Number(entity?.x) || 0);
    const centerY = Number.isFinite(Number(centerOverride?.y))
        ? Number(centerOverride.y)
        : (Number.isFinite(Number(collider?.y)) ? Number(collider.y) : Number(entity?.y) || 0);
    const radius = Math.max(
        1,
        Number(collider?.radius) || Number(entity?.groundRadius) || Number(fallbackRadius) || 10
    );
    return {
        x: centerX,
        y: centerY,
        radius,
        width: radius * 2,
        height: radius * 2 * PERSPECTIVE_SCALE_Y,
    };
}
