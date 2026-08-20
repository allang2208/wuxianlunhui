function patchKind(surface) {
    if (!surface) return null;
    if (surface.elevatedPatch) return surface.elevatedPatch;
    if (surface.handoffDown || surface.connector) return 'wall-stair-bridge';
    if (surface.sharedSeam) return 'stair-seam';
    if (surface.kind === 'stairs') return 'stair';
    if (surface.kind === 'wall_walk') return 'wall';
    return 'elevated';
}

function midpoint(a, b, fallback = null) {
    if (a && b) return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    if (fallback && Number.isFinite(fallback.x) && Number.isFinite(fallback.y)) {
        return { x: fallback.x, y: fallback.y };
    }
    return null;
}

function activeStairGroupMembers(staircase) {
    const members = Array.isArray(staircase?._wallStairGroupMembers)
        ? staircase._wallStairGroupMembers
        : [staircase];
    return members.filter((member) => member?.active && member?._isWallStaircase);
}

/**
 * 楼梯底部唯一的地面门户。这里只读取楼梯贴图导出的 walkSurface，避免另造一套
 * footprint。groundPoint 位于楼梯外侧，供地面 A* 与下楼路线真正穿过边界。
 */
export function stairGroundPortal(staircase, outsideDistance = 14) {
    const walkSurface = staircase?.visualSegments?.[0]?.walkSurface
        || staircase?.segments?.[0]?.walkSurface;
    const entry = midpoint(walkSurface?.entryA, walkSurface?.entryB, walkSurface?.entry);
    const exit = midpoint(walkSurface?.exitA, walkSurface?.exitB, walkSurface?.exit);
    if (!entry || !exit) return null;
    const runX = exit.x - entry.x;
    const runY = exit.y - entry.y;
    const runLength = Math.hypot(runX, runY);
    if (runLength <= 1e-6) return null;
    const mouthX = walkSurface?.entryA && walkSurface?.entryB
        ? walkSurface.entryB.x - walkSurface.entryA.x
        : -runY;
    const mouthY = walkSurface?.entryA && walkSurface?.entryB
        ? walkSurface.entryB.y - walkSurface.entryA.y
        : runX;
    const entryWidth = Math.hypot(mouthX, mouthY)
        || Math.max(8, Number(staircase?.walkWidth) || 48);
    const distance = Math.max(4, Number(outsideDistance) || 14);
    const axisX = runX / runLength;
    const axisY = runY / runLength;
    const acrossAxisX = mouthX / entryWidth;
    const acrossAxisY = mouthY / entryWidth;
    const basisDeterminant = axisX * acrossAxisY - axisY * acrossAxisX;
    if (Math.abs(basisDeterminant) <= 1e-6) return null;
    return {
        staircase,
        entryA: walkSurface?.entryA || null,
        entryB: walkSurface?.entryB || null,
        entry,
        exit,
        axisX,
        axisY,
        acrossAxisX,
        acrossAxisY,
        basisDeterminant,
        runLength,
        halfWidth: entryWidth * 0.5,
        groundPoint: {
            x: entry.x - axisX * distance,
            y: entry.y - axisY * distance,
        },
    };
}

/**
 * 相邻同向楼梯共享一个连续的底部入口带。路线仍可选择单座楼梯的中心线，但实际
 * Portal 捕获覆盖整组外沿，避免路线选中 A、脚底落在 B 或两者接缝时被当成非法进入。
 */
export function stairGroupGroundPortal(staircase, outsideDistance = 14) {
    const members = activeStairGroupMembers(staircase);
    const memberPortals = members
        .map((member) => stairGroundPortal(member, outsideDistance))
        .filter(Boolean);
    if (!memberPortals.length) return null;
    if (memberPortals.length === 1) {
        return {
            ...memberPortals[0],
            groupId: staircase?._wallStairGroupId || null,
            members,
            memberPortals,
        };
    }

    const reference = memberPortals[0];
    let alongTotal = 0;
    let minAcross = Infinity;
    let maxAcross = -Infinity;
    for (const portal of memberPortals) {
        const coords = portalCoordinates(reference, portal.entry);
        alongTotal += coords.along;
        const across = coords.acrossSigned;
        minAcross = Math.min(minAcross, across - portal.halfWidth);
        maxAcross = Math.max(maxAcross, across + portal.halfWidth);
    }
    const along = alongTotal / memberPortals.length;
    const across = (minAcross + maxAcross) * 0.5;
    const entry = portalPoint(reference, along, across);
    const distance = Math.max(4, Number(outsideDistance) || 14);
    return {
        staircase,
        groupId: staircase?._wallStairGroupId || null,
        members,
        memberPortals,
        entry,
        exit: {
            x: entry.x + reference.axisX * reference.runLength,
            y: entry.y + reference.axisY * reference.runLength,
        },
        axisX: reference.axisX,
        axisY: reference.axisY,
        acrossAxisX: reference.acrossAxisX,
        acrossAxisY: reference.acrossAxisY,
        basisDeterminant: reference.basisDeterminant,
        runLength: reference.runLength,
        halfWidth: Math.max(reference.halfWidth, (maxAcross - minAcross) * 0.5),
        groundPoint: {
            x: entry.x - reference.axisX * distance,
            y: entry.y - reference.axisY * distance,
        },
    };
}

