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
    const currentPlatform = unit?._platformRef || null;
    const currentOwner = unit?._surfaceRef || null;
    return candidates
        .map((candidate, index) => {
            const surface = candidate.surface;
            const staircase = candidateStaircase(candidate);
            let score = 0;
            if (staircase && staircase === currentPlatform) score += 1000;
            if (surface?.owner && surface.owner === currentOwner) score += 500;
            if (surface?.kind === currentKind) score += 200;
            if (surface?.handoffDown) score += 900;
            // 共享面只用于补缝；存在高度连续的正常踏步时不得抢占。
            if (surface?.sharedSeam) score += 1;
            score -= Math.abs((Number(surface?.z) || 0) - currentZ) * 4;
            score -= Math.max(0, Number(surface?.distance) || 0) * 0.1;
            return { ...candidate, staircase, score, index };
        })
        .sort((left, right) => right.score - left.score || left.index - right.index)[0];
}

/** 一次性提交surface身份字段，避免owner/wall/platform来自不同候选。 */
export function commitElevatedSurfaceIdentity(unit, surface, staircase, z) {
    const wall = surface?.wall || staircase?.wall || null;
    unit._surfaceKind = surface?.kind || 'ground';
    unit._surfaceRef = surface?.owner || null;
    unit._surfaceWall = wall;
    unit._surfaceWalls = surface?.walls || staircase?.walls || (wall ? [wall] : []);
    unit._platformRef = staircase || null;
    unit._platformLift = z;
    unit._onPlatform = !!surface && z > 1;
    return wall;
}
