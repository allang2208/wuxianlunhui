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
import { DungeonConfig } from './dungeon-config.js';
import { ItemDatabase } from '../items/item-database.js';
import { StatusBar } from '../ui/status-bar.js';
import { EquipManager } from '../ui/equip-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { Game } from '../game.js';
import { RARITY_ORDER } from './rarity.js';
import { COMBAT_FORMULAS } from './combat-formulas.js';

/** 聚合当前携带祭品的效果：每个键为 Π(1 + p/100) 的乘算倍率（无该键效果时为 1）；
 * 以 Flat 结尾的键为固定值（非百分比），按加和聚合（如 hpRegenFlat 每秒+1） */
export function getTributeEffects() {
    const carried = (DungeonMapSystem && DungeonMapSystem._carriedItems) || [];
    const total = {};
    for (const c of carried) {
        const effects = c && c.item && c.item.effects;
        if (!effects) continue;
        for (const [key, value] of Object.entries(effects)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                if (key.endsWith('Flat')) {
                    total[key] = (total[key] || 0) + value;
                } else {
                    total[key] = (total[key] ?? 1) * (1 + value / 100);
                }
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

/** 生命恢复固定值加成（Flat 键加和，无效果时为 0；玩家 hpRegen 使用） */
export function getTributeHpRegenFlat() {
    return getTributeEffects().hpRegenFlat ?? 0;
}

/** 经验获取倍率（天山雪莲特效，玩家 gainExp 使用） */
export function getTributeExpMultiplier() {
    return getTributeEffects().expPercent ?? 1;
}

// ==================== 怪物向效果 ====================

/** 怪物承伤倍率（>1 怪物更易受伤，damageable-entity 敌方承伤使用） */
export function getTributeMonsterDamageTakenMul() {
    return getTributeEffects().monsterDamageTakenPercent ?? 1;
}

/** 怪物攻击削减倍率（<1，敌方对玩家造成伤害乘算） */
export function getTributeMonsterAtkDownMul() {
    return 2 - (getTributeEffects().monsterAtkDownPercent ?? 1);
}

/** 怪物移速削减倍率（<1，敌人移动计算使用） */
export function getTributeMonsterMoveSlowMul() {
    return 2 - (getTributeEffects().monsterMoveSlowPercent ?? 1);
}

// ==================== 比例/其他 ====================

/** 战斗节点概率变化（百分点，正=战斗变多/事件同步变少；负=事件变多/战斗同步变少） */
export function getTributeCombatChanceDelta() {
    return ((getTributeEffects().combatChanceDelta ?? 1) - 1) * 100;
}

/** 精英战斗概率变化（百分点） */
export function getTributeEliteChanceDelta() {
    return ((getTributeEffects().eliteChanceDelta ?? 1) - 1) * 100;
}

/** 祭品掉落率倍率 */
export function getTributeDropChanceMul() {
    return getTributeEffects().dropChancePercent ?? 1;
}

/** 体力恢复倍率 */
export function getTributeStaminaRegenMul() {
    return getTributeEffects().staminaRegenPercent ?? 1;
}

// ==================== 特效祭品（item.special 块） ====================

function _carriedSpecials(key) {
    const carried = (DungeonMapSystem && DungeonMapSystem._carriedItems) || [];
    const out = [];
    for (const c of carried) {
        const sp = c && c.item && c.item.special;
        if (sp && sp[key] !== undefined) out.push(sp[key]);
    }
    return out;
}

/** 金刚石「金刚不坏」：单次伤害上限比例（如 0.15；未携带返回 0） */
export function getSurviveCapRatio() {
    const vals = _carriedSpecials('surviveCapPercent');
    return vals.length ? Math.max(...vals) / 100 : 0;
}

/** 月光石「月影」：{ duration, damagePercent }；未携带返回 null */
export function getMoonshadowConfig() {
    const carried = (DungeonMapSystem && DungeonMapSystem._carriedItems) || [];
    for (const c of carried) {
        const sp = c && c.item && c.item.special;
        if (sp && sp.moonshadowDuration !== undefined) {
            return { duration: sp.moonshadowDuration, damagePercent: sp.moonshadowDamagePercent || 0 };
        }
    }
    return null;
}

/** 贤者之石「点石成金」：是否携带 */
export function hasOreUpgrade() {
    return _carriedSpecials('oreUpgrade').some(v => !!v);
}

const _RARITY_ORDER_UP = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary'];

/**
 * 贤者之石「点石成金」拾取时调用：
 * - 拾取的祭品品质提升一级（替换为高一档的随机祭品，保留槽位/数量）
 * - 若拾取的已是传说祭品：额外再获得一件随机传说祭品（原物品不受影响）
 * @param {object} item 即将入包的祭品物品
 * @param {object} [player] 玩家（用于显示浮动文字）
 */
export function applyOreUpgradeOnPickup(item, player) {
    if (!item || item.category !== 'tribute') return;
    const idx = _RARITY_ORDER_UP.indexOf(item.rarity || 'common');
    if (idx === _RARITY_ORDER_UP.length - 1) {
        // 已是传说：额外给一件随机传说祭品（入包，满则掉落地上）
        const extra = _pickTributeByRarity('legendary');
        if (extra) {
            const added = EquipManager.addToBackpack ? EquipManager.addToBackpack(extra) : false;
            if (!added && Game && Game.dropItem && player) Game.dropItem(player.x, player.y, extra);
            if (EffectManager && player) {
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '🪨 点石成金：额外获得传说祭品！', '#e0c060'));
            }
        }
        return;
    }
    if (idx === -1) return;
    const upgraded = _pickTributeByRarity(_RARITY_ORDER_UP[idx + 1]);
    if (!upgraded) return;
    // 保留槽位/堆叠，替换为高一级稀有度的随机祭品
    const { slot, stack } = item;
    Object.assign(item, upgraded);
    item.slot = slot;
    item.stack = stack;
    if (EffectManager && player) {
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `🪨 点石成金：${item.name} 品质提升！`, '#e0c060'));
    }
}

