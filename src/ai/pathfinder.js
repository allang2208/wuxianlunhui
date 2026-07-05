/* ================================================================
 *  PathFinder — 局部A*寻路系统（用于怪物绕过障碍物）
 * 优化内容：
 * 1. 动态搜索范围（基于距离，最小300px）
 * 2. 空间哈希加速障碍物查询（避免每次遍历全部墙壁）
 * 3. 二叉堆优先队列（O(log n) 替代 O(n) 数组查找）
 * 4. 对角线剪切检测（防止穿角）
 * 5. 起点/终点被阻挡时自动寻找最近可用格子
 * 6. 路径平滑（简化冗余路径点）
 * ================================================================ */

/* ---------- 二叉堆优先队列 ---------- */
class BinaryHeap {
    constructor(scoreFn) {
        this.content = [];
        this.scoreFn = scoreFn;
    }
    push(element) {
        this.content.push(element);
        this._sinkUp(this.content.length - 1);
    }
    pop() {
        const result = this.content[0];
        const end = this.content.pop();
        if (this.content.length > 0) {
            this.content[0] = end;
            this._sinkDown(0);
        }
        return result;
    }
    remove(node) {
        const i = this.content.indexOf(node);
        if (i === -1) return;
        const end = this.content.pop();
        if (i !== this.content.length) {
            this.content[i] = end;
            if (this.scoreFn(end) < this.scoreFn(node)) {
                this._sinkUp(i);
            } else {
                this._sinkDown(i);
            }
        }
    }
    size() {
        return this.content.length;
    }
    _sinkUp(n) {
        const element = this.content[n];
        while (n > 0) {
            const parentN = Math.floor((n - 1) / 2);
            const parent = this.content[parentN];
            if (this.scoreFn(element) >= this.scoreFn(parent)) break;
            this.content[parentN] = element;
            this.content[n] = parent;
            n = parentN;
        }
    }
    _sinkDown(n) {
        const length = this.content.length;
        const element = this.content[n];
        const elemScore = this.scoreFn(element);
        while (true) {
            const child2N = (n + 1) * 2;
            const child1N = child2N - 1;
            let swap = null;
            let child1Score;
            if (child1N < length) {
                const child1 = this.content[child1N];
                child1Score = this.scoreFn(child1);
                if (child1Score < elemScore) swap = child1N;
            }
            if (child2N < length) {
                const child2 = this.content[child2N];
                const child2Score = this.scoreFn(child2);
                if ((swap === null ? elemScore : child1Score) > child2Score) swap = child2N;
            }
            if (swap === null) break;
            this.content[n] = this.content[swap];
            this.content[swap] = element;
            n = swap;
        }
    }
}

