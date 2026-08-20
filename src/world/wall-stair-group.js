export function wallStairGroupId(staircase) {
    if (!staircase) return '';
    return staircase._wallStairGroupId
        || (staircase.id ? `wall-stair-group:${staircase.id}` : '');
}

export function wallStairGroupMembers(staircase) {
    if (!staircase) return [];
    const members = Array.isArray(staircase._wallStairGroupMembers)
        ? staircase._wallStairGroupMembers
        : [staircase];
    return members.filter((member) => member?.active !== false && member?._isWallStaircase);
}

export function wallStairsShareGroup(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftId = wallStairGroupId(left);
    return !!leftId && leftId === wallStairGroupId(right);
}

/** 楼梯组注册器：识别并排同向楼梯、生成共享接缝、维护外轮廓边界。 */
export function createWallStairGroupRegistry(deps) {
    const {
        config,
        state,
        getStaircases,
        convexHull,
        isoLocalToWorldDelta,
        worldDeltaToIsoLocal,
    } = deps;

    const railDistance = (left, right) => {
        if (!left || !right) return Infinity;
        const direct = Math.hypot(left[0].x - right[0].x, left[0].y - right[0].y)
            + Math.hypot(left[1].x - right[1].x, left[1].y - right[1].y);
        const reversed = Math.hypot(left[0].x - right[1].x, left[0].y - right[1].y)
            + Math.hypot(left[1].x - right[0].x, left[1].y - right[0].y);
        return Math.min(direct, reversed);
    };

    const nearestRailPair = (surfaceA, surfaceB) => {
        if (!surfaceA || !surfaceB) return null;
        const railsA = [
            [surfaceA.entryA, surfaceA.exitA],
            [surfaceA.entryB, surfaceA.exitB],
        ];
        const railsB = [
            [surfaceB.entryA, surfaceB.exitA],
            [surfaceB.entryB, surfaceB.exitB],
        ];
        let best = null;
        for (const railA of railsA) {
            for (const railB of railsB) {
                const distance = railDistance(railA, railB);
                if (!best || distance < best.distance) best = { railA, railB, distance };
            }
        }
        return best;
    };

    const areSideBySide = (left, right) => {
        if (!left?.active || !right?.active || left === right) return false;
        if (left.dir !== right.dir || left.ascendingSign !== right.ascendingSign) return false;
        if (left.segmentCount !== right.segmentCount
            || Math.abs(left.targetTopZ - right.targetTopZ) > 1
            || Math.abs(left.groundZ - right.groundZ) > 1) return false;
        const run = config.cellWidth / Math.SQRT2;
        const sideStep = left.dir === 'e1'
            ? isoLocalToWorldDelta(0, run)
            : isoLocalToWorldDelta(run, 0);
        const dx = right.segments?.[0]?.x - left.segments?.[0]?.x;
        const dy = right.segments?.[0]?.y - left.segments?.[0]?.y;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
        const local = worldDeltaToIsoLocal(dx, dy);
        const runError = left.dir === 'e1' ? Math.abs(local.u) : Math.abs(local.v);
        const sideValue = left.dir === 'e1' ? local.v : local.u;
        const sideError = Math.min(
            Math.abs(sideValue - run),
            Math.abs(sideValue + run)
        );
        return runError <= config.runTolerance
            && sideError <= config.centerTolerance
            && Math.min(
                Math.hypot(dx - sideStep.x, dy - sideStep.y),
                Math.hypot(dx + sideStep.x, dy + sideStep.y)
            ) <= config.centerTolerance + config.runTolerance;
    };

    const makeSeam = (stairA, stairB, surfaceA, surfaceB, options = {}) => {
        const pair = nearestRailPair(surfaceA, surfaceB);
        if (!pair || pair.distance > config.railGapTolerance) return null;
        let railB = pair.railB;
        const direct = Math.hypot(pair.railA[0].x - railB[0].x, pair.railA[0].y - railB[0].y)
            + Math.hypot(pair.railA[1].x - railB[1].x, pair.railA[1].y - railB[1].y);
        const reversed = Math.hypot(pair.railA[0].x - railB[1].x, pair.railA[0].y - railB[1].y)
            + Math.hypot(pair.railA[1].x - railB[0].x, pair.railA[1].y - railB[0].y);
        if (reversed < direct) railB = [railB[1], railB[0]];
        const hull = convexHull([
            { key: 'a0', ...pair.railA[0] },
            { key: 'a1', ...pair.railA[1] },
            { key: 'b0', ...railB[0] },
            { key: 'b1', ...railB[1] },
        ]);
        if (hull.length < 3) return null;
        return {
            stairA,
            stairB,
            railA: pair.railA,
            railB,
            footprint: { x: 0, y: 0, _pixelFootprintLocal: hull },
            entry: {
                x: (pair.railA[0].x + railB[0].x) * 0.5,
                y: (pair.railA[0].y + railB[0].y) * 0.5,
            },
            exit: {
                x: (pair.railA[1].x + railB[1].x) * 0.5,
                y: (pair.railA[1].y + railB[1].y) * 0.5,
            },
            connector: !!options.connector,
            segmentIndex: Number.isInteger(options.segmentIndex)
                ? options.segmentIndex
                : null,
        };
    };

    const activeList = (staircases = null) => Array.from(staircases || getStaircases() || [])
        .filter((staircase) => staircase?.active && staircase._isWallStaircase);

    const signature = (staircases = null) => activeList(staircases)
        .map((staircase) => [
            staircase.id,
            Number(staircase.segments?.[0]?.x).toFixed(2),
            Number(staircase.segments?.[0]?.y).toFixed(2),
            staircase.dir,
            staircase.ascendingSign,
            staircase.segmentCount,
            Number(staircase.targetTopZ).toFixed(2),
        ].join(':'))
        .sort()
        .join('|');

    const rebuild = (staircases = null) => {
        const list = activeList(staircases);
        const adjacency = new Map(list.map((staircase) => [staircase, new Set()]));
        for (const staircase of list) {
            staircase._unregisterEdgeSegs?.();
            staircase._sharedStairSurfaces = [];
            staircase._sharedRailSegments = [];
            staircase._wallStairGroupId = '';
            staircase._wallStairGroupMembers = [staircase];
        }
        for (let leftIndex = 0; leftIndex < list.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex++) {
                const left = list[leftIndex];
                const right = list[rightIndex];
                if (!areSideBySide(left, right)) continue;
                const segmentSeams = [];
                for (let segmentIndex = 0; segmentIndex < left.segmentCount; segmentIndex++) {
                    const seam = makeSeam(
                        left,
                        right,
                        left.visualSegments?.[segmentIndex]?.walkSurface,
                        right.visualSegments?.[segmentIndex]?.walkSurface,
                        { segmentIndex }
                    );
                    if (!seam) continue;
                    segmentSeams.push(seam);
                }
                // 只有每一级踏步都能生成真实共享面，才把两座楼梯注册为同一组。
                // 不能只凭中心距合组，否则入口虽变宽，中段仍可能保留不可跨越的暗缝。
                if (segmentSeams.length !== left.segmentCount) continue;
                adjacency.get(left)?.add(right);
                adjacency.get(right)?.add(left);
                for (const seam of segmentSeams) {
                    left._sharedStairSurfaces.push(seam);
                    right._sharedStairSurfaces.push(seam);
                    left._sharedRailSegments.push(seam.railA);
                    right._sharedRailSegments.push(seam.railB);
                }
                const connectorSeam = makeSeam(
                    left,
                    right,
                    left.wallConnectorSurface?.(),
                    right.wallConnectorSurface?.(),
                    { connector: true }
                );
                if (connectorSeam) {
                    left._sharedStairSurfaces.push(connectorSeam);
                    right._sharedStairSurfaces.push(connectorSeam);
                    left._sharedRailSegments.push(connectorSeam.railA);
                    right._sharedRailSegments.push(connectorSeam.railB);
                }
            }
        }
        const nextVersion = (state.version || 0) + 1;
        const groups = new Map();
        const visited = new Set();
        for (const staircase of list) {
            if (visited.has(staircase)) continue;
            const members = [];
            const pending = [staircase];
            visited.add(staircase);
            while (pending.length) {
                const current = pending.shift();
                members.push(current);
                for (const neighbor of adjacency.get(current) || []) {
                    if (visited.has(neighbor)) continue;
                    visited.add(neighbor);
                    pending.push(neighbor);
                }
            }
            members.sort((left, right) => String(left.id).localeCompare(String(right.id)));
            const groupId = `wall-stair-group:${members.map((member) => member.id).join('|')}`;
            const group = {
                id: groupId,
                members,
                memberIds: new Set(members.map((member) => member.id)),
                version: nextVersion,
            };
            groups.set(groupId, group);
            for (const member of members) {
                member._wallStairGroupId = groupId;
                member._wallStairGroupMembers = members;
                member._wallStairGroup = group;
                for (const seam of member._sharedStairSurfaces || []) {
                    seam.groupId = groupId;
                    seam.group = group;
                }
            }
        }
        for (const staircase of list) staircase._registerEdgeSegs?.();
        state.signature = signature(list);
        state.version = nextVersion;
        state.groups = groups;
        for (const staircase of list) staircase._wallStairGroupVersion = state.version;
        return list;
    };

    const ensure = (staircases = null) => {
        const list = activeList(staircases);
        const nextSignature = signature(list);
        const stale = nextSignature !== state.signature
            || list.some((staircase) =>
                !Array.isArray(staircase._sharedStairSurfaces)
                || !Array.isArray(staircase._sharedRailSegments)
                || staircase._wallStairGroupVersion !== state.version);
        return stale ? rebuild(list) : list;
    };

    return {
        railDistance,
        areSideBySide,
        makeSeam,
        signature,
        rebuild,
        ensure,
    };
}
