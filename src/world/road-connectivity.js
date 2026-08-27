function keyOf(i, j) {
    return `${i},${j}`;
}

const NEIGHBORS = Object.freeze([
    [1, 0], [-1, 0], [0, 1], [0, -1],
]);

/**
 * 纯数据道路图。调用方提供当前 road 格和可选的边阻挡判定；本模块不读取
 * Phaser、实体、存档或全局系统，因此前台与后台位面可以复用同一连通算法。
 */
export function createRoadNetwork(cells, { edgeBlocked = null } = {}) {
    const byKey = new Map();
    for (const cell of cells || []) {
        const i = Number(cell?.i);
        const j = Number(cell?.j);
        if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
        const key = cell.key || keyOf(i, j);
        byKey.set(key, { ...cell, i, j, key });
    }

    const adjacency = new Map();
    for (const cell of byKey.values()) {
        const list = [];
        for (const [di, dj] of NEIGHBORS) {
            const neighbor = byKey.get(keyOf(cell.i + di, cell.j + dj));
            if (!neighbor) continue;
            if (edgeBlocked?.(cell, neighbor)) continue;
            list.push(neighbor.key);
        }
        adjacency.set(cell.key, list);
    }

    const componentByKey = new Map();
    const components = new Map();
    let nextComponent = 1;
    for (const start of byKey.keys()) {
        if (componentByKey.has(start)) continue;
        const id = nextComponent++;
        const queue = [start];
        const members = [];
        componentByKey.set(start, id);
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const key = queue[cursor];
            members.push(key);
            for (const neighbor of adjacency.get(key) || []) {
                if (componentByKey.has(neighbor)) continue;
                componentByKey.set(neighbor, id);
                queue.push(neighbor);
            }
        }
        components.set(id, members);
    }
    return { byKey, adjacency, componentByKey, components };
}

/** 多起点 BFS；仅在选择新目的地或拓扑失效时调用。 */
export function shortestRoadRoute(network, startKeys, targetKeys) {
    if (!network) return null;
    const starts = [...new Set(startKeys || [])].filter((key) => network.byKey.has(key));
    const targets = new Set((targetKeys || []).filter((key) => network.byKey.has(key)));
    if (!starts.length || !targets.size) return null;

    const queue = [];
    const previous = new Map();
    for (const key of starts) {
        queue.push(key);
        previous.set(key, null);
        if (targets.has(key)) return [network.byKey.get(key)];
    }
    let found = null;
    for (let cursor = 0; cursor < queue.length && !found; cursor++) {
        const key = queue[cursor];
        for (const neighbor of network.adjacency.get(key) || []) {
            if (previous.has(neighbor)) continue;
            previous.set(neighbor, key);
            if (targets.has(neighbor)) {
                found = neighbor;
                break;
            }
            queue.push(neighbor);
        }
    }
    if (!found) return null;
    const keys = [];
    for (let key = found; key !== null; key = previous.get(key)) keys.push(key);
    keys.reverse();
    return keys.map((key) => network.byKey.get(key));
}
