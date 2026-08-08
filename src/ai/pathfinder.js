import { WallSystem } from '../world/wall-system.js';
import { regionIndex } from './region-index.js';
import { dynamicObstacleMap } from './dynamic-obstacle-map.js';

/** 寻路帧预算耗尽时的哨兵返回值：调用方应保留旧路径、下一帧重试，而非当作"不可达" */
export const PATH_DEFERRED = Symbol('PATH_DEFERRED');

// [PERF-2026-08-08] 整数格 key 步长：key = gx + gy * CELL_STRIDE，替代 "gx,gy" 字符串拼接
// （热路径每格多次拼字符串的开销实测可观）。|gx| < 65536（±262 万 px）内唯一。
const CELL_STRIDE = 131072;

// [PERF-2026-08-08] 半径档归并桶：memo/路径缓存按桶共享（原 7 档精确半径 key 共享率差）。
// 取桶上界为代表半径（≥ 桶内任意实际半径，只可能绕更宽、不可能穿墙）。
// 桶外（>90）半径保持原值各自成桶。实际半径集合 10/28/33/40/60/90/180 → 桶 20/40/40/40/90/90/180。
const RADIUS_BUCKETS = [20, 40, 90];

// [GATE-SOFT-COST] 门闸软成本乘数：关着的门段（_gate 标记）纳入 SpatialHash 但不作阻挡，
// 只给贴身格子加成本乘数。取 6 的依据：门段 halfThick(≈26) + 半径桶 20 的贴身带宽约 46px，
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