/**
 * 返回整组入口外侧、并尽量保持参考点横向通道的地面点。
 * 宽楼梯组的路线和首次接触兜底不能全部收束到某一座楼梯中心。
 */
export function stairGroupGroundPoint(
    staircase,
    referencePoint = null,
    outsideDistance = 14,
    edgeInset = 2
) {
    const portal = stairGroupGroundPortal(staircase, outsideDistance);
    if (!portal) return null;
    if (!referencePoint
        || !Number.isFinite(referencePoint.x)
        || !Number.isFinite(referencePoint.y)) {
        return { ...portal.groundPoint };
    }
    const across = portalCoordinates(portal, referencePoint).acrossSigned;
    const usableHalfWidth = Math.max(
        0,
        portal.halfWidth - Math.max(0, Number(edgeInset) || 0)
    );
    const clampedAcross = Math.max(-usableHalfWidth, Math.min(usableHalfWidth, across));
    return {
        x: portal.groundPoint.x + portal.acrossAxisX * clampedAcross,
        y: portal.groundPoint.y + portal.acrossAxisY * clampedAcross,
    };
}

function portalCoordinates(portal, point) {
    const dx = point.x - portal.entry.x;
    const dy = point.y - portal.entry.y;
    const determinant = Number(portal.basisDeterminant)
        || (portal.axisX * portal.acrossAxisY - portal.axisY * portal.acrossAxisX);
    if (Math.abs(determinant) <= 1e-8) {
        return { along: 0, acrossSigned: 0, across: 0 };
    }
    const along = (dx * portal.acrossAxisY - dy * portal.acrossAxisX) / determinant;
    const acrossSigned = (portal.axisX * dy - portal.axisY * dx) / determinant;
    return {
        along,
        acrossSigned,
        across: Math.abs(acrossSigned),
    };
}

function portalPoint(portal, along, across) {
    return {
        x: portal.entry.x + portal.axisX * along + portal.acrossAxisX * across,
        y: portal.entry.y + portal.axisY * along + portal.acrossAxisY * across,
    };
}

/** 把入口点限制在整组外侧护栏为单位碰撞半径预留后的安全横向通道内。 */
export function clampStairGroupPortalLane(portal, point, edgeInset = 0) {
    if (!portal || !point) return point || null;
    const coords = portalCoordinates(portal, point);
    const safeHalfWidth = Math.max(
        0,
        portal.halfWidth - Math.max(0, Number(edgeInset) || 0)
    );
    const across = Math.max(
        -safeHalfWidth,
        Math.min(safeHalfWidth, coords.acrossSigned)
    );
    return portalPoint(portal, coords.along, across);
}

/**
 * 判断一次实际位移是否穿过楼梯底部门户。返回 null 表示普通移动或非法侧向离面。
 * direction=enter 用于 ground→stairs，direction=exit 用于 stairs→ground。
 */
export function resolveStairGroundPortalTransition(
    staircase,
    from,
    to,
    direction,
    options = {}
) {
    if (!staircase?.active || !from || !to) return null;
    const portal = options.grouped === false
        ? stairGroundPortal(staircase, options.outsideDistance)
        : stairGroupGroundPortal(staircase, options.outsideDistance);
    if (!portal) return null;
    const fromCoords = portalCoordinates(portal, from);
    const toCoords = portalCoordinates(portal, to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.01) return null;
    const margin = Math.max(2, Number(options.captureMargin) || 6);
    const alongDelta = toCoords.along - fromCoords.along;
    const crossingT = Math.abs(alongDelta) > 1e-6
        ? Math.max(0, Math.min(1, -fromCoords.along / alongDelta))
        : 0;
    const crossingAcross = Math.abs(
        fromCoords.acrossSigned
            + (toCoords.acrossSigned - fromCoords.acrossSigned) * crossingT
    );
    const withinMouth = crossingAcross <= portal.halfWidth + margin;
    if (!withinMouth) return null;

    if (direction === 'enter') {
        // 只认是否实际向入口内侧推进，不再要求20%的轴向夹角。宽入口允许斜向汇入，
        // 侧向误吸附仍由入口平面、整组宽度和首段surface三重约束阻止。
        if (alongDelta <= 0.01) return null;
        if (fromCoords.along > margin || toCoords.along < -margin) return null;
        return { kind: 'ground_to_stairs', fromKind: 'ground', toKind: 'stairs', portal };
    }
    if (direction === 'exit') {
        if (alongDelta >= -0.01) return null;
        if (fromCoords.along < -margin || toCoords.along > margin) return null;
        return { kind: 'stairs_to_ground', fromKind: 'stairs', toKind: 'ground', portal };
    }
    return null;
}

