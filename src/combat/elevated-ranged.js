import defenseStructuresJson from '../../data/defense-structures.json';

const rangedCfg = defenseStructuresJson.wallWalk?.rangedCombat || {};
const finiteOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

export const ELEVATED_RANGED_CONFIG = Object.freeze({
    rangeMultiplier: Math.max(1, finiteOr(rangedCfg.rangeMultiplier, 1.2)),
    wallClearance: Math.max(0, finiteOr(rangedCfg.wallClearance, 2)),
    wallClearanceRadius: Math.max(0, finiteOr(rangedCfg.wallClearanceRadius, 220)),
});

/** 仅玩家与友军站在正式墙顶面时享受高架远程加成；楼梯途中与敌人不加成。 */
export function isFriendlyWallTopRangedSource(source) {
    if (!source || source._surfaceKind !== 'wall_walk') return false;
    return source._faction === 'player' || source._faction === 'companion';
}

export function getElevatedRangedRangeMultiplier(source) {
    return isFriendlyWallTopRangedSource(source)
        ? ELEVATED_RANGED_CONFIG.rangeMultiplier
        : 1;
}

export function applyElevatedRangedRange(source, baseRange) {
    const range = Math.max(0, Number(baseRange) || 0);
    return range * getElevatedRangedRangeMultiplier(source);
}

export function projectileSourceZ(source, heightFactor = 0.58) {
    const height = Number(source?.collider?.height)
        || Number(source?.collisionHeight)
        || Number(source?.bodyHeight)
        || Number(source?.size)
        || 40;
    return (Number(source?.z) || 0) + height * heightFactor;
}

export function projectileTargetZ(target, fallback = 24) {
    if (!target) return fallback;
    const centerZ = Number(target.collider?.centerZ);
    if (Number.isFinite(centerZ)) return centerZ;
    const height = Number(target.collider?.height)
        || Number(target.collisionHeight)
        || Number(target.bodyHeight)
        || Number(target.size)
        || fallback * 2;
    return (Number(target.z) || 0) + height * 0.5;
}

/** 给墙体弹道检测附加发射者上下文，不改变既有 segs/rects ignore 集合。 */
export function projectileWallContext(source, ignore = null) {
    const context = ignore ? { ...ignore } : {};
    context.projectileSource = source || null;
    context.wallClearance = isFriendlyWallTopRangedSource(source)
        ? ELEVATED_RANGED_CONFIG.wallClearance
        : 0;
    context.wallClearanceRadius = ELEVATED_RANGED_CONFIG.wallClearanceRadius;
    context.wallClearanceOrigin = source
        ? { x: Number(source.x) || 0, y: Number(source.y) || 0 }
        : null;
    context.wallClearanceWalls = new Set();
    const sourceWalls = Array.isArray(source?._surfaceWalls)
        ? source._surfaceWalls
        : [];
    for (const wall of [
        ...sourceWalls,
        source?._surfaceWall,
    ]) {
        if (!wall) continue;
        context.wallClearanceWalls.add(wall);
        if (wall._wallRect) context.wallClearanceWalls.add(wall._wallRect);
        if (wall._coverSeg) context.wallClearanceWalls.add(wall._coverSeg);
        if (wall._gateSeg) context.wallClearanceWalls.add(wall._gateSeg);
    }
    return context;
}
