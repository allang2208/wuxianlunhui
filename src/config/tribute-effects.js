/**
 * tribute-effects.js — 祭品效果聚合引擎（数据驱动，最终乘算）
 *
 * 祭品物品定义携带 effects 字段（固定百分比，负数为减益）：
 *   atkPercent 物理攻击%  matkPercent 魔法攻击%  defPercent 物理防御%
 *   mdefPercent 魔法防御%  moveSpeedPercent 移动速度%  critPercent 暴击率%
 *   goldPercent 金币掉落%  hpRegenPercent 生命恢复%  mpRegenPercent 魔法恢复%
 * 特殊祭品另可携带：
 *   expPercent 经验获取%（天山雪莲）  revivePercent 复活生命%（蟠桃）
 *   killMpHealPercent 击杀回蓝%（千年人参）
 * 多个同键祭品按最终乘算叠加：最终面板 × Π(1 + p/100)。
 */

import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { ItemDatabase } from '../items/item-database.js';
import { StatusBar } from '../ui/status-bar.js';
import { COMBAT_FORMULAS } from './combat-formulas.js';

/** 聚合当前携带祭品的效果：每个键为 Π(1 + p/100) 的乘算倍率（无该键效果时为 1） */
export function getTributeEffects() {
    const carried = (DungeonMapSystem && DungeonMapSystem._carriedItems) || [];
    const total = {};
    for (const c of carried) {
        const effects = c && c.item && c.item.effects;
        if (!effects) continue;
        for (const [key, value] of Object.entries(effects)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                total[key] = (total[key] ?? 1) * (1 + value / 100);
            }
        }
    }
    return total;
}

/** 对玩家最终面板应用祭品效果（在 calculateCombatStats 末尾调用，最终乘算） */
export function applyTributeEffects(player) {
    if (!player || !player.data) return;
    const e = getTributeEffects();
    const d = player.data;
    d.atk = Math.floor(d.atk * (e.atkPercent ?? 1));
    d.matk = Math.floor(d.matk * (e.matkPercent ?? 1));
    d.def = Math.floor(d.def * (e.defPercent ?? 1));
    d.mdef = Math.floor(d.mdef * (e.mdefPercent ?? 1));
    d.speed = Math.floor(d.speed * (e.moveSpeedPercent ?? 1));
    d.crit = Math.floor(d.crit * (e.critPercent ?? 1));
}

/** 金币掉落倍率（damageable-entity getEnemyGoldDrop 使用） */
export function getTributeGoldMultiplier() {
    return getTributeEffects().goldPercent ?? 1;
}

/** 生命恢复倍率（玩家 hpRegen 使用） */
export function getTributeHpRegenMultiplier() {
    return getTributeEffects().hpRegenPercent ?? 1;
}

/** 魔法恢复倍率（玩家 mpRegen 使用） */
export function getTributeMpRegenMultiplier() {
    return getTributeEffects().mpRegenPercent ?? 1;
}

/** 经验获取倍率（天山雪莲特效，玩家 gainExp 使用） */
export function getTributeExpMultiplier() {
    return getTributeEffects().expPercent ?? 1;
}

/** 蟠桃复活生命比例（如 0.3；未携带蟠桃返回 0） */
export function getTributeReviveRatio() {
    return (getTributeEffects().revivePercent ?? 1) - 1;
}

/** 千年人参击杀回蓝比例（如 0.05；未携带返回 0） */
export function getTributeKillMpHealRatio() {
    return (getTributeEffects().killMpHealPercent ?? 1) - 1;
}

// ==================== 祭品掉落 ====================

/** 按权重抽取一个稀有度 */
function _rollRarity(entries) {
    const roll = Math.random() * 100;
    let acc = 0;
    for (const [rarity, weight] of entries) {
        acc += weight;
        if (roll < acc) return rarity;
    }
    return entries[entries.length - 1][0];
}

/** 从 ItemDatabase 中按稀有度随机选一件祭品（带 effects 数据驱动的才算） */
function _pickTributeByRarity(rarity) {
    const items = ItemDatabase.items || {};
    const pool = Object.entries(items).filter(([, it]) =>
        it && it.category === 'tribute' && it.rarity === rarity && it.effects);
    if (pool.length === 0) return null;
    const [id] = pool[Math.floor(Math.random() * pool.length)];
    return ItemDatabase.get(id);
}

/**
 * 击杀掉落祭品判定（召唤物在外层已拦截）：
 * - 精英/首领：必掉，品质按 combat-formulas.json tributes.dropTables.elite 权重
 * - 普通怪：chance 概率掉，品质只出稀有及以下（normal 表）
 * @param {string} rank 怪物 rank（elite/boss/normal...）
 * @returns {object|null} 祭品物品模板
 */
export function rollTributeDrop(rank) {
    const tables = COMBAT_FORMULAS.tributes?.dropTables || {};
    const isElite = (rank === 'elite' || rank === 'boss');
    const table = isElite
        ? (tables.elite || { chance: 1, weights: [['common', 35], ['uncommon', 30], ['rare', 20], ['epic', 10], ['mythic', 4], ['legendary', 1]] })
        : (tables.normal || { chance: 0.05, weights: [['common', 80], ['uncommon', 15], ['rare', 5]] });
    const chance = table.chance ?? (isElite ? 1 : 0.05);
    if (Math.random() >= chance) return null;
    return _pickTributeByRarity(_rollRarity(table.weights || []));
}

// ==================== 特效 Buff 显示 ====================

const SPECIAL_BUFFS = [
    { key: 'expPercent', id: 'tributeSnowLotus', icon: '🪷', name: '雪莲祝福', color: '#9ad0ff' },
    { key: 'killMpHealPercent', id: 'tributeGinseng', icon: '🌿', name: '人参回气', color: '#6a9a5a' },
    { key: 'revivePercent', id: 'tributePeach', icon: '🍑', name: '蟠桃续命', color: '#e8a06a' },
];

/** 同步特效祭品的常驻 buff 图标（携带时显示；蟠桃复活用掉后不再显示） */
export function syncTributeBuffs(player) {
    if (!player || !StatusBar) return;
    const e = getTributeEffects();
    for (const buff of SPECIAL_BUFFS) {
        const active = (e[buff.key] ?? 1) > 1 && !(buff.key === 'revivePercent' && player._peachReviveUsed);
        const has = player[`_${buff.id}EffectId`];
        if (active && !has) {
            player[`_${buff.id}EffectId`] = StatusBar.addEffect(buff.id, 999999, { icon: buff.icon, name: buff.name, color: buff.color });
        } else if (!active && has) {
            StatusBar.removeEffect(has);
            player[`_${buff.id}EffectId`] = null;
        }
    }
}

/** 地牢结束时清除特效 buff 图标 */
export function clearTributeBuffs(player) {
    if (!player || !StatusBar) return;
    for (const buff of SPECIAL_BUFFS) {
        const id = player[`_${buff.id}EffectId`];
        if (id) {
            StatusBar.removeEffect(id);
            player[`_${buff.id}EffectId`] = null;
        }
    }
    player._peachReviveUsed = false;
    player._peachRevivePending = false;
}
