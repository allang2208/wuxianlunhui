/**
 * EnergyManager — 世界-122 仓库能源唯一真源。
 *
 * - 每座仓库独立保存 storedEnergy / storageCapacity；
 * - getEnergy/getCapacity 聚合所有仓库，现有建造/升级/面板调用无需硬编码仓库数量；
 * - 旧背包能源迁移为待入库能量，仓库注册后自动装入；
 * - 仓库满时拒绝继续产出，并触发节流后的“请修建更多仓库”提示。
 */

/** 仅保留旧存档/旧地面掉落兼容；新采矿不再写玩家或队友背包。 */
export const ENERGY_ITEM = {
    name: '能源',
    type: '材料',
    icon: '⚡',
    iconImage: 'assets/items/energy.png',
    category: 'energy',
    rarity: 'common',
    desc: '世界-122 采集的能源，现统一存放于仓库',
    maxStack: 999,
    stack: 1,
    price: 1,
};

class EnergyManagerImpl {
    constructor() {
        this._backpack = null; // 仅用于迁移旧能源物品
        this._maxSlots = 0;    // 兼容旧调用，不再限制能源容量
        this._callbacks = { onUpdate: null, onFull: null };
        this._warehouses = new Map();
        this._pendingEnergy = 0;
        this._lastFullNoticeAt = 0;
    }

    /** 注入背包并迁移旧能源堆；迁移后背包不再保留能源物品。 */
    setBackpackRef(backpackItems) {
        this._backpack = backpackItems;
        if (!Array.isArray(backpackItems)) return;
        let legacy = 0;
        for (let i = backpackItems.length - 1; i >= 0; i--) {
            const item = backpackItems[i];
            if (!item || item.category !== 'energy') continue;
            legacy += Math.max(0, Number(item.stack) || 0);
            backpackItems.splice(i, 1);
        }
        if (legacy > 0) {
            this.importLegacyEnergy(legacy);
        }
    }

    /** 兼容旧初始化接口；仓库容量不再读取背包槽位。 */
    setMaxBackpackSlots(maxBackpackSlots) {
        this._maxSlots = maxBackpackSlots;
    }

    setCallbacks(callbacks = {}) {
        if ('onUpdate' in callbacks) this._callbacks.onUpdate = callbacks.onUpdate;
        if ('onFull' in callbacks) this._callbacks.onFull = callbacks.onFull;
    }

    _notifyUpdate() {
        if (typeof this._callbacks.onUpdate === 'function') this._callbacks.onUpdate();
    }

    _notifyFull() {
        const now = Date.now();
        if (now - this._lastFullNoticeAt < 1500) return;
        this._lastFullNoticeAt = now;
        if (typeof this._callbacks.onFull === 'function') {
            this._callbacks.onFull('仓库已满，请修建更多的仓库');
        }
    }

    registerWarehouse(entity, capacity = 5000) {
        if (!entity) return false;
        const cap = Math.max(0, Math.floor(Number(capacity) || 0));
        entity.storageCapacity = cap;
        entity.storedEnergy = Math.max(0, Math.min(cap, Math.floor(Number(entity.storedEnergy) || 0)));
        this._warehouses.set(entity.id || entity, entity);
        this._flushPendingEnergy();
        this._notifyUpdate();
        return true;
    }

    /** preserve=true 用于场景生命周期；摧毁/出售则默认损失该仓库存量。 */
    unregisterWarehouse(entity, { preserve = false } = {}) {
        if (!entity) return 0;
        const key = entity.id || entity;
        const stored = Math.max(0, Math.floor(Number(entity.storedEnergy) || 0));
        if (!this._warehouses.delete(key)) return 0;
        if (preserve && stored > 0) this._pendingEnergy += stored;
        entity.storedEnergy = 0;
        this._notifyUpdate();
        return stored;
    }

    resetWarehouses({ preserve = false } = {}) {
        for (const warehouse of this._warehouses.values()) {
            if (preserve) this._pendingEnergy += Math.max(0, warehouse.storedEnergy || 0);
            warehouse.storedEnergy = 0;
        }
        this._warehouses.clear();
        this._notifyUpdate();
    }

