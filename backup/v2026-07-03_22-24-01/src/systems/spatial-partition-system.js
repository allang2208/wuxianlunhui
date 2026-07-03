/**
 * SpatialPartitionSystem — 空间分区系统
 *
 * 职责：
 * 1. 将游戏世界划分为均匀网格，加速实体空间查询
 * 2. 提供高效的近邻搜索、范围查询、矩形查询
 * 3. 支持动态实体插入、更新与移除
 * 4. 被感知系统、移动系统、决策系统调用以优化性能
 *
 * 设计原则：
 * - 不直接调用其他系统，只操作内部数据结构
 * - 统一接口：update(dt, entities) 重建网格
 * - 提供查询接口供其他系统使用
 * - 时间单位：毫秒
 * - 全局变量使用 typeof 检查
 */

import { MathUtils } from '../config/math-utils.js';

/**
 * 网格配置参数
 * 根据游戏世界大小和实体密度动态调整
 */
const GRID_CONFIG = {
    cellSize: 128,      // 每个网格单元大小（像素），覆盖视野范围
    maxEntities: 2048,  // 最大支持实体数（预分配优化）
    maxQueryResults: 64 // 单次查询最大返回结果数（避免数组膨胀）
};

class SpatialPartitionSystemImpl {
    constructor() {
        this.cellSize = GRID_CONFIG.cellSize;
        this.invCellSize = 1.0 / this.cellSize;
        this.cells = new Map();       // 网格存储: key="x,y" -> Set<Entity>
        this.allEntities = [];        // 缓存所有活跃实体
        this._queryResults = [];      // 复用查询结果数组（减少GC）
        this._tempSet = new Set();    // 临时集合去重
        this._bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        this._rebuildInterval = 100;  // 全量重建间隔（ms）
        this._rebuildTimer = 0;
        this._version = 0;            // 网格版本号，用于增量更新检测
    }

    /**
     * 主更新入口 — 每帧调用重建空间网格
     * @param {number} dt — 时间间隔（ms）
     * @param {Map|Array} entities — 实体集合
     */
    update(dt, entities) {
        this._rebuildTimer += dt;

        // 每 _rebuildInterval 毫秒或实体数量变化时全量重建
        if (this._rebuildTimer >= this._rebuildInterval) {
            this._rebuildTimer = 0;
            this._buildGrid(entities);
        }
    }

    /**
     * 强制立即重建网格（用于关键事件后）
     * @param {Map|Array} entities — 实体集合
     */
    forceRebuild(entities) {
        this._rebuildTimer = 0;
        this._buildGrid(entities);
    }

    /**
     * 从集合中重建完整网格
     * @param {Map|Array} entities — 实体集合
     */
    _buildGrid(entities) {
        this.cells.clear();
        this._tempSet.clear();
        this.allEntities.length = 0;
        this._version++;

        const iter = entities.values ? entities.values() : entities;
        for (const entity of iter) {
            if (!entity || !entity.active) continue;
            if (typeof entity.x !== 'number' || typeof entity.y !== 'number') continue;

            this.allEntities.push(entity);
            const key = this._getCellKey(entity.x, entity.y);
            let cell = this.cells.get(key);
            if (!cell) {
                cell = [];
                this.cells.set(key, cell);
            }
            cell.push(entity);
        }
    }

