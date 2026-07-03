/**
 * GoldManager — 集中管理所有金币逻辑
 * 不直接依赖 EquipManager，通过引用和回调操作
 */
class GoldManagerImpl {
    constructor() {
        this._backpack = null;
        this._maxSlots = 0;
        this._callbacks = {
            onUpdate: null,
            onFull: null
        };
    }

    /**
     * 设置对背包数组的引用
     * @param {Array} backpackItems — 背包物品数组（会被直接修改）
     */
    setBackpackRef(backpackItems) {
        this._backpack = backpackItems;
    }

    /**
     * 设置最大背包槽位数
     * @param {number} maxBackpackSlots
     */
    setMaxBackpackSlots(maxBackpackSlots) {
        this._maxSlots = maxBackpackSlots;
    }

    /**
     * 设置回调函数
     * @param {Object} callbacks
     * @param {Function} [callbacks.onUpdate] — 背包数据变更后调用（如刷新UI）
     * @param {Function} [callbacks.onFull] — 背包已满时调用
     */
    setCallbacks(callbacks) {
        if (callbacks.onUpdate) this._callbacks.onUpdate = callbacks.onUpdate;
        if (callbacks.onFull) this._callbacks.onFull = callbacks.onFull;
    }

    /** @private 安全读取背包数组 */
    _getBackpack() {
        return this._backpack || [];
    }

    /** @private 查找背包中的金币物品 */
    _findGoldItem() {
        const bp = this._getBackpack();
        return bp.find(i => i.category === 'gold' || i.name === '金币');
    }

    /** @private 同步金币 stats 显示 */
    _syncGoldStats(goldItem) {
        if (goldItem.stats && goldItem.stats[0]) {
            goldItem.stats[0].value = String(goldItem.stack);
        } else if (goldItem.stats) {
            goldItem.stats = [{ name: '数量', value: String(goldItem.stack) }];
        }
    }

    /** @private 通知 UI 更新 */
    _notifyUpdate() {
        if (typeof this._callbacks.onUpdate === 'function') {
            this._callbacks.onUpdate();
        }
    }

    /** @private 通知背包已满 */
    _notifyFull() {
        if (typeof this._callbacks.onFull === 'function') {
            this._callbacks.onFull();
        }
    }

    /** @private 获取下一个空闲槽位，无则返回 -1 */
    _getNextFreeSlot() {
        const bp = this._getBackpack();
        const usedSlots = new Set(bp.map(i => i.slot).filter(s => s !== undefined));
        let slot = 0;
        while (usedSlots.has(slot) && slot < this._maxSlots) {
            slot++;
        }
        return slot >= this._maxSlots ? -1 : slot;
    }

    /**
     * 获取当前金币数量
     * @returns {number}
     */
    getGold() {
        const goldItem = this._findGoldItem();
        return goldItem ? (goldItem.stack || 0) : 0;
    }

    /**
     * 增加金币（自动合并到已有堆叠，最大99999）
     * @param {number} amount — 增加数量
     * @returns {boolean} — 是否成功
     */
    addGold(amount) {
        if (amount <= 0) return false;
        const MAX_GOLD_STACK = 99999;

        const bp = this._getBackpack();

        // 优先合并到所有已有的金币堆叠中
        for (const item of bp) {
            if (item && (item.category === 'gold' || item.name === '金币') && item.stack < MAX_GOLD_STACK) {
                const space = MAX_GOLD_STACK - item.stack;
                if (amount <= space) {
                    item.stack += amount;
                    this._syncGoldStats(item);
                    this._notifyUpdate();
                    return true;
                }
                item.stack = MAX_GOLD_STACK;
                amount -= space;
                this._syncGoldStats(item);
            }
        }

        // 剩余金币放入新格子
        while (amount > 0) {
            const slot = this._getNextFreeSlot();
            if (slot < 0) {
                this._notifyFull();
                return false;
            }
            const stack = Math.min(amount, MAX_GOLD_STACK);
            bp.push({
                slot,
                name: '金币',
                type: '货币',
                icon: '💰',
                category: 'gold',
                stats: [{ name: '数量', value: String(stack) }],
                desc: '金光闪闪的硬币',
                stack: stack,
                price: 1
            });
            amount -= stack;
        }

        this._notifyUpdate();
        return true;
    }

    /**
     * 扣除金币
     * @param {number} amount — 扣除数量
     * @returns {boolean} — 成功返回 true，不足返回 false
     */
    deductGold(amount) {
        if (amount <= 0) return true;

        const bp = this._getBackpack();
        const goldItem = this._findGoldItem();

        if (!goldItem) return false;
        if ((goldItem.stack || 0) < amount) return false;

        goldItem.stack -= amount;
        this._syncGoldStats(goldItem);

        if (goldItem.stack <= 0) {
            const idx = bp.indexOf(goldItem);
            if (idx >= 0) {
                bp.splice(idx, 1);
            }
        }

        this._notifyUpdate();
        return true;
    }

    /**
     * 将传入的金币物品合并到背包中（最大99999）
     * @param {Object} item — 金币物品（需包含 category === 'gold'）
     * @returns {boolean} — 是否成功
     */
    mergeGold(item) {
        if (!item || item.category !== 'gold') return false;
        const MAX_GOLD_STACK = 99999;

        const bp = this._getBackpack();
        let amount = item.stack || 1;

        // 先填满所有已有金币堆叠
        for (const existing of bp) {
            if (existing && (existing.category === 'gold' || existing.name === '金币') && existing.stack < MAX_GOLD_STACK) {
                const space = MAX_GOLD_STACK - existing.stack;
                if (amount <= space) {
                    existing.stack += amount;
                    this._syncGoldStats(existing);
                    this._notifyUpdate();
                    return true;
                }
                existing.stack = MAX_GOLD_STACK;
                amount -= space;
                this._syncGoldStats(existing);
            }
        }

        // 剩余金币放入新格子
        while (amount > 0) {
            const slot = this._getNextFreeSlot();
            if (slot < 0) {
                this._notifyFull();
                return false;
            }
            const stack = Math.min(amount, MAX_GOLD_STACK);
            const clone = JSON.parse(JSON.stringify(item));
            clone.slot = slot;
            clone.stack = stack;
            clone.stats = [{ name: '数量', value: String(stack) }];
            bp.push(clone);
            amount -= stack;
        }

        this._notifyUpdate();
        return true;
    }
}

/** 导出单例 */
export const GoldManager = new GoldManagerImpl();
