import { WarehouseSystem } from '../ui/warehouse-system.js';

const ENHANCEMENT_STONE_TEMPLATE = Object.freeze({
    id: 'enhancement_stone',
    name: '强化石',
    type: '强化材料',
    icon: '💎',
    iconImage: 'assets/items/enhance_stone.png',
    category: 'enhancement',
    subCategory: 'stone',
    rarity: 'mythic',
    maxStack: 9999,
    desc: '用于强化装备的特殊材料，蕴含神秘力量',
    price: 100,
});

export function createArmoryEnhancementStone(count = 1) {
    return {
        ...ENHANCEMENT_STONE_TEMPLATE,
        stack: Math.max(1, Math.floor(Number(count) || 1)),
    };
}

/** 自动堆叠进主神空间仓库，返回实际存入和仍需保留的数量。 */
export function routeArmoryEnhancementStones(count) {
    const requested = Math.max(0, Math.floor(Number(count) || 0));
    if (requested <= 0) return { accepted: 0, remaining: 0 };
    const accepted = WarehouseSystem.depositItemAmount(
        createArmoryEnhancementStone(requested)
    );
    return { accepted, remaining: Math.max(0, requested - accepted) };
}
