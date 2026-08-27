import { WallSystem } from '../world/wall-system.js';
/* ================================================================
 * RegionIndex — 连通区域索引系统（参考 RimWorld Reachability）
 * 
 * 核心思想：
 * 1. 用 Flood Fill 标记地图中每个可行走格子的区域编号
 * 2. 寻路前 O(1) 检查起点和终点是否在同一区域
 * 3. 不同区域 → 放弃 A*，直接找当前区域的最近出口
 * 
 * 性能：
 * - 全图重算：~5ms（200×200 网格）
 * - 增量更新：只重算变更区域周围的局部区域
 * - 查询：O(1)
 * ================================================================ */

class RegionIndex {
    constructor(gridSize = 40) {
        this.gridSize = gridSize;
        this.regions = new Map(); // key: "gridX,gridY" -> regionId
        this.regionBounds = new Map(); // regionId -> { minX, maxX, minY, maxY, cells: [] }
        this.nextRegionId = 1;
        this._dirty = true;
        this._lastWallHash = null;
        this._lastRadius = null; // [PERF-2026-08-08] 上次重建用的（桶）半径：半径档变化才需重建
        this._rebuildJob = null;
        this._exitSearchJobs = new Map();
    }

    // 标记需要重新计算
    markDirty() {
        this._dirty = true;
        this._rebuildJob = null;
        this._exitSearchJobs.clear();
    }

    beginFrame(now = Date.now()) {
        for (const [key, job] of this._exitSearchJobs) {
            if (now - job.lastTouchedAt > 3000) this._exitSearchJobs.delete(key);
        }
    }

    // 检查是否需要重算（墙壁变化时）
    // [PERF-2026-08-08] 可选传（桶）半径：索引按半径建，半径档变了同样要重算，
    // 同桶半径重复调用不触发全量重建
    checkDirty(radius) {
        if (this._dirty) return true;
        if (radius !== undefined && this._lastRadius !== null && radius !== this._lastRadius) {
            return true;
        }
        // 检查墙壁哈希是否变化
        const currentHash = this._computeWallHash();
        if (currentHash !== this._lastWallHash) {
            this._lastWallHash = currentHash;
            return true;
        }
        return false;
    }

    // 计算墙壁配置的简单哈希
    _computeWallHash() {
        if (!WallSystem || !WallSystem.walls) return 'empty';
        let hash = 0;
        for (const w of WallSystem.walls) {
            hash = (hash * 31 + Math.floor(w.x) + Math.floor(w.y) * 17 + Math.floor(w.w) * 13 + Math.floor(w.h) * 7) & 0x7FFFFFFF;
        }
        return hash.toString();
    }

    // 全图 Flood Fill 重算区域索引
    rebuild(worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius) {
        this._rebuildJob = null;
        while (!this.advanceRebuild(
            worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius, Infinity
        )) {
            // Infinity deadline: loop only documents the synchronous compatibility contract.
        }
    }

    _createRebuildJob(worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius,
        isBlockedFn = null) {
        const step = this.gridSize;
        const startGX = Math.floor(worldMinX / step);
        const startGY = Math.floor(worldMinY / step);
        const endGX = Math.ceil(worldMaxX / step);
        const endGY = Math.ceil(worldMaxY / step);
        const cols = endGX - startGX + 1;
        const rows = endGY - startGY + 1;
        const count = cols * rows;
        return {
            signature: `${startGX},${startGY},${endGX},${endGY}:${entityRadius}`,
            startGX, startGY, endGX, endGY, cols, rows, count, entityRadius,
            isBlockedFn,
            blocked: new Uint8Array(count),
            regionIds: new Int32Array(count),
            queue: new Int32Array(count),
            phase: 'blocked',
            buildIndex: 0,
            scanIndex: 0,
            commitIndex: 0,
            nextRegionId: 1,
            regionBounds: new Map(),
            regions: new Map(),
            fill: null,
        };
    }

