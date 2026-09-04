/**
 * consumable.js — 消耗品使用效果（数据驱动）
 * 物品定义 useEffect: {
 *   hp?: number, mp?: number,
 *   maxHpPercent?: number, maxMpPercent?: number
 * }，百分比字段与固定值相加后一次性结算。
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

function resolveRecoveryAmount(effect, flatKey, percentKey, maxValue) {
    const flat = Math.max(0, Number(effect?.[flatKey]) || 0);
    const percent = Math.max(0, Number(effect?.[percentKey]) || 0);
    const maximum = Math.max(0, Number(maxValue) || 0);
    return Math.max(0, Math.floor(flat + maximum * percent / 100));
}

/**
 * 应用消耗品效果到玩家（回血/回蓝 + 浮动文字）。
 * @returns {boolean} 是否有有效效果被应用
 */
export function applyConsumableEffect(player, item) {
    const effect = getConsumableEffect(item);
    if (!effect || !player || !player.data) return false;
    let applied = false;
    const hpAmount = resolveRecoveryAmount(effect, 'hp', 'maxHpPercent', player.data.maxHp);
    if (hpAmount > 0) {
        player.data.hp = Math.min(player.data.hp + hpAmount, player.data.maxHp);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${hpAmount} HP`, '#7a9a6a'));
        applied = true;
    }
    const mpAmount = resolveRecoveryAmount(effect, 'mp', 'maxMpPercent', player.data.maxMp);
    if (mpAmount > 0) {
        player.data.mp = Math.min(player.data.mp + mpAmount, player.data.maxMp);
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${mpAmount} MP`, '#5a8aaa'));
        applied = true;
    }
    return applied;
}
