import { WallSystem } from '../world/wall-system.js';
import { regionIndex } from './region-index.js';
import { dynamicObstacleMap } from './dynamic-obstacle-map.js';
import { circleIntersectsIsoFootprint, isoFootprintVertices } from '../physics/iso-footprint.js';
import performanceConfig from '../../data/performance-config.json';

/** 寻路帧预算耗尽时的哨兵返回值：调用方应保留旧路径、下一帧重试，而非当作"不可达" */
export const PATH_DEFERRED = Symbol('PATH_DEFERRED');

// [PERF-2026-08-08] 整数格 key 步长：key = gx + gy * CELL_STRIDE，替代 "gx,gy" 字符串拼接
// （热路径每格多次拼字符串的开销实测可观）。|gx| < 65536（±262 万 px）内唯一。
const CELL_STRIDE = 131072;

// [PERF-2026-08-08] 半径档归并桶：memo/路径缓存按桶共享（原 7 档精确半径 key 共享率差）。
// 取桶上界为代表半径（≥ 桶内任意实际半径，只可能绕更宽、不可能穿墙）。
// 桶外（>90）半径保持原值各自成桶。实际半径集合 10/28/33/40/60/90/180 → 桶 20/40/40/40/90/90/180。
const RADIUS_BUCKETS = [20, 40, 90];

// [GATE-SOFT-COST] 门闸软成本乘数：关着的门段（_gate 标记）纳入 SpatialHash 但不作阻挡。
// 敌军、竞技场门与常锁门给贴身格子加成本乘数；可触发自动门的玩家/友军按正常通路计算。
// 取 6 的依据：门段 halfThick(≈26) + 半径桶 20 的贴身带宽约 46px，
// 跨门一次约经过 2 个格子，附加成本 ≈ 2×(6-1)×40 = 400px 等效绕程——战斗房尺度
// （500~1000px）内有可绕路线时优先绕门，绕行代价 >400px 或门是唯一通路时仍规划穿门
// （保持"不把临时障碍当永久墙"的原设计意图）。开门时门洞段已从 isoSegments splice 掉，
// 成本自然归零。bench: tools/pathfinding-bench.mjs [GATE-SOFT-COST] 段。
export const GATE_SOFT_COST = 6;

/* ================================================================
 *  PathFinder — 局部A*寻路系统（用于怪物绕过障碍物）
 * 优化内容：
 * 1. 动态搜索范围（基于距离，最小300px）
 * 2. 空间哈希加速障碍物查询（避免每次遍历全部墙壁）
 * 3. 二叉堆优先队列（O(log n) 替代 O(n) 数组查找）
 * 4. 对角线剪切检测（防止穿角）
 * 5. 起点/终点被阻挡时自动寻找最近可用格子
 * 6. 路径平滑（简化冗余路径点）
 * 7. [NEW] Region Index 连通性预检查（RimWorld 机制）
 * 8. [NEW] 目标不可达时自动寻找最近出口
 * 9. [PERF-2026-08-08] 掩体增删局部失效 invalidateRegion（替代全清）
 * 10. [PERF-2026-08-08] 半径档归并桶（memo/路径缓存/RegionIndex 按桶共享）
 * 11. [PERF-2026-08-08] 热路径整数 key + 堆 remove O(log n)
 * ================================================================ */

/* ---------- 二叉堆优先队列 ---------- */
// [PERF-2026-08-08] 元素→下标索引表：remove 由 indexOf O(n) 降为 O(log n)，
// push/pop/sink 同步维护。纯性能重构，堆序语义不变。
class BinaryHeap {
    constructor(scoreFn) {
        this.content = [];
        this.scoreFn = scoreFn;
        this._index = new Map(); // element -> content 下标
    }
    push(element) {
        this._index.set(element, this.content.length);
        this.content.push(element);
        this._sinkUp(this.content.length - 1);
    }
    pop() {
        const result = this.content[0];
        const end = this.content.pop();
        this._index.delete(result);
        if (this.content.length > 0) {
            this.content[0] = end;
            this._index.set(end, 0);
            this._sinkDown(0);
        }
        return result;
    }
    remove(node) {
        const i = this._index.get(node);
        if (i === undefined) return;
        const end = this.content.pop();
        this._index.delete(node);
        if (i !== this.content.length) {
            this.content[i] = end;
            this._index.set(end, i);
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
            this._index.set(element, parentN);
            this._index.set(parent, n);
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
            this._index.set(this.content[n], n);
            this._index.set(element, swap);
            n = swap;
        }
    }
}

/* 跨帧 A* 使用的整数索引堆；状态只保存 typed-array，避免每个待处理任务持有数千格对象。 */
class IndexHeap {
    constructor(scores, capacity) {
        this.scores = scores;
        this.content = [];
        this.positions = new Int32Array(capacity);
        this.positions.fill(-1);
    }
    size() { return this.content.length; }
    push(index) {
        const old = this.positions[index];
        if (old >= 0) {
            this._sinkUp(old);
            this._sinkDown(this.positions[index]);
            return;
        }
        this.positions[index] = this.content.length;
        this.content.push(index);
        this._sinkUp(this.content.length - 1);
    }
    pop() {
        const result = this.content[0];
        const end = this.content.pop();
        this.positions[result] = -1;
        if (this.content.length > 0) {
            this.content[0] = end;
            this.positions[end] = 0;
            this._sinkDown(0);
        }
        return result;
    }
    _swap(a, b) {
        const av = this.content[a], bv = this.content[b];
        this.content[a] = bv; this.content[b] = av;
        this.positions[av] = b; this.positions[bv] = a;
    }
    _sinkUp(pos) {
        while (pos > 0) {
            const parent = Math.floor((pos - 1) / 2);
            if (this.scores[this.content[pos]] >= this.scores[this.content[parent]]) break;
            this._swap(pos, parent);
            pos = parent;
        }
    }
    _sinkDown(pos) {
        const length = this.content.length;
        while (true) {
            const left = pos * 2 + 1;
            const right = left + 1;
            let best = pos;
            if (left < length
                && this.scores[this.content[left]] < this.scores[this.content[best]]) best = left;
            if (right < length
                && this.scores[this.content[right]] < this.scores[this.content[best]]) best = right;
            if (best === pos) break;
            this._swap(pos, best);
            pos = best;
        }
    }
}

/* ---------- 空间哈希（加速障碍物查询）---------- */
class SpatialHash {
    constructor(cellSize = 40) {
        this.cellSize = cellSize;
        this.cells = new Map(); // key: cx + cy*CELL_STRIDE（整数） -> [{type:'wall'|'tree'|'seg', obj}]
        this._wallHash = null;
        this._treeHash = null;
        this._rebuildJob = null;
        this.maxTreeRadius = 0;
        this._lastRebuildCells = 0;
    }
    clear() {
        this.cells.clear();
        this._wallHash = null;
        this._treeHash = null;
        this._rebuildJob = null;
        this.maxTreeRadius = 0;
        this._lastRebuildCells = 0;
    }

    cancelRebuild() {
        this._rebuildJob = null;
    }
    _getKey(cx, cy) {
        // [PERF-2026-08-08] 整数 key 替代 `${cx},${cy}` 字符串拼接
        return cx + cy * CELL_STRIDE;
    }
    _getCell(x, y) {
        return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
    }
    // 从 WallSystem 重建空间哈希
    rebuild() {
        this._rebuildJob = null;
        while (!this.advanceRebuild(Infinity)) {
            // Infinity deadline: synchronous compatibility path.
        }
    }

    _createRebuildEntry(type, object) {
        let minCX, maxCX, minCY, maxCY;
        if (type === 'wall') {
            minCX = Math.floor(object.x / this.cellSize);
            maxCX = Math.floor((object.x + object.w) / this.cellSize);
            minCY = Math.floor(object.y / this.cellSize);
            maxCY = Math.floor((object.y + object.h) / this.cellSize);
        } else if (type === 'tree') {
            const treeR = object.collisionRadius || object.radius * 0.6;
            minCX = Math.floor((object.x - treeR) / this.cellSize);
            maxCX = Math.floor((object.x + treeR) / this.cellSize);
            minCY = Math.floor((object.y - treeR) / this.cellSize);
            maxCY = Math.floor((object.y + treeR) / this.cellSize);
        } else {
            minCX = Math.floor(Math.min(object.x1, object.x2) / this.cellSize);
            maxCX = Math.floor(Math.max(object.x1, object.x2) / this.cellSize);
            minCY = Math.floor(Math.min(object.y1, object.y2) / this.cellSize);
            maxCY = Math.floor(Math.max(object.y1, object.y2) / this.cellSize);
        }
        return { type, obj: object, minCX, maxCX, minCY, maxCY };
    }

    _createRebuildJob() {
        const entries = [];
        let totalCells = 0;
        let maxTreeRadius = 0;
        const add = (type, object) => {
            const entry = this._createRebuildEntry(type, object);
            entries.push(entry);
            totalCells += (entry.maxCX - entry.minCX + 1)
                * (entry.maxCY - entry.minCY + 1);
            if (type === 'tree' && object.radius > maxTreeRadius) {
                maxTreeRadius = object.radius;
            }
        };
        if (WallSystem?.walls) {
            for (const wall of WallSystem.walls) add('wall', wall);
        }
        if (WallSystem?.trees) {
            for (const tree of WallSystem.trees) add('tree', tree);
        }
        if (WallSystem?.isoSegments) {
            for (const segment of WallSystem.isoSegments) {
                if (!segment._cover && !segment._gate && !segment._iceWall) continue;
                add((segment._cover || segment._iceWall) ? 'seg' : 'gate', segment);
            }
        }
        return {
            entries,
            cells: new Map(),
            entryIndex: 0,
            current: null,
            maxTreeRadius,
            processedCells: 0,
            totalCells,
        };
    }

