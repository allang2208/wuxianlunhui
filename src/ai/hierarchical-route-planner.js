import performanceConfig from '../../data/performance-config.json';

const navConfig = performanceConfig.pathQueue?.hierarchy || {};
const SECTOR_SIZE = Math.max(320, Number(navConfig.sectorSizePx) || 640);
const PORTAL_STEP = Math.max(40, Number(navConfig.portalSampleStepPx) || 80);
const ROUTE_TTL_MS = Math.max(500, Number(navConfig.routeTtlMs) || 3000);
const MAX_ROUTES = Math.max(16, Number(navConfig.maxCachedRoutes) || 96);
const MAX_VISITED = Math.max(64, Number(navConfig.maxVisitedSectors) || 384);
const FRAME_BUDGET_MS = Math.max(0.2, Number(navConfig.frameBudgetMs) || 0.6);

export const HIERARCHY_DEFERRED = Symbol('HIERARCHY_DEFERRED');

const DIRS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
];

const nodeKey = (x, y) => `${x},${y}`;

/**
 * 大地图粗层 A*：只在 640px 扇区图上找门户序列，细层避障仍交给 PathFinder。
 * 扇区路由按拓扑版本/半径桶共享；多单位跨屏追同一目标时不会重复搜索全局路线。
 */
class HierarchicalRoutePlannerImpl {
    constructor() {
        this._routes = new Map();
        this._portals = new Map();
        this._topologyVersion = -1;
        this._pendingRoutes = new Map();
        this.cacheHits = 0;
        this.searches = 0;
        this.negativeHits = 0;
        this._searchesThisFrame = 0;
        this._frameUsedMs = 0;
    }

    beginFrame() {
        this._searchesThisFrame = 0;
        this._frameUsedMs = 0;
        const now = Date.now();
        for (const [key, state] of this._pendingRoutes) {
            if (now - state.lastTouchedAt > 3000) this._pendingRoutes.delete(key);
        }
    }

    _syncTopology(pathFinder) {
        const version = pathFinder?.getTopologyVersion?.() ?? 0;
        if (version === this._topologyVersion) return version;
        this._topologyVersion = version;
        this._routes.clear();
        this._portals.clear();
        this._pendingRoutes.clear();
        return version;
    }

    _portalBetween(ax, ay, bx, by, radius, pathFinder) {
        const version = this._topologyVersion;
        const key = `${version}:${radius}:${ax},${ay}>${bx},${by}`;
        if (this._portals.has(key)) return this._portals.get(key);
        const dx = bx - ax;
        const dy = by - ay;
        const candidates = [];
        if (dx !== 0 && dy === 0) {
            const x = (dx > 0 ? bx : ax) * SECTOR_SIZE;
            const minY = ay * SECTOR_SIZE;
            for (let off = PORTAL_STEP / 2; off < SECTOR_SIZE; off += PORTAL_STEP) {
                candidates.push({ x, y: minY + off });
            }
        } else if (dy !== 0 && dx === 0) {
            const y = (dy > 0 ? by : ay) * SECTOR_SIZE;
            const minX = ax * SECTOR_SIZE;
            for (let off = PORTAL_STEP / 2; off < SECTOR_SIZE; off += PORTAL_STEP) {
                candidates.push({ x: minX + off, y });
            }
        } else {
            candidates.push({
                x: (dx > 0 ? bx : ax) * SECTOR_SIZE,
                y: (dy > 0 ? by : ay) * SECTOR_SIZE,
            });
        }
        const inward = Math.max(radius + 4, 24);
        let best = null;
        let bestScore = Infinity;
        const targetCenterX = (bx + 0.5) * SECTOR_SIZE;
        const targetCenterY = (by + 0.5) * SECTOR_SIZE;
        for (const p of candidates) {
            const fromX = p.x - dx * inward;
            const fromY = p.y - dy * inward;
            const toX = p.x + dx * inward;
            const toY = p.y + dy * inward;
            if (pathFinder.isPointBlocked(fromX, fromY, radius)
                || pathFinder.isPointBlocked(toX, toY, radius)
                || pathFinder.isSegmentBlocked(fromX, fromY, toX, toY, radius)) continue;
            const score = Math.hypot(p.x - targetCenterX, p.y - targetCenterY);
            if (score < bestScore) {
                bestScore = score;
                best = { x: toX, y: toY };
            }
        }
        this._portals.set(key, best);
        return best;
    }

