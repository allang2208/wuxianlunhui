
import { PATH_DEFERRED } from './pathfinder.js';

/**
 * PathManager — 智能路径管理器（参考《环世界》）
 *
 * 每个 Enemy 实例一个 PathManager，负责：
 * 1. 路径缓存：存储当前路径，避免每帧重新计算
 * 2. 定期有效性检查：每 1.5-2.5 秒扫描路径节点，检测新障碍物
 * 3. 局部修复：路径被阻挡时，在障碍物附近搜索替代路线，不重新计算整条路径
 * 4. 路径跟随：提供 getCurrentWaypoint() / advanceWaypoint() API
 *
 * 设计原则：
 * - 不直接操作移动，只管理路径数据
 * - 移动由 MovementSystem 通过 PathManager API 获取路径点后执行
 * - 所有路径操作以 world 坐标为节点
 */
class PathManager {
    constructor(enemy) {
        this.enemy = enemy;
        this.path = null;              // 当前路径：{x, y}[]
        this.pathIdx = 0;              // 当前路径索引
        this.checkInterval = 1500 + Math.random() * 1000; // 1.5-2.5s 随机间隔，避免所有单位同时检查
        this.checkTimer = 0;           // 检查计时器
        this.isValid = false;        // 路径是否有效
        this.lastRecalcTime = 0;     // 上次重算时间
        this.stuckCount = 0;         // 连续修复失败次数
        this.topologyVersion = -1;   // 当前路径生成时的障碍拓扑版本
        // [PERF-2026-08-03] 首寻路错峰：创建后随机延迟 0~250ms，避免刷怪瞬间多只怪同帧冷寻路
        this._firstRecalcAt = Date.now() + Math.random() * 250;
        this._lastWarnAt = 0;        // console.warn 节流
    }

    // ==================== 路径设置 ====================

    /**
     * 设置新路径
     * @param {Array<{x,y}>} path - 路径节点数组
     */
    setPath(path, pathPlanner = null) {
        if (!path || path.length === 0) {
            this._clearPath();
            return;
        }
        // [PERF-2026-08-03] 防御性拷贝：路径缓存数组为多怪共享对象，直接持有并在
        // 副本上改首点，避免污染其他怪物/缓存（原实现原地改 path[0] 是潜在别名 bug）
        const ownPath = path.slice();
        // 首点对齐到怪物当前位置：A* 起点 snap 到所在格子中心，
        // 若格子中心在怪物行进方向身后，跟随首点会"瞬间掉头"折返（往左走时尤为明显）
        if (this.enemy && ownPath.length > 0) {
            ownPath[0] = { x: this.enemy.x, y: this.enemy.y };
        }
        this.path = ownPath;
        this.pathIdx = 0;
        this.isValid = true;
        this.checkTimer = this.checkInterval;
        this.stuckCount = 0;
        this.lastRecalcTime = Date.now();
        this.topologyVersion = pathPlanner?.getTopologyVersion?.() ?? this.topologyVersion;
    }

    /**
     * 清除路径
     */
    _clearPath() {
        this.path = null;
        this.pathIdx = 0;
        this.isValid = false;
        this.stuckCount = 0;
        this.topologyVersion = -1;
    }

    // ==================== 每帧更新：有效性检查 ====================

    /**
     * 每帧由 MovementSystem 调用
     * @param {number} dt - 时间间隔 ms
     * @param {PathFinder} pathPlanner - 路径规划器实例
     */
    update(dt, pathPlanner, scheduler = null, priority = 0) {
        if (!this.path || !this.isValid) return;
        const topologyChanged = pathPlanner?.getTopologyVersion
            && pathPlanner.getTopologyVersion() !== this.topologyVersion;
        this.checkTimer -= dt;
        if (!topologyChanged && this.checkTimer > 0) return;
        if (scheduler?.enqueueValidation) {
            scheduler.enqueueValidation(this, pathPlanner, priority);
            return;
        }
        this.checkTimer = this.checkInterval;
        const result = this._checkValidity(pathPlanner);
        if (result === PATH_DEFERRED) {
            this.checkTimer = 0;
            return;
        }
        if (this.path && this.isValid) {
            this.topologyVersion = pathPlanner?.getTopologyVersion?.() ?? this.topologyVersion;
        }
    }

