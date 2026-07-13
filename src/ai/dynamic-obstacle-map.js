import { Game } from '../game.js';

/* ================================================================
 * DynamicObstacleMap — 动态障碍图
 *
 * 目标：让寻路能“看见”密集的怪物群，主动规划绕行路线，
 * 而不是所有怪物都沿着同一条最短路径冲向玩家。
 *
 * 设计原则：
 * 1. 轻量：每 250ms 采样一次，不每帧更新
 * 2. 稀疏：只标记“密集区域”（≥3 个敌人在同一格子范围内）
 * 3. 软成本：障碍不是完全不可走，而是提高移动成本（3.0~5.0）
 * 4. 衰减：成本会自然衰减，避免路径频繁抖动
 * ================================================================ */

class DynamicObstacleMap {
    constructor(gridSize = 40) {
        this.gridSize = gridSize;
        // key: "cx,cy" -> { cost, count, updatedAt }
        this.cells = new Map();
        this.updateInterval = 250; // ms
        this.lastUpdate = 0;
        // 同一格子内敌人数量阈值，超过才视为障碍
        this.crowdThreshold = 2; // count > 2 即 ≥3
        // 基础成本倍数（会被 decay 衰减）
        this.baseCost = 3.5;
        // 每秒衰减量，让旧障碍自然淡出
        this.decayPerSecond = 1.5;
    }

    /**
     * 获取指定世界坐标的动态成本
     * @param {number} x
     * @param {number} y
     * @returns {number} 成本倍数，>=1
     */
    getCost(x, y) {
        const key = this._getKey(Math.floor(x / this.gridSize), Math.floor(y / this.gridSize));
        const cell = this.cells.get(key);
        if (!cell) return 1.0;
        return Math.max(1.0, cell.cost);
    }

    /**
     * 由 PathFinder.findPath 调用，按需刷新障碍图
     * @param {number} now - 当前时间戳 ms
     */
    update(now) {
        if (now - this.lastUpdate < this.updateInterval) return;
        this.lastUpdate = now;
        this._rebuild(now);
    }

    /**
     * 手动标记某个位置为临时障碍（可用于特殊技能/陷阱等）
     * @param {number} x
     * @param {number} y
     * @param {number} cost - 成本倍数
     * @param {number} duration - 持续时间 ms
     */
    markTemporaryObstacle(x, y, cost = 5.0, duration = 1000) {
        const key = this._getKey(Math.floor(x / this.gridSize), Math.floor(y / this.gridSize));
        this.cells.set(key, {
            cost,
            count: this.crowdThreshold + 1,
            updatedAt: Date.now() + duration
        });
    }

    _rebuild(now) {
        // 1. 衰减旧 cell
        for (const [key, cell] of this.cells) {
            const age = (now - cell.updatedAt) / 1000;
            cell.cost -= this.decayPerSecond * age;
            if (cell.cost <= 1.0) {
                this.cells.delete(key);
            }
        }

        // 2. 重新统计敌人密集区域
        if (!Game || !Game.entities) return;
        const counts = new Map();
        for (const e of Game.entities.values()) {
            if (!e.active || e.hp <= 0 || e._faction !== 'enemy') continue;
            const r = e.collisionRadius || 12;
            const [cx, cy] = this._getCell(e.x, e.y);
            const range = Math.max(0, Math.ceil(r / this.gridSize));
            for (let dx = -range; dx <= range; dx++) {
                for (let dy = -range; dy <= range; dy++) {
                    const key = this._getKey(cx + dx, cy + dy);
                    counts.set(key, (counts.get(key) || 0) + 1);
                }
            }
        }

        for (const [key, count] of counts) {
            if (count > this.crowdThreshold) {
                const existing = this.cells.get(key);
                const newCost = existing
                    ? Math.min(existing.cost + 0.5, this.baseCost)
                    : this.baseCost;
                this.cells.set(key, {
                    cost: newCost,
                    count,
                    updatedAt: now
                });
            }
        }
    }

    _getCell(x, y) {
        return [Math.floor(x / this.gridSize), Math.floor(y / this.gridSize)];
    }

    _getKey(cx, cy) {
        return `${cx},${cy}`;
    }
}

const dynamicObstacleMap = new DynamicObstacleMap(40);

export { DynamicObstacleMap, dynamicObstacleMap };