    /** 跨帧重建；完成前旧索引保持可读，提交阶段一次性替换。 */
    advanceRebuild(worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius,
        deadline = Infinity, isBlockedFn = null) {
        const step = this.gridSize;
        const signature = `${Math.floor(worldMinX / step)},${Math.floor(worldMinY / step)},`
            + `${Math.ceil(worldMaxX / step)},${Math.ceil(worldMaxY / step)}:${entityRadius}`;
        let job = this._rebuildJob;
        if (!job || job.signature !== signature) {
            job = this._createRebuildJob(
                worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius, isBlockedFn
            );
            this._rebuildJob = job;
        } else if (isBlockedFn) {
            job.isBlockedFn = isBlockedFn;
        }
        if (job.phase === 'blocked') {
            while (job.buildIndex < job.count) {
                const index = job.buildIndex++;
                const row = Math.floor(index / job.cols);
                const col = index - row * job.cols;
                const x = (job.startGX + col) * step + step / 2;
                const y = (job.startGY + row) * step + step / 2;
                job.blocked[index] = (job.isBlockedFn
                    ? job.isBlockedFn(x, y, entityRadius)
                    : this._isBlockedQuick(x, y, entityRadius)) ? 1 : 0;
                if (performance.now() >= deadline) return false;
            }
            job.phase = 'scan';
        }
        const dirs = [-1,0, 1,0, 0,-1, 0,1, -1,-1, -1,1, 1,-1, 1,1];
        while (job.phase === 'scan' || job.phase === 'fill') {
            if (job.phase === 'scan') {
                while (job.scanIndex < job.count) {
                    const index = job.scanIndex++;
                    if (job.blocked[index]) {
                        job.regionIds[index] = -1;
                        if ((index & 31) === 0 && performance.now() >= deadline) return false;
                        continue;
                    }
                    if (job.regionIds[index] !== 0) {
                        if ((index & 31) === 0 && performance.now() >= deadline) return false;
                        continue;
                    }
                    const regionId = job.nextRegionId++;
                    job.regionIds[index] = regionId;
                    job.queue[0] = index;
                    job.fill = {
                        regionId,
                        head: 0,
                        tail: 1,
                        cells: [],
                        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
                    };
                    job.phase = 'fill';
                    break;
                }
                if (job.scanIndex >= job.count && job.phase === 'scan') {
                    job.phase = 'commit';
                    break;
                }
            }
            if (job.phase === 'fill') {
                const fill = job.fill;
                while (fill.head < fill.tail) {
                    const index = job.queue[fill.head++];
                    const row = Math.floor(index / job.cols);
                    const col = index - row * job.cols;
                    const gx = job.startGX + col;
                    const gy = job.startGY + row;
                    const x = gx * step + step / 2;
                    const y = gy * step + step / 2;
                    fill.cells.push({ gx, gy, x, y });
                    fill.minX = Math.min(fill.minX, x); fill.maxX = Math.max(fill.maxX, x);
                    fill.minY = Math.min(fill.minY, y); fill.maxY = Math.max(fill.maxY, y);
                    for (let d = 0; d < dirs.length; d += 2) {
                        const nr = row + dirs[d + 1];
                        const nc = col + dirs[d];
                        if (nr < 0 || nr >= job.rows || nc < 0 || nc >= job.cols) continue;
                        const next = nr * job.cols + nc;
                        if (job.regionIds[next] !== 0) continue;
                        if (job.blocked[next]) {
                            job.regionIds[next] = -1;
                            continue;
                        }
                        job.regionIds[next] = fill.regionId;
                        job.queue[fill.tail++] = next;
                    }
                    if (performance.now() >= deadline) return false;
                }
                job.regionBounds.set(fill.regionId, {
                    minX: fill.minX, maxX: fill.maxX,
                    minY: fill.minY, maxY: fill.maxY,
                    cells: fill.cells,
                });
                job.fill = null;
                job.phase = 'scan';
            }
        }
        if (job.phase === 'commit') {
            while (job.commitIndex < job.count) {
                const index = job.commitIndex++;
                const row = Math.floor(index / job.cols);
                const col = index - row * job.cols;
                job.regions.set(`${job.startGX + col},${job.startGY + row}`, job.regionIds[index]);
                if ((index & 31) === 0 && performance.now() >= deadline) return false;
            }
            this.regions = job.regions;
            this.regionBounds = job.regionBounds;
            this.nextRegionId = job.nextRegionId;
            this._dirty = false;
            this._lastWallHash = this._computeWallHash();
            this._lastRadius = entityRadius;
            this._rebuildJob = null;
            this._exitSearchJobs.clear();
            return true;
        }
        return false;
    }