    runScheduledValidation(pathPlanner) {
        if (!this.path || !this.isValid) return false;
        this.checkTimer = this.checkInterval;
        const result = this._checkValidity(pathPlanner);
        if (result === PATH_DEFERRED) {
            this.checkTimer = 0;
            return PATH_DEFERRED;
        }
        if (this.path && this.isValid) {
            this.topologyVersion = pathPlanner?.getTopologyVersion?.() ?? this.topologyVersion;
        }
        return result;
    }

    /**
     * 扫描路径上的所有节点，检测是否被障碍物阻挡
     * 只检查当前索引之后的节点（已走过的节点不检查）
     */
    _checkValidity(pathPlanner) {
        if (!pathPlanner || !pathPlanner.isPointBlocked) return false;
        if (this.enemy._spawnEgress) return false;
        const radius = this.enemy.groundRadius;
        // 每次只预读前方最多 8 段走廊，控制多单位检查成本；拓扑版本变化时立即执行。
        // 出兵离场阶段起点可能仍在来源建筑 footprint 内，先让既有 egress 契约把单位带出。
        const endIdx = Math.min(this.path.length - 1, this.pathIdx + 8);
        let prev = { x: this.enemy.x, y: this.enemy.y };
        for (let i = this.pathIdx; i <= endIdx; i++) {
            const node = this.path[i];
            const corridorBlocked = pathPlanner.isSegmentBlocked?.(prev.x, prev.y, node.x, node.y, radius);
            if (pathPlanner.isPointBlocked(node.x, node.y, radius) || corridorBlocked) {
                return this._repairPath(i, pathPlanner);
            }
            prev = node;
        }
        return true;
    }

    // ==================== 局部修复（核心） ====================

    /**
     * 局部修复：在障碍物附近搜索替代路径
     * 策略：
     * 1. 尝试在阻挡节点前后各取 1-2 个节点，中间搜索替代路径
     * 2. 如果找到替代路径，拼接：前半段 + 替代段 + 后半段
     * 3. 如果找不到，从阻挡点重新计算到终点的路径
     * 4. 如果完全失败，标记路径无效
     *
     * @param {number} blockedIdx - 被阻挡节点的索引
     * @param {PathFinder} pathPlanner - 路径规划器
     */
    _repairPath(blockedIdx, pathPlanner) {
        const radius = this.enemy.groundRadius;
        const nextIdx = Math.min(this.path.length - 1, blockedIdx + 2); // 向后看 2 个节点
        const end = this.path[nextIdx];

        // 策略1：从怪物当前位置出发搜索替代路径——不回退 pathIdx！
        // （旧实现回退到阻挡点前 2 个节点，怪物会掉头折返已走过的路径点，表现为"瞬间反向"）
        let altPath = null;
        try {
            altPath = pathPlanner.findPath(this.enemy.x, this.enemy.y, end.x, end.y, radius);
        } catch (e) {
            this._warn('[PathManager] findPath failed: ' + e.message);
        }

        // 帧预算不足：保留旧路径，下帧 _checkValidity 会重试
        if (altPath === PATH_DEFERRED) return PATH_DEFERRED;

        if (altPath && altPath.length > 1) {
            // 新路径 = 替代段（altPath[0]≈当前位置，从下一节点开始跟随） + 阻挡点之后的路径段
            this.path = [...altPath, ...this.path.slice(nextIdx + 1)];
            this.pathIdx = 1;
            this.isValid = true;
            this.stuckCount = 0;
            this.topologyVersion = pathPlanner?.getTopologyVersion?.() ?? this.topologyVersion;
            return true;
        }

        // 策略2：从怪物当前位置重新计算到终点的完整路径（同样不回退）
        const finalTarget = this.path[this.path.length - 1];
        let newPath = null;
        try {
            newPath = pathPlanner.findPath(this.enemy.x, this.enemy.y, finalTarget.x, finalTarget.y, radius);
        } catch (e) {
            this._warn('[PathManager] full recalc failed: ' + e.message);
        }

        if (newPath === PATH_DEFERRED) return PATH_DEFERRED;

        if (newPath && newPath.length > 1) {
            this.path = newPath;
            this.pathIdx = 1; // newPath[0]≈当前位置，从下一节点开始跟随
            this.isValid = true;
            this.stuckCount = 0;
            this.topologyVersion = pathPlanner?.getTopologyVersion?.() ?? this.topologyVersion;
            return true;
        }

        // 所有修复策略都失败
        this.stuckCount++;
        if (this.stuckCount >= 3) {
            // 连续 3 次修复失败，标记路径无效，让 MovementSystem 触发随机逃逸
            this._clearPath();
        }
        return false;
    }

