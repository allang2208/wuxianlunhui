import performanceConfig from '../../data/performance-config.json';

const config = performanceConfig.pathQueue?.commandRoutes || {};
const TILE_CELLS = 16;
const MAX_FIELDS = config.maxFields || 12;
const MAX_CELLS = config.maxCellsPerField || 32768;
const MAX_RESIDENT = config.maxResidentCells || 65536;
const MAX_TILES = config.maxTiles || 512;
const TTL = config.cacheTtlMs || 3000;
const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
const PENDING = Object.freeze({ status: 'pending' });
const LIMITED = Object.freeze({ status: 'search_limited', reason: '路线搜索受限，未确认可达' });
const UNREACHABLE = Object.freeze({ status: 'unreachable', reason: '当前导航区域没有通往目标的路线' });
const keyOf = (x, y) => `${x},${y}`;

class RouteHeap {
    constructor() { this.items = []; }
    push(value) {
        const a = this.items; let i = a.length; a.push(value);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].f <= value.f) break;
            a[i] = a[p]; i = p;
        }
        a[i] = value;
    }
    pop() {
        const a = this.items, first = a[0], last = a.pop();
        if (a.length) {
            let i = 0;
            while (i * 2 + 1 < a.length) {
                let child = i * 2 + 1;
                if (child + 1 < a.length && a[child + 1].f < a[child].f) child++;
                if (a[child].f >= last.f) break;
                a[i] = a[child]; i = child;
            }
            a[i] = last;
        }
        return first;
    }
}
/**
 * 指挥导航的分块反向成本场。局部A*之外的完整绕行和多入口评估共用它。
 * 640px块只负责缓存；真实图仍由40px可走格和经验证的连接组成，绝不假定同块互通。
 * 多个终点一次播种，按真实路径成本+终点后续成本竞争；相近起点共享同一个续算作业。
 * 不另设帧预算，所有建图、连线、搜索和回溯计入PathFinder的现有预算。
 */
export class CommandRoutePlanner {
    constructor(finder) {
        this.finder = finder;
        this.tiles = new Map();
        this.fields = new Map();
        this.direct = new Map();
        this.transitJoins = new Map();
        this.residentCells = 0;
        this.revision = 0;
        this.changes = [];
        this.stats = { searches: 0, hits: 0, expanded: 0, limited: 0 };
    }

    invalidate(minX, minY, maxX, maxY) {
        this.changes.push({ version: ++this.revision, minX, minY, maxX, maxY });
        if (this.changes.length > 64) this.changes.shift();
        this.direct.clear();
        this.transitJoins.clear();
        if (!Number.isFinite(minX)) {
            this.tiles.clear(); this.fields.clear(); this.residentCells = 0; return;
        }
        // 半径和跨块邻边都包含在失效扩边内；远处已验证的区域可以继续复用。
        for (const [key, tile] of this.tiles) {
            const pad = tile.radius + this.finder.gridSize * 2;
            if (tile.minX <= maxX + pad && tile.maxX >= minX - pad
                && tile.minY <= maxY + pad && tile.maxY >= minY - pad) this.tiles.delete(key);
        }
        for (const [key, field] of this.fields) {
            const pad = field.radius + this.finder.gridSize * 2;
            if (field.minX <= maxX + pad && field.maxX >= minX - pad
                && field.minY <= maxY + pad && field.maxY >= minY - pad) this._dropField(key);
        }
    }

    _dropField(key) {
        const field = this.fields.get(key);
        if (field) this.residentCells -= field.nodes.size;
        this.fields.delete(key);
    }

    _active(field) {
        for (const request of field.waiters) {
            if (!request.isCurrent?.()) field.waiters.delete(request);
        }
        return field.waiters.size > 0;
    }

    _releaseRequest(request) {
        if (request) for (const field of this.fields.values()) field.waiters.delete(request);
    }

    _makeRoom() {
        for (const [key, field] of this.fields) {
            if (this.fields.size < MAX_FIELDS && this.residentCells < MAX_RESIDENT) return true;
            if (!this._active(field)) this._dropField(key);
        }
        return this.fields.size < MAX_FIELDS && this.residentCells < MAX_RESIDENT;
    }

