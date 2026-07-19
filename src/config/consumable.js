/**
 * consumable.js — 消耗品使用效果（数据驱动）
 * 物品定义 useEffect: { hp?: number, mp?: number }，新增消耗品只需在物品数据加字段。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';

/** 解析消耗品效果（物品 useEffect 优先，兼容旧版按名称硬编码） */
export function getConsumableEffect(item) {
    if (!item) return null;
    if (item.useEffect) return item.useEffect;
    if (item.name === '治疗药水') return { hp: 30 };
    if (item.name === '魔力药水') return { mp: 25 };
    return null;
}

/**
 * 应用消耗品效果到玩家（回血/回蓝 + 浮动文字）。
 * @returns {boolean} 是否有有效效果被应用
 */
export function applyConsumableEffect(player, item) {
    const effect = getConsumableEffect(item);
    if (!effect || !player || !player.data) return false;
    if (effect.hp) {
        player.data.hp = Math.min(player.data.hp + effect.hp, player.data.maxHp);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${effect.hp} HP`, '#7a9a6a'));
    }
    if (effect.mp) {
        player.data.mp = Math.min(player.data.mp + effect.mp, player.data.maxMp);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${effect.mp} MP`, '#5a8aaa'));
    }
    return true;
}