    // ==================== 路径跟随 API ====================

    /**
     * 获取当前目标路径点
     * @returns {{x:number, y:number}|null}
     */
    getCurrentWaypoint() {
        if (!this.path || this.pathIdx >= this.path.length) return null;
        return this.path[this.pathIdx];
    }

    /**
     * 前进到下一个路径点
     */
    advanceWaypoint() {
        if (this.pathIdx < this.path.length) this.pathIdx++;
    }

    /**
     * 路径是否已走完
     * @returns {boolean}
     */
    isPathComplete() {
        return !this.path || this.pathIdx >= this.path.length;
    }

    /**
     * 路径是否有效（有路径且未失效）
     * @returns {boolean}
     */
    hasValidPath() {
        return this.path && this.isValid && this.pathIdx < this.path.length;
    }

    /**
     * 剩余路径长度（从当前索引到终点）
     * @returns {number}
     */
    getRemainingDistance() {
        if (!this.path || this.pathIdx >= this.path.length) return 0;
        let dist = 0;
        for (let i = this.pathIdx; i < this.path.length - 1; i++) {
            const dx = this.path[i + 1].x - this.path[i].x;
            const dy = this.path[i + 1].y - this.path[i].y;
            dist += Math.sqrt(dx * dx + dy * dy);
        }
        return dist;
    }

    // [ENHANCE] 强制重算路径（如目标位置变化较大时调用）
    // 默认 500ms 间隔限制，避免每帧触发 A*
    // 卡住时 bypassLimit = true 强制绕过限制
    // [NEW] 当目标不可达时，自动寻找最近出口路径（RimWorld RegionIndex 机制）
    forceRecalc(pathPlanner, targetX, targetY, bypassLimit = false) {
        const minRecalcInterval = 500; // 500ms 最小重算间隔
        if (!bypassLimit && Date.now() - this.lastRecalcTime < minRecalcInterval) {
            return false; // 间隔不足，跳过
        }
        // [PERF-2026-08-03] 首寻路错峰（含卡住 bypass）：刷怪同帧错开，冷路径不集中在同一帧
        if (Date.now() < this._firstRecalcAt) return false;
        const radius = this.enemy.groundRadius;
        let path = null;
        try {
            path = pathPlanner.findPath(this.enemy.x, this.enemy.y, targetX, targetY, radius);
        } catch (e) {
            this._warn('[PathManager] forceRecalc failed: ' + e.message);
        }
        // 帧预算不足：保留旧路径，下一帧 MovementSystem 的 shouldRecalc 会再次尝试
        if (path === PATH_DEFERRED) return PATH_DEFERRED;
        if (path) {
            this.setPath(path, pathPlanner);
            this._isExitPath = false;
            return true;
        }

        // [NEW] A* 失败：尝试 RegionIndex 找最近出口
        // 只在封闭空间（如地牢战斗房间）使用，开放地图不适用
        const exitResult = pathPlanner.findPathToExit(this.enemy.x, this.enemy.y, targetX, targetY, radius);
        if (exitResult === PATH_DEFERRED) return PATH_DEFERRED;
        if (exitResult && exitResult.path) {
            this.setPath(exitResult.path, pathPlanner);
            this._isExitPath = true;
            this._exitTargetX = targetX;
            this._exitTargetY = targetY;
            return true;
        }

        // 完全无法移动
        this._clearPath();
        this._isExitPath = false;
        return false;
    }

    _warn(msg) {
        const now = Date.now();
        if (now - this._lastWarnAt > 1000) {
            this._lastWarnAt = now;
            console.warn(msg);
        }
    }
}

export { PathManager };