    proofForPath(path, radius) {
        const proof = { version: this.revision, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const pad = this.finder._bucketRadius(radius) + this.finder.gridSize;
        for (const point of path) {
            proof.minX = Math.min(proof.minX, point.x - pad); proof.maxX = Math.max(proof.maxX, point.x + pad);
            proof.minY = Math.min(proof.minY, point.y - pad); proof.maxY = Math.max(proof.maxY, point.y + pad);
        }
        return proof;
    }

    isProofCurrent(proof) {
        if (!proof || proof.version < (this.changes[0]?.version ?? 0) - 1) return false;
        return !this.changes.some(change => change.version > proof.version
            && (!Number.isFinite(change.minX) || (proof.minX <= change.maxX && proof.maxX >= change.minX
                && proof.minY <= change.maxY && proof.maxY >= change.minY)));
    }

    pointBlocked(x, y, radius, options) {
        const finder = this.finder;
        if (finder.isPointBlocked(x, y, radius)) return true;
        // 指令移动不能把常锁门/敌方门当作可穿过的软障碍；自动友军门仍可通行。
        const hash = finder.spatialHash;
        const [cx, cy] = hash._getCell(x, y);
        const range = Math.ceil(radius / hash.cellSize) + 1;
        for (let dx = -range; dx <= range; dx++) for (let dy = -range; dy <= range; dy++) {
            for (const item of hash.cells.get(hash._getKey(cx + dx, cy + dy)) || []) {
                if (item.type !== 'gate') continue;
                const gate = item.obj;
                if (options?.friendlyGateAccess && gate._opensForFriendly === true
                    && gate._gateOwner?.gateMode !== 'locked') continue;
                if (hash._pointSegDist(x, y, gate.x1, gate.y1, gate.x2, gate.y2)
                    < radius + (gate.halfThick || 26)) return true;
            }
        }
        return false;
    }

    segmentBlocked(x, y, tx, ty, radius, options) {
        radius = this.finder._bucketRadius(radius);
        const count = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) / 20));
        for (let i = 0; i <= count; i++) {
            if (this.pointBlocked(x + (tx - x) * i / count, y + (ty - y) * i / count,
                radius, options)) return true;
        }
        return false;
    }

    _cell(gx, gy, field) {
        const step = this.finder.gridSize;
        const tx = Math.floor(gx / TILE_CELLS), ty = Math.floor(gy / TILE_CELLS);
        const key = `${field.namespace}:${tx},${ty}`;
        let tile = this.tiles.get(key);
        if (!tile) {
            if (this.tiles.size >= MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
            tile = { radius: field.radius, cells: new Map(),
                minX: tx * TILE_CELLS * step, minY: ty * TILE_CELLS * step,
                maxX: (tx + 1) * TILE_CELLS * step, maxY: (ty + 1) * TILE_CELLS * step };
            this.tiles.set(key, tile);
        }
        const index = (gy - ty * TILE_CELLS) * TILE_CELLS + gx - tx * TILE_CELLS;
        let cell = tile.cells.get(index);
        if (!cell) {
            const x = gx * step + step / 2, y = gy * step + step / 2;
            const data = this.finder._getCellData(x, y, field.radius, field.options);
            cell = { x, y, gx, gy, blocked: data.blocked
                || this.pointBlocked(x, y, field.radius, field.options),
                cost: data.cost, checked: 0, open: 0 };
            tile.cells.set(index, cell);
        }
        field.minX = Math.min(field.minX, cell.x); field.maxX = Math.max(field.maxX, cell.x);
        field.minY = Math.min(field.minY, cell.y); field.maxY = Math.max(field.maxY, cell.y);
        return cell;
    }

    _edge(cell, direction, field) {
        const [dx, dy] = DIRS[direction], bit = 1 << direction;
        const next = this._cell(cell.gx + dx, cell.gy + dy, field);
        if (!(cell.checked & bit)) {
            let open = !cell.blocked && !next.blocked;
            if (open && dx && dy) {
                open = !this._cell(cell.gx + dx, cell.gy, field).blocked
                    && !this._cell(cell.gx, cell.gy + dy, field).blocked;
            }
            if (open) open = !this.segmentBlocked(cell.x, cell.y, next.x, next.y, field.radius, field.options);
            cell.checked |= bit;
            if (open) cell.open |= bit;
        }
        return cell.open & bit ? next : null;
    }

    _push(field, cell, cost, next, goalId, via = null) {
        const key = cell.key || keyOf(cell.gx, cell.gy);
        let node = field.nodes.get(key);
        if (node && node.g <= cost) return;
        if (!node) {
            node = { key, cell }; field.nodes.set(key, node); this.residentCells++;
        }
        Object.assign(node, { g: cost, next, goalId, via, closed: false });
        if (cell.virtual) {
            field.minX = Math.min(field.minX, cell.x); field.maxX = Math.max(field.maxX, cell.x);
            field.minY = Math.min(field.minY, cell.y); field.maxY = Math.max(field.maxY, cell.y);
        }
        const h = Math.max(Math.abs(cell.x - field.focusX), Math.abs(cell.y - field.focusY));
        field.heap.push({ key, g: cost, f: cost + h });
    }

    _create(namespace, radius, options, goals, x, y) {
        this.stats.searches++;
        return { namespace, radius, options: { friendlyGateAccess: !!options.friendlyGateAccess },
            transit: options.transitGraph,
            gridLinks: new Map(), portalLinks: new Map(), virtualDirection: 0,
            goals, focusX: x, focusY: y, nodes: new Map(), heap: new RouteHeap(),
            seed: 0, seedCell: 0, current: null, direction: 0, expanded: 0,
            minX: Math.min(x, ...goals.map(g => g.x)), maxX: Math.max(x, ...goals.map(g => g.x)),
            minY: Math.min(y, ...goals.map(g => g.y)), maxY: Math.max(y, ...goals.map(g => g.y)),
            touched: Date.now(), traces: new Map(), joins: new Map(), waiters: new Set(), status: 'pending' };
    }

    _prepareTransit(field, deadline) {
        const graph = field.transit;
        if (!graph) return true;
        const cacheKey = `${graph.key}:${field.namespace}`;
        let state = this.transitJoins.get(cacheKey);
        if (!state) {
            if (this.transitJoins.size >= 16) this.transitJoins.delete(this.transitJoins.keys().next().value);
            state = { portalIndex: 0, portalCell: 0, gridLinks: new Map(), portalLinks: new Map() };
            this.transitJoins.set(cacheKey, state);
        }
        field.gridLinks = state.gridLinks; field.portalLinks = state.portalLinks;
        const step = this.finder.gridSize;
        while (state.portalIndex < graph.portals.length) {
            const portal = graph.portals[state.portalIndex];
            while (state.portalCell < 9) {
                if (performance.now() >= deadline) return false;
                const index = state.portalCell++;
                const cell = this._cell(Math.floor(portal.x / step) + index % 3 - 1,
                    Math.floor(portal.y / step) + Math.floor(index / 3) - 1, field);
                if (cell.blocked || this.segmentBlocked(cell.x, cell.y, portal.x, portal.y, field.radius, field.options)) continue;
                const key = keyOf(cell.gx, cell.gy), cost = Math.hypot(cell.x - portal.x, cell.y - portal.y) * cell.cost;
                if (!field.gridLinks.has(key)) field.gridLinks.set(key, []);
                if (!field.portalLinks.has(portal.key)) field.portalLinks.set(portal.key, []);
                field.gridLinks.get(key).push({ cell: portal, cost });
                field.portalLinks.get(portal.key).push({ cell, cost });
            }
            state.portalIndex++; state.portalCell = 0;
        }
        return true;
    }

    _seed(field, deadline) {
        const step = this.finder.gridSize;
        while (field.seed < field.goals.length) {
            const goal = field.goals[field.seed];
            while (field.seedCell < 9) {
                if (performance.now() >= deadline) return false;
                const index = field.seedCell++;
                const cell = this._cell(Math.floor(goal.x / step) + index % 3 - 1,
                    Math.floor(goal.y / step) + Math.floor(index / 3) - 1, field);
                if (cell.blocked || this.segmentBlocked(cell.x, cell.y, goal.x, goal.y, field.radius, field.options)) continue;
                this._push(field, cell, Math.max(0, goal.cost || 0)
                    + Math.hypot(goal.x - cell.x, goal.y - cell.y) * cell.cost, null, goal.id);
            }
            field.seed++; field.seedCell = 0;
        }
        if (!field.nodes.size) field.status = 'search_limited'; // 极窄入口不能被网格表达，不伪造不连通。
        return true;
    }

    _advance(field, joins, deadline, focusDistance) {
        if (!this._prepareTransit(field, deadline)) return null;
        if (!this._seed(field, deadline)) return null;
        while (performance.now() < deadline) {
            // 已结算节点具有从某一完整终点返回的有效链；不同起点不会共用未经检查的首段。
            let best = null;
            for (const join of joins) {
                const node = field.nodes.get(join.key);
                if (node?.closed && (!best || node.g + join.cost < best.cost)) {
                    best = { node, cost: node.g + join.cost };
                }
            }
            // 启发式朝首个起点，但共享查询也要等其他入口的成本下界不能胜出后再返回。
            const lowerBound = Math.min(field.heap.items[0]?.f ?? Infinity,
                field.current ? field.current.g + Math.max(Math.abs(field.current.cell.x - field.focusX),
                    Math.abs(field.current.cell.y - field.focusY)) : Infinity) - focusDistance;
            if (best && (best.cost <= lowerBound || field.status !== 'pending')) return best;
            if (field.status !== 'pending') return null;
            if (!field.current) {
                let item;
                do {
                    item = field.heap.pop();
                } while (item && (field.nodes.get(item.key)?.closed || field.nodes.get(item.key)?.g !== item.g));
                if (!item) { field.status = 'unreachable'; return null; }
                const node = field.nodes.get(item.key);
                node.closed = true; field.current = node; field.direction = node.cell.virtual ? DIRS.length : 0;
                field.virtualDirection = 0;
                field.expanded++; this.stats.expanded++;
            }
            while (field.direction < DIRS.length) {
                if (performance.now() >= deadline) return null;
                if (field.nodes.size >= MAX_CELLS || this.residentCells >= MAX_RESIDENT) {
                    field.status = 'search_limited'; this.stats.limited++; return null;
                }
                const d = field.direction++, node = field.current;
                const next = this._edge(node.cell, d, field);
                if (!next) continue;
                const diagonal = DIRS[d][0] && DIRS[d][1];
                this._push(field, next, node.g + (diagonal ? Math.SQRT2 : 1)
                    * this.finder.gridSize * node.cell.cost, node.key, node.goalId);
            }
            const current = field.current;
            const links = current.cell.virtual
                ? [...current.cell.edges, ...(field.portalLinks.get(current.key) || [])]
                : (field.gridLinks.get(current.key) || []);
            while (field.virtualDirection < links.length) {
                if (performance.now() >= deadline) return null;
                if (field.nodes.size >= MAX_CELLS || this.residentCells >= MAX_RESIDENT) {
                    field.status = 'search_limited'; this.stats.limited++; return null;
                }
                const edge = links[field.virtualDirection++];
                this._push(field, edge.cell, current.g + edge.cost, current.key, current.goalId,
                    edge.route ? edge.route.slice().reverse() : null);
            }
            field.current = null;
        }
        return null;
    }

    query(x, y, goals, radius, options = {}) {
        if (!goals.length) return UNREACHABLE;
        const finder = this.finder;
        if (!finder.advanceNavigationWithinFrameBudget() || !finder._budgetAvailable()) return PENDING;
        const remaining = finder.frameBudgetMs - finder._frameUsedMs - (options.reserveMs || 0);
        if (remaining <= 0) return PENDING;
        const started = performance.now();
        const deadline = started + Math.min(0.6, remaining);
        try {
            radius = finder._bucketRadius(radius);
            const namespace = `${radius}:${options.friendlyGateAccess ? 1 : 0}:${finder.getFriendlyGateAccessVersion()}`;
            if (options.fastDirect && goals.length === 1
                && Math.hypot(goals[0].x - x, goals[0].y - y) <= 240) {
                const goal = goals[0], directKey = `${namespace}:${x},${y}>${goal.x},${goal.y}`;
                let open = this.direct.get(directKey);
                if (open === undefined) {
                    if (performance.now() >= deadline) return PENDING;
                    open = !this.segmentBlocked(x, y, goal.x, goal.y, radius, options);
                    if (this.direct.size >= 256) this.direct.delete(this.direct.keys().next().value);
                    this.direct.set(directKey, open);
                }
                if (open) {
                    this._releaseRequest(options.request);
                    return { status: 'complete', goalId: goal.id,
                    cost: Math.hypot(goal.x - x, goal.y - y) + (goal.cost || 0),
                    path: [{ x, y }, { x: goal.x, y: goal.y }] };
                }
            }
            if (options.directOnly) return null;
            const step = finder.gridSize, sector = step * TILE_CELLS;
            const signature = goals.map(g => `${g.id}:${g.x}:${g.y}:${Math.max(0, g.cost || 0)}`).join('|');
            const key = `${namespace}:${options.transitGraph?.key || 'ground'}:${Math.floor(x / sector)},${Math.floor(y / sector)}>${signature}`;
            if (options.request && options.request.fieldKey !== key) {
                this._releaseRequest(options.request);
                options.request.fieldKey = key;
            }
            let field = this.fields.get(key);
            if (field && Date.now() - field.touched > TTL && !this._active(field)) { this._dropField(key); field = null; }
            if (!field) {
                // 容量不足只推迟新任务，不能丢掉正在续算的搜索使整队永远算不完。
                if (!this._makeRoom()) return PENDING;
                field = this._create(namespace, radius, options, goals, x, y);
                this.fields.set(key, field);
            } else this.stats.hits++;
            if (options.request) field.waiters.add(options.request);
            const finished = result => { field.waiters.delete(options.request); return result; };
            field.touched = Date.now();
            // LRU。作业共享但返回路径独立；只通过可取消的在途请求保护活跃搜索。
            this.fields.delete(key); this.fields.set(key, field);
            const joinKey = `${x},${y}`;
            let joinState = field.joins.get(joinKey);
            if (!joinState) {
                if (field.joins.size >= 128) field.joins.delete(field.joins.keys().next().value);
                joinState = { index: 0, joins: [] }; field.joins.set(joinKey, joinState);
            }
            const joins = joinState.joins;
            while (joinState.index < 9) {
                if (performance.now() >= deadline) return PENDING;
                const index = joinState.index++;
                const gx = Math.floor(x / step) + index % 3 - 1;
                const gy = Math.floor(y / step) + Math.floor(index / 3) - 1;
                const cell = this._cell(gx, gy, field);
                if (!cell.blocked && !this.segmentBlocked(x, y, cell.x, cell.y, radius, options)) {
                    joins.push({ key: keyOf(gx, gy), cost: Math.hypot(x - cell.x, y - cell.y) * cell.cost });
                }
            }
            if (!joins.length) return finished(LIMITED);
            const best = this._advance(field, joins, deadline,
                Math.max(Math.abs(x - field.focusX), Math.abs(y - field.focusY)));
            if (!best) return field.status === 'unreachable' ? finished(UNREACHABLE)
                : field.status === 'search_limited' ? finished(LIMITED) : PENDING;
            const traceKey = best.node.key;
            let trace = field.traces.get(traceKey);
            if (!trace) {
                if (field.traces.size >= 4) field.traces.delete(field.traces.keys().next().value);
                trace = { next: best.node, path: [], goalId: best.node.goalId, segment: 0 };
                field.traces.set(traceKey, trace);
            }
            while (trace.next) {
                if (performance.now() >= deadline) return PENDING;
                if (trace.path.length >= 8192) return finished(LIMITED);
                const node = trace.next;
                const points = node.via || [node.cell.point || { x: node.cell.x, y: node.cell.y }];
                const point = points[trace.segment++];
                const a = trace.path[trace.path.length - 2], b = trace.path[trace.path.length - 1];
                // 只压缩共线的已验证格边，不做跨墙拐角平滑；减少路上频繁减速与重复点。
                if (a && b && !a.surfaceKind && !b.surfaceKind && !point.surfaceKind
                    && (b.x - a.x) * (point.y - b.y) === (b.y - a.y) * (point.x - b.x)
                    && (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) > 0) {
                    trace.path[trace.path.length - 1] = point;
                } else trace.path.push(point);
                if (trace.segment >= points.length) {
                    trace.next = node.next ? field.nodes.get(node.next) : null;
                    trace.segment = 0;
                }
            }
            const goal = field.goals.find(g => g.id === trace.goalId);
            // 只有已验证的共线格边被合并；回溯及压缩均可跨帧续算。
            return finished({ status: 'complete', cost: best.cost, goalId: goal.id,
                searchLimited: field.status === 'search_limited',
                path: [{ x, y }, ...trace.path, { x: goal.x, y: goal.y }] });
        } finally { finder._chargeBudget(started); }
    }

    getStats() {
        return { ...this.stats, fields: this.fields.size, cells: this.residentCells, tiles: this.tiles.size };
    }
}
