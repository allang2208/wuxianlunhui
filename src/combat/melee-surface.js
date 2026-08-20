const DEFAULT_SURFACE_TOLERANCE = 24;

function surfaceZ(entity) {
    const bottomZ = Number(entity?.collider?.bottomZ);
    return Number.isFinite(bottomZ) ? bottomZ : (Number(entity?.z) || 0);
}

function surfaceKind(entity) {
    const kind = entity?._surfaceKind;
    if (kind === 'ground' || kind === 'stairs' || kind === 'wall_walk') return kind;
    return surfaceZ(entity) > 1 ? 'elevated' : 'ground';
}

function staircasesShareSeam(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftGroupId = left._wallStairGroupId;
    if (leftGroupId && leftGroupId === right._wallStairGroupId) return true;
    const leftSeams = Array.isArray(left._sharedStairSurfaces) ? left._sharedStairSurfaces : [];
    const rightSeams = new Set(
        Array.isArray(right._sharedStairSurfaces) ? right._sharedStairSurfaces : []
    );
    return leftSeams.some((seam) => rightSeams.has(seam));
}

function entityWallSet(entity) {
    const walls = new Set(Array.isArray(entity?._surfaceWalls) ? entity._surfaceWalls : []);
    if (entity?._surfaceWall) walls.add(entity._surfaceWall);
    if (entity?._surfaceStaircase?.wall) walls.add(entity._surfaceStaircase.wall);
    return walls;
}

/**
 * 近战唯一的承载平面门禁。实体可用meleeSurfaceTolerance覆盖默认24px，便于兵种配置；
 * ground与高架永不互打，楼梯要求同梯/共享接缝，墙梯只允许同附着墙的顶部同高交接。
 */
export function canMeleeShareSurface(source, target, tolerance = null) {
    if (!source || !target) return false;
    const sourceKind = surfaceKind(source);
    const targetKind = surfaceKind(target);
    const configuredTolerance = tolerance
        ?? source.meleeSurfaceTolerance
        ?? target.meleeSurfaceTolerance
        ?? DEFAULT_SURFACE_TOLERANCE;
    const verticalTolerance = Math.max(0, Number(configuredTolerance) || 0);
    if (Math.abs(surfaceZ(source) - surfaceZ(target)) > verticalTolerance) return false;
    if ((sourceKind === 'ground') !== (targetKind === 'ground')) return false;
    if (sourceKind === 'ground' && targetKind === 'ground') return true;

    if (sourceKind === 'stairs' && targetKind === 'stairs') {
        return staircasesShareSeam(source._surfaceStaircase, target._surfaceStaircase);
    }
    if (sourceKind === 'wall_walk' && targetKind === 'wall_walk') {
        const sourceComponent = Number(source._surfaceComponentId) || 0;
        const targetComponent = Number(target._surfaceComponentId) || 0;
        if (sourceComponent && targetComponent) return sourceComponent === targetComponent;
        const sourceWalls = entityWallSet(source);
        const targetWalls = entityWallSet(target);
        if (sourceWalls.size && targetWalls.size) {
            for (const wall of sourceWalls) if (targetWalls.has(wall)) return true;
            return false;
        }
        // 正式墙顶身份缺少载体信息时失败关闭，不能退化成“只看Z差”。
        return false;
    }

    const wallStairPair = (sourceKind === 'stairs' && targetKind === 'wall_walk')
        || (sourceKind === 'wall_walk' && targetKind === 'stairs');
    if (wallStairPair) {
        const sourceWalls = entityWallSet(source);
        const targetWalls = entityWallSet(target);
        for (const wall of sourceWalls) if (targetWalls.has(wall)) return true;
        return false;
    }
    return sourceKind === targetKind;
}
