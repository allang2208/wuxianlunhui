/**
 * tribute-effects.js — 祭品效果聚合引擎（数据驱动）
 *
 * 祭品物品定义携带 effects 字段（固定百分比，负数为减益）：
 *   atkPercent 物理攻击%  matkPercent 魔法攻击%  defPercent 物理防御%
 *   mdefPercent 魔法防御%  moveSpeedPercent 移动速度%  critPercent 暴击率%
 *   goldPercent 金币掉落%  hpRegenPercent 生命恢复%  mpRegenPercent 魔法恢复%
 * 携带中的全部祭品效果按键线性加和后统一应用；新增祭品只需在物品数据加 effects。
 */

import { DungeonMapSystem } from '../world/dungeon-map-system.js';

/** 聚合当前携带祭品的全部 effects（线性加和） */
export function getTributeEffects() {
    const carried = (DungeonMapSystem && DungeonMapSystem._carriedItems) || [];
    const total = {};
    for (const c of carried) {
        const effects = c && c.item && c.item.effects;
        if (!effects) continue;
        for (const [key, value] of Object.entries(effects)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                total[key] = (total[key] || 0) + value;
            }
        }
    }
    return total;
}

/** 按百分比调整数值（负值向下取整更保守） */
function _pct(value, percent) {
    if (!percent) return value;
    return Math.floor(value * (1 + percent / 100));
}

/** 对玩家最终面板应用祭品效果（在 calculateCombatStats 末尾调用） */
export function applyTributeEffects(player) {
    if (!player || !player.data) return;
    const e = getTributeEffects();
    const d = player.data;
    d.atk = _pct(d.atk, e.atkPercent);
    d.matk = _pct(d.matk, e.matkPercent);
    d.def = _pct(d.def, e.defPercent);
    d.mdef = _pct(d.mdef, e.mdefPercent);
    d.speed = _pct(d.speed, e.moveSpeedPercent);
    d.crit = _pct(d.crit, e.critPercent);
}

/** 金币掉落倍率（damageable-entity getEnemyGoldDrop 使用） */
export function getTributeGoldMultiplier() {
    const e = getTributeEffects();
    return 1 + (e.goldPercent || 0) / 100;
}

/** 生命恢复倍率（玩家 hpRegen 使用） */
export function getTributeHpRegenMultiplier() {
    const e = getTributeEffects();
    return 1 + (e.hpRegenPercent || 0) / 100;
}

/** 魔法恢复倍率（玩家 mpRegen 使用） */
export function getTributeMpRegenMultiplier() {
    const e = getTributeEffects();
    return 1 + (e.mpRegenPercent || 0) / 100;
}
