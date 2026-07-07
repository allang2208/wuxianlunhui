import { PathFinder } from './pathfinder.js';

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
    }

    // ==================== 路径设置 ====================

    /**
     * 设置新路径
     * @param {Array<{x,y}>} path - 路径节点数组
     */
    setPath(path) {
        if (!path || path.length === 0) {
            this._clearPath();
            return;
        }
        this.path = path;
        this.pathIdx = 0;
        this.isValid = true;
        this.checkTimer = this.checkInterval;
        this.stuckCount = 0;
        this.lastRecalcTime = Date.now();
    }

    /**
     * 清除路径
     */
    _clearPath() {
        this.path = null;
        this.pathIdx = 0;
        this.isValid = false;
        this.stuckCount = 0;
    }

    // ==================== 每帧更新：有效性检查 ====================

    /**
     * 每帧由 MovementSystem 调用
     * @param {number} dt - 时间间隔 ms
     * @param {PathFinder} pathPlanner - 路径规划器实例
     */
    update(dt, pathPlanner) {
        if (!this.path || !this.isValid) return;
        this.checkTimer -= dt;
        if (this.checkTimer > 0) return;
        this.checkTimer = this.checkInterval;
        this._checkValidity(pathPlanner);
    }

    /**
     * 扫描路径上的所有节点，检测是否被障碍物阻挡
     * 只检查当前索引之后的节点（已走过的节点不检查）
     */
    _checkValidity(pathPlanner) {
        if (!pathPlanner || !pathPlanner._isBlocked) return;
        const radius = this.enemy.collisionRadius || 12;
        // 从当前索引+1开始检查（当前节点可能正在移动中，不需要严格检查）
        for (let i = this.pathIdx + 1; i < this.path.length; i++) {
            const node = this.path[i];
            if (pathPlanner._isBlocked(node.x, node.y, radius)) {
                this._repairPath(i, pathPlanner);
                return;
            }
        }
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
        const radius = this.enemy.collisionRadius || 12;
        const prevIdx = Math.max(0, blockedIdx - 2); // 向前看 2 个节点
        const nextIdx = Math.min(this.path.length - 1, blockedIdx + 2); // 向后看 2 个节点
        const start = this.path[prevIdx];
        const end = this.path[nextIdx];

        // 策略1：小范围局部搜索（搜索范围限制，性能友好）
        let altPath = null;
        try {
            altPath = pathPlanner.findPath(start.x, start.y, end.x, end.y, radius);
        } catch (e) {
            console.warn('[PathManager] findPath failed:', e.message);
        }

        if (altPath && altPath.length > 2) {
            // 拼接路径：前半段(到prevIdx) + 替代段(去掉首尾，因为和前后重合) + 后半段(从nextIdx开始)
            const before = this.path.slice(0, prevIdx + 1);
            const middle = altPath.slice(1, -1);
            const after = this.path.slice(nextIdx);
            this.path = [...before, ...middle, ...after];
            // 调整索引：如果当前索引在 before 范围内，保持不变；否则需要调整
            if (this.pathIdx > prevIdx) {
                this.pathIdx = prevIdx; // 回退到修复起点，确保能正确跟随新路径
            }
            this.isValid = true;
            this.stuckCount = 0;
            return;
        }

        // 策略2：从阻挡点重新计算到终点的完整路径
        const finalTarget = this.path[this.path.length - 1];
        let newPath = null;
        try {
            newPath = pathPlanner.findPath(start.x, start.y, finalTarget.x, finalTarget.y, radius);
        } catch (e) {
            console.warn('[PathManager] full recalc failed:', e.message);
        }

        if (newPath && newPath.length > 1) {
            // 拼接：前半段 + 新路径（去掉起点，因为和 start 重合）
            const before = this.path.slice(0, prevIdx + 1);
            this.path = [...before, ...newPath.slice(1)];
            if (this.pathIdx > prevIdx) {
                this.pathIdx = prevIdx;
            }
            this.isValid = true;
            this.stuckCount = 0;
            return;
        }

        // 所有修复策略都失败
        this.stuckCount++;
        if (this.stuckCount >= 3) {
            // 连续 3 次修复失败，标记路径无效，让 MovementSystem 触发随机逃逸
            this._clearPath();
        }
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
            return; // 间隔不足，跳过
        }
        const radius = this.enemy.collisionRadius || 12;
        let path = null;
        try {
            path = pathPlanner.findPath(this.enemy.x, this.enemy.y, targetX, targetY, radius);
        } catch (e) {
            console.warn('[PathManager] forceRecalc failed:', e.message);
        }
        if (path) {
            this.setPath(path);
            this._isExitPath = false;
            return;
        }

        // [NEW] A* 失败：尝试 RegionIndex 找最近出口
        // 只在封闭空间（如地牢战斗房间）使用，开放地图不适用
        const exitResult = pathPlanner.findPathToExit(this.enemy.x, this.enemy.y, targetX, targetY, radius);
        if (exitResult && exitResult.path) {
            this.setPath(exitResult.path);
            this._isExitPath = true;
            this._exitTargetX = targetX;
            this._exitTargetY = targetY;
            return;
        }

        // 完全无法移动
        this._clearPath();
        this._isExitPath = false;
    }
    // 默认 500ms 间隔限制，避免每帧触发 A*
    // 卡住时 bypassLimit = true 强制绕过限制
    forceRecalc(pathPlanner, targetX, targetY, bypassLimit = false) {
        const minRecalcInterval = 500; // 500ms 最小重算间隔
        if (!bypassLimit && Date.now() - this.lastRecalcTime < minRecalcInterval) {
            return; // 间隔不足，跳过
        }
        const radius = this.enemy.collisionRadius || 12;
        let path = null;
        try {
            path = pathPlanner.findPath(this.enemy.x, this.enemy.y, targetX, targetY, radius);
        } catch (e) {
            console.warn('[PathManager] forceRecalc failed:', e.message);
        }
        if (path) {
            this.setPath(path);
        } else {
            this._clearPath();
        }
    }
}

export { PathManager };