/* ---------- 空间哈希（加速障碍物查询）---------- */
class SpatialHash {
    constructor(cellSize = 40) {
        this.cellSize = cellSize;
        this.cells = new Map(); // key: cx + cy*CELL_STRIDE（整数） -> [{type:'wall'|'tree'|'seg', obj}]
        this._wallHash = null;
        this._treeHash = null;
    }
    clear() {
        this.cells.clear();
        this._wallHash = null;
        this._treeHash = null;
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
        this.clear();
        if (!WallSystem) return;
        // 注意：只建模 WallSystem.walls/trees（静态几何）。isoSegments 中**动态**段
        // （门闸/冰墙等，无 _cover 标记）有意不纳入寻路——动态段由 MovementSystem 的
        // WallSystem.resolve 实际挡停（撞墙即停），若纳入寻路会让敌人绕开冰墙/门闸，
        // 削弱临时障碍的阻挡设计。**掩体墙段（_cover 标记）是静态实体**，必须纳入寻路
        // （2026-08-08 用户反馈：世界-122 怪物寻路把基地掩体墙当可通行，直线穿墙后在
        // 左右下夹角被 resolve 卡在墙根土块上抖动；纳入后怪物绕墙走、从门洞进入）。
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
        // 静态掩体墙段（DefenseCover._coverSeg）：按线段包围盒塞格，阻挡口径与
        // WallSystem.canMoveTo 一致（点到线段距离 < 半径 + halfThick）。
        // [GATE-SOFT-COST] 门闸段（_gate 标记）也纳入哈希但类型为 'gate'：
        // isBlocked/_getCellData 的阻挡判定都不认它（保持可通行语义），
        // 只在 _getCellData 里给贴身格子加 GATE_SOFT_COST 软成本乘数；
        // 开门时门洞段已被 WallGate.setPassable 从 isoSegments splice 掉，成本自然归零
        if (WallSystem.isoSegments) {
            for (const s of WallSystem.isoSegments) {
                if (!s._cover && !s._gate) continue; // 其余动态段（冰墙等）不纳入
                const type = s._cover ? 'seg' : 'gate';
                const minCX = Math.floor(Math.min(s.x1, s.x2) / this.cellSize);
                const maxCX = Math.floor(Math.max(s.x1, s.x2) / this.cellSize);
                const minCY = Math.floor(Math.min(s.y1, s.y2) / this.cellSize);
                const maxCY = Math.floor(Math.max(s.y1, s.y2) / this.cellSize);
                for (let cx = minCX; cx <= maxCX; cx++) {
                    for (let cy = minCY; cy <= maxCY; cy++) {
                        const key = this._getKey(cx, cy);
                        if (!this.cells.has(key)) this.cells.set(key, []);
                        this.cells.get(key).push({ type, obj: s });
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
        // [PERF-2026-08-03] 静态格子结果记忆化：按(格子坐标, 半径)缓存 blocked/moveCost。
        // 同一几何下多只怪共享一份结果，避免每次寻路都重建整张成本网格（实测占冷路径 ~92%）
        this._cellMemo = new Map();
        this._memoRadii = new Set(); // memo 中出现过的桶半径（invalidateRegion 按格清除时枚举用）
        this._geometryVersion = 0;   // 几何版本：invalidateCache() 自增，几何变化时清 memo
        // [PERF-2026-08-03] 每帧寻路预算：主线程 A* 同步执行，超预算请求返回 PATH_DEFERRED，
        // 由调用方保留旧路径、下一帧重试（MovementSystem.beginFrame 每帧重置）
        this.frameBudgetMs = 3;
        this._frameUsedMs = 0;
        // 出口路径短时缓存（A* 失败后卡住重算每 500ms 都会走到这里，原来每次都全量重建 RegionIndex）
        this._exitCache = new Map(); // key -> { result, timestamp }
        this._lastWarnAt = 0;        // console.warn 节流（卡住重算循环曾刷屏）
    }

    // 确保空间哈希已构建
    _ensureHash() {
        if (!this._hashValid) {
            this.spatialHash.rebuild();
            // 预计算最大树木半径，供 _getMoveCost 的 SpatialHash 查询使用
            this._maxTreeRadius = 0;
            if (WallSystem && WallSystem.trees) {
                for (const t of WallSystem.trees) {
                    if (t.radius > this._maxTreeRadius) this._maxTreeRadius = t.radius;
                }
            }
            this._hashValid = true;
        }
    }

    // 墙壁变化时调用（如动态生成墙壁后）
    invalidateCache() {
        this._hashValid = false;
        this._maxTreeRadius = 0;
        this._pathCache.clear();
        this._exitCache.clear();
        // [PERF-2026-08-03] 几何变化：递增版本并清空格子记忆化
        this._geometryVersion++;
        this._cellMemo.clear();
        // [NEW] 标记 RegionIndex 需要重算
        regionIndex.markDirty();
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
                const base = (gx + gy * CELL_STRIDE) * 4096;
                for (const r of this._memoRadii) this._cellMemo.delete(base + r);
            }
        }
        // 4) SpatialHash（掩体 _cover 段来源）无增量移除：标脏后下次 _ensureHash 全量重建，
        //    重建读 WallSystem.isoSegments 当前状态，增删后的段自然反映，不漏
        this._hashValid = false;
        this._maxTreeRadius = 0;
        this._geometryVersion++;
        // RegionIndex：保持 markDirty 惰性重建（机制不变）
        regionIndex.markDirty();
    }

    /**
     * [PERF-2026-08-03] 每帧寻路预算：由 MovementSystem.beginFrame() 在每帧开始时调用。
     * 帧预算防止"刷怪瞬间 N 只怪同帧冷寻路"造成主线程长卡顿。
     */
    beginFrame() {
        this._frameUsedMs = 0;
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

    // [NEW] 确保 RegionIndex 已构建（用于地牢战斗房间等封闭空间）
    // [PERF-2026-08-08] 按桶半径建索引：同桶怪复用同一索引，不同桶才触发全量重建
    _ensureRegionIndex(worldMinX, worldMinY, worldMaxX, worldMaxY, entityRadius) {
        const r = this._bucketRadius(entityRadius);
        if (regionIndex.checkDirty(r)) {
            regionIndex.rebuild(worldMinX, worldMinY, worldMaxX, worldMaxY, r);
        }
    }

    _isBlocked(x, y, radius) {
        this._ensureHash();
        return this.spatialHash.isBlocked(x, y, radius);
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
    _getCellData(x, y, entityRadius) {
        this._ensureHash();
        // 契约：仅允许格子中心坐标调用（k×40+20）——memo 按格子复用，
        // 同格子内的不同采样点共享同一结果，只有中心采样才保证一致性
        const r = this._bucketRadius(entityRadius);
        const gx = Math.floor(x / this.gridSize);
        const gy = Math.floor(y / this.gridSize);
        const memoKey = (gx + gy * CELL_STRIDE) * 4096 + r;
        const cached = this._cellMemo.get(memoKey);
        if (cached) return cached;

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
                        const blockR = t.radius + r;
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
                          // [GATE-SOFT-COST] 门闸段不阻挡（不设 blocked，isBlocked 同口径不认），
                          // 只给贴身格子加软成本乘数；与掩体阻挡判定同口径距离
                          const s = item.obj;
                          if (this.spatialHash._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2)
                              < r + (s.halfThick || 26)) {
                              if (cost < GATE_SOFT_COST) cost = GATE_SOFT_COST;
                          }
                      }
                  }
              }
        }
        const result = { blocked, cost };
        this._memoRadii.add(r);
        this._cellMemo.set(memoKey, result);
        return result;
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
        // [PERF-2026-08-08] visited 整数 key（gx + gy*CELL_STRIDE），替代 "gx,gy" 字符串拼接
        visited.add(Math.floor(startX / step) + Math.floor(startY / step) * CELL_STRIDE);
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
                const key = Math.floor(nx / step) + Math.floor(ny / step) * CELL_STRIDE;
                if (visited.has(key)) continue;
                if (this._isBlocked(nx, ny, entityRadius)) continue;
                visited.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
        // 步数用完仍未到达目标附近，让 A* 自己判断（避免 BFS 预算不足导致误判）
        return true;
    }

    // [NEW] 当目标不可达时，找到当前区域边界上离目标最近的出口
    // 返回 { path: [{x,y}, ...], isExitPath: true } 或 null
    findPathToExit(startX, startY, targetX, targetY, entityRadius) {
        // [PERF-2026-08-03] 出口路径短时缓存：A* 失败后卡住重算每 500ms 都会走到这里，
        // 原来每次都全量重建 RegionIndex（2~5ms，大地图更高），缓存后重复失败近零成本
        const exitKey = `${this._getCacheKey(startX, startY, targetX, targetY, entityRadius)},exit`;
        const cached = this._exitCache.get(exitKey);
        if (cached && Date.now() - cached.timestamp < 500) return cached.result;

        // 出口搜索同样受帧预算约束（RegionIndex 全量重建不便宜）
        if (!this._budgetAvailable()) return PATH_DEFERRED;
        const budgetStart = performance.now();

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
            this._ensureRegionIndex(minX, minY, maxX, maxY, entityRadius);
            // 找最近出口
            const exit = regionIndex.findNearestExit(startX, startY, targetX, targetY, entityRadius);
            if (exit) {
                // 用 A* 走到出口
                const path = this.findPath(startX, startY, exit.x, exit.y, entityRadius);
                if (path === PATH_DEFERRED) {
                    this._chargeBudget(budgetStart);
                    return PATH_DEFERRED;
                }
                if (path) result = { path, isExitPath: true, exitX: exit.x, exitY: exit.y };
            }
        }
        this._chargeBudget(budgetStart);
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
    _getCacheKey(startX, startY, endX, endY, radius) {
        // 坐标量化到 gridSize 的倍数，减少缓存 key 的精度
        // [PERF-2026-08-08] 半径归并为桶：同桶怪共享路径缓存
        const gs = this.gridSize;
        const qx = Math.floor(startX / gs) * gs;
        const qy = Math.floor(startY / gs) * gs;
        const qex = Math.floor(endX / gs) * gs;
        const qey = Math.floor(endY / gs) * gs;
        return `${qx},${qy},${qex},${qey},${this._bucketRadius(radius)}`;
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

    _buildGrid(startX, startY, endX, endY, entityRadius) {
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
                const cellData = this._getCellData(x, y, entityRadius);
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

    findPath(startX, startY, endX, endY, entityRadius) {
        // [ENHANCE] 尝试从缓存获取（含不可达负缓存）
        // 如果起点/终点附近有动态障碍，跳过缓存，避免使用过期的低成本路径
        const dynamicCostStart = dynamicObstacleMap.getCost(startX, startY);
        const dynamicCostEnd = dynamicObstacleMap.getCost(endX, endY);
        const cacheKey = this._getCacheKey(startX, startY, endX, endY, entityRadius);
        const cacheUsable = dynamicCostStart <= 1.1 && dynamicCostEnd <= 1.1;
        if (cacheUsable) {
            const cachedPath = this._getCachedPath(cacheKey);
            if (cachedPath !== undefined) return cachedPath; // null = 不可达负缓存
        }
        // [PERF-2026-08-03] 帧预算：主线程 A* 超预算返回 PATH_DEFERRED，
        // 调用方保留旧路径/下帧重试，避免刷怪瞬间多只怪同帧寻路造成长卡顿
        if (!this._budgetAvailable()) return PATH_DEFERRED;
        const budgetStart = performance.now();
        const path = this._searchPath(startX, startY, endX, endY, entityRadius, cacheKey);
        this._chargeBudget(budgetStart);
        if (path === null && cacheUsable) {
            // [PERF-2026-08-03] 不可达负缓存（短 TTL）：避免卡住重算循环每 500ms 付一次冷 A* 成本
            this._setCache(cacheKey, null, 500, { sx: startX, sy: startY, ex: endX, ey: endY });
        }
        return path;
    }

    // 原 findPath 主体：连通性预检 → 建网格 → A*
    _searchPath(startX, startY, endX, endY, entityRadius, cacheKey) {
        // [ENHANCE] 先检查区域连通性，避免无效 A* 计算
        if (!this.isReachable(startX, startY, endX, endY, entityRadius)) {
            return null;
        }
        const cacheMeta = { sx: startX, sy: startY, ex: endX, ey: endY };
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
