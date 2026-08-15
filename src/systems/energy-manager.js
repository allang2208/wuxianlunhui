/**
 * EnergyManager — 世界-122「能源」背包物品集中管理（与 GoldManager 同构）。
 *
 * - 能源 = 背包物品（category 'energy'），稀有度普通，最大堆叠 999，可多堆；
 * - 掉落/采集/建造/修理全部经由本单例读写玩家背包数组（引用注入，不直接依赖 EquipManager）；
 * - 建造与修理在背包里扣能源（"掉落后装入背包才能修建建筑"）。
 */

/** 能源物品模板（掉落物/新堆叠统一用这份定义） */
export const ENERGY_ITEM = {
    name: '能源',
    type: '材料',
    icon: '⚡',
    iconImage: 'assets/items/energy.png', // 2026-08-15：生图管线产出（蓝色水晶簇图标，同场景节点风格）
    category: 'energy',
    rarity: 'common',
    desc: '世界-122 采集的能源，用于修建与修理防御建筑',
    maxStack: 999,
    stack: 1,
    price: 1,
};

class EnergyManagerImpl {
    constructor() {
        this._backpack = null;
        this._maxSlots = 0;
        this._callbacks = { onUpdate: null, onFull: null };
    }

    /** 设置对背包数组的引用（会被直接修改） */
    setBackpackRef(backpackItems) {
        this._backpack = backpackItems;
    }

    /** 设置最大背包槽位数 */
    setMaxBackpackSlots(maxBackpackSlots) {
        this._maxSlots = maxBackpackSlots;
    }

    setCallbacks(callbacks) {
        if (callbacks.onUpdate) this._callbacks.onUpdate = callbacks.onUpdate;
        if (callbacks.onFull) this._callbacks.onFull = callbacks.onFull;
    }

    _getBackpack() {
        return this._backpack || [];
    }

    _findEnergyItems() {
        return this._getBackpack().filter((i) => i && i.category === 'energy');
    }

    _notifyUpdate() {
        if (typeof this._callbacks.onUpdate === 'function') this._callbacks.onUpdate();
    }

    _notifyFull() {
        if (typeof this._callbacks.onFull === 'function') this._callbacks.onFull();
    }

    _getNextFreeSlot() {
        const bp = this._getBackpack();
        const used = new Set(bp.map((i) => i.slot).filter((s) => s !== undefined));
        let slot = 0;
        while (used.has(slot) && slot < this._maxSlots) slot++;
        return slot >= this._maxSlots ? -1 : slot;
    }

    /** 背包内能源总数（跨堆叠求和） */
    getEnergy() {
        let total = 0;
        for (const i of this._findEnergyItems()) total += i.stack || 0;
        return total;
    }

    /**
     * 增加能源（优先合并未满堆叠，超出开新堆；背包满返回 false）
     * @param {number} amount
     * @returns {boolean}
     */
    addEnergy(amount) {
        if (!(amount > 0)) return false;
        const maxStack = ENERGY_ITEM.maxStack;
        const bp = this._getBackpack();
        for (const item of bp) {
            if (item && item.category === 'energy' && item.stack < maxStack) {
                const space = maxStack - item.stack;
                if (amount <= space) {
                    item.stack += amount;
                    this._notifyUpdate();
                    return true;
                }
                item.stack = maxStack;
                amount -= space;
            }
        }
        while (amount > 0) {
            const slot = this._getNextFreeSlot();
            if (slot < 0) {
                this._notifyFull();
                return false;
            }
            const stack = Math.min(amount, maxStack);
            bp.push({ ...ENERGY_ITEM, slot, stack });
            amount -= stack;
        }
        this._notifyUpdate();
        return true;
    }

    /**
     * 扣除能源（跨堆叠；不足返回 false，不动背包）
     * @param {number} amount
     * @returns {boolean}
     */
    deductEnergy(amount) {
        if (amount <= 0) return true;
        if (this.getEnergy() < amount) return false;
        let remain = amount;
        const bp = this._getBackpack();
        for (let i = bp.length - 1; i >= 0; i--) {
            const item = bp[i];
            if (!item || item.category !== 'energy') continue;
            const take = Math.min(item.stack || 0, remain);
            item.stack -= take;
            remain -= take;
            if (item.stack <= 0) bp.splice(i, 1);
            if (remain <= 0) break;
        }
        this._notifyUpdate();
        return true;
    }

    /** 将传入的能源物品合并进背包（拾取路径复用） */
    mergeEnergy(item) {
        if (!item || item.category !== 'energy') return false;
        const amount = item.stack || 1;
        const before = this.getEnergy();
        const ok = this.addEnergy(amount);
        return ok || this.getEnergy() > before;
    }
}

/** 导出单例 */
export const EnergyManager = new EnergyManagerImpl();