    _remember(key, route) {
        if (this._routes.size >= MAX_ROUTES) {
            let oldestKey = null;
            let oldestAt = Infinity;
            for (const [candidate, entry] of this._routes) {
                if (entry.timestamp < oldestAt) {
                    oldestAt = entry.timestamp;
                    oldestKey = candidate;
                }
            }
            if (oldestKey !== null) this._routes.delete(oldestKey);
        }
        this._routes.set(key, { route, timestamp: Date.now() });
        return route;
    }

    _createRouteState(sx, sy, gx, gy, radius, pathFinder) {
        const margin = 3;
        const minX = Math.min(sx, gx) - margin;
        const maxX = Math.max(sx, gx) + margin;
        const minY = Math.min(sy, gy) - margin;
        const maxY = Math.max(sy, gy) + margin;
        const startKey = nodeKey(sx, sy);
        const goalKey = nodeKey(gx, gy);
        return {
            sx, sy, gx, gy, radius, pathFinder,
            minX, maxX, minY, maxY,
            startKey, goalKey,
            open: [{ x: sx, y: sy, key: startKey, f: 0 }],
            gScore: new Map([[startKey, 0]]),
            cameFrom: new Map(),
            closed: new Set(),
            current: null,
            dirIndex: 0,
            visited: 0,
            lastTouchedAt: Date.now(),
        };
    }

    _reconstructRoute(state) {
        const route = [];
        let key = state.goalKey;
        while (key !== state.startKey) {
            const step = state.cameFrom.get(key);
            if (!step) return null;
            route.push(step.portal);
            key = step.previous;
        }
        route.reverse();
        return route;
    }

    _advanceRoute(state, deadline) {
        while ((state.current || state.open.length > 0) && state.visited < MAX_VISITED) {
            if (!state.current) {
                let bestAt = 0;
                for (let i = 1; i < state.open.length; i++) {
                    if (state.open[i].f < state.open[bestAt].f) bestAt = i;
                }
                const current = state.open.splice(bestAt, 1)[0];
                if (state.closed.has(current.key)) continue;
                state.closed.add(current.key);
                state.visited++;
                if (current.key === state.goalKey) {
                    return { done: true, route: this._reconstructRoute(state) };
                }
                state.current = current;
                state.dirIndex = 0;
            }
            while (state.dirIndex < DIRS.length) {
                const current = state.current;
                const [dx, dy] = DIRS[state.dirIndex++];
                const nx = current.x + dx;
                const ny = current.y + dy;
                if (nx >= state.minX && nx <= state.maxX
                    && ny >= state.minY && ny <= state.maxY) {
                    const nextKey = nodeKey(nx, ny);
                    if (!state.closed.has(nextKey)) {
                        const portal = this._portalBetween(
                            current.x, current.y, nx, ny, state.radius, state.pathFinder
                        );
                        if (portal) {
                            const tentative = (state.gScore.get(current.key) || 0)
                                + (dx !== 0 && dy !== 0 ? 1.414 : 1) * SECTOR_SIZE;
                            if (tentative < (state.gScore.get(nextKey) ?? Infinity)) {
                                state.gScore.set(nextKey, tentative);
                                state.cameFrom.set(nextKey, { previous: current.key, portal });
                                const h = Math.max(
                                    Math.abs(state.gx - nx), Math.abs(state.gy - ny)
                                ) * SECTOR_SIZE;
                                state.open.push({ x: nx, y: ny, key: nextKey, f: tentative + h });
                            }
                        }
                    }
                }
                if (performance.now() >= deadline) return { done: false, route: null };
            }
            state.current = null;
            if (performance.now() >= deadline) return { done: false, route: null };
        }
        return { done: true, route: null };
    }

