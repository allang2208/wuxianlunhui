import {
    UNLIMITED_ITEM_STACK,
    consolidateGoldStacks,
    isGoldItem,
    syncGoldStackPresentation,
} from '../items/item-stack-rules.js';
import { EconomyFlowSystem } from '../world/economy-flow-system.js';

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
        this.normalizeBackpackGold();
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
        return bp.find(isGoldItem);
    }

    _findGoldItems() {
        return this._getBackpack().filter(isGoldItem);
    }

    /** 合并旧存档或旧逻辑留下的多格金币，始终只保留一格。 */
    normalizeBackpackGold() {
        return consolidateGoldStacks(this._getBackpack());
    }

    /** @private 同步金币 stats 显示 */
    _syncGoldStats(goldItem) {
        syncGoldStackPresentation(goldItem);
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
        return Math.max(0, Number(this.normalizeBackpackGold()?.stack) || 0);
    }

    /** 市场等事务在扣除另一种资源前，用此值保证金币可以原子入库。 */
    getRemainingCapacity() {
        const bp = this._getBackpack();
        const goldItem = this.normalizeBackpackGold();
        if (goldItem) {
            return Math.max(0, UNLIMITED_ITEM_STACK - (Number(goldItem.stack) || 0));
        }
        const usedSlots = new Set(bp.map((item) => item?.slot).filter((slot) => slot !== undefined));
        const freeSlots = Math.max(0, this._maxSlots - usedSlots.size);
        return freeSlots > 0 ? UNLIMITED_ITEM_STACK : 0;
    }

    /**
     * 尽可能把金币存入背包，返回实际入包数量。
     * 银行被动产出用这个接口计算后续仓库/地面溢出，不弹“背包已满”提示。
     */
    depositGold(amount, { notifyFull = false, accounting } = {}) {
        let remaining = Math.max(0, Math.floor(Number(amount) || 0));
        if (remaining <= 0) return 0;
        const requested = Math.min(UNLIMITED_ITEM_STACK, remaining);
        remaining = requested;
        const bp = this._getBackpack();
        let goldItem = this.normalizeBackpackGold();
        if (!goldItem) {
            const slot = this._getNextFreeSlot();
            if (slot < 0) {
                if (notifyFull) this._notifyFull();
                return 0;
            }
            goldItem = {
                slot,
                name: '金币',
                type: '货币',
                icon: '💰',
                category: 'gold',
                rarity: 'mythic',
                stats: [{ name: '数量', value: '0' }],
                desc: '金光闪闪的硬币',
                stack: 0,
                price: 1,
            };
            bp.push(goldItem);
        }

        const current = Math.max(0, Math.floor(Number(goldItem.stack) || 0));
        const added = Math.min(remaining, Math.max(0, UNLIMITED_ITEM_STACK - current));
        goldItem.stack = current + added;
        remaining -= added;
        this._syncGoldStats(goldItem);

        const deposited = requested - remaining;
        EconomyFlowSystem.record('gold', deposited, accounting);
        if (deposited > 0) this._notifyUpdate();
        if (remaining > 0 && notifyFull) this._notifyFull();
        return deposited;
    }

    /**
     * 增加金币（自动合并到背包内唯一金币堆叠）
     * @param {number} amount — 增加数量
     * @returns {boolean} — 是否成功
     */
    addGold(amount, options = {}) {
        const requested = Math.max(0, Math.floor(Number(amount) || 0));
        if (requested <= 0) return false;
        return this.depositGold(requested, { ...options, notifyFull: true }) === requested;
    }

    /**
     * 扣除金币
     * @param {number} amount — 扣除数量
     * @returns {boolean} — 成功返回 true，不足返回 false
     */
    deductGold(amount, { accounting } = {}) {
        if (amount <= 0) return true;

        const bp = this._getBackpack();
        this.normalizeBackpackGold();
        if (this.getGold() < amount) return false;
        let remain = amount;
        for (let index = bp.length - 1; index >= 0 && remain > 0; index--) {
            const item = bp[index];
            if (!isGoldItem(item)) continue;
            const take = Math.min(Math.max(0, Number(item.stack) || 0), remain);
            item.stack -= take;
            remain -= take;
            if (item.stack <= 0) bp.splice(index, 1);
            else this._syncGoldStats(item);
        }

        EconomyFlowSystem.record('gold', -(amount - remain), accounting);
        this._notifyUpdate();
        return remain <= 0;
    }

    /**
     * 将传入的金币物品合并到背包内唯一金币堆叠
     * @param {Object} item — 金币物品（需包含 category === 'gold'）
     * @returns {boolean} — 是否成功
     */
    mergeGold(item) {
        if (!isGoldItem(item)) return false;
        const amount = Math.max(0, Math.floor(Number(item.stack) || 1));
        return this.depositGold(amount, { notifyFull: true }) === amount;
    }
}

/** 导出单例 */
export const GoldManager = new GoldManagerImpl();