    advanceRebuild(deadline = Infinity) {
        if (!this._rebuildJob) this._rebuildJob = this._createRebuildJob();
        const job = this._rebuildJob;
        while (job.entryIndex < job.entries.length || job.current) {
            if (!job.current) {
                const entry = job.entries[job.entryIndex++];
                job.current = {
                    entry,
                    minCX: entry.minCX,
                    maxCX: entry.maxCX,
                    minCY: entry.minCY,
                    maxCY: entry.maxCY,
                    cx: entry.minCX,
                    cy: entry.minCY,
                };
            }
            const current = job.current;
            const key = this._getKey(current.cx, current.cy);
            let bucket = job.cells.get(key);
            if (!bucket) {
                bucket = [];
                job.cells.set(key, bucket);
            }
            bucket.push(current.entry);
            job.processedCells++;
            current.cy++;
            if (current.cy > current.maxCY) {
                current.cy = current.minCY;
                current.cx++;
                if (current.cx > current.maxCX) job.current = null;
            }
            if (performance.now() >= deadline) return false;
        }
        this.cells = job.cells;
        this.maxTreeRadius = job.maxTreeRadius;
        this._lastRebuildCells = job.totalCells;
        this._wallHash = null;
        this._treeHash = null;
        this._rebuildJob = null;
        return true;
    }

    getRebuildStats() {
        const job = this._rebuildJob;
        if (!job) {
            return {
                pending: 0,
                processedCells: this._lastRebuildCells,
                totalCells: this._lastRebuildCells,
                progress: this._lastRebuildCells > 0 ? 100 : 0,
            };
        }
        const progress = job.totalCells > 0
            ? Math.min(100, job.processedCells / job.totalCells * 100)
            : 100;
        return {
            pending: 1,
            processedCells: job.processedCells,
            totalCells: job.totalCells,
            progress,
        };
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
                        const treeR = t.collisionRadius || t.radius * 0.6;
                        if (Math.sqrt(ddx * ddx + ddy * ddy) < treeR + radius) {
                            return true;
                        }
                    } else if (item.type === 'seg') {
                        const s = item.obj;
                        if (this._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2) < radius + (s.halfThick || 26)) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    /** 点到线段距离（与 WallSystem._pointSegDist 同口径） */
    _pointSegDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + dx * t, cy = y1 + dy * t;
        return Math.hypot(px - cx, py - cy);
    }
}

/* ---------- 路径查找器 ---------- */
class PathFinder {
    constructor() {
        this.gridSize = 40;  // [MODIFIED] 优化grid分辨率：20→40，减少网格数量提高性能
        this.minSearchRange = 300;
        this.maxSearchRange = 800; // [NEW] 限制搜索范围，避免远距离目标产生巨大网格
        this.spatialHash = new SpatialHash(40);
        this._hashValid = false;
        this._maxTreeRadius = 0; // 用于 _getMoveCost SpatialHash 查询范围
        // 网格对象池：避免每帧 A* 分配大量格子对象（maxSearchRange=800, gridSize=40 => 约 60×60）
        this._gridPool = Array.from({ length: 64 }, () =>
            Array.from({ length: 64 }, () => ({ x: 0, y: 0, r: 0, c: 0, blocked: false, moveCost: 1, g: Infinity, h: 0, f: Infinity, parent: null }))
        );
        // [ENHANCE] 全局路径缓存：减少重复计算
        this._pathCache = new Map(); // key -> { path, timestamp }
        this._cacheMaxAge = 3000;    // 缓存有效期 3 秒
        this._cacheMaxSize = 50;     // 最多缓存 50 条路径
        // [PERF-2026-08-03] 静态格子结果记忆化：按(格子坐标, 半径, 门通行档)缓存 blocked/moveCost。
        // 同一几何下多只怪共享一份结果，避免每次寻路都重建整张成本网格（实测占冷路径 ~92%）
        this._cellMemo = new Map();
        this._memoRadii = new Set(); // memo 中出现过的桶半径（invalidateRegion 按格清除时枚举用）
        this._geometryVersion = 0;   // 几何版本：invalidateCache() 自增，几何变化时清 memo
        this._friendlyGateAccessVersion = 0; // 自动门模式变化：通知玩家/侍从丢弃旧成本路径
        // [PERF-2026-08-03] 每帧寻路预算：主线程 A* 同步执行，超预算请求返回 PATH_DEFERRED，
        // 由调用方保留旧路径、下一帧重试（MovementSystem.beginFrame 每帧重置）
        this.frameBudgetMs = Math.max(
            1,
            Number(performanceConfig.pathQueue?.finderBudgetMs)
                || Number(performanceConfig.pathQueue?.drainBudgetMs)
                || 3
        );
        this._frameUsedMs = 0;
        // 出口路径短时缓存（A* 失败后卡住重算每 500ms 都会走到这里，原来每次都全量重建 RegionIndex）
        this._exitCache = new Map(); // key -> { result, timestamp }
        // 与完整 A* 分离的短时连通性预读取。同一拓扑版本、同一半径桶与相近端点
        // 复用一次 Flood Fill 结论，避免多选单位/卡死重算在同帧重复扫描连通区。
        this._reachabilityCache = new Map();
        // 可跨帧暂停/续算的 A* 作业；requestId 由 PathManager 稳定提供。
        this._pendingSearches = new Map();
        this._pendingEndpointProjections = new Map();
        this._endpointProjectionCache = new Map();
        // 防御波次共享的稀疏流场：格子记录应接入哪一段公共路径，局部避障仍由 MovementSystem 负责。
        this._sharedFlowFields = new Map();
        this._sharedFlowMaxAge = Math.max(
            500,
            Number(performanceConfig.pathQueue?.sharedFlowTtlMs) || 2500
        );
        this._sharedFlowMaxSize = Math.max(
            8,
            Number(performanceConfig.pathQueue?.sharedFlowMaxFields) || 48
        );
        this._incrementalSlices = 0;
        this._hashBuildSlices = 0;
        this._projectionSlices = 0;
        this._sharedFlowHits = 0;
        this._sharedIntegrationHits = 0;
        this._sharedFlowBuildSlices = 0;
        this._negativeCacheHits = 0;
        this._lastWarnAt = 0;        // console.warn 节流（卡住重算循环曾刷屏）
          // 世界-122 能源矿等“非墙体实体圆障碍”：只给寻路用，不写进 WallSystem，
          // 避免影响塔弹道/墙体碰撞语义。EnergyNodeSystem.setup/teardown 负责登记。
          this._entityCircleObstacles = [];
          this._entityFootprintObstacles = [];
          this._entityFootprintCells = new Map();
          this._entityFootprintCellSize = 160;
          this._entityFootprintQueryEpoch = 0;
          this._entityFootprintQueryBuffer = [];
          this._entityFootprintSignature = '';
          this._lastEntityFootprintSyncAt = 0;
          this._footprintSyncMs = 0;
          this._lastFootprintSyncMs = 0;
          this._peakFootprintSyncMs = 0;
          this._footprintSyncRuns = 0;
          this._hasEntityObstacles = false;
    }

    // 确保空间哈希已构建；有限 deadline 下可跨帧续建。
    _ensureHash(deadline = Infinity) {
        if (this._hashValid) return true;
        if (!this.spatialHash.advanceRebuild(deadline)) return false;
        this._maxTreeRadius = this.spatialHash.maxTreeRadius;
        this._hashValid = true;
        return true;
    }

    isNavigationReady() {
        return this._hashValid;
    }

    ensureNavigationReady(deadline = Infinity) {
        const ready = this._ensureHash(deadline);
        if (!ready && deadline !== Infinity) this._hashBuildSlices++;
        return ready;
    }

    /** AI 验证/寻路入口共用：在 finder 帧预算内续建导航索引并记账。 */
    advanceNavigationWithinFrameBudget() {
        if (this._hashValid) return true;
        if (!this._budgetAvailable()) return false;
        const startedAt = performance.now();
        const remaining = Math.max(0, this.frameBudgetMs - this._frameUsedMs);
        const ready = this.ensureNavigationReady(startedAt + remaining);
        this._chargeBudget(startedAt);
        return ready;
    }

    // 墙壁变化时调用（如动态生成墙壁后）
    invalidateCache() {
        this._hashValid = false;
        this.spatialHash.cancelRebuild();
        this._maxTreeRadius = 0;
        this._pathCache.clear();
        this._exitCache.clear();
        this._reachabilityCache.clear();
        this._pendingSearches.clear();
        this._pendingEndpointProjections.clear();
        this._endpointProjectionCache.clear();
        this._sharedFlowFields.clear();
        // [PERF-2026-08-03] 几何变化：递增版本并清空格子记忆化
        this._geometryVersion++;
        this._cellMemo.clear();
        // [NEW] 标记 RegionIndex 需要重算
        regionIndex.markDirty();
    }

      /**
       * 登记“寻路专用”圆形实体障碍（当前为世界-122 能源矿）。
       * - 只影响 A*连通性/射线平滑，不写进 WallSystem，玩家/塔弹道等墙体语义不变；
       * - 登记/清空时清路径缓存与格子 memo，保证后续寻路立即绕行。
       * @param {Array<{x:number,y:number,radius:number}>} obstacles
       */
      setEntityCircleObstacles(obstacles) {
          this._entityCircleObstacles = Array.isArray(obstacles)
              ? obstacles.map(o => ({ x: o.x, y: o.y, radius: o.radius || o.groundRadius || 20 }))
              : [];
          this._hasEntityObstacles = this._entityCircleObstacles.length > 0
              || this._entityFootprintObstacles.length > 0;
          this._pathCache.clear();
          this._exitCache.clear();
          this._reachabilityCache.clear();
          this._pendingSearches.clear();
          this._pendingEndpointProjections.clear();
          this._endpointProjectionCache.clear();
          this._sharedFlowFields.clear();
          this._cellMemo.clear();
          this._geometryVersion++;
          regionIndex.markDirty();
      }

      /** 点是否落在任一寻路专用实体圆障碍内 */
      _isEntityObstacleBlocked(x, y, radius) {
          if (!this._hasEntityObstacles) return false;
          for (const o of this._entityCircleObstacles) {
              const rr = o.radius + radius;
              const dx = x - o.x, dy = y - o.y;
              if (dx * dx + dy * dy < rr * rr) return true;
          }
          for (const o of this._queryEntityFootprints(x, y, radius)) {
              if (x + radius < o.minX || x - radius > o.maxX
                  || y + radius < o.minY || y - radius > o.maxY) continue;
              if (circleIntersectsIsoFootprint(x, y, radius, o.entity)) return true;
          }
          return false;
      }

