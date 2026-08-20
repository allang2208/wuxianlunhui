import { WallSystem } from '../world/wall-system.js';
import {
    canUseWallTopModelException,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
    wallHitSupportsTarget,
} from './elevated-ranged.js';

function surfaceIdentityToken(entity) {
    if (!entity) return 'none';
    const kind = entity._surfaceKind === 'stairs' || entity._surfaceKind === 'wall_walk'
        ? entity._surfaceKind
        : 'ground';
    const carrier = kind === 'stairs'
        ? (entity._surfaceStaircase?.id || entity._surfaceRef?.id || '')
        : (kind === 'wall_walk'
            ? (entity._surfaceComponentId || entity._surfaceWall?.id || '')
            : '');
    const revision = Number(entity._elevatedState?.lastValidated?.revision) || 0;
    const heightBand = Math.round((Number(entity.z) || 0) / 12);
    return `${kind}:${carrier}:${revision}:${heightBand}`;
}

/** LOS缓存身份必须随双方承载表面和高架拓扑一起失效。 */
export function rangedLineOfSightCacheToken(source, target) {
    return `${surfaceIdentityToken(source)}>${surfaceIdentityToken(target)}`;
}

/** 枪械、弹道魔法与锁定魔法共享的带高度视线判定。 */
export function hasRangedLineOfSight(source, target, radius = 8, ignore = null) {
    if (!source || !target || !WallSystem) return true;
    const targetX = Number(target.x);
    const targetY = Number(target.y);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

    const elevated = source._surfaceKind === 'stairs' || source._surfaceKind === 'wall_walk'
        || target._surfaceKind === 'stairs' || target._surfaceKind === 'wall_walk'
        || (Number(source.z) || 0) > 0 || (Number(target.z) || 0) > 0;
    if (elevated && typeof WallSystem.projectileBlocked === 'function') {
        const context = projectileWallContext(source, ignore);
        if (typeof WallSystem.projectileWallHit === 'function') {
            const wallHit = WallSystem.projectileWallHit(
                source.x,
                source.y,
                projectileSourceZ(source),
                targetX,
                targetY,
                projectileTargetZ(target),
                context
            );
            return !wallHit || (canUseWallTopModelException(source)
                && wallHitSupportsTarget(wallHit, target));
        }
        return !WallSystem.projectileBlocked(
            source.x,
            source.y,
            projectileSourceZ(source),
            targetX,
            targetY,
            projectileTargetZ(target),
            context
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
    const elevated = source._surfaceKind === 'stairs' || source._surfaceKind === 'wall_walk'
        || (Number(source.z) || 0) > 0;
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