    getWarehouses() {
        return Array.from(this._warehouses.values()).filter((w) => w && w.active !== false);
    }

    getWarehouseCount() {
        return this.getWarehouses().length;
    }

    getEnergy() {
        return this.getWarehouses().reduce((sum, w) => sum + Math.max(0, Number(w.storedEnergy) || 0), 0);
    }

    getCapacity() {
        return this.getWarehouses().reduce((sum, w) => sum + Math.max(0, Number(w.storageCapacity) || 0), 0);
    }

    getFreeCapacity() {
        return Math.max(0, this.getCapacity() - this.getEnergy());
    }

    hasWarehouse() {
        return this.getWarehouseCount() > 0;
    }

    isFull() {
        return this.getCapacity() <= 0 || this.getFreeCapacity() <= 0;
    }

    canStore(amount) {
        return amount <= 0 || this.getFreeCapacity() >= amount;
    }

    /** 存入能源并返回实际入库量；容量不足时允许部分入库并提示满仓。 */
    depositEnergy(amount) {
        let remain = Math.max(0, Math.floor(Number(amount) || 0));
        if (remain <= 0) return 0;
        const requested = remain;
        for (const warehouse of this.getWarehouses()) {
            const capacity = Math.max(0, warehouse.storageCapacity || 0);
            const current = Math.max(0, warehouse.storedEnergy || 0);
            const take = Math.min(remain, Math.max(0, capacity - current));
            if (take <= 0) continue;
            warehouse.storedEnergy = current + take;
            remain -= take;
            if (remain <= 0) break;
        }
        const added = requested - remain;
        if (added > 0) this._notifyUpdate();
        if (remain > 0) this._notifyFull();
        return added;
    }

    /** 兼容原调用：全部存入返回 true，部分/无法存入返回 false。 */
    addEnergy(amount) {
        const requested = Math.max(0, Math.floor(Number(amount) || 0));
        return requested > 0 && this.depositEnergy(requested) === requested;
    }

    deductEnergy(amount) {
        let remain = Math.max(0, Math.floor(Number(amount) || 0));
        if (remain <= 0) return true;
        if (this.getEnergy() < remain) return false;
        const warehouses = this.getWarehouses();
        for (let i = warehouses.length - 1; i >= 0 && remain > 0; i--) {
            const warehouse = warehouses[i];
            const take = Math.min(Math.max(0, warehouse.storedEnergy || 0), remain);
            warehouse.storedEnergy -= take;
            remain -= take;
        }
        this._notifyUpdate();
        return true;
    }

    /** 旧地面能源物品拾取兼容：直接转入仓库。 */
    mergeEnergy(item) {
        if (!item || item.category !== 'energy') return false;
        const amount = Math.max(1, Math.floor(Number(item.stack) || 1));
        return this.depositEnergy(amount) > 0;
    }

    /** 旧玩家/队友背包能源迁移：无仓库时进入待入库，不丢失。 */
    importLegacyEnergy(amount) {
        const value = Math.max(0, Math.floor(Number(amount) || 0));
        if (value <= 0) return 0;
        this._pendingEnergy += value;
        this._flushPendingEnergy();
        this._notifyUpdate();
        return value;
    }

    _flushPendingEnergy() {
        if (this._pendingEnergy <= 0 || !this.hasWarehouse()) return;
        const added = this.depositEnergy(this._pendingEnergy);
        this._pendingEnergy = Math.max(0, this._pendingEnergy - added);
    }

    serializeStorage() {
        return {
            total: this.getEnergy() + this._pendingEnergy,
            pending: this._pendingEnergy,
            capacity: this.getCapacity(),
            warehouseCount: this.getWarehouseCount(),
        };
    }

    restoreStorage(snapshot) {
        const total = Math.max(0, Math.floor(Number(snapshot?.total) || 0));
        for (const warehouse of this.getWarehouses()) warehouse.storedEnergy = 0;
        this._pendingEnergy = total;
        this._flushPendingEnergy();
        this._notifyUpdate();
    }
}

export const EnergyManager = new EnergyManagerImpl();