    /**
     * 获取单个实体所在网格的邻居（用于增量查询）
     * @param {Object} entity — 目标实体
     * @returns {Array} — 同格及相邻格实体
     */
    getNeighbors(entity) {
        if (!entity || typeof entity.x !== 'number' || typeof entity.y !== 'number') return [];

        this._queryResults.length = 0;
        const cx = Math.floor(entity.x * this.invCellSize);
        const cy = Math.floor(entity.y * this.invCellSize);

        // 查询 3x3 邻域（当前格 + 周围8格）
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = (cx + dx) + ',' + (cy + dy);
                const cell = this.cells.get(key);
                if (!cell) continue;
                for (let i = 0; i < cell.length; i++) {
                    const other = cell[i];
                    if (other !== entity && other.active) {
                        this._queryResults.push(other);
                    }
                }
            }
        }
        return this._queryResults;
    }

    /**
     * 圆形范围查询 — 返回指定半径内的所有实体
     * @param {number} x — 中心X
     * @param {number} y — 中心Y
     * @param {number} radius — 查询半径（像素）
     * @param {Object} [exclude] — 排除的实体
     * @returns {Array} — 范围内实体列表
     */
    queryRadius(x, y, radius, exclude) {
        this._queryResults.length = 0;
        if (radius <= 0) return this._queryResults;

        const rSq = radius * radius;
        const minCX = Math.floor((x - radius) * this.invCellSize);
        const maxCX = Math.floor((x + radius) * this.invCellSize);
        const minCY = Math.floor((y - radius) * this.invCellSize);
        const maxCY = Math.floor((y + radius) * this.invCellSize);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells.get(cx + ',' + cy);
                if (!cell) continue;
                for (let i = 0; i < cell.length; i++) {
                    const entity = cell[i];
                    if (entity === exclude || !entity.active) continue;
                    const dx = entity.x - x;
                    const dy = entity.y - y;
                    if (dx * dx + dy * dy <= rSq) {
                        this._queryResults.push(entity);
                        if (this._queryResults.length >= GRID_CONFIG.maxQueryResults) {
                            return this._queryResults;
                        }
                    }
                }
            }
        }
        return this._queryResults;
    }

    /**
     * 圆形范围查询 — 仅返回玩家实体
     * @param {number} x — 中心X
     * @param {number} y — 中心Y
     * @param {number} radius — 查询半径
     * @param {Object} [exclude] — 排除的实体
     * @returns {Array} — 范围内玩家实体
     */
    queryRadiusPlayers(x, y, radius, exclude) {
        this._queryResults.length = 0;
        if (radius <= 0) return this._queryResults;

        const rSq = radius * radius;
        const minCX = Math.floor((x - radius) * this.invCellSize);
        const maxCX = Math.floor((x + radius) * this.invCellSize);
        const minCY = Math.floor((y - radius) * this.invCellSize);
        const maxCY = Math.floor((y + radius) * this.invCellSize);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells.get(cx + ',' + cy);
                if (!cell) continue;
                for (let i = 0; i < cell.length; i++) {
                    const entity = cell[i];
                    if (entity === exclude || !entity.active) continue;
                    if (entity._faction !== 'player') continue;
                    const dx = entity.x - x;
                    const dy = entity.y - y;
                    if (dx * dx + dy * dy <= rSq) {
                        this._queryResults.push(entity);
                        if (this._queryResults.length >= GRID_CONFIG.maxQueryResults) {
                            return this._queryResults;
                        }
                    }
                }
            }
        }
        return this._queryResults;
    }

    /**
     * 矩形范围查询
     * @param {number} x — 矩形左下角X
     * @param {number} y — 矩形左下角Y
     * @param {number} width — 矩形宽度
     * @param {number} height — 矩形高度
     * @param {Object} [exclude] — 排除的实体
     * @returns {Array} — 矩形内实体
     */
    queryRect(x, y, width, height, exclude) {
        this._queryResults.length = 0;
        if (width <= 0 || height <= 0) return this._queryResults;

        const minCX = Math.floor(x * this.invCellSize);
        const maxCX = Math.floor((x + width) * this.invCellSize);
        const minCY = Math.floor(y * this.invCellSize);
        const maxCY = Math.floor((y + height) * this.invCellSize);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells.get(cx + ',' + cy);
                if (!cell) continue;
                for (let i = 0; i < cell.length; i++) {
                    const entity = cell[i];
                    if (entity === exclude || !entity.active) continue;
                    if (entity.x >= x && entity.x <= x + width && entity.y >= y && entity.y <= y + height) {
                        this._queryResults.push(entity);
                        if (this._queryResults.length >= GRID_CONFIG.maxQueryResults) {
                            return this._queryResults;
                        }
                    }
                }
            }
        }
        return this._queryResults;
    }

    /**
     * 获取最近的N个实体
     * @param {number} x — 中心X
     * @param {number} y — 中心Y
     * @param {number} maxCount — 最大返回数量
     * @param {number} [maxRadius] — 最大搜索半径
     * @param {Object} [exclude] — 排除的实体
     * @returns {Array} — 按距离排序的实体列表（每元素含 distance 字段）
     */
    queryNearest(x, y, maxCount, maxRadius, exclude) {
        maxCount = maxCount || 5;
        maxRadius = maxRadius || 800;
        const results = this.queryRadius(x, y, maxRadius, exclude);
        if (results.length <= 1) return results;

        // 计算距离并排序
        const scored = [];
        for (let i = 0; i < results.length; i++) {
            const e = results[i];
            const dx = e.x - x;
            const dy = e.y - y;
            scored.push({ entity: e, distance: dx * dx + dy * dy });
        }
        scored.sort((a, b) => a.distance - b.distance);

        this._queryResults.length = 0;
        for (let i = 0; i < Math.min(maxCount, scored.length); i++) {
            this._queryResults.push(scored[i].entity);
        }
        return this._queryResults;
    }

    /**
     * 查询扇形范围内的实体（用于锥形攻击/视野）
     * @param {number} x — 起点X
     * @param {number} y — 起点Y
     * @param {number} radius — 扇形半径
     * @param {number} angle — 中心方向（弧度）
     * @param {number} fov — 视野角度（弧度）
     * @param {Object} [exclude] — 排除的实体
     * @returns {Array} — 扇形内实体
     */
    queryCone(x, y, radius, angle, fov, exclude) {
        this._queryResults.length = 0;
        if (radius <= 0 || fov <= 0) return this._queryResults;

        const halfFov = fov * 0.5;
        const cosHalfFov = Math.cos(halfFov);
        const rSq = radius * radius;
        const minCX = Math.floor((x - radius) * this.invCellSize);
        const maxCX = Math.floor((x + radius) * this.invCellSize);
        const minCY = Math.floor((y - radius) * this.invCellSize);
        const maxCY = Math.floor((y + radius) * this.invCellSize);

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const cell = this.cells.get(cx + ',' + cy);
                if (!cell) continue;
                for (let i = 0; i < cell.length; i++) {
                    const entity = cell[i];
                    if (entity === exclude || !entity.active) continue;
                    const dx = entity.x - x;
                    const dy = entity.y - y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > rSq) continue;
                    if (distSq < 0.001) {
                        this._queryResults.push(entity);
                        continue;
                    }
                    // 判断是否在扇形角度内：dot product > cos(halfFov)
                    const dist = Math.sqrt(distSq);
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const cosDir = Math.cos(angle);
                    const sinDir = Math.sin(angle);
                    if (nx * cosDir + ny * sinDir >= cosHalfFov) {
                        this._queryResults.push(entity);
                        if (this._queryResults.length >= GRID_CONFIG.maxQueryResults) {
                            return this._queryResults;
                        }
                    }
                }
            }
        }
        return this._queryResults;
    }

    /**
     * 获取指定坐标处的网格键
     * @param {number} x — 世界坐标X
     * @param {number} y — 世界坐标Y
     * @returns {string} — "cellX,cellY" 格式键
     */
    _getCellKey(x, y) {
        return Math.floor(x * this.invCellSize) + ',' + Math.floor(y * this.invCellSize);
    }

    /**
     * 获取指定坐标处的网格单元实体
     * @param {number} x — 世界坐标X
     * @param {number} y — 世界坐标Y
     * @returns {Array|null} — 该格内的实体列表
     */
    getCellAt(x, y) {
        return this.cells.get(this._getCellKey(x, y)) || null;
    }

    /**
     * 获取实体密度热图（用于调试或AI决策）
     * @param {number} x — 中心X
     * @param {number} y — 中心Y
     * @param {number} radius — 统计半径
     * @returns {number} — 单位面积实体数（密度）
     */
    getDensity(x, y, radius) {
        const count = this.queryRadius(x, y, radius).length;
        const area = Math.PI * radius * radius;
        return area > 0 ? count / area : 0;
    }

    /**
     * 调试可视化 — 绘制网格和实体分布（Canvas 2D）
     * @param {CanvasRenderingContext2D} ctx — Canvas 2D 上下文
     * @param {number} cameraX — 摄像机X偏移
     * @param {number} cameraY — 摄像机Y偏移
     * @param {number} [alpha] — 绘制透明度
     */
    debugRender(ctx, cameraX, cameraY, alpha) {
        alpha = alpha || 0.3;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;

        // 只绘制视野范围内的网格
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const startCX = Math.floor((cameraX) * this.invCellSize);
        const endCX = Math.floor((cameraX + viewW) * this.invCellSize);
        const startCY = Math.floor((cameraY) * this.invCellSize);
        const endCY = Math.floor((cameraY + viewH) * this.invCellSize);

        for (let cy = startCY; cy <= endCY; cy++) {
            for (let cx = startCX; cx <= endCX; cx++) {
                const px = cx * this.cellSize - cameraX;
                const py = cy * this.cellSize - cameraY;
                const cell = this.cells.get(cx + ',' + cy);
                if (cell && cell.length > 0) {
                    ctx.fillStyle = `rgba(255, 0, 0, ${Math.min(cell.length * 0.1, 0.5)})`;
                    ctx.fillRect(px, py, this.cellSize, this.cellSize);
                }
                ctx.strokeRect(px, py, this.cellSize, this.cellSize);
            }
        }

        ctx.restore();
    }
}

// 单例导出
const SpatialPartitionSystem = new SpatialPartitionSystemImpl();

export default SpatialPartitionSystem;
export { SpatialPartitionSystemImpl };
