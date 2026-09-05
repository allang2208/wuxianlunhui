// 只缓存不带单位/命令的几何图。地面和高架即使XY重合，也有不同的节点键。
const cache = new Map();
const PENDING = Object.freeze({ pending: true });
export function resetCommandTransitGraphs() { cache.clear(); }
const lengthOf = route => route.reduce((sum, p, i) => i ? sum + Math.hypot(
    p.x - route[i - 1].x, p.y - route[i - 1].y, (p.z || 0) - (route[i - 1].z || 0)) : sum, 0);

export function commandTransitGraph(finder, key, offset, edges) {
    let job = cache.get(key);
    if (!job) {
        if (cache.size >= 8) {
            const disposable = [...cache].find(([, value]) => value.done || Date.now() - value.touched > 2000);
            if (!disposable) return PENDING;
            cache.delete(disposable[0]);
        }
        job = { iterator: edges(), graph: { key, nodes: new Map(), portals: [] }, done: false };
        cache.set(key, job);
    }
    job.touched = Date.now();
    if (job.done) return job.graph;
    if (!finder.advanceNavigationWithinFrameBudget() || !finder._budgetAvailable()) return PENDING;
    const remaining = finder.frameBudgetMs - finder._frameUsedMs - 0.8;
    if (remaining <= 0) return PENDING;
    const started = performance.now(), deadline = started + Math.min(0.4, remaining);
    const nodeFor = (id, point) => {
        let node = job.graph.nodes.get(id);
        if (!node) {
            node = { key: id, x: point.x, y: point.y, point, virtual: true, edges: [] };
            job.graph.nodes.set(id, node);
            if (point.surfaceKind === 'ground') job.graph.portals.push(node);
        }
        return node;
    };
    try {
        while (performance.now() < deadline) {
            const next = job.iterator.next();
            if (next.done) { job.done = true; job.iterator = null; return job.graph; }
            const edge = next.value;
            if (!edge?.route?.length) continue;
            const route = edge.route.map(p => {
                const point = { ...p, x: p.x + offset.x, y: p.y + offset.y };
                delete point.transition; delete point.fromCurrentSurface;
                return point;
            });
            const from = nodeFor(edge.from, route[0]);
            const to = nodeFor(edge.to, route[route.length - 1]);
            const cost = lengthOf(route) + Math.max(0, Number(edge.penalty) || 0);
            from.edges.push({ cell: to, cost, route });
            to.edges.push({ cell: from, cost, route: route.slice().reverse() });
        }
        return PENDING;
    } finally { finder._chargeBudget(started); }
}

/** 地面折线只交给地面执行器；每个上下梯出口必须单独保留，不能跨出口直奔远目标。 */
export function splitCommandTransitPath(path, version) {
    if (!path.some(p => p.surfaceKind === 'stairs' || p.surfaceKind === 'wall_walk')) return null;
    const route = [], ground = [];
    let elevated = false;
    const flushGround = () => {
        if (!ground.length) return;
        const last = ground[ground.length - 1];
        route.push({ ...last, z: 0, surfaceKind: 'ground', navigationPath: ground.splice(0), navigationVersion: version });
    };
    for (const point of path) {
        const high = point.surfaceKind === 'stairs' || point.surfaceKind === 'wall_walk';
        if (high) {
            flushGround();
            const previous = route[route.length - 1];
            if (!previous || previous.x !== point.x || previous.y !== point.y || previous.z !== point.z
                || previous.surfaceKind !== point.surfaceKind) route.push({ ...point });
        } else {
            if (elevated) route.push({ ...point, z: 0, surfaceKind: 'ground' });
            ground.push({ ...point });
        }
        elevated = high;
    }
    flushGround();
    if (route.length) route[0].fromCurrentSurface = true;
    return route;
}