    getNextWaypoint(startX, startY, targetX, targetY, radius, pathFinder) {
        if (!pathFinder) return null;
        const version = this._syncTopology(pathFinder);
        // 门户采样会读空间哈希；拓扑变化后先用本层预算跨帧重建，
        // 禁止粗层规划在首次 _isBlocked 时触发同步全量尖峰。
        if (pathFinder.isNavigationReady?.() === false) {
            if (this._frameUsedMs >= FRAME_BUDGET_MS) return HIERARCHY_DEFERRED;
            const hashStartedAt = performance.now();
            const remaining = Math.max(0, FRAME_BUDGET_MS - this._frameUsedMs);
            const ready = pathFinder.ensureNavigationReady(hashStartedAt + remaining);
            this._frameUsedMs += performance.now() - hashStartedAt;
            if (!ready) return HIERARCHY_DEFERRED;
        }
        const sx = Math.floor(startX / SECTOR_SIZE);
        const sy = Math.floor(startY / SECTOR_SIZE);
        const gx = Math.floor(targetX / SECTOR_SIZE);
        const gy = Math.floor(targetY / SECTOR_SIZE);
        if (sx === gx && sy === gy) return null;
        const bucket = pathFinder._bucketRadius?.(radius) ?? radius;
        const key = `${version}:${bucket}:${sx},${sy}>${gx},${gy}`;
        const cached = this._routes.get(key);
        let route;
        if (cached && Date.now() - cached.timestamp <= ROUTE_TTL_MS) {
            route = cached.route;
            this.cacheHits++;
            if (route === null) this.negativeHits++;
        } else {
            if (this._frameUsedMs >= FRAME_BUDGET_MS) return HIERARCHY_DEFERRED;
            let state = this._pendingRoutes.get(key);
            if (!state) {
                state = this._createRouteState(sx, sy, gx, gy, bucket, pathFinder);
                this._pendingRoutes.set(key, state);
                this._searchesThisFrame++;
                this.searches++;
            }
            state.lastTouchedAt = Date.now();
            const startedAt = performance.now();
            const remaining = Math.max(0, FRAME_BUDGET_MS - this._frameUsedMs);
            const result = this._advanceRoute(state, startedAt + remaining);
            this._frameUsedMs += performance.now() - startedAt;
            if (!result.done) return HIERARCHY_DEFERRED;
            this._pendingRoutes.delete(key);
            route = this._remember(key, result.route);
        }
        if (!route || route.length === 0) return null;
        const maxRelay = 700;
        let selected = route[0];
        let selectedIndex = 0;
        for (let i = 0; i < route.length; i++) {
            const portal = route[i];
            if (Math.hypot(portal.x - startX, portal.y - startY) > maxRelay) break;
            selected = portal;
            selectedIndex = i;
        }
        if (Math.hypot(selected.x - startX, selected.y - startY) < 160
            && selectedIndex + 1 < route.length) selected = route[selectedIndex + 1];
        const selectedDistance = Math.hypot(selected.x - startX, selected.y - startY);
        if (selectedDistance > maxRelay) {
            const scale = maxRelay / selectedDistance;
            selected = {
                x: startX + (selected.x - startX) * scale,
                y: startY + (selected.y - startY) * scale,
            };
        }
        return { x: selected.x, y: selected.y, hierarchical: true };
    }

    getStats() {
        return {
            cachedRoutes: this._routes.size,
            cachedPortals: this._portals.size,
            cacheHits: this.cacheHits,
            searches: this.searches,
            negativeHits: this.negativeHits,
            pendingRoutes: this._pendingRoutes.size,
            frameUsedMs: this._frameUsedMs,
        };
    }
}

const HierarchicalRoutePlanner = new HierarchicalRoutePlannerImpl();

export { HierarchicalRoutePlanner, HierarchicalRoutePlannerImpl };