    // 快速阻挡检测（不使用 SpatialHash，避免循环依赖）
    _isBlockedQuick(x, y, radius) {
        if (!WallSystem || !WallSystem.walls) return false;
        for (const w of WallSystem.walls) {
            if (x + radius > w.x && x - radius < w.x + w.w &&
                y + radius > w.y && y - radius < w.y + w.h) {
                return true;
            }
        }
        if (WallSystem.trees) {
            for (const t of WallSystem.trees) {
                const dx = x - t.x, dy = y - t.y;
                const treeR = t.collisionRadius || t.radius * 0.6;
                if (Math.sqrt(dx * dx + dy * dy) < treeR + radius) return true;
            }
        }
        // 静态掩体墙段（与 pathfinder SpatialHash 同口径：点到线段距离 < 半径 + halfThick；
        // 动态段门闸/冰墙不纳入——此前漏掉掩体，含掩体图里连通区/出口判定失真）
        if (WallSystem.isoSegments) {
            for (const s of WallSystem.isoSegments) {
                if (!s._cover) continue;
                if (this._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2) < radius + (s.halfThick || 26)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 点到线段距离（与 pathfinder/WallSystem 同口径） */
    _pointSegDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx, cy = y1 + t * dy;
        return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    }

    // O(1) 获取某点的区域编号
    getRegionId(x, y) {
        const gx = Math.floor(x / this.gridSize);
        const gy = Math.floor(y / this.gridSize);
        return this.regions.get(`${gx},${gy}`) || 0;
    }

    // O(1) 检查两点是否在同一可达区域
    isSameRegion(x1, y1, x2, y2) {
        const r1 = this.getRegionId(x1, y1);
        const r2 = this.getRegionId(x2, y2);
        return r1 > 0 && r1 === r2;
    }

    // 找到当前区域边界上，离目标点最近的出口格子
    // 返回 { x, y, dist } 或 null
    findNearestExit(currentX, currentY, targetX, targetY, _entityRadius) {
        const result = this.findNearestExitIncremental(
            'sync', currentX, currentY, targetX, targetY, Infinity
        );
        return result.result;
    }

    findNearestExitIncremental(requestKey, currentX, currentY, targetX, targetY,
        deadline = Infinity) {
        const currentRegionId = this.getRegionId(currentX, currentY);
        if (currentRegionId <= 0) return { done: true, result: null };

        const region = this.regionBounds.get(currentRegionId);
        if (!region) return { done: true, result: null };

        const signature = `${currentRegionId}:${Math.floor(targetX / this.gridSize)},`
            + `${Math.floor(targetY / this.gridSize)}`;
        let job = this._exitSearchJobs.get(requestKey);
        if (!job || job.signature !== signature) {
            job = {
                signature,
                index: 0,
                nearest: null,
                minDist: Infinity,
                lastTouchedAt: Date.now(),
            };
            this._exitSearchJobs.set(requestKey, job);
        }
        job.lastTouchedAt = Date.now();
        while (job.index < region.cells.length) {
            const cell = region.cells[job.index++];
            const cx = cell.x;
            const cy = cell.y;
            const isBoundary = this._isBoundaryCell(cell.gx, cell.gy, currentRegionId);
            if (isBoundary) {
                const dist = (cx - targetX) ** 2 + (cy - targetY) ** 2;
                if (dist < job.minDist) {
                    job.minDist = dist;
                    job.nearest = { x: cx, y: cy, dist: Math.sqrt(dist) };
                }
            }
            if ((job.index & 31) === 0 && performance.now() >= deadline) {
                return { done: false, result: null };
            }
        }
        this._exitSearchJobs.delete(requestKey);
        return { done: true, result: job.nearest };
    }

    // 检查格子是否是区域边界（相邻有阻挡或不同区域）
    _isBoundaryCell(gx, gy, regionId) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of dirs) {
            const ngx = gx + dx;
            const ngy = gy + dy;
            const neighborRegion = this.regions.get(`${ngx},${ngy}`);
            if (neighborRegion === undefined || neighborRegion === -1 || neighborRegion !== regionId) {
                return true;
            }
        }
        return false;
    }

    getPerformanceStats() {
        return {
            rebuildPending: this._rebuildJob ? 1 : 0,
            rebuildProcessedCells: this._rebuildJob
                ? Math.max(this._rebuildJob.buildIndex, this._rebuildJob.commitIndex)
                : 0,
            rebuildTotalCells: this._rebuildJob?.count || 0,
            exitSearchPending: this._exitSearchJobs.size,
            regionCount: this.regionBounds.size,
        };
    }

    // 调试：绘制区域可视化
    debugDraw(ctx) {
        const colors = ['#ff000020', '#00ff0020', '#0000ff20', '#ffff0020', '#ff00ff20', '#00ffff20'];
        for (const [key, regionId] of this.regions) {
            if (regionId <= 0) continue;
            const [gx, gy] = key.split(',').map(Number);
            const x = gx * this.gridSize;
            const y = gy * this.gridSize;
            ctx.fillStyle = colors[(regionId - 1) % colors.length];
            ctx.fillRect(x, y, this.gridSize, this.gridSize);
        }
    }
}

// 全局实例
const regionIndex = new RegionIndex(40);

export { RegionIndex, regionIndex };