/** 蟠桃复活生命比例（如 0.3；未携带蟠桃返回 0） */
export function getTributeReviveRatio() {
    return (getTributeEffects().revivePercent ?? 1) - 1;
}

/** 千年人参击杀回蓝比例（如 0.05；未携带返回 0） */
export function getTributeKillMpHealRatio() {
    return (getTributeEffects().killMpHealPercent ?? 1) - 1;
}

/** 大理石击杀回血比例（如 0.05；未携带返回 0） */
export function getTributeKillHpHealRatio() {
    return (getTributeEffects().killHpHealPercent ?? 1) - 1;
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

/** 公开版：按稀有度随机取一件祭品（合成等系统使用） */
export function pickTributeByRarity(rarity) {
    return _pickTributeByRarity(rarity);
}

/**
 * 击杀掉落祭品判定（召唤物在外层已拦截）：
 * - 按地牢难度等级（dungeonList.grade，默认 D）取 combat-formulas.json tributes.dropTables 对应表
 * - 精英/首领必掉（分表），普通怪按概率掉；掉落稀有度不超过该难度的 maxRarity 上限
 * @param {string} rank 怪物 rank（elite/boss/normal...）
 * @param {string} [dungeonType] 地牢类型（主神空间等无难度场景默认 'D'）
 * @returns {object|null} 祭品物品模板
 */
export function rollTributeDrop(rank, dungeonType) {
    const grade = _getDungeonGrade(dungeonType);
    const tables = COMBAT_FORMULAS.tributes?.dropTables || {};
    const table = tables[grade] || tables.D;
    if (!table) return null;
    const isBoss = rank === 'boss';
    const isElite = rank === 'elite' || isBoss;
    const sub = isBoss ? table.boss : (isElite ? table.elite : table.normal);
    if (!sub) return null;
    // 掉率加成（数据驱动，乘算）
    const chance = Math.min(1, (sub.chance ?? (isElite ? 1 : 0.05)) * getTributeDropChanceMul());
    if (Math.random() >= chance) return null;
    // 稀有度上限过滤（F=稀有封顶 / E=史诗封顶 / D+全开放）
    const weights = _capWeights(sub.weights || [], table.maxRarity);
    if (weights.length === 0) return null;
    return _pickTributeByRarity(_rollRarity(weights));
}

/** 按稀有度上限过滤权重表并归一化 */
function _capWeights(weights, maxRarity) {
    if (!maxRarity) return weights;
    const capIdx = RARITY_ORDER.indexOf(maxRarity);
    if (capIdx === -1) return weights;
    const allowed = weights.filter(([rarity]) => RARITY_ORDER.indexOf(rarity) <= capIdx);
    const sum = allowed.reduce((acc, [, w]) => acc + w, 0);
    if (sum <= 0) return allowed;
    // 归一化到 100，保证抽取语义一致
    return allowed.map(([rarity, w]) => [rarity, (w / sum) * 100]);
}

/** 地牢类型 → 难度等级（dungeonList.grade，默认 D） */
function _getDungeonGrade(dungeonType) {
    const list = DungeonConfig.raw?.dungeonList || {};
    if (dungeonType && list[dungeonType] && list[dungeonType].grade) {
        return list[dungeonType].grade;
    }
    return 'D';
}

// ==================== 特效 Buff 显示 ====================

const SPECIAL_BUFFS = [
    { key: 'expPercent', id: 'tributeSnowLotus', icon: '🪷', name: '雪莲祝福', color: '#9ad0ff' },
    { key: 'killMpHealPercent', id: 'tributeGinseng', icon: '🌿', name: '人参回气', color: '#6a9a5a' },
    { key: 'revivePercent', id: 'tributePeach', icon: '🍑', name: '蟠桃续命', color: '#e8a06a' },
    { key: '_surviveCap', id: 'tributeDiamond', icon: '💎', name: '金刚不坏', color: '#7ab0e0' },
    { key: '_moonshadow', id: 'tributeMoonstone', icon: '🌙', name: '月影庇护', color: '#b0a0e0' },
    { key: '_oreUpgrade', id: 'tributePhilosopher', icon: '🪨', name: '点石成金', color: '#e0c060' },
];

/** 同步特效祭品的常驻 buff 图标（携带时显示；蟠桃复活用掉后不再显示） */
export function syncTributeBuffs(player) {
    if (!player || !StatusBar) return;
    const e = getTributeEffects();
    const actives = {
        expPercent: (e.expPercent ?? 1) > 1,
        killMpHealPercent: (e.killMpHealPercent ?? 1) > 1,
        revivePercent: (e.revivePercent ?? 1) > 1 && !player._peachReviveUsed,
        _surviveCap: getSurviveCapRatio() > 0,
        _moonshadow: !!getMoonshadowConfig(),
        _oreUpgrade: hasOreUpgrade(),
    };
    for (const buff of SPECIAL_BUFFS) {
        const active = actives[buff.key] ?? false;
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