      _rebuildEntityFootprintIndex() {
          this._entityFootprintCells.clear();
          const cellSize = this._entityFootprintCellSize;
          for (const obstacle of this._entityFootprintObstacles) {
              const minCX = Math.floor(obstacle.minX / cellSize);
              const maxCX = Math.floor(obstacle.maxX / cellSize);
              const minCY = Math.floor(obstacle.minY / cellSize);
              const maxCY = Math.floor(obstacle.maxY / cellSize);
              for (let cx = minCX; cx <= maxCX; cx++) {
                  for (let cy = minCY; cy <= maxCY; cy++) {
                      const key = cx + cy * CELL_STRIDE;
                      let bucket = this._entityFootprintCells.get(key);
                      if (!bucket) {
                          bucket = [];
                          this._entityFootprintCells.set(key, bucket);
                      }
                      bucket.push(obstacle);
                  }
              }
          }
      }

      _queryEntityFootprints(x, y, radius) {
          const result = this._entityFootprintQueryBuffer;
          result.length = 0;
          if (this._entityFootprintObstacles.length === 0) return result;
          const epoch = ++this._entityFootprintQueryEpoch;
          const cellSize = this._entityFootprintCellSize;
          const minCX = Math.floor((x - radius) / cellSize);
          const maxCX = Math.floor((x + radius) / cellSize);
          const minCY = Math.floor((y - radius) / cellSize);
          const maxCY = Math.floor((y + radius) / cellSize);
          for (let cx = minCX; cx <= maxCX; cx++) {
              for (let cy = minCY; cy <= maxCY; cy++) {
                  const bucket = this._entityFootprintCells.get(cx + cy * CELL_STRIDE);
                  if (!bucket) continue;
                  for (const obstacle of bucket) {
                      if (obstacle._queryEpoch === epoch) continue;
                      obstacle._queryEpoch = epoch;
                      result.push(obstacle);
                  }
              }
          }
          return result;
      }

