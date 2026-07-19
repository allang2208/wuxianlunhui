/**
 * rarity.js — 物品稀有度统一定义（单一来源）
 * 等级顺序与中文标签集中在此，新增等级只需改本文件。
 */

export const RARITY_LABELS = {
    common: '普通',
    uncommon: '优质',
    rare: '稀有',
    epic: '史诗',
    mythic: '神话',
    legendary: '传说',
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary'];

/** 稀有度键 → 文字颜色（tooltip 等场景） */
export const RARITY_COLORS = {
    common: '#c0c0c0',
    uncommon: '#7aff7a',
    rare: '#7a9aff',
    epic: '#c67aff',
    mythic: '#e69a3c',
    legendary: '#e04a3a',
};

/** 稀有度键 → 中文标签（未知键原样返回） */
export function getRarityLabel(rarity) {
    return RARITY_LABELS[rarity] || rarity;
}
