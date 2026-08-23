import { ItemDatabase } from '../items/item-database.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';

/** 将面包屋产出的植物祭品按顺序写入主神空间仓库，满仓后的 ID 原样返回。 */
export function routeBakeryPlantTributes(itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds.filter((id) => typeof id === 'string') : [];
    let accepted = 0;
    for (; accepted < ids.length; accepted++) {
        const item = ItemDatabase.createInstance(ids[accepted], { stack: 1 });
        if (!item || WarehouseSystem.depositItemAmount(item) < 1) break;
    }
    return { accepted, remainingIds: ids.slice(accepted) };
}
