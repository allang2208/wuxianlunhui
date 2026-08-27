import { GoldManager } from '../systems/gold-manager.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';

export function createGoldItem(amount) {
    const stack = Math.max(0, Math.floor(Number(amount) || 0));
    return {
        name: '金币',
        type: '货币',
        icon: '💰',
        category: 'gold',
        rarity: 'mythic',
        stats: [{ name: '数量', value: String(stack) }],
        desc: '金光闪闪的硬币',
        stack,
        price: 1,
    };
}

/** 背包与主神空间仓库合计还能接收的金币数量。 */
export function getGoldRoutingCapacity() {
    const backpack = Math.max(0, Math.floor(Number(GoldManager?.getRemainingCapacity?.()) || 0));
    const warehouse = Math.max(0, Math.floor(Number(
        WarehouseSystem?.getItemRemainingCapacity?.(createGoldItem(1))
    ) || 0));
    return backpack + warehouse;
}

/** 玩家可支配金币总额：背包与主神空间仓库共用同一资本口径。 */
export function getPlayerTotalGold() {
    const backpack = Math.max(0, Number(GoldManager?.getGold?.()) || 0);
    const warehouse = (WarehouseSystem?.items || []).reduce((sum, item) => {
        if (!item || (item.category !== 'gold' && item.name !== '金币')) return sum;
        return sum + Math.max(0, Number(item.stack) || 0);
    }, 0);
    return backpack + warehouse;
}

/** 银行产出唯一入库顺序：玩家背包 -> 主人空间仓库 -> 返回剩余量给调用方落地。 */
export function routeProducedGold(amount) {
    const requested = Math.max(0, Math.floor(Number(amount) || 0));
    if (requested <= 0) return { requested: 0, backpack: 0, warehouse: 0, remaining: 0 };
    const backpack = GoldManager?.depositGold?.(requested) || 0;
    const afterBackpack = Math.max(0, requested - backpack);
    const warehouse = afterBackpack > 0
        ? (WarehouseSystem?.depositItemAmount?.(createGoldItem(afterBackpack)) || 0)
        : 0;
    return {
        requested,
        backpack,
        warehouse,
        remaining: Math.max(0, afterBackpack - warehouse),
    };
}