/** 统一收集墙顶、楼梯、共享缝与墙梯接口候选。 */
export function createUnifiedElevatedNavigation(options) {
    const {
        chooseCandidate,
        candidateAllowed = null,
        maxStaircaseDistance = 240,
    } = options;

    const query = (unit, x, y, staircases, wallSurfaceResolver) => {
        const candidates = [];
        const seenSharedSeams = new Set();
        for (const staircase of staircases || []) {
            if (!staircase?.active) continue;
            if (staircase._isWallStaircase) {
                const nearby = (staircase.segments || []).some((segment) =>
                    Math.hypot(segment.x - x, segment.y - y) <= maxStaircaseDistance);
                if (!nearby && (!staircase.wall
                    || Math.hypot(staircase.wall.x - x, staircase.wall.y - y)
                        > maxStaircaseDistance)) continue;
            }
            let surface = null;
            if (typeof staircase.surfaceAt === 'function') {
                surface = staircase.surfaceAt(x, y, unit);
            }
            if (surface) {
                const surfaceStaircase = surface.staircase || staircase;
                surface.stairGroupId = surfaceStaircase?._wallStairGroupId || null;
                surface.stairGroupMembers = surfaceStaircase?._wallStairGroupMembers
                    || (surfaceStaircase ? [surfaceStaircase] : []);
                surface.validatedSupport = true;
                if (surface.sharedSeamRef) {
                    if (!seenSharedSeams.has(surface.sharedSeamRef)) {
                        seenSharedSeams.add(surface.sharedSeamRef);
                        surface.elevatedPatch = patchKind(surface);
                        candidates.push({
                            surface,
                            staircase: surface.staircase || staircase,
                        });
                    }
                } else {
                    surface.elevatedPatch = patchKind(surface);
                    candidates.push({
                        surface,
                        staircase: surface.staircase || staircase,
                    });
                }
            }
            const bridge = staircase.navigationBridgeAt?.(x, y, unit);
            if (bridge) {
                bridge.validatedSupport = true;
                bridge.elevatedPatch = patchKind(bridge);
                candidates.push({
                    surface: bridge,
                    staircase: bridge.staircase || staircase,
                });
            }
        }
        const wallSurface = wallSurfaceResolver?.(x, y);
        if (wallSurface) {
            wallSurface.validatedSupport = true;
            wallSurface.elevatedPatch = patchKind(wallSurface);
            candidates.push({ surface: wallSurface, staircase: null });
        }
        const eligibleCandidates = typeof candidateAllowed === 'function'
            ? candidates.filter((candidate) => candidateAllowed(unit, candidate))
            : candidates;
        const selected = chooseCandidate(unit, eligibleCandidates);
        return selected
            ? {
                surface: selected.surface,
                staircase: selected.staircase,
                candidateCount: eligibleCandidates.length,
            }
            : { surface: null, staircase: null, candidateCount: 0 };
    };

    const commitFlags = (unit, surface) => {
        const patch = patchKind(surface);
        unit._elevatedNavigationActive = !!surface
            && (surface.kind === 'stairs' || surface.kind === 'wall_walk');
        unit._elevatedNavigationPatch = patch;
        unit._elevatedNavigationBridge = patch === 'wall-stair-bridge'
            || patch === 'stair-seam';
        unit._elevatedNavigationComponent = unit._elevatedNavigationActive
            ? (surface?.walls || []).map((wall) => wall?.id).filter(Boolean).sort().join('|')
            : null;
    };

    /**
     * 从最后有效支撑点扫到本帧落点。无支撑采样先交给 transitionAt 判定合法门户切换，
     * 只有 invalid_gap 才停在前一有效点。
     */
    const sweep = (from, to, queryAt, maxStep = 3, transitionAt = null) => {
        if (!from || !to || typeof queryAt !== 'function') {
            return {
                surface: null,
                staircase: null,
                x: to?.x,
                y: to?.y,
                completed: false,
                outcome: 'invalid',
            };
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy);
        const samples = Math.max(1, Math.min(128, Math.ceil(distance / Math.max(1, maxStep))));
        let last = queryAt(from.x, from.y);
        if (!last?.surface) {
            return {
                surface: null,
                staircase: null,
                x: from.x,
                y: from.y,
                completed: false,
                outcome: 'invalid_start',
            };
        }
        let lastX = from.x;
        let lastY = from.y;
        for (let index = 1; index <= samples; index++) {
            const t = index / samples;
            const x = from.x + dx * t;
            const y = from.y + dy * t;
            const queried = queryAt(x, y);
            if (!queried?.surface) {
                const transition = typeof transitionAt === 'function'
                    ? transitionAt({
                        from: { x: lastX, y: lastY },
                        to: { x, y },
                        destination: { x: to.x, y: to.y },
                        previous: last,
                        index,
                        samples,
                    })
                    : null;
                if (transition) {
                    return {
                        surface: null,
                        staircase: transition.staircase || last.staircase || null,
                        x: to.x,
                        y: to.y,
                        completed: true,
                        outcome: transition.kind || 'transition',
                        transition,
                    };
                }
                return {
                    ...last,
                    x: lastX,
                    y: lastY,
                    completed: false,
                    outcome: 'invalid_gap',
                };
            }
            last = queried;
            lastX = x;
            lastY = y;
        }
        return { ...last, x: lastX, y: lastY, completed: true, outcome: 'supported' };
    };

    return { query, sweep, commitFlags };
}
