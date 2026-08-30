// 地牢路线的纯展示几何：只合并真正共线、重合的片段，不产生玩法节点或连接。
const EPSILON = 0.001;
const pointKey = point => `${point.x.toFixed(3)},${point.y.toFixed(3)}`;

export function routePathLength(path) {
    return path.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
}

export function sampleRoutePath(path, distance) {
    let remaining = Math.max(0, distance);
    for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < EPSILON) continue;
        if (remaining <= length || index === path.length - 1) {
            const t = Math.min(1, remaining / length);
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
                angle: Math.atan2(b.y - a.y, b.x - a.x) };
        }
        remaining -= length;
    }
    return { ...path[0], angle: 0 };
}

/** 支持部分重叠及正反向；同一边即使重复经过也只计一次。只在布线缓存更新时调用。 */
export function buildRouteBundles(paths) {
    const lines = new Map();
    for (const [edgeKey, path] of paths) {
        for (let index = 1; index < path.length; index++) {
            const a = path[index - 1], b = path[index];
            let dx = b.x - a.x, dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (length < EPSILON) continue;
            if (dx < -EPSILON || (Math.abs(dx) <= EPSILON && dy < 0)) { dx = -dx; dy = -dy; }
            const ux = dx / length, uy = dy / length;
            const normal = -uy * a.x + ux * a.y;
            const key = `${ux.toFixed(6)}:${uy.toFixed(6)}:${normal.toFixed(3)}`;
            if (!lines.has(key)) lines.set(key, { ux, uy, normal, intervals: [] });
            const line = lines.get(key);
            const start = line.ux * a.x + line.uy * a.y;
            const end = line.ux * b.x + line.uy * b.y;
            line.intervals.push({ low: Math.min(start, end), high: Math.max(start, end), edgeKey });
        }
    }

    const memberGroups = new Map();
    for (const line of lines.values()) {
        const cuts = line.intervals.flatMap(interval => [interval.low, interval.high])
            .sort((a, b) => a - b).filter((value, index, values) => !index || value - values[index - 1] > EPSILON);
        const pointAt = value => ({ x: line.ux * value - line.uy * line.normal,
            y: line.uy * value + line.ux * line.normal });
        for (let index = 1; index < cuts.length; index++) {
            const middle = (cuts[index - 1] + cuts[index]) / 2;
            const edgeKeys = [...new Set(line.intervals.filter(interval =>
                middle > interval.low && middle < interval.high).map(interval => interval.edgeKey))].sort();
            if (!edgeKeys.length) continue;
            const key = edgeKeys.join('|');
            if (!memberGroups.has(key)) memberGroups.set(key, { edgeKeys, pieces: [] });
            memberGroups.get(key).pieces.push({ a: pointAt(cuts[index - 1]), b: pointAt(cuts[index]) });
        }
    }

    const bundles = [];
    for (const { edgeKeys, pieces } of memberGroups.values()) {
        const adjacency = new Map();
        for (let index = 0; index < pieces.length; index++) {
            const piece = pieces[index];
            piece.aKey = pointKey(piece.a);
            piece.bKey = pointKey(piece.b);
            for (const key of [piece.aKey, piece.bKey]) {
                if (!adjacency.has(key)) adjacency.set(key, []);
                adjacency.get(key).push(index);
            }
        }
        const used = new Set();
        const trace = (start, firstIndex) => {
            const path = [];
            let cursor = start, index = firstIndex;
            while (index !== undefined && !used.has(index)) {
                used.add(index);
                const piece = pieces[index];
                const forward = cursor === piece.aKey;
                if (!path.length) path.push(forward ? piece.a : piece.b);
                path.push(forward ? piece.b : piece.a);
                cursor = forward ? piece.bKey : piece.aKey;
                const neighbors = adjacency.get(cursor);
                if (neighbors.length !== 2) break;
                index = neighbors.find(candidate => !used.has(candidate));
            }
            if (path.length > 1) bundles.push({ path, edgeKeys, length: routePathLength(path) });
        };
        // 同成员的连续通道合成一束；分岔处停止，不能把不同出口误合成一条路线。
        for (const [key, neighbors] of adjacency) {
            if (neighbors.length === 2) continue;
            for (const index of neighbors) if (!used.has(index)) trace(key, index);
        }
        for (let index = 0; index < pieces.length; index++) {
            if (!used.has(index)) trace(pieces[index].aKey, index);
        }
    }
    return bundles;
}
