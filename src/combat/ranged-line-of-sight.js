import { WallSystem } from '../world/wall-system.js';
import {
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
} from './elevated-ranged.js';

/** 枪械、弹道魔法与锁定魔法共享的带高度视线判定。 */
export function hasRangedLineOfSight(source, target, radius = 8, ignore = null) {
    if (!source || !target || !WallSystem) return true;
    const targetX = Number(target.x);
    const targetY = Number(target.y);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

    const elevated = (Number(source.z) || 0) > 0 || (Number(target.z) || 0) > 0;
    if (elevated && typeof WallSystem.projectileBlocked === 'function') {
        return !WallSystem.projectileBlocked(
            source.x,
            source.y,
            projectileSourceZ(source),
            targetX,
            targetY,
            projectileTargetZ(target),
            projectileWallContext(source, ignore)
        );
    }
    if (typeof WallSystem.resolve === 'function') {
        const resolved = WallSystem.resolve(
            source.x,
            source.y,
            targetX,
            targetY,
            radius,
            ignore
        );
        return Math.abs(resolved.x - targetX) <= 1
            && Math.abs(resolved.y - targetY) <= 1;
    }
    return !WallSystem.blocked?.(source.x, source.y, targetX, targetY, ignore);
}

/**
 * 返回直线远程攻击的最终可达点。高架时按弹道高度二分墙交点；
 * 地面时保持原 WallSystem.resolve 口径。
 */
export function resolveRangedLineEnd(source, endX, endY, radius = 8) {
    if (!source || !WallSystem) return { x: endX, y: endY };
    const sourceZ = projectileSourceZ(source);
    const elevated = (Number(source.z) || 0) > 0;
    if (!elevated || typeof WallSystem.projectileBlocked !== 'function') {
        return WallSystem.resolve
            ? WallSystem.resolve(source.x, source.y, endX, endY, radius)
            : { x: endX, y: endY };
    }

    const context = projectileWallContext(source);
    if (!WallSystem.projectileBlocked(
        source.x, source.y, sourceZ,
        endX, endY, sourceZ,
        context
    )) {
        return { x: endX, y: endY };
    }

    let low = 0;
    let high = 1;
    for (let index = 0; index < 14; index++) {
        const mid = (low + high) * 0.5;
        const x = source.x + (endX - source.x) * mid;
        const y = source.y + (endY - source.y) * mid;
        if (WallSystem.projectileBlocked(
            source.x, source.y, sourceZ,
            x, y, sourceZ,
            context
        )) {
            high = mid;
        } else {
            low = mid;
        }
    }
    return {
        x: source.x + (endX - source.x) * low,
        y: source.y + (endY - source.y) * low,
    };
}
