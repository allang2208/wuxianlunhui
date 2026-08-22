import explorerConfig from '../../data/hamster-explorer-config.json';
import equipmentData from '../../data/equipment.json';

const MATERIAL_TEMPLATES = Object.freeze({
    enhancement_stone: {
        id: 'enhancement_stone', name: '强化石', type: '强化材料', icon: '💎',
        iconImage: 'assets/items/enhance_stone.png', category: 'enhancement',
        subCategory: 'stone', rarity: 'mythic', maxStack: 9999,
        desc: '用于强化装备的特殊材料，蕴含神秘力量', price: 100,
    },
    reforge_ticket: {
        id: 'reforge_ticket', name: '改造券', type: '强化材料', icon: '🔧',
        iconImage: 'assets/items/modify_ticket.png', category: 'enhancement',
        subCategory: 'ticket', rarity: 'mythic', maxStack: 9999,
        desc: '用于改造装备的凭证，可使装备获得特殊能力', price: 200,
    },
    magic_dust: {
        id: 'magic_dust', name: '魔法粉尘', type: '材料', icon: '✨',
        iconImage: 'assets/items/magic_dust.png', category: 'material',
        rarity: 'mythic', maxStack: 9999, desc: '用于附魔的魔法粉尘', price: 1,
    },
});

const rewardConfig = explorerConfig.rewards || {};

export function explorerRewardPool(sceneId) {
    const pool = rewardConfig.pools?.[sceneId];
    return Array.isArray(pool) ? pool : [];
}
export function canExploreScene(sceneId) {
    return explorerRewardPool(sceneId).length > 0;
}

function cloneItem(template, stack = 1) {
    if (!template) return null;
    return { ...JSON.parse(JSON.stringify(template)), stack: Math.max(1, Math.floor(stack)) };
}

/**
 * 单次探险互斥奖励：50% 位面祭品 / 25% 金币 / 25% 三种强化材料。
 * randomValue/poolValue 可由后台模拟传入确定值，前台默认使用 Math.random。
 */
export function createExplorerReward(sceneId, playerLevel, randomValue = Math.random(), poolValue = Math.random()) {
    const level = Math.max(1, Math.floor(Number(playerLevel) || 1));
    const tributeChance = Number(rewardConfig.tributeChance) || 0.5;
    const goldChance = Number(rewardConfig.goldChance) || 0.25;
    const roll = Math.max(0, Math.min(0.999999, Number(randomValue) || 0));

    if (roll < tributeChance) {
        const pool = explorerRewardPool(sceneId);
        if (!pool.length) return { kind: 'none', items: [], gold: 0, label: '当前位面没有祭品池' };
        const index = Math.min(pool.length - 1,
            Math.floor(Math.max(0, Math.min(0.999999, Number(poolValue) || 0)) * pool.length));
        const key = pool[index];
        const item = cloneItem(equipmentData.equipment?.[key], 1);
        return item
            ? { kind: 'tribute', items: [item], gold: 0, label: item.name }
            : { kind: 'none', items: [], gold: 0, label: '祭品配置缺失' };
    }

    if (roll < tributeChance + goldChance) {
        const gold = Math.max(0, Math.floor((Number(rewardConfig.goldPerPlayerLevel) || 500) * level));
        return { kind: 'gold', items: [], gold, label: `金币×${gold}` };
    }

    const stoneCount = Math.max(1, Math.floor(Number(rewardConfig.enhancementStone) || 1));
    const ticketCount = Math.max(1, Math.floor(Number(rewardConfig.reforgeTicket) || 1));
    const dustCount = Math.max(1, Math.floor((Number(rewardConfig.magicDustPerPlayerLevel) || 10) * level));
    const items = [
        cloneItem(MATERIAL_TEMPLATES.enhancement_stone, stoneCount),
        cloneItem(MATERIAL_TEMPLATES.reforge_ticket, ticketCount),
        cloneItem(MATERIAL_TEMPLATES.magic_dust, dustCount),
    ].filter(Boolean);
    return {
        kind: 'materials', items, gold: 0,
        label: `强化石×${stoneCount}、改造券×${ticketCount}、魔法粉尘×${dustCount}`,
    };
}
