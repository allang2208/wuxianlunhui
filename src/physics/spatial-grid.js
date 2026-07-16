/**
 * 2D 空间网格（地面 broadphase）
 *
 * 用于投射物、地面 AOE 等快速筛选附近的实体。
 * 只按 x/y 分格，不处理 z；z 过滤在后续精确检测中完成。
 */

export class SpatialGrid {
    /**
     * @param {number} cellSize 网格单元大小（默认 256）
     */
    constructor(cellSize = 256) {
        this.cellSize = Math.max(1, cellSize);
        /** @type {Map<string, Set>} */
        this.cells = new Map();
        /** @type {Map<object, string[]>} */
        this._items = new Map();
    }

    _key(cx, cy) {
        return `${cx},${cy}`;
    }

    /**
     * 插入一个对象
     * @param {object} item
     * @param {number} x
     * @param {number} y
     * @param {number} radius 对象半径，用于决定覆盖哪些格子
     */
    insert(item, x, y, radius = 0) {
        this.remove(item);

        const cs = this.cellSize;
        const minCX = Math.floor((x - radius) / cs);
        const maxCX = Math.floor((x + radius) / cs);
        const minCY = Math.floor((y - radius) / cs);
        const maxCY = Math.floor((y + radius) / cs);

        const keys = [];
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const k = this._key(cx, cy);
                let set = this.cells.get(k);
                if (!set) {
                    set = new Set();
                    this.cells.set(k, set);
                }
                set.add(item);
                keys.push(k);
            }
        }

        this._items.set(item, keys);
    }

    /**
     * 移除对象
     * @param {object} item
     */
    remove(item) {
        const keys = this._items.get(item);
        if (!keys) return;

        for (const k of keys) {
            const set = this.cells.get(k);
            if (set) {
                set.delete(item);
                if (set.size === 0) {
                    this.cells.delete(k);
                }
            }
        }
        this._items.delete(item);
    }

    /**
     * 查询某半径范围内的所有对象
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @returns {object[]}
     */
    query(x, y, radius) {
        const cs = this.cellSize;
        const minCX = Math.floor((x - radius) / cs);
        const maxCX = Math.floor((x + radius) / cs);
        const minCY = Math.floor((y - radius) / cs);
        const maxCY = Math.floor((y + radius) / cs);

        const result = new Set();
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const set = this.cells.get(this._key(cx, cy));
                if (set) {
                    for (const item of set) {
                        result.add(item);
                    }
                }
            }
        }
        return Array.from(result);
    }

    /**
     * 清空整个网格
     */
    clear() {
        this.cells.clear();
        this._items.clear();
    }

    /**
     * 当前活跃对象数量
     */
    get count() {
        return this._items.size;
    }
}