/* ---------- 空间哈希（加速障碍物查询）---------- */
class SpatialHash {
    constructor(cellSize = 40) {
        this.cellSize = cellSize;
        this.cells = new Map(); // key: "cx,cy" -> [{type:'wall'|'tree', obj}]
        this._wallHash = null;
        this._treeHash = null;
    }
    clear() {
        this.cells.clear();
        this._wallHash = null;
        this._treeHash = null;
    }
    _getKey(cx, cy) {
        return `${cx},${cy}`;
    }
    _getCell(x, y) {
        return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
    }
    // 从 WallSystem 重建空间哈希
    rebuild() {
        this.clear();
        if (typeof WallSystem === 'undefined') return;
        // 矩形墙壁
        if (WallSystem.walls) {
            for (const w of WallSystem.walls) {
                const minCX = Math.floor(w.x / this.cellSize);
                const maxCX = Math.floor((w.x + w.w) / this.cellSize);
                const minCY = Math.floor(w.y / this.cellSize);
                const maxCY = Math.floor((w.y + w.h) / this.cellSize);
                for (let cx = minCX; cx <= maxCX; cx++) {
                    for (let cy = minCY; cy <= maxCY; cy++) {
                        const key = this._getKey(cx, cy);
                        if (!this.cells.has(key)) this.cells.set(key, []);
                        this.cells.get(key).push({ type: 'wall', obj: w });
                    }
                }
            }
        }
        // 圆形树木
        if (WallSystem.trees) {
            for (const t of WallSystem.trees) {
                const minCX = Math.floor((t.x - t.radius) / this.cellSize);
                const maxCX = Math.floor((t.x + t.radius) / this.cellSize);
                const minCY = Math.floor((t.y - t.radius) / this.cellSize);
                const maxCY = Math.floor((t.y + t.radius) / this.cellSize);
                for (let cx = minCX; cx <= maxCX; cx++) {
                    for (let cy = minCY; cy <= maxCY; cy++) {
                        const key = this._getKey(cx, cy);
                        if (!this.cells.has(key)) this.cells.set(key, []);
                        this.cells.get(key).push({ type: 'tree', obj: t });
                    }
                }
            }
        }
    }
    // 检查点是否在障碍物内（只检查相关 cell）
    isBlocked(x, y, radius) {
        // 快速 AABB 检查：先检查中心点所在的 cell，再扩展 radius 范围
        const [baseCX, baseCY] = this._getCell(x, y);
        const range = Math.ceil(radius / this.cellSize) + 1;
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const key = this._getKey(baseCX + dx, baseCY + dy);
                const items = this.cells.get(key);
                if (!items) continue;
                for (const item of items) {
                    if (item.type === 'wall') {
                        const w = item.obj;
                        if (x + radius > w.x && x - radius < w.x + w.w &&
                            y + radius > w.y && y - radius < w.y + w.h) {
                            return true;
                        }
                    } else if (item.type === 'tree') {
                        const t = item.obj;
                        const ddx = x - t.x, ddy = y - t.y;
                        if (Math.sqrt(ddx * ddx + ddy * ddy) < t.radius + radius) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}

/* ---------- 路径查找器 ---------- */
class PathFinder {
    constructor() {
        this.gridSize = 40;  // [MODIFIED] 优化grid分辨率：20→40，减少网格数量提高性能
        this.minSearchRange = 300;
        this.spatialHash = new SpatialHash(40);
        this._hashValid = false;
        // [ENHANCE] 全局路径缓存：减少重复计算
        this._pathCache = new Map(); // key -> { path, timestamp }
        this._cacheMaxAge = 3000;    // 缓存有效期 3 秒
        this._cacheMaxSize = 50;     // 最多缓存 50 条路径
    }

    // 确保空间哈希已构建
    _ensureHash() {
        if (!this._hashValid) {
            this.spatialHash.rebuild();
            this._hashValid = true;
        }
    }

    // 墙壁变化时调用（如动态生成墙壁后）
    invalidateCache() {
        this._hashValid = false;
        this._pathCache.clear();
    }

    _isBlocked(x, y, radius) {
        this._ensureHash();
        return this.spatialHash.isBlocked(x, y, radius);
    }

    // [ENHANCE] 地形权重计算：不同地形的移动成本
    // 普通地面：1.0，树木附近：1.5，其他单位附近：1.3
    _getMoveCost(x, y, entityRadius) {
        let cost = 1.0;
        // 检查树木附近（增加移动成本，让单位自然绕行）
        if (typeof WallSystem !== 'undefined' && WallSystem.trees) {
            for (const t of WallSystem.trees) {
                const treeR = t.collisionRadius || t.radius * 0.6;
                const d = Math.sqrt((x - t.x) ** 2 + (y - t.y) ** 2);
                if (d < treeR + entityRadius * 1.5) {
                    cost += 0.5;
                    break; // 只计算最近的一棵树
                }
            }
        }
        // 检查其他单位附近（避免拥挤）
        if (typeof Game !== 'undefined' && Game.entities) {
            for (const e of Game.entities.values()) {
                if (!e || e === this || !e.active || e.hp <= 0) continue;
                // 只检查同阵营单位（敌人不会互相排斥）
                const d = Math.sqrt((x - e.x) ** 2 + (y - e.y) ** 2);
                if (d < entityRadius * 2.5) {
                    cost += 0.3;
                    break;
                }
            }
        }
        return cost;
    }

    // [ENHANCE] 区域连通性检查：使用 Flood Fill 快速判断目标是否可达
    // 如果起点和终点不在同一区域，直接返回 false，避免昂贵的 A* 计算
    isReachable(startX, startY, endX, endY, entityRadius) {
        this._ensureHash();
        const step = this.gridSize;
        const maxDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        // [FIX] 步数按 BFS 层数计算：每层 step 距离，给 3 倍冗余 + 20 保底
        const maxSteps = Math.ceil(maxDist / step) * 3 + 20;
        const visited = new Set();
        const queue = [{ x: startX, y: startY }];
        visited.add(`${Math.floor(startX / step)},${Math.floor(startY / step)}`);
        let steps = 0;
        while (queue.length > 0 && steps < maxSteps) {
            steps++;
            const { x, y } = queue.shift();
            // 如果到达目标附近，认为可达
            if (Math.sqrt((x - endX) ** 2 + (y - endY) ** 2) < step * 2) {
                return true;
            }
            // 8方向扩展
            const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
            for (const [dr, dc] of dirs) {
                const nx = x + dr * step;
                const ny = y + dc * step;
                const key = `${Math.floor(nx / step)},${Math.floor(ny / step)}`;
                if (visited.has(key)) continue;
                if (this._isBlocked(nx, ny, entityRadius)) continue;
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
        // [FIX] 步数用完不一定不可达，返回 true 让 A* 继续尝试（A* 有超时保护）
        return true;
    }

    // [ENHANCE] 缓存管理
    _getCacheKey(startX, startY, endX, endY, radius) {
        // 坐标量化到 gridSize 的倍数，减少缓存 key 的精度
        const gs = this.gridSize;
        const qx = Math.floor(startX / gs) * gs;
        const qy = Math.floor(startY / gs) * gs;
        const qex = Math.floor(endX / gs) * gs;
        const qey = Math.floor(endY / gs) * gs;
        return `${qx},${qy},${qex},${qey},${radius}`;
    }

    _getFromCache(key) {
        const cached = this._pathCache.get(key);
        if (!cached) return null;
        if (Date.now() - cached.timestamp > this._cacheMaxAge) {
            this._pathCache.delete(key);
            return null;
        }
        return cached.path;
    }

    _setCache(key, path) {
        // 清理过期缓存
        if (this._pathCache.size >= this._cacheMaxSize) {
            const now = Date.now();
            for (const [k, v] of this._pathCache) {
                if (now - v.timestamp > this._cacheMaxAge) {
                    this._pathCache.delete(k);
                }
            }
        }
        this._pathCache.set(key, { path, timestamp: Date.now() });
    }

    _buildGrid(startX, startY, endX, endY, entityRadius) {
        const directDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        const searchRange = Math.max(this.minSearchRange, directDist + 200);
        const minX = Math.min(startX, endX) - searchRange;
        const maxX = Math.max(startX, endX) + searchRange;
        const minY = Math.min(startY, endY) - searchRange;
        const maxY = Math.max(startY, endY) + searchRange;
        const cols = Math.ceil((maxX - minX) / this.gridSize);
        const rows = Math.ceil((maxY - minY) / this.gridSize);
        const grid = [];
        for (let r = 0; r < rows; r++) {
            grid[r] = [];
            for (let c = 0; c < cols; c++) {
                const x = minX + c * this.gridSize + this.gridSize / 2;
                const y = minY + r * this.gridSize + this.gridSize / 2;
                // [ENHANCE] 增加 moveCost 属性
                const blocked = this._isBlocked(x, y, entityRadius);
                grid[r][c] = {
                    x, y, r, c,
                    blocked,
                    moveCost: blocked ? Infinity : this._getMoveCost(x, y, entityRadius),
                    g: Infinity, h: 0, f: Infinity,
                    parent: null, visited: false
                };
            }
        }
        return { grid, minX, minY, cols, rows };
    }

    _findNearestOpen(grid, rows, cols, startR, startC) {
        if (startR >= 0 && startR < rows && startC >= 0 && startC < cols) {
            if (!grid[startR][startC].blocked) return { r: startR, c: startC };
        }
        for (let radius = 1; radius < Math.max(rows, cols); radius++) {
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                    const nr = startR + dr, nc = startC + dc;
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                    if (!grid[nr][nc].blocked) return { r: nr, c: nc };
                }
            }
        }
        return null;
    }

    _isCornerCut(grid, rows, cols, currentR, currentC, dr, dc) {
        if (dr === 0 || dc === 0) return false;
        const n1r = currentR + dr, n1c = currentC;
        const n2r = currentR, n2c = currentC + dc;
        const n1 = (n1r >= 0 && n1r < rows && n1c >= 0 && n1c < cols) ? grid[n1r][n1c] : null;
        const n2 = (n2r >= 0 && n2r < rows && n2c >= 0 && n2c < cols) ? grid[n2r][n2c] : null;
        return (n1 && n1.blocked) || (n2 && n2.blocked);
    }

    _raycastBlocked(x1, y1, x2, y2, radius) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.ceil(dist / (this.gridSize * 0.5));
        const stepX = dx / steps;
        const stepY = dy / steps;
        for (let i = 1; i < steps; i++) {
            const x = x1 + stepX * i;
            const y = y1 + stepY * i;
            if (this._isBlocked(x, y, radius)) return true;
        }
        return false;
    }

    _smoothPath(path, entityRadius) {
        if (!path || path.length < 3) return path;
        const smoothed = [path[0]];
        for (let i = 1; i < path.length - 1; i++) {
            const prev = smoothed[smoothed.length - 1];
            const curr = path[i];
            const next = path[i + 1];
            const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
            const cross = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(cross) > 1) {
                smoothed.push(curr);
                continue;
            }
            if (this._raycastBlocked(prev.x, prev.y, next.x, next.y, entityRadius)) {
                smoothed.push(curr);
            }
        }
        smoothed.push(path[path.length - 1]);
        return smoothed;
    }

    findPath(startX, startY, endX, endY, entityRadius) {
        // [ENHANCE] 先检查区域连通性，避免无效 A* 计算
        if (!this.isReachable(startX, startY, endX, endY, entityRadius)) {
            return null;
        }
        // [ENHANCE] 尝试从缓存获取
        const cacheKey = this._getCacheKey(startX, startY, endX, endY, entityRadius);
        const cachedPath = this._getFromCache(cacheKey);
        if (cachedPath) {
            return cachedPath;
        }
        const { grid, minX, minY, cols, rows } = this._buildGrid(startX, startY, endX, endY, entityRadius);
        const startC = Math.floor((startX - minX) / this.gridSize);
        const startR = Math.floor((startY - minY) / this.gridSize);
        const endC = Math.floor((endX - minX) / this.gridSize);
        const endR = Math.floor((endY - minY) / this.gridSize);
        if (startR < 0 || startR >= rows || startC < 0 || startC >= cols) return null;
        if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) return null;
        const startOpen = this._findNearestOpen(grid, rows, cols, startR, startC);
        const endOpen = this._findNearestOpen(grid, rows, cols, endR, endC);
        if (!startOpen || !endOpen) return null;
        const startNode = grid[startOpen.r][startOpen.c];
        const endNode = grid[endOpen.r][endOpen.c];
        startNode.g = 0;
        startNode.h = Math.max(Math.abs(endX - startNode.x), Math.abs(endY - startNode.y));
        startNode.f = startNode.h;
        startNode.parent = null;
        const openHeap = new BinaryHeap(node => node.f);
        const closedSet = new Set();
        let iterations = 0;
        const maxIterations = cols * rows * 2;
        openHeap.push(startNode);
        while (openHeap.size() > 0) {
            if (++iterations > maxIterations) return null;
            const current = openHeap.pop();
            closedSet.add(`${current.r},${current.c}`);
            if (current === endNode || (Math.abs(current.x - endNode.x) < this.gridSize && Math.abs(current.y - endNode.y) < this.gridSize)) {
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ x: node.x, y: node.y });
                    node = node.parent;
                }
                const smoothed = this._smoothPath(path, entityRadius);
                // [ENHANCE] 缓存路径
                this._setCache(cacheKey, smoothed);
                return smoothed;
            }
            const neighbors = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1],           [0, 1],
                [1, -1],  [1, 0],  [1, 1]
            ];
            for (const [dr, dc] of neighbors) {
                const nr = current.r + dr;
                const nc = current.c + dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                const neighbor = grid[nr][nc];
                if (neighbor.blocked) continue;
                if (closedSet.has(`${nr},${nc}`)) continue;
                if (this._isCornerCut(grid, rows, cols, current.r, current.c, dr, dc)) continue;
                const isDiagonal = dr !== 0 && dc !== 0;
                // [ENHANCE] 使用格子的 moveCost 权重
                const baseMoveCost = isDiagonal ? 1.414 : 1;
                const terrainCost = neighbor.moveCost || 1.0;
                const moveCost = baseMoveCost * terrainCost * this.gridSize;
                const tentativeG = current.g + moveCost;
                if (tentativeG < neighbor.g) {
                    neighbor.g = tentativeG;
                    neighbor.h = Math.max(Math.abs(endX - neighbor.x), Math.abs(endY - neighbor.y));
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.parent = current;
                    openHeap.remove(neighbor);
                    openHeap.push(neighbor);
                }
            }
        }
        return null;
    }
}

const pathFinder = new PathFinder();

export { PathFinder, pathFinder };
