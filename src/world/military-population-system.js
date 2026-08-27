import { isMilitaryPopulationIgnored } from '../config/dev-cheats.js';

/**
 * 当前位面的军事人口真源。
 *
 * 容量复用经济人口的房屋容量，但军事单位不会写入经济人口的岗位/预留表；
 * 两条线路只共享容量数值。单位数由原生产建筑的完整编制统计给出，因此本地、
 * 跨位面途中和外派驻军都会继续占用原位面的军事人口。
 *
 * 本模块不依赖 Game/建筑类，HUD 可以安全静态导入，避免 UI -> Game 的 TDZ 循环。
 */
export const MilitaryPopulationSystem = {
    _producers: new Set(),
    _capacityProvider: null,

    setCapacityProvider(provider) {
        this._capacityProvider = typeof provider === 'function' ? provider : null;
    },

    registerProducer(producer) {
        if (producer?._isTroopProducer) this._producers.add(producer);
    },

    unregisterProducer(producer) {
        this._producers.delete(producer);
    },

    reset() {
        this._producers.clear();
    },

    getCapacity() {
        return Math.max(0, Math.floor(Number(this._capacityProvider?.()) || 0));
    },

    getUsed() {
        let used = 0;
        for (const producer of this._producers) {
            if (!producer || producer.active === false || !producer._isTroopProducer) continue;
            used += Math.max(0, Math.floor(Number(producer.aliveUnitCount?.()) || 0));
        }
        return used;
    },

    getSnapshot() {
        const capacity = this.getCapacity();
        const used = this.getUsed();
        return {
            used,
            capacity,
            free: Math.max(0, capacity - used),
            overcrowded: Math.max(0, used - capacity),
        };
    },

    canRecruit(amount = 1) {
        if (isMilitaryPopulationIgnored()) return true;
        const cost = Math.max(0, Math.floor(Number(amount) || 0));
        return cost <= this.getSnapshot().free;
    },
};
