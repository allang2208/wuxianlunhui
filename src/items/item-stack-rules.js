/**
 * 物品堆叠规则真源。
 * “无限”以 JavaScript 可精确表示的最大安全整数为防溢出边界；该边界不写入存档物品字段。
 */
export const UNLIMITED_ITEM_STACK = Number.MAX_SAFE_INTEGER;

export function isGoldItem(item) {
    return !!item && (item.category === 'gold' || item.name === '金币');
}

export function getItemMaxStack(item, fallback = 1) {
    if (isGoldItem(item)) return UNLIMITED_ITEM_STACK;
    // 两种强化材料统一上限；兼容缺少 id 或携带旧 maxStack 的已有实例。
    if (item?.id === 'enhancement_stone' || item?.id === 'reforge_ticket'
        || (!item?.id && (item?.name === '强化石' || item?.name === '改造券'))) {
        return 9999;
    }
    const configured = Math.floor(Number(item?.maxStack));
    if (Number.isFinite(configured) && configured > 0) return configured;
    return Math.max(1, Math.floor(Number(fallback) || 1));
}

export function syncGoldStackPresentation(item) {
    if (!isGoldItem(item)) return item;
    item.name = '金币';
    item.category = 'gold';
    delete item.maxStack;
    item.stats = [{ name: '数量', value: String(item.stack) }];
    return item;
}

/**
 * 原地把同一容器内的旧版多格金币合并到第一格，保留第一格槽位和展示数据。
 */
export function consolidateGoldStacks(items) {
    if (!Array.isArray(items)) return null;
    let primary = null;
    let total = 0;
    for (const item of items) {
        if (!isGoldItem(item)) continue;
        if (!primary) primary = item;
        const amount = Math.max(0, Math.floor(Number(item.stack) || 0));
        total = Math.min(UNLIMITED_ITEM_STACK, total + amount);
    }
    if (!primary) return null;

    for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index];
        if (item !== primary && isGoldItem(item)) items.splice(index, 1);
    }
    if (total <= 0) {
        const index = items.indexOf(primary);
        if (index >= 0) items.splice(index, 1);
        return null;
    }
    primary.stack = total;
    return syncGoldStackPresentation(primary);
}
