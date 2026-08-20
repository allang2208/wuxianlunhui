function candidateStaircase(candidate) {
    const surface = candidate?.surface;
    if (surface?.staircase?._isWallStaircase) return surface.staircase;
    if (surface?.owner?._isWallStaircase) return surface.owner;
    return candidate?.staircase?._isWallStaircase ? candidate.staircase : null;
}

/** 多个楼梯/共享面重叠时，稳定选择与当前状态最连续的surface。 */
export function chooseElevatedSurfaceCandidate(unit, candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const currentZ = Number(unit?.z) || 0;
    const currentKind = unit?._surfaceKind || 'ground';
    const currentStaircase = unit?._surfaceStaircase || null;
    const currentStairGroupId = unit?._surfaceStairGroupId
        || currentStaircase?._wallStairGroupId
        || null;
    const currentOwner = unit?._surfaceRef || null;
    const routeStage = unit?._surfaceRouteStage || null;
    const destination = unit?._surfaceNavDestination || null;
    const requestedKind = routeStage === 'handoff_to_wall'
        ? 'wall_walk'
        : (routeStage === 'handoff_to_stairs'
            ? 'stairs'
            : destination?.surfaceKind);
    return candidates
        .map((candidate, index) => {
            const surface = candidate.surface;
            const staircase = candidateStaircase(candidate);
            const stairGroupId = surface?.stairGroupId
                || staircase?._wallStairGroupId
                || null;
            let score = 0;
            if (staircase && staircase === currentStaircase) score += 1000;
            if (stairGroupId && stairGroupId === currentStairGroupId) score += 900;
            if (surface?.owner && surface.owner === currentOwner) score += 500;
            if (surface?.kind === currentKind) score += 200;
            if (surface?.handoffDown) score += 900;
            // AI/RTS 已进入明确的墙梯交接阶段后，目标表面必须压过保持当前楼梯的
            // 通用滞回分。否则楼梯顶部与墙面同时命中时会一直黏在 stairs 身份。
            if (requestedKind === 'wall_walk' && surface?.kind === 'wall_walk') {
                score += 3200;
                if (destination?.wallId
                    && (surface?.wall?.id === destination.wallId
                        || surface?.walls?.some((wall) => wall?.id === destination.wallId))) {
                    score += 400;
                }
            } else if (requestedKind === 'stairs' && surface?.kind === 'stairs') {
                score += 3200;
                if (destination?.stairGroupId
                    && stairGroupId === destination.stairGroupId) {
                    score += 600;
                } else if (destination?.staircaseId
                    && (staircase?.id === destination.staircaseId
                        || staircase?._wallStairGroupMembers?.some((member) =>
                            member?.id === destination.staircaseId))) {
                    score += 400;
                }
            }
            // 共享面只用于补缝；存在高度连续的正常踏步时不得抢占。
            if (surface?.sharedSeam) score += 1;
            score -= Math.abs((Number(surface?.z) || 0) - currentZ) * 4;
            score -= Math.max(0, Number(surface?.distance) || 0) * 0.1;
            return { ...candidate, staircase, score, index };
        })
        .sort((left, right) => right.score - left.score || left.index - right.index)[0];
}

/** 一次性提交surface身份字段，避免owner/wall/staircase来自不同候选。 */
export function commitElevatedSurfaceIdentity(unit, surface, staircase, z, transition = null) {
    const wall = surface?.wall || staircase?.wall || null;
    unit._surfaceKind = surface?.kind || 'ground';
    unit._surfaceRef = surface?.owner || null;
    unit._surfaceWall = wall;
    unit._surfaceWalls = surface?.walls || staircase?.walls || (wall ? [wall] : []);
    unit._surfaceStaircase = staircase || null;
    unit._surfaceStairGroupId = surface?.stairGroupId
        || staircase?._wallStairGroupId
        || null;
    unit._surfaceStairGroupMembers = surface?.stairGroupMembers
        || staircase?._wallStairGroupMembers
        || (staircase ? [staircase] : []);
    unit._surfaceComponentId = Number(surface?.topologyComponentId) || null;
    if (!unit._elevatedState) unit._elevatedState = {};
    unit._elevatedState.kind = unit._surfaceKind;
    unit._elevatedState.wall = wall;
    unit._elevatedState.staircase = staircase || null;
    unit._elevatedState.z = z;
    unit._elevatedState.transition = transition || null;
    if (surface?.validatedSupport
        && (surface.kind === 'stairs' || surface.kind === 'wall_walk')) {
        unit._elevatedState.lastValidated = {
            x: unit.x,
            y: unit.y,
            z,
            kind: surface.kind,
            wall,
            staircase: staircase || null,
            stairGroupId: unit._surfaceStairGroupId,
            revision: surface.topologyRevision || null,
        };
    } else if (!surface) {
        // 地面身份不能保留高架安全点；否则下一次经过楼梯投影区时，连续扫掠会从
        // 陈旧的墙/梯坐标重新把单位拉回高处。
        unit._elevatedState.lastValidated = null;
        unit._elevatedState.lastGround = { x: unit.x, y: unit.y };
        unit._surfaceStairGroupId = null;
        unit._surfaceStairGroupMembers = [];
        unit._surfaceUnsupportedFrames = 0;
    }
    return wall;
}