      /**
       * 把普通静态建筑的真实 iso footprint 同步为寻路硬障碍。
       * 墙、门、高架楼梯继续由 WallSystem/高架导航拥有；普通建筑与防御塔统一按真实占地阻挡。
       * 方法由 MovementSystem 高频调用，内部 250ms 节流且仅在签名变化时失效缓存。
       */
      syncEntityFootprintObstacles(entities, now = Date.now()) {
          if (now - this._lastEntityFootprintSyncAt < 250) return false;
          const startedAt = performance.now();
          const finish = (result) => {
              this._lastFootprintSyncMs = Math.max(0, performance.now() - startedAt);
              this._peakFootprintSyncMs = Math.max(
                  this._peakFootprintSyncMs,
                  this._lastFootprintSyncMs
              );
              this._footprintSyncMs += this._lastFootprintSyncMs;
              this._footprintSyncRuns++;
              return result;
          };
          this._lastEntityFootprintSyncAt = now;
          let source = [];
          if (entities instanceof Map) source = entities.values();
          else if (Array.isArray(entities)) source = entities;
          else if (entities && typeof entities.values === 'function') source = entities.values();
          else if (entities && typeof entities[Symbol.iterator] === 'function') source = entities;

          const next = [];
          const signatureParts = [];
          for (const entity of source) {
              if (!entity || entity.active === false || entity.noCollision === true) continue;
              if (entity.collisionShape !== 'iso_rect') continue;
              if (!(entity.immovable || entity.noSeparation || entity._isBuilding || entity._isDefenseStructure)) continue;
              if (entity._isDefenseCover || entity._isCoverGate || entity._isWallStaircase) continue;
              const vertices = isoFootprintVertices(entity);
              if (!vertices.length) continue;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const p of vertices) {
                  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                  minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
              }
              next.push({ entity, minX, minY, maxX, maxY });
              signatureParts.push([
                  entity.id || entity._navObstacleId || entity.constructor?.name || 'building',
                  Math.round(entity.x || 0), Math.round(entity.y || 0),
                  Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY),
              ].join(':'));
          }
          signatureParts.sort();
          const signature = signatureParts.join('|');
          if (signature === this._entityFootprintSignature) return finish(false);
          this._entityFootprintSignature = signature;
          this._entityFootprintObstacles = next;
          this._rebuildEntityFootprintIndex();
          this._hasEntityObstacles = this._entityCircleObstacles.length > 0 || next.length > 0;
          this._pathCache.clear();
          this._exitCache.clear();
          this._reachabilityCache.clear();
          this._pendingSearches.clear();
          this._pendingEndpointProjections.clear();
          this._endpointProjectionCache.clear();
          this._sharedFlowFields.clear();
          this._geometryVersion++;
          regionIndex.markDirty();
          return finish(true);
      }

      getTopologyVersion() {
          return this._geometryVersion;
      }

      cancelIncrementalRequest(requestId) {
          if (requestId === undefined || requestId === null) return false;
          return this._pendingSearches.delete(requestId);
      }

      getFriendlyGateAccessVersion() {
          return this._friendlyGateAccessVersion;
      }

      /** 自动门模式改变时，同时失效局部缓存并让已在行进的玩家/侍从重新规划。 */
      notifyFriendlyGateAccessChanged(minX, minY, maxX, maxY) {
          this._friendlyGateAccessVersion++;
          this.invalidateRegion(minX, minY, maxX, maxY);
      }

      isPointBlocked(x, y, radius = 20) {
          return this._isBlocked(x, y, this._bucketRadius(radius));
      }

      isSegmentBlocked(x1, y1, x2, y2, radius = 20) {
          return this._raycastBlocked(x1, y1, x2, y2, this._bucketRadius(radius));
      }

      /** 给 RTS 点击点/编队槽位寻找最近合法落点，不改变高架目标语义。 */
      findNearestWalkablePoint(x, y, radius = 20, maxDistance = 320) {
          const r = this._bucketRadius(radius);
          if (!this._isBlocked(x, y, r)) return { x, y };
          const step = Math.max(this.gridSize, r);
          for (let d = step; d <= maxDistance; d += step) {
              const samples = Math.max(12, Math.ceil(Math.PI * 2 * d / step));
              for (let i = 0; i < samples; i++) {
                  const a = i / samples * Math.PI * 2;
                  const px = x + Math.cos(a) * d;
                  const py = y + Math.sin(a) * d;
                  if (!this._isBlocked(px, py, r)) return { x: px, y: py };
              }
          }
          return null;
      }


    /**
     * [PERF-2026-08-08] 半径档归并：返回该半径所属桶的代表半径（桶上界，保守不缩水）；
     * 桶外（>90）半径原值返回、各自成桶。memo/路径缓存/RegionIndex 统一用桶半径，
     * 同桶怪共享缓存，避免不同半径各建一套。
     */
    _bucketRadius(radius) {
        for (const b of RADIUS_BUCKETS) {
            if (radius <= b) return b;
        }
        return radius;
    }

    /**
     * [PERF-2026-08-08] 局部失效（掩体增删专用）：只清与指定区域相关的缓存，
     * 替代 invalidateCache() 的核弹级全清（世界-122 掩体被摧毁/加建频繁，
     * 全清会让全部怪集体冷启动）。
     * 传入矩形为变化源 bbox（如掩体线段包围盒），内部外扩 maxSearchRange(800px)——
     * 任何搜索窗口最大外扩量，覆盖所有可能读到该几何的寻路。
     * 清除范围：
     *  1. _pathCache：路径任一节点落入外扩窗口的条目；负缓存(null)按起/终点判断
     *  2. _exitCache：同口径按起/终点判断
     *  3. _cellMemo：窗口内格子的全部半径桶条目
     *  4. SpatialHash / RegionIndex：无增量结构，仍标脏惰性全量重建（下次查询触发一次）
     */
    invalidateRegion(minX, minY, maxX, maxY) {
        const R = this.maxSearchRange;
        const x0 = minX - R, x1 = maxX + R;
        const y0 = minY - R, y1 = maxY + R;
        const inWindow = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        // 1) 路径缓存：节点命中窗口 → 删；null 负缓存按起终点命中判断
        for (const [k, v] of this._pathCache) {
            let hit = false;
            if (v.path) {
                for (const n of v.path) {
                    if (inWindow(n.x, n.y)) { hit = true; break; }
                }
            }
            if (!hit && v.meta &&
                (inWindow(v.meta.sx, v.meta.sy) || inWindow(v.meta.ex, v.meta.ey))) {
                hit = true;
            }
            if (hit) this._pathCache.delete(k);
        }
        // 2) 出口缓存（含 null 结果）：按起终点命中判断
        for (const [k, v] of this._exitCache) {
            if (v.meta && (inWindow(v.meta.sx, v.meta.sy) || inWindow(v.meta.ex, v.meta.ey))) {
                this._exitCache.delete(k);
            }
        }
        // 3) 格子 memo：窗口覆盖的格子，逐半径桶删除
        const g0x = Math.floor(x0 / this.gridSize), g1x = Math.floor(x1 / this.gridSize);
        const g0y = Math.floor(y0 / this.gridSize), g1y = Math.floor(y1 / this.gridSize);
        for (let gx = g0x; gx <= g1x; gx++) {
            for (let gy = g0y; gy <= g1y; gy++) {
                for (const r of this._memoRadii) {
                    const base = ((gx + gy * CELL_STRIDE) * 4096 + r) * 2;
                    this._cellMemo.delete(base);
                    this._cellMemo.delete(base + 1);
                }
            }
        }
        // 4) SpatialHash（掩体 _cover 段来源）无增量移除：标脏后跨帧构建新索引，
        //    完成后原子交换；重建读 WallSystem.isoSegments 当前状态，增删后的段自然反映，不漏
        this._hashValid = false;
        this.spatialHash.cancelRebuild();
        this._maxTreeRadius = 0;
        this._geometryVersion++;
        this._reachabilityCache.clear();
        this._pendingEndpointProjections.clear();
        this._endpointProjectionCache.clear();
        for (const [requestId, state] of this._pendingSearches) {
            if (inWindow(state.startX, state.startY) || inWindow(state.endX, state.endY)
                || (state.minX <= maxX && state.minX + state.cols * this.gridSize >= minX
                    && state.minY <= maxY && state.minY + state.rows * this.gridSize >= minY)) {
                this._pendingSearches.delete(requestId);
            }
        }
        for (const [key, field] of this._sharedFlowFields) {
            let hit = field.meta
                && (inWindow(field.meta.sx, field.meta.sy) || inWindow(field.meta.ex, field.meta.ey));
            if (!hit && field.path) {
                hit = field.path.some(node => inWindow(node.x, node.y));
            }
            if (!hit && Number.isFinite(field.minX) && Number.isFinite(field.minY)) {
                const fieldMaxX = field.minX + field.cols * this.gridSize;
                const fieldMaxY = field.minY + field.rows * this.gridSize;
                hit = field.minX <= x1 && fieldMaxX >= x0
                    && field.minY <= y1 && fieldMaxY >= y0;
            }
            if (hit) this._sharedFlowFields.delete(key);
        }
        // RegionIndex：保持 markDirty 惰性重建（机制不变）
        regionIndex.markDirty();
    }

    /**
     * [PERF-2026-08-03] 每帧寻路预算：由 MovementSystem.beginFrame() 在每帧开始时调用。
     * 帧预算防止"刷怪瞬间 N 只怪同帧冷寻路"造成主线程长卡顿。
     */
    beginFrame() {
        this._frameUsedMs = 0;
        this._footprintSyncMs = 0;
        this._footprintSyncRuns = 0;
        const now = Date.now();
        regionIndex.beginFrame?.(now);
        for (const [requestId, state] of this._pendingSearches) {
            if (now - state.lastTouchedAt > 3000) this._pendingSearches.delete(requestId);
        }
        for (const [key, state] of this._pendingEndpointProjections) {
            if (now - state.lastTouchedAt > 3000) this._pendingEndpointProjections.delete(key);
        }
        for (const [key, entry] of this._endpointProjectionCache) {
            if (now - entry.timestamp > 1000) this._endpointProjectionCache.delete(key);
        }
    }

    _getSharedFlowBuildStats() {
        let pendingFields = 0;
        let processedCells = 0;
        let totalCells = 0;
        let buildableFields = 0;
        for (const field of this._sharedFlowFields.values()) {
            if (field.negative || field.status === 'corridor' || !field.count) continue;
            buildableFields++;
            if (field.status === 'ready') continue;
            pendingFields++;
            totalCells += field.count * 2;
            processedCells += Math.min(field.count, field.buildIndex || 0)
                + Math.min(field.count, field.closedCount || 0);
        }
        const progress = pendingFields > 0 && totalCells > 0
            ? Math.min(100, processedCells / totalCells * 100)
            : (buildableFields > 0 ? 100 : 0);
        return { pendingFields, processedCells, totalCells, progress };
    }

    getPerformanceStats() {
        const regionStats = regionIndex.getPerformanceStats?.() || {};
        const hashStats = this.spatialHash.getRebuildStats?.() || {};
        const flowStats = this._getSharedFlowBuildStats();
        return {
            frameBudgetMs: this.frameBudgetMs,
            frameUsedMs: this._frameUsedMs,
            budgetRemainingMs: Math.max(0, this.frameBudgetMs - this._frameUsedMs),
            pathCacheEntries: this._pathCache?.size || 0,
            reachabilityCacheEntries: this._reachabilityCache?.size || 0,
            pendingSearches: this._pendingSearches?.size || 0,
            sharedFlowFields: this._sharedFlowFields?.size || 0,
            sharedFlowHits: this._sharedFlowHits,
            sharedIntegrationHits: this._sharedIntegrationHits,
            sharedFlowBuildSlices: this._sharedFlowBuildSlices,
            negativeCacheHits: this._negativeCacheHits,
            incrementalSlices: this._incrementalSlices,
            hashBuildSlices: this._hashBuildSlices,
            hashRebuildPending: hashStats.pending || 0,
            hashRebuildProcessedCells: hashStats.processedCells || 0,
            hashRebuildTotalCells: hashStats.totalCells || 0,
            hashBuildProgress: this._hashValid
                ? 100
                : (hashStats.pending ? (hashStats.progress || 0) : 0),
            projectionSlices: this._projectionSlices,
            flowBuildPending: flowStats.pendingFields,
            flowBuildProcessedCells: flowStats.processedCells,
            flowBuildTotalCells: flowStats.totalCells,
            flowBuildProgress: flowStats.progress,
            footprintSyncMs: this._footprintSyncMs,
            footprintLastSyncMs: this._lastFootprintSyncMs,
            footprintPeakSyncMs: this._peakFootprintSyncMs,
            footprintSyncRuns: this._footprintSyncRuns,
            regionRebuildPending: regionStats.rebuildPending || 0,
            regionRebuildProcessedCells: regionStats.rebuildProcessedCells || 0,
            regionRebuildTotalCells: regionStats.rebuildTotalCells || 0,
            regionExitSearchPending: regionStats.exitSearchPending || 0,
        };
    }

    _budgetAvailable() {
        return this._frameUsedMs < this.frameBudgetMs;
    }

    _chargeBudget(startMs) {
        this._frameUsedMs += performance.now() - startMs;
    }

    _warn(msg) {
        const now = Date.now();
        if (now - this._lastWarnAt > 1000) {
            this._lastWarnAt = now;
            console.warn(msg);
        }
    }

    _isBlocked(x, y, radius) {
        this._ensureHash();
        if (this.spatialHash.isBlocked(x, y, radius)) return true;
          return this._isEntityObstacleBlocked(x, y, radius);
    }

    /**
     * [PERF-2026-08-03] 合并单趟格子查询：一次空间哈希遍历同时算出 blocked 与静态 moveCost。
     * 结果按(格子坐标, 半径桶)记忆化——同一几何下同桶寻路共享，消除 _buildGrid 每格两次
     * 空间查询的重复开销（实测单次冷路径 9.2ms 的根因，占冷路径 ~92%）。
     * [PERF-2026-08-08] 半径档归并：memo key 与阻挡判定统一用桶代表半径（桶上界，
     * ≥ 桶内任意实际半径，路径只会变保守绕更宽、不会穿墙）；
     * key 改整数 (gx + gy*CELL_STRIDE) * 4096 + 桶半径，消除热路径字符串拼接。
     * 注意：只缓存静态几何（墙/树）；动态障碍成本仍由 _buildGrid 每格实时叠加。
     */
    /** 把寻路专用实体圆障碍叠加到静态格子结果上（不污染静态 memo） */
      _withEntityObstacles(x, y, r, base) {
          if (!this._hasEntityObstacles) return base;
          let { blocked, cost } = base;
          for (const o of this._entityCircleObstacles) {
              const dx = x - o.x, dy = y - o.y;
              const d2 = dx * dx + dy * dy;
              const hardR = o.radius + r;
              if (d2 < hardR * hardR) {
                  blocked = true;
                  break;
              }
              // 硬障碍外圈给软成本，让 A* 提前切线绕行而不是贴边刮擦
              const softR = o.radius + r * 2.0;
              if (d2 < softR * softR && cost < 3.0) cost = 3.0;
          }
          if (!blocked) {
              for (const o of this._queryEntityFootprints(x, y, r)) {
                  if (x + r < o.minX || x - r > o.maxX
                      || y + r < o.minY || y - r > o.maxY) continue;
                  if (circleIntersectsIsoFootprint(x, y, r, o.entity)) {
                      blocked = true;
                      break;
                  }
              }
          }
          return { blocked, cost };
      }

      _getCellData(x, y, entityRadius, options = null) {
        this._ensureHash();
        // 契约：仅允许格子中心坐标调用（k×40+20）——memo 按格子复用，
        // 同格子内的不同采样点共享同一结果，只有中心采样才保证一致性
        const r = this._bucketRadius(entityRadius);
        const gx = Math.floor(x / this.gridSize);
        const gy = Math.floor(y / this.gridSize);
        const friendlyGateAccess = options?.friendlyGateAccess === true;
        const memoKey = ((gx + gy * CELL_STRIDE) * 4096 + r) * 2
            + (friendlyGateAccess ? 1 : 0);
        const cached = this._cellMemo.get(memoKey);
        if (cached) return this._withEntityObstacles(x, y, r, cached);

        const cellSize = this.spatialHash.cellSize;
        const [baseCX, baseCY] = this.spatialHash._getCell(x, y);
        const searchR = Math.max(r, r * 1.5 + this._maxTreeRadius);
        const range = Math.ceil(searchR / cellSize) + 1;
        let cost = 1.0;
        let blocked = false;
        outer:
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const key = this.spatialHash._getKey(baseCX + dx, baseCY + dy);
                const items = this.spatialHash.cells.get(key);
                if (!items) continue;
                for (const item of items) {
                    if (item.type === 'wall') {
                        const w = item.obj;
                        if (x + r > w.x && x - r < w.x + w.w &&
                            y + r > w.y && y - r < w.y + w.h) {
                            blocked = true;
                            break outer;
                        }
                      } else if (item.type === 'tree') {
                          const t = item.obj;
                          const ddx = x - t.x, ddy = y - t.y;
                        const distSq = ddx * ddx + ddy * ddy;
                        // 阻挡：与原 _isBlocked 同口径（视觉半径 + 实体半径）
                        const blockR = (t.collisionRadius || t.radius * 0.6) + r;
                        if (distSq < blockR * blockR) {
                            blocked = true;
                            break outer;
                        }
                        // 近树软成本：与原 _getMoveCost 同口径（碰撞半径 + 实体半径×1.5），只计一棵
                        if (cost === 1.0) {
                            const treeR = t.collisionRadius || t.radius * 0.6;
                            const nearR = treeR + r * 1.5;
                              if (distSq < nearR * nearR) cost += 0.5;
                          }
                      } else if (item.type === 'seg') {
                          const s = item.obj;
                          if (this.spatialHash._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2)
                              < r + (s.halfThick || 26)) {
                              blocked = true;
                              break outer;
                          }
                      } else if (item.type === 'gate') {
                          // 门段不作永久阻挡；友军可开启的自动门按普通格，其他关闭门保留软成本。
                          const s = item.obj;
                          if (this.spatialHash._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2)
                              < r + (s.halfThick || 26)) {
                              const friendlyAutoGate = friendlyGateAccess
                                  && s._opensForFriendly === true
                                  && s._gateOwner?.gateMode !== 'locked';
                              const gateCost = friendlyAutoGate ? 1 : GATE_SOFT_COST;
                              if (cost < gateCost) cost = gateCost;
                          }
                      }
                  }
              }
        }
        const result = { blocked, cost };
        this._memoRadii.add(r);
        // [PERF-2026-08-16] 地图扩展后格子记忆化可能无界增长：超上限整体清空
        // （6144×4096 下 40 怪 × 每路径数百格 ≈ 数万条，上限取 10 万防频繁触顶清空）
        if (this._cellMemo.size > 100000) this._cellMemo.clear();
        this._cellMemo.set(memoKey, result);
        return this._withEntityObstacles(x, y, r, result);
    }

    // [ENHANCE] 区域连通性检查：使用 Flood Fill 快速判断目标是否可达
    // 如果起点和终点不在同一区域，直接返回 false，避免昂贵的 A* 计算
    isReachable(startX, startY, endX, endY, entityRadius) {
        this._ensureHash();
        const step = this.gridSize;
        const r = this._bucketRadius(entityRadius);
        // 起点允许位于刚出生建筑/旧存档嵌入区内，以便 A* 从最近开放格离场；终点必须合法。
        if (this._isBlocked(endX, endY, r)) return false;
        const targetKey = `${this._geometryVersion}:${r}:${Math.floor(endX / step)},${Math.floor(endY / step)}`;
        const startCellKey = Math.floor(startX / step) + Math.floor(startY / step) * CELL_STRIDE;
        const cacheKey = `${targetKey}:${startCellKey}`;
        const cached = this._reachabilityCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 1000) return cached.value;
        const visited = new Set();
        const remember = (value, spreadVisited = false) => {
            if (this._reachabilityCache.size >= 4096) this._reachabilityCache.clear();
            const timestamp = Date.now();
            if (spreadVisited) {
                // 到达目标时，已访问格都与目标同连通分量；队形内其他单位可直接命中预读结论。
                for (const cellKey of visited) {
                    this._reachabilityCache.set(`${targetKey}:${cellKey}`, { value, timestamp });
                }
            } else {
                this._reachabilityCache.set(cacheKey, { value, timestamp });
            }
            return value;
        };
        const maxDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        // [FIX] 步数按 BFS 层数计算：每层 step 距离，给 3 倍冗余 + 20 保底
        const maxSteps = Math.ceil(maxDist / step) * 3 + 20;
        const queue = [{ x: startX, y: startY }];
        // [PERF-2026-08-08] visited 整数 key（gx + gy*CELL_STRIDE），替代 "gx,gy" 字符串拼接
        visited.add(Math.floor(startX / step) + Math.floor(startY / step) * CELL_STRIDE);
        let steps = 0;
        let queueIdx = 0;
        while (queueIdx < queue.length && steps < maxSteps) {
            steps++;
            const { x, y } = queue[queueIdx++];
            // 如果到达目标附近，认为可达
            if (Math.sqrt((x - endX) ** 2 + (y - endY) ** 2) < step * 2) {
                return remember(true, true);
            }
            // 8方向扩展
            const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
            for (const [dr, dc] of dirs) {
                const nx = x + dr * step;
                const ny = y + dc * step;
                const key = Math.floor(nx / step) + Math.floor(ny / step) * CELL_STRIDE;
                if (visited.has(key)) continue;
                if (this._isBlocked(nx, ny, r)) continue;
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
        // 队列耗尽说明起点所在连通区已完整搜索，目标确实不可达。
        if (queueIdx >= queue.length) return remember(false, true);
        // 只有步数预算用完时才让 A* 自己判断，避免 BFS 预算不足导致误判。
        return remember(true);
    }

    // [NEW] 当目标不可达时，找到当前区域边界上离目标最近的出口
    // 返回 { path: [{x,y}, ...], isExitPath: true } 或 null
    findPathToExit(startX, startY, targetX, targetY, entityRadius, options = null) {
        // [PERF-2026-08-03] 出口路径短时缓存：A* 失败后卡住重算每 500ms 都会走到这里，
        // 原来每次都全量重建 RegionIndex（2~5ms，大地图更高），缓存后重复失败近零成本
        const exitKey = `${this._getCacheKey(
            startX, startY, targetX, targetY, entityRadius, options
        )},exit`;
        const cached = this._exitCache.get(exitKey);
        if (cached && Date.now() - cached.timestamp < 500) return cached.result;

        // 只有显式增量 AI 请求可以延后；玩家 RTS/地图生成等直接调用保持同步。
        const incremental = options?.incremental === true;
        if (incremental && !this._budgetAvailable()) return PATH_DEFERRED;
        const budgetStart = performance.now();
        let outerBudgetCharged = false;
        const chargeOuterBudget = () => {
            if (outerBudgetCharged) return;
            this._chargeBudget(budgetStart);
            outerBudgetCharged = true;
        };

        // 先确保 RegionIndex 已构建（使用当前 WallSystem 的边界）
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        if (WallSystem && WallSystem.walls) {
            for (const w of WallSystem.walls) {
                minX = Math.min(minX, w.x);
                maxX = Math.max(maxX, w.x + w.w);
                minY = Math.min(minY, w.y);
                maxY = Math.max(maxY, w.y + w.h);
            }
        }
        let result = null;
        if (minX !== Infinity) {
            const radius = this._bucketRadius(entityRadius);
            const remaining = Math.max(0, this.frameBudgetMs - this._frameUsedMs);
            const deadline = incremental ? budgetStart + remaining : Infinity;
            if (regionIndex.checkDirty(radius)) {
                const rebuilt = regionIndex.advanceRebuild(
                    minX, minY, maxX, maxY, radius, deadline,
                    (x, y, r) => this._isBlocked(x, y, r)
                );
                if (!rebuilt) {
                    chargeOuterBudget();
                    return PATH_DEFERRED;
                }
            }
            const exitSearch = regionIndex.findNearestExitIncremental(
                exitKey, startX, startY, targetX, targetY, deadline
            );
            if (!exitSearch.done) {
                chargeOuterBudget();
                return PATH_DEFERRED;
            }
            const exit = exitSearch.result;
            if (exit) {
                // 用 A* 走到出口
                // RegionIndex 计费到此结束；findPath 会自行计入 A*，禁止外层再次覆盖计费。
                chargeOuterBudget();
                const path = this.findPath(startX, startY, exit.x, exit.y, entityRadius, options);
                if (path === PATH_DEFERRED) {
                    return PATH_DEFERRED;
                }
                if (path) result = { path, isExitPath: true, exitX: exit.x, exitY: exit.y };
            }
        }
        chargeOuterBudget();
        // 结果（含 null）短时缓存；防无限增长
        // [PERF-2026-08-08] meta 记录起终点：invalidateRegion 局部失效按区域相交判断
        if (this._exitCache.size > 100) this._exitCache.clear();
        this._exitCache.set(exitKey, {
            result,
            timestamp: Date.now(),
            meta: { sx: startX, sy: startY, ex: targetX, ey: targetY }
        });
        return result;
    }

    // [ENHANCE] 缓存管理
    _getCacheKey(startX, startY, endX, endY, radius, options = null) {
        // 坐标量化到 gridSize 的倍数，减少缓存 key 的精度
        // [PERF-2026-08-08] 半径归并为桶：同桶怪共享路径缓存
        const gs = this.gridSize;
        const qx = Math.floor(startX / gs) * gs;
        const qy = Math.floor(startY / gs) * gs;
        const qex = Math.floor(endX / gs) * gs;
        const qey = Math.floor(endY / gs) * gs;
        const gateProfile = options?.friendlyGateAccess === true ? 'friendly-gate' : 'default-gate';
        return `${qx},${qy},${qex},${qey},${this._bucketRadius(radius)},${gateProfile}`;
    }

    // 读取路径缓存：未命中返回 undefined；命中返回 path（可能为 null = 不可达负缓存）
    _getCachedPath(key) {
        const cached = this._pathCache.get(key);
        if (!cached) return undefined;
        if (Date.now() - cached.timestamp > cached.ttl) {
            this._pathCache.delete(key);
            return undefined;
        }
        return cached.path;
    }

    // [PERF-2026-08-08] meta 记录起终点：invalidateRegion 局部失效时按区域相交判断
    // （负缓存 path=null 无节点可判，正缓存也用作兜底）
    _setCache(key, path, ttl = this._cacheMaxAge, meta = null) {
        // 超过容量：先清过期，仍满则淘汰最旧（简单 LRU，避免只清过期导致的无限增长）
        if (this._pathCache.size >= this._cacheMaxSize) {
            const now = Date.now();
            for (const [k, v] of this._pathCache) {
                if (now - v.timestamp > v.ttl) this._pathCache.delete(k);
            }
            if (this._pathCache.size >= this._cacheMaxSize) {
                let oldestKey = null;
                let oldestTs = Infinity;
                for (const [k, v] of this._pathCache) {
                    if (v.timestamp < oldestTs) { oldestTs = v.timestamp; oldestKey = k; }
                }
                if (oldestKey !== null) this._pathCache.delete(oldestKey);
            }
        }
        this._pathCache.set(key, { path, timestamp: Date.now(), ttl, meta });
    }

    _buildGrid(startX, startY, endX, endY, entityRadius, options = null) {
        const directDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        const searchRange = Math.min(
            this.maxSearchRange,
            Math.max(this.minSearchRange, directDist + 200)
        );
        // [PERF-2026-08-03] 网格原点对齐到 gridSize 倍数：格子中心坐标稳定为 k*40+20，
        // 使 _getCellData 的(格子坐标)记忆化可跨多次寻路复用
        const rawMinX = Math.min(startX, endX) - searchRange;
        const rawMaxX = Math.max(startX, endX) + searchRange;
        const rawMinY = Math.min(startY, endY) - searchRange;
        const rawMaxY = Math.max(startY, endY) + searchRange;
        const minX = Math.floor(rawMinX / this.gridSize) * this.gridSize;
        const minY = Math.floor(rawMinY / this.gridSize) * this.gridSize;
        const maxX = rawMaxX;
        const maxY = rawMaxY;
        const cols = Math.ceil((maxX - minX) / this.gridSize);
        const rows = Math.ceil((maxY - minY) / this.gridSize);
        // 若对象池足够大则复用格子对象，否则回退到动态分配
        const usePool = rows <= this._gridPool.length && cols <= this._gridPool[0].length;
        const grid = [];
        for (let r = 0; r < rows; r++) {
            grid[r] = usePool ? this._gridPool[r] : [];
            for (let c = 0; c < cols; c++) {
                const x = minX + c * this.gridSize + this.gridSize / 2;
                const y = minY + r * this.gridSize + this.gridSize / 2;
                // [PERF-2026-08-03] 合并单趟查询 + 跨寻路记忆化（原为每次 _isBlocked + _getMoveCost 两次空间查询）
                const cellData = this._getCellData(x, y, entityRadius, options);
                const blocked = cellData.blocked;
                // 动态障碍成本每格实时叠加（250ms 更新，不进静态 memo）
                const dynamicCost = blocked ? 1.0 : dynamicObstacleMap.getCost(x, y);
                if (usePool) {
                    const cell = this._gridPool[r][c];
                    cell.x = x; cell.y = y; cell.r = r; cell.c = c;
                    cell.blocked = blocked;
                    cell.moveCost = blocked ? Infinity : cellData.cost * dynamicCost;
                    cell.g = Infinity; cell.h = 0; cell.f = Infinity; cell.parent = null;
                } else {
                    grid[r][c] = {
                        x, y, r, c,
                        blocked,
                        moveCost: blocked ? Infinity : cellData.cost * dynamicCost,
                        g: Infinity, h: 0, f: Infinity,
                        parent: null
                    };
                }
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
        if (dist < 1e-6) return this._isBlocked(x2, y2, radius);
        const steps = Math.ceil(dist / (this.gridSize * 0.5));
        const stepX = dx / steps;
        const stepY = dy / steps;
        for (let i = 1; i <= steps; i++) {
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

    _reconstructPath(endNode, entityRadius, cacheKey, cacheMeta) {
        const path = [];
        let node = endNode;
        while (node) {
            path.unshift({ x: node.x, y: node.y });
            node = node.parent;
        }
        const smoothed = this._smoothPath(path, entityRadius);
        this._setCache(cacheKey, smoothed, this._cacheMaxAge, cacheMeta);
        return smoothed;
    }

    _sharedFlowKey(endX, endY, radius, options) {
        const sector = Math.max(this.gridSize * 4,
            Number(performanceConfig.pathQueue?.sharedFlowSectorPx) || 240);
        const gateProfile = options?.friendlyGateAccess === true ? 1 : 0;
        const targetGroup = options?.sharedTargetKey || '';
        return `${this._bucketRadius(radius)}:${gateProfile}`
            + `:${targetGroup}:${Math.floor(endX / sector)},${Math.floor(endY / sector)}`;
    }

    _getSharedPath(startX, startY, endX, endY, radius, options) {
        if (options?.sharedCrowdPath !== true) return undefined;
        const key = this._sharedFlowKey(endX, endY, radius, options);
        const field = this._sharedFlowFields.get(key);
        if (!field) return undefined;
        if (Date.now() - field.timestamp > this._sharedFlowMaxAge) {
            this._sharedFlowFields.delete(key);
            return undefined;
        }
        if (field.negative) {
            const sector = Math.max(this.gridSize * 4,
                Number(performanceConfig.pathQueue?.sharedFlowSectorPx) || 240);
            const startSector = `${Math.floor(startX / sector)},${Math.floor(startY / sector)}`;
            if (field.startSector !== startSector) return undefined;
            this._negativeCacheHits++;
            return null;
        }
        field.timestamp = Date.now();
        const corridorPath = this._pathFromSharedCorridor(
            field, startX, startY, endX, endY, radius
        );
        if (corridorPath) {
            this._sharedFlowHits++;
            return corridorPath;
        }
        if (field.status === 'corridor') return undefined;
        const fieldGoal = field.path[field.path.length - 1];
        const bucket = this._bucketRadius(radius);
        if (!fieldGoal || Math.hypot(fieldGoal.x - endX, fieldGoal.y - endY) > 280
            || this._raycastBlocked(fieldGoal.x, fieldGoal.y, endX, endY, bucket)) {
            return undefined;
        }
        const col = Math.floor((startX - field.minX) / this.gridSize);
        const row = Math.floor((startY - field.minY) / this.gridSize);
        if (row < 0 || row >= field.rows || col < 0 || col >= field.cols) return undefined;
        const startIndex = row * field.cols + col;
        if (field.status !== 'ready' && !field.closed[startIndex]) {
            if (!this._budgetAvailable()) return PATH_DEFERRED;
            const sliceStart = performance.now();
            const remaining = Math.max(0, this.frameBudgetMs - this._frameUsedMs);
            const available = this._advanceSharedFlow(
                field, sliceStart + remaining, startIndex
            );
            this._chargeBudget(sliceStart);
            if (!available && field.status !== 'ready') {
                this._sharedFlowBuildSlices++;
                return PATH_DEFERRED;
            }
        }
        if (!Number.isFinite(field.integration[startIndex])) return undefined;
        const path = this._pathFromIntegrationField(
            field, startIndex, startX, startY, endX, endY, radius
        );
        if (path) {
            this._sharedFlowHits++;
            this._sharedIntegrationHits++;
        }
        return path || undefined;
    }

    _pathFromSharedCorridor(field, startX, startY, endX, endY, radius) {
        const gx = Math.floor(startX / this.gridSize);
        const gy = Math.floor(startY / this.gridSize);
        let joinIndex = field.corridor?.get(gx + gy * CELL_STRIDE);
        if (joinIndex === undefined) {
            for (let ring = 1; ring <= 2 && joinIndex === undefined; ring++) {
                for (let dx = -ring; dx <= ring && joinIndex === undefined; dx++) {
                    for (let dy = -ring; dy <= ring; dy++) {
                        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                        joinIndex = field.corridor?.get((gx + dx) + (gy + dy) * CELL_STRIDE);
                        if (joinIndex !== undefined) break;
                    }
                }
            }
        }
        if (joinIndex === undefined) return null;
        const join = field.path[joinIndex];
        const last = field.path[field.path.length - 1];
        const bucket = this._bucketRadius(radius);
        if (!join || !last
            || this._raycastBlocked(startX, startY, join.x, join.y, bucket)
            || Math.hypot(last.x - endX, last.y - endY) > 280
            || this._raycastBlocked(last.x, last.y, endX, endY, bucket)) return null;
        const path = [{ x: startX, y: startY }, ...field.path.slice(joinIndex)];
        if (Math.hypot(last.x - endX, last.y - endY) > this.gridSize) {
            path.push({ x: endX, y: endY });
        }
        return path;
    }

    _createSharedFlowField(path, endX, endY, radius, options) {
        const padding = Math.max(80,
            Number(performanceConfig.pathQueue?.sharedFlowPaddingPx) || 240);
        const maxCells = Math.max(512,
            Number(performanceConfig.pathQueue?.sharedFlowMaxCells) || 4096);
        let pathMinX = Infinity, pathMinY = Infinity, pathMaxX = -Infinity, pathMaxY = -Infinity;
        for (const node of path) {
            pathMinX = Math.min(pathMinX, node.x); pathMaxX = Math.max(pathMaxX, node.x);
            pathMinY = Math.min(pathMinY, node.y); pathMaxY = Math.max(pathMaxY, node.y);
        }
        const minX = Math.floor((pathMinX - padding) / this.gridSize) * this.gridSize;
        const minY = Math.floor((pathMinY - padding) / this.gridSize) * this.gridSize;
        const cols = Math.ceil((pathMaxX + padding - minX) / this.gridSize);
        const rows = Math.ceil((pathMaxY + padding - minY) / this.gridSize);
        const count = cols * rows;
        const corridor = new Map();
        for (let i = path.length - 1; i >= 0; i--) {
            const a = path[i];
            const b = path[Math.min(path.length - 1, i + 1)];
            const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / this.gridSize));
            for (let s = 0; s <= samples; s++) {
                const t = s / samples;
                const gx = Math.floor((a.x + (b.x - a.x) * t) / this.gridSize);
                const gy = Math.floor((a.y + (b.y - a.y) * t) / this.gridSize);
                for (let ox = -2; ox <= 2; ox++) {
                    for (let oy = -2; oy <= 2; oy++) {
                        const cellKey = gx + ox + (gy + oy) * CELL_STRIDE;
                        if (!corridor.has(cellKey)) corridor.set(cellKey, i);
                    }
                }
            }
        }
        const field = {
            negative: false,
            status: count <= maxCells ? 'build' : 'corridor',
            path: path.map(node => ({ x: node.x, y: node.y })),
            corridor,
            meta: { sx: path[0].x, sy: path[0].y, ex: endX, ey: endY },
            timestamp: Date.now(),
            minX, minY, cols, rows, count,
            radius: this._bucketRadius(radius),
            options: { friendlyGateAccess: options?.friendlyGateAccess === true },
        };
        if (field.status === 'corridor') return field;
        field.blocked = new Uint8Array(count);
        field.moveCost = new Float32Array(count);
        field.integration = new Float64Array(count); field.integration.fill(Infinity);
        field.next = new Int32Array(count); field.next.fill(-1);
        field.closed = new Uint8Array(count);
        field.heap = new IndexHeap(field.integration, count);
        field.buildIndex = 0;
        field.closedCount = 0;
        field.goalIndex = -1;
        return field;
    }

    _advanceSharedFlow(field, deadline, desiredIndex = -1) {
        const checkMask = 15;
        if (field.status === 'build') {
            while (field.buildIndex < field.count) {
                const index = field.buildIndex++;
                const row = Math.floor(index / field.cols);
                const col = index - row * field.cols;
                const x = field.minX + col * this.gridSize + this.gridSize / 2;
                const y = field.minY + row * this.gridSize + this.gridSize / 2;
                const cell = this._getCellData(x, y, field.radius, field.options);
                field.blocked[index] = cell.blocked ? 1 : 0;
                field.moveCost[index] = cell.blocked ? Infinity : cell.cost;
                if ((index & checkMask) === 0 && performance.now() >= deadline) return false;
            }
            const endC = Math.floor((field.meta.ex - field.minX) / this.gridSize);
            const endR = Math.floor((field.meta.ey - field.minY) / this.gridSize);
            field.goalIndex = this._nearestOpenIndex(field, endR, endC);
            if (field.goalIndex < 0) {
                field.status = 'ready';
                return true;
            }
            field.integration[field.goalIndex] = 0;
            field.heap.push(field.goalIndex);
            field.status = 'integrate';
        }
        const dirs = [-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
        let expansions = 0;
        while (field.heap.size() > 0) {
            const current = field.heap.pop();
            if (field.closed[current]) continue;
            field.closed[current] = 1;
            field.closedCount++;
            if (current === desiredIndex) return true;
            const row = Math.floor(current / field.cols);
            const col = current - row * field.cols;
            for (let d = 0; d < dirs.length; d += 2) {
                const dr = dirs[d], dc = dirs[d + 1];
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= field.rows || nc < 0 || nc >= field.cols) continue;
                const neighbor = nr * field.cols + nc;
                if (field.blocked[neighbor] || field.closed[neighbor]) continue;
                if (dr !== 0 && dc !== 0) {
                    if (field.blocked[nr * field.cols + col]
                        || field.blocked[row * field.cols + nc]) continue;
                }
                const tentative = field.integration[current]
                    + (dr !== 0 && dc !== 0 ? 1.414 : 1)
                    * field.moveCost[current] * this.gridSize;
                if (tentative >= field.integration[neighbor]) continue;
                field.integration[neighbor] = tentative;
                field.next[neighbor] = current;
                field.heap.push(neighbor);
            }
            if ((++expansions & checkMask) === 0 && performance.now() >= deadline) return false;
        }
        field.status = 'ready';
        return true;
    }

    _pathFromIntegrationField(field, startIndex, startX, startY, endX, endY, radius) {
        if (startIndex !== field.goalIndex && field.next[startIndex] < 0) return null;
        const path = [{ x: startX, y: startY }];
        let current = startIndex;
        let previousDirection = null;
        let previousIndex = current;
        for (let steps = 0; steps < field.count && current !== field.goalIndex; steps++) {
            const next = field.next[current];
            if (next < 0 || next === current) return null;
            const row = Math.floor(current / field.cols);
            const col = current - row * field.cols;
            const nextRow = Math.floor(next / field.cols);
            const nextCol = next - nextRow * field.cols;
            const direction = `${nextRow - row},${nextCol - col}`;
            if (previousDirection !== null && direction !== previousDirection) {
                const prevRow = Math.floor(previousIndex / field.cols);
                const prevCol = previousIndex - prevRow * field.cols;
                path.push({
                    x: field.minX + prevCol * this.gridSize + this.gridSize / 2,
                    y: field.minY + prevRow * this.gridSize + this.gridSize / 2,
                });
            }
            previousDirection = direction;
            previousIndex = next;
            current = next;
        }
        if (current !== field.goalIndex) return null;
        const goalRow = Math.floor(current / field.cols);
        const goalCol = current - goalRow * field.cols;
        path.push({
            x: field.minX + goalCol * this.gridSize + this.gridSize / 2,
            y: field.minY + goalRow * this.gridSize + this.gridSize / 2,
        });
        const last = path[path.length - 1];
        if (Math.hypot(last.x - endX, last.y - endY) > this.gridSize
            && !this._raycastBlocked(last.x, last.y, endX, endY, this._bucketRadius(radius))) {
            path.push({ x: endX, y: endY });
        }
        return path;
    }

    _projectBlockedEndpointIncremental(endX, endY, radius, maxDistance = 360) {
        const bucket = this._bucketRadius(radius);
        const cacheKey = `${this._geometryVersion}:${bucket}:`
            + `${Math.floor(endX / this.gridSize)},${Math.floor(endY / this.gridSize)}`;
        const cached = this._endpointProjectionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp <= 1000) return cached.result;
        if (!this._budgetAvailable()) return PATH_DEFERRED;
        let state = this._pendingEndpointProjections.get(cacheKey);
        if (!state) {
            const step = Math.max(this.gridSize, bucket);
            state = {
                endX, endY, bucket, maxDistance, step,
                distance: step, sample: 0, samples: 0,
                lastTouchedAt: Date.now(),
            };
            this._pendingEndpointProjections.set(cacheKey, state);
        }
        state.lastTouchedAt = Date.now();
        const startedAt = performance.now();
        const deadline = startedAt + Math.max(0, this.frameBudgetMs - this._frameUsedMs);
        while (state.distance <= state.maxDistance) {
            if (state.samples === 0) {
                state.samples = Math.max(
                    12,
                    Math.ceil(Math.PI * 2 * state.distance / state.step)
                );
                state.sample = 0;
            }
            while (state.sample < state.samples) {
                const angle = state.sample++ / state.samples * Math.PI * 2;
                const x = state.endX + Math.cos(angle) * state.distance;
                const y = state.endY + Math.sin(angle) * state.distance;
                if (!this._isBlocked(x, y, state.bucket)) {
                    const result = { x, y };
                    this._pendingEndpointProjections.delete(cacheKey);
                    this._endpointProjectionCache.set(cacheKey, { result, timestamp: Date.now() });
                    this._chargeBudget(startedAt);
                    return result;
                }
                if (performance.now() >= deadline) {
                    this._projectionSlices++;
                    this._chargeBudget(startedAt);
                    return PATH_DEFERRED;
                }
            }
            state.distance += state.step;
            state.samples = 0;
        }
        this._pendingEndpointProjections.delete(cacheKey);
        this._endpointProjectionCache.set(cacheKey, { result: null, timestamp: Date.now() });
        this._chargeBudget(startedAt);
        return null;
    }

    _rememberSharedPath(path, endX, endY, radius, options, negative = false,
        startX = 0, startY = 0) {
        if (options?.sharedCrowdPath !== true) return;
        const key = this._sharedFlowKey(endX, endY, radius, options);
        if (this._sharedFlowFields.size >= this._sharedFlowMaxSize) {
            let oldestKey = null, oldestAt = Infinity;
            for (const [candidateKey, field] of this._sharedFlowFields) {
                if (field.timestamp < oldestAt) {
                    oldestAt = field.timestamp;
                    oldestKey = candidateKey;
                }
            }
            if (oldestKey !== null) this._sharedFlowFields.delete(oldestKey);
        }
        if (negative) {
            const existing = this._sharedFlowFields.get(key);
            if (existing && !existing.negative) return;
            const sector = Math.max(this.gridSize * 4,
                Number(performanceConfig.pathQueue?.sharedFlowSectorPx) || 240);
            this._sharedFlowFields.set(key, {
                negative: true,
                startSector: `${Math.floor(startX / sector)},${Math.floor(startY / sector)}`,
                meta: { sx: startX, sy: startY, ex: endX, ey: endY },
                timestamp: Date.now(),
            });
            return;
        }
        if (!path || path.length < 2) return;
        const existing = this._sharedFlowFields.get(key);
        if (existing && !existing.negative) return;
        this._sharedFlowFields.set(
            key,
            this._createSharedFlowField(path, endX, endY, radius, options)
        );
    }

    _createIncrementalSearch(startX, startY, endX, endY, entityRadius, cacheKey, options) {
        const directDist = Math.hypot(endX - startX, endY - startY);
        const searchRange = Math.min(this.maxSearchRange,
            Math.max(this.minSearchRange, directDist + 200));
        const minX = Math.floor((Math.min(startX, endX) - searchRange) / this.gridSize)
            * this.gridSize;
        const minY = Math.floor((Math.min(startY, endY) - searchRange) / this.gridSize)
            * this.gridSize;
        const maxX = Math.max(startX, endX) + searchRange;
        const maxY = Math.max(startY, endY) + searchRange;
        const cols = Math.ceil((maxX - minX) / this.gridSize);
        const rows = Math.ceil((maxY - minY) / this.gridSize);
        const count = cols * rows;
        const g = new Float64Array(count); g.fill(Infinity);
        const f = new Float64Array(count); f.fill(Infinity);
        const parent = new Int32Array(count); parent.fill(-1);
        return {
            requestId: options.requestId,
            signature: cacheKey,
            lastTouchedAt: Date.now(),
            cacheKey, options, startX, startY, endX, endY,
            radius: this._bucketRadius(entityRadius),
            cacheMeta: { sx: startX, sy: startY, ex: endX, ey: endY },
            minX, minY, cols, rows, count,
            blocked: new Uint8Array(count),
            moveCost: new Float32Array(count),
            g, f, parent,
            closed: new Uint8Array(count),
            heap: new IndexHeap(f, count),
            buildIndex: 0,
            phase: 'build',
            iterations: 0,
            maxIterations: Math.min(count * 2, 5000),
            bestIndex: -1,
            endIndex: -1,
        };
    }

    _nearestOpenIndex(state, row, col) {
        const { rows, cols, blocked } = state;
        if (row >= 0 && row < rows && col >= 0 && col < cols
            && !blocked[row * cols + col]) return row * cols + col;
        for (let ring = 1; ring < Math.max(rows, cols); ring++) {
            for (let dr = -ring; dr <= ring; dr++) {
                for (let dc = -ring; dc <= ring; dc++) {
                    if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
                    const nr = row + dr, nc = col + dc;
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                    const index = nr * cols + nc;
                    if (!blocked[index]) return index;
                }
            }
        }
        return -1;
    }

    _reconstructIncrementalPath(state, endIndex) {
        const path = [];
        let index = endIndex;
        while (index >= 0) {
            const row = Math.floor(index / state.cols);
            const col = index - row * state.cols;
            path.push({
                x: state.minX + col * this.gridSize + this.gridSize / 2,
                y: state.minY + row * this.gridSize + this.gridSize / 2,
            });
            index = state.parent[index];
        }
        path.reverse();
        const smoothed = this._smoothPath(path, state.radius);
        this._setCache(state.cacheKey, smoothed, this._cacheMaxAge, state.cacheMeta);
        return smoothed;
    }

    _advanceIncrementalSearch(state, deadline) {
        const checkEvery = 16;
        if (state.phase === 'build') {
            while (state.buildIndex < state.count) {
                const index = state.buildIndex++;
                const row = Math.floor(index / state.cols);
                const col = index - row * state.cols;
                const x = state.minX + col * this.gridSize + this.gridSize / 2;
                const y = state.minY + row * this.gridSize + this.gridSize / 2;
                const cell = this._getCellData(x, y, state.radius, state.options);
                state.blocked[index] = cell.blocked ? 1 : 0;
                const crowdCost = state.options?.sharedCrowdPath === true || cell.blocked
                    ? 1 : dynamicObstacleMap.getCost(x, y);
                state.moveCost[index] = cell.blocked ? Infinity : cell.cost * crowdCost;
                if ((index & (checkEvery - 1)) === 0 && performance.now() >= deadline) {
                    return PATH_DEFERRED;
                }
            }
            const startC = Math.floor((state.startX - state.minX) / this.gridSize);
            const startR = Math.floor((state.startY - state.minY) / this.gridSize);
            const endC = Math.floor((state.endX - state.minX) / this.gridSize);
            const endR = Math.floor((state.endY - state.minY) / this.gridSize);
            const startIndex = this._nearestOpenIndex(state, startR, startC);
            state.endIndex = this._nearestOpenIndex(state, endR, endC);
            if (startIndex < 0 || state.endIndex < 0) return null;
            const sr = Math.floor(startIndex / state.cols);
            const sc = startIndex - sr * state.cols;
            const sx = state.minX + sc * this.gridSize + this.gridSize / 2;
            const sy = state.minY + sr * this.gridSize + this.gridSize / 2;
            state.g[startIndex] = 0;
            state.f[startIndex] = Math.max(Math.abs(state.endX - sx), Math.abs(state.endY - sy));
            state.bestIndex = startIndex;
            state.heap.push(startIndex);
            state.phase = 'astar';
        }
        const dirs = [-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
        while (state.heap.size() > 0) {
            if (++state.iterations > state.maxIterations) {
                this._warn('[PathFinder] incremental A* iteration limit reached, returning best-effort path');
                return this._reconstructIncrementalPath(state, state.bestIndex);
            }
            const current = state.heap.pop();
            if (state.closed[current]) continue;
            state.closed[current] = 1;
            const row = Math.floor(current / state.cols);
            const col = current - row * state.cols;
            const x = state.minX + col * this.gridSize + this.gridSize / 2;
            const y = state.minY + row * this.gridSize + this.gridSize / 2;
            const best = state.bestIndex;
            const br = Math.floor(best / state.cols);
            const bc = best - br * state.cols;
            const bx = state.minX + bc * this.gridSize + this.gridSize / 2;
            const by = state.minY + br * this.gridSize + this.gridSize / 2;
            if (Math.max(Math.abs(state.endX - x), Math.abs(state.endY - y))
                < Math.max(Math.abs(state.endX - bx), Math.abs(state.endY - by))) {
                state.bestIndex = current;
            }
            if (current === state.endIndex) return this._reconstructIncrementalPath(state, current);
            for (let d = 0; d < dirs.length; d += 2) {
                const dr = dirs[d], dc = dirs[d + 1];
                const nr = row + dr, nc = col + dc;
                if (nr < 0 || nr >= state.rows || nc < 0 || nc >= state.cols) continue;
                const next = nr * state.cols + nc;
                if (state.blocked[next] || state.closed[next]) continue;
                if (dr !== 0 && dc !== 0) {
                    const sideA = nr * state.cols + col;
                    const sideB = row * state.cols + nc;
                    if (state.blocked[sideA] || state.blocked[sideB]) continue;
                }
                const tentative = state.g[current]
                    + (dr !== 0 && dc !== 0 ? 1.414 : 1)
                    * state.moveCost[next] * this.gridSize;
                if (tentative >= state.g[next]) continue;
                state.g[next] = tentative;
                state.parent[next] = current;
                const nx = state.minX + nc * this.gridSize + this.gridSize / 2;
                const ny = state.minY + nr * this.gridSize + this.gridSize / 2;
                state.f[next] = tentative
                    + Math.max(Math.abs(state.endX - nx), Math.abs(state.endY - ny));
                state.heap.push(next);
            }
            if ((state.iterations & (checkEvery - 1)) === 0 && performance.now() >= deadline) {
                return PATH_DEFERRED;
            }
        }
        return null;
    }

    findPath(startX, startY, endX, endY, entityRadius, options = null) {
        // 墙/树/掩体空间哈希冷重建也必须受帧预算约束。玩家直接指令仍保持
        // 同步语义；AI 请求则保留旧路径并在下帧续建新索引。
        if (options?.incremental === true && !this._hashValid) {
            if (!this.advanceNavigationWithinFrameBudget()) return PATH_DEFERRED;
        }
        // 攻击建筑等语义目标会把中心点交给寻路；中心成为硬障碍后先投影到最近开放点，
        // 让战斗继续以目标实体为准、路径只负责走到 footprint 外侧。
        if (this._isBlocked(endX, endY, this._bucketRadius(entityRadius))) {
            const projected = options?.incremental === true
                ? this._projectBlockedEndpointIncremental(endX, endY, entityRadius, 360)
                : this.findNearestWalkablePoint(endX, endY, entityRadius, 360);
            if (projected === PATH_DEFERRED) return PATH_DEFERRED;
            if (!projected) return null;
            endX = projected.x;
            endY = projected.y;
        }
        // [ENHANCE] 尝试从缓存获取（含不可达负缓存）
        // 如果起点/终点附近有动态障碍，跳过缓存，避免使用过期的低成本路径
        const dynamicCostStart = dynamicObstacleMap.getCost(startX, startY);
        const dynamicCostEnd = dynamicObstacleMap.getCost(endX, endY);
        const cacheKey = this._getCacheKey(startX, startY, endX, endY, entityRadius, options);
        const cacheUsable = options?.sharedCrowdPath === true
            || (dynamicCostStart <= 1.1 && dynamicCostEnd <= 1.1);
        const cachedPath = this._getCachedPath(cacheKey);
        // 动态拥挤只改变软成本，不改变静态可达性：负缓存始终可读；正路径仍按拥挤策略决定。
        if (cachedPath === null) {
            this._negativeCacheHits++;
            return null;
        }
        if (cacheUsable && cachedPath !== undefined) {
            if (options?.sharedCrowdPath === true) {
                this._pendingSearches.delete(`shared:${cacheKey}`);
                this._rememberSharedPath(
                    cachedPath, endX, endY, entityRadius, options,
                    false, startX, startY
                );
            }
            return cachedPath;
        }
        const sharedPath = this._getSharedPath(
            startX, startY, endX, endY, entityRadius, options
        );
        if (sharedPath !== undefined) {
            if (sharedPath !== PATH_DEFERRED && options?.sharedCrowdPath === true) {
                this._pendingSearches.delete(`shared:${cacheKey}`);
            }
            return sharedPath;
        }
        // [PERF-2026-08-03] 帧预算：主线程 A* 超预算返回 PATH_DEFERRED，
        // 调用方保留旧路径/下帧重试，避免刷怪瞬间多只怪同帧寻路造成长卡顿
        const incremental = options?.incremental === true
            && options?.requestId !== undefined;
        if (incremental && !this._budgetAvailable()) return PATH_DEFERRED;
        const budgetStart = performance.now();
        let path;
        if (incremental) {
            const signature = cacheKey;
            // 同起终点的入侵单位续算同一个作业；首个完成后其余单位直接命中路径/流场。
            const pendingKey = options.sharedCrowdPath === true
                ? `shared:${cacheKey}`
                : options.requestId;
            let state = this._pendingSearches.get(pendingKey);
            if (!state || state.signature !== signature) {
                state = this._createIncrementalSearch(
                    startX, startY, endX, endY, entityRadius, cacheKey, options
                );
                this._pendingSearches.set(pendingKey, state);
            }
            state.lastTouchedAt = Date.now();
            const remaining = Math.max(0, this.frameBudgetMs - this._frameUsedMs);
            path = this._advanceIncrementalSearch(state, budgetStart + remaining);
            if (path === PATH_DEFERRED) this._incrementalSlices++;
            else this._pendingSearches.delete(pendingKey);
        } else {
            path = this._searchPath(
                startX, startY, endX, endY, entityRadius, cacheKey, options
            );
        }
        this._chargeBudget(budgetStart);
        if (path === PATH_DEFERRED) return PATH_DEFERRED;
        if (path === null) {
            // [PERF-2026-08-03] 不可达负缓存（短 TTL）：避免卡住重算循环每 500ms 付一次冷 A* 成本
            this._setCache(cacheKey, null, 500, { sx: startX, sy: startY, ex: endX, ey: endY });
            this._rememberSharedPath(
                null, endX, endY, entityRadius, options, true, startX, startY
            );
        }
        if (path) this._rememberSharedPath(path, endX, endY, entityRadius, options);
        return path;
    }

    // 原 findPath 主体：连通性预检 → 建网格 → A*
    _searchPath(startX, startY, endX, endY, entityRadius, cacheKey, options = null) {
        // [ENHANCE] 先检查区域连通性，避免无效 A* 计算
        if (!this.isReachable(startX, startY, endX, endY, entityRadius)) {
            return null;
        }
        const cacheMeta = { sx: startX, sy: startY, ex: endX, ey: endY };
        const { grid, minX, minY, cols, rows } = this._buildGrid(
            startX, startY, endX, endY, entityRadius, options
        );
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
        const maxIterations = Math.min(cols * rows * 2, 5000);
        let bestNode = startNode;
        openHeap.push(startNode);
        while (openHeap.size() > 0) {
            if (++iterations > maxIterations) {
                // 超时回退：返回通往当前最接近目标节点的路径
                this._warn('[PathFinder] A* iteration limit reached, returning best-effort path');
                return this._reconstructPath(bestNode, entityRadius, cacheKey, cacheMeta);
            }
            const current = openHeap.pop();
            // [PERF-2026-08-08] closedSet 整数 key（r*cols+c），替代 "r,c" 字符串拼接
            closedSet.add(current.r * cols + current.c);
            if (!bestNode || current.h < bestNode.h) {
                bestNode = current;
            }
            if (current === endNode || (Math.abs(current.x - endNode.x) < this.gridSize && Math.abs(current.y - endNode.y) < this.gridSize)) {
                return this._reconstructPath(current, entityRadius, cacheKey, cacheMeta);
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
                if (closedSet.has(nr * cols + nc)) continue;
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
