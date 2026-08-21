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

    _findGoldItems() {
        return this._getBackpack().filter(
            (item) => item && (item.category === 'gold' || item.name === '金币')
        );
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
        return this._findGoldItems().reduce(
            (sum, item) => sum + Math.max(0, Number(item.stack) || 0),
            0
        );
    }

    /** 市场等事务在扣除另一种资源前，用此值保证金币可以原子入库。 */
    getRemainingCapacity() {
        const maxStack = 99999;
        const bp = this._getBackpack();
        const partialSpace = this._findGoldItems().reduce(
            (sum, item) => sum + Math.max(0, maxStack - (Number(item.stack) || 0)),
            0
        );
        const usedSlots = new Set(bp.map((item) => item?.slot).filter((slot) => slot !== undefined));
        const freeSlots = Math.max(0, this._maxSlots - usedSlots.size);
        return partialSpace + freeSlots * maxStack;
    }

    /**
     * 尽可能把金币存入背包，返回实际入包数量。
     * 银行被动产出用这个接口计算后续仓库/地面溢出，不弹“背包已满”提示。
     */
    depositGold(amount, { notifyFull = false } = {}) {
        let remaining = Math.max(0, Math.floor(Number(amount) || 0));
        if (remaining <= 0) return 0;
        const requested = remaining;
        const MAX_GOLD_STACK = 99999;
        const bp = this._getBackpack();

        for (const item of bp) {
            if (remaining <= 0) break;
            if (!item || (item.category !== 'gold' && item.name !== '金币')) continue;
            const current = Math.max(0, Math.floor(Number(item.stack) || 0));
            const add = Math.min(remaining, Math.max(0, MAX_GOLD_STACK - current));
            if (add <= 0) continue;
            item.stack = current + add;
            remaining -= add;
            this._syncGoldStats(item);
        }

        while (remaining > 0) {
            const slot = this._getNextFreeSlot();
            if (slot < 0) break;
            const stack = Math.min(remaining, MAX_GOLD_STACK);
            bp.push({
                slot,
                name: '金币',
                type: '货币',
                icon: '💰',
                category: 'gold',
                rarity: 'mythic',
                stats: [{ name: '数量', value: String(stack) }],
                desc: '金光闪闪的硬币',
                stack,
                price: 1,
            });
            remaining -= stack;
        }

        const added = requested - remaining;
        if (added > 0) this._notifyUpdate();
        if (remaining > 0 && notifyFull) this._notifyFull();
        return added;
    }

    /**
     * 增加金币（自动合并到已有堆叠，最大99999）
     * @param {number} amount — 增加数量
     * @returns {boolean} — 是否成功
     */
    addGold(amount) {
        const requested = Math.max(0, Math.floor(Number(amount) || 0));
        if (requested <= 0) return false;
        return this.depositGold(requested, { notifyFull: true }) === requested;
    }

    /**
     * 扣除金币
     * @param {number} amount — 扣除数量
     * @returns {boolean} — 成功返回 true，不足返回 false
     */
    deductGold(amount) {
        if (amount <= 0) return true;

        const bp = this._getBackpack();
        if (this.getGold() < amount) return false;
        let remain = amount;
        for (let index = bp.length - 1; index >= 0 && remain > 0; index--) {
            const item = bp[index];
            if (!item || (item.category !== 'gold' && item.name !== '金币')) continue;
            const take = Math.min(Math.max(0, Number(item.stack) || 0), remain);
            item.stack -= take;
            remain -= take;
            if (item.stack <= 0) bp.splice(index, 1);
            else this._syncGoldStats(item);
        }

        this._notifyUpdate();
        return remain <= 0;
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
