/**
 * 世界-122 防守怪目标分摊（2026-08-16）
 *
 * 问题：大量怪物聚集时都锁定同一个最近结构（基地/掩体/塔），攻击距离内
 * 站不下，其余怪物聚在目标周围发呆（只认最近结构、不换第二目标）。
 * 方案：防守怪选结构目标时按「结构同时攻击上限」感知拥挤度，把溢出怪物
 * 分摊到附近其他可攻击结构（第二目标）；正在攻击距离内的怪物保持不换，
 * 避免目标抖动。
 */

/** 结构默认同时可攻击怪物上限（可用结构字段 _attackSlots 覆盖） */
export const DEFAULT_ATTACK_SLOTS = 3;
/** 候选结构最小考虑范围（px）：低于此距离的结构才参与分摊 */
export const MIN_CONSIDER_RANGE = 420;
/** 考虑范围 = max(下限, 攻击距离 × 倍率)：远程怪天然考虑更远 */
export const CONSIDER_RANGE_FACTOR = 2.5;
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { WallSystem } from '../world/wall-system.js';

/** 有效攻击距离（与 combat-system 同口径：attackDistance ?? attackRange×1.15） */
export function effectiveAttackRange(enemy) {
    if (!enemy) return 70;
    if (enemy.attackDistance !== undefined) return enemy.attackDistance;
    return (enemy.attackRange || 70) * 1.15;
}

/** 结构可同时容纳的攻击者上限 */
export function attackSlotsOf(structure) {
    if (structure && Number.isFinite(structure._attackSlots)) return structure._attackSlots;
    return DEFAULT_ATTACK_SLOTS;
}

/** 该怪物分摊第二目标的候选半径 */
export function considerRangeFor(enemy) {
    return Math.max(MIN_CONSIDER_RANGE, effectiveAttackRange(enemy) * CONSIDER_RANGE_FACTOR);
}

/** 怪物当前是否真的够得着该结构（与 CombatSystem 同口径） */
export function isStructureAttackable(enemy, structure) {
    if (!enemy || !structure || !structure.active) return false;
    return distanceToEntityShape(structure, enemy.x, enemy.y) <= effectiveAttackRange(enemy);
}

/**
 * 计算结构占用表：key = 结构实体，value = 当前把它当 target 的存活防守怪数量。
 * 只统计防守怪（_preferDefenseTargets 或 _defenseMonster），不统计玩家/友方。
 */
export function computeStructureOccupancy(entities) {
    const occ = new Map();
    if (!entities) return occ;
    const iter = entities && entities.values ? entities.values() : entities;
    for (const m of iter) {
        if (!m || !m.active || m.hp <= 0) continue;
        if (!m._preferDefenseTargets && !m._defenseMonster) continue;
        const t = m.target;
        if (!t || !t.active || t.hp <= 0 || !t._isDefenseStructure) continue;
        occ.set(t, (occ.get(t) || 0) + 1);
    }
    return occ;
}

/**
 * 为防守怪选择低拥挤的结构目标（第二目标分摊）。
 *
 * 规则（按序）：
 * 1. 当前目标已是结构且在攻击距离内 → 保持（正在输出，不抢）；
 * 2. 当前目标未超容量且在考虑范围内 → 保持（防抖，避免每帧换目标）；
 * 3. 否则在考虑范围内选「未超容量且最近」的结构；
 * 4. 全部超容量时退化为「占用最少、其次最近」；
 * 5. 考虑范围内无候选 → 返回 null（调用方回退到最近结构，保持旧行为）。
 *
 * @param {object} enemy - 防守怪
 * @param {Iterable|Array} entities - 全部实体
 * @param {Map|null} occupancy - 预计算占用表；null 时内部计算
 * @returns {{target: object, dist: number, occ: number}|null}
 */
export function pickStructureTarget(enemy, entities, occupancy = null) {
    if (!enemy || !entities) return null;
    const occ = occupancy || computeStructureOccupancy(entities);
    const range = considerRangeFor(enemy);
    const reach = effectiveAttackRange(enemy);

    // 当前目标保持判断
    const cur = enemy.target;
    if (cur && cur.active && cur.hp > 0 && cur._isDefenseStructure) {
        // 真正够得着（与 CombatSystem 同口径：distanceToEntityShape ≤ 攻击距离）
        // 才保持——墙前被同伴挡住、中心距离看似近但形状距离超射程的怪必须让位换目标
        if (distanceToEntityShape(cur, enemy.x, enemy.y) <= reach) {
            const cdx = cur.x - enemy.x;
            const cdy = cur.y - enemy.y;
            const cd = Math.sqrt(cdx * cdx + cdy * cdy);
            return { target: cur, dist: cd, occ: occ.get(cur) || 0 };
        }
    }

    let best = null;       // 候选内占用最少（其次距离最近）
    let bestBelow = null;  // 未超容量候选内距离最近（其次占用最少）
    const iter = entities && entities.values ? entities.values() : entities;
    for (const s of iter) {
        if (!s || !s.active || s.hp <= 0) continue;
        if (!s._isDefenseStructure || s._faction !== 'player') continue;
        const dx = s.x - enemy.x;
        const dy = s.y - enemy.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > range) continue;
        // 可达性：视线射线不得被其他墙段/门段挡住（目标自身的掩体面线/门洞段忽略，
        // 与 CombatSystem/感知 LOS 同口径）——避免挑到墙另一侧够不着的目标继续顶墙
        if (WallSystem && typeof WallSystem.blocked === 'function') {
            const ignore = s._coverSeg
                ? { segs: new Set([s._coverSeg]) }
                : (s._gateSeg ? { segs: new Set([s._gateSeg]) } : null);
            if (WallSystem.blocked(enemy.x, enemy.y, s.x, s.y, ignore)) continue;
        }
        const o = occ.get(s) || 0;
        if (!best || o < best.occ || (o === best.occ && d < best.dist)) {
            best = { target: s, dist: d, occ: o };
        }
        if (o < attackSlotsOf(s)
            && (!bestBelow || d < bestBelow.dist || (d === bestBelow.dist && o < bestBelow.occ))) {
            bestBelow = { target: s, dist: d, occ: o };
        }
    }
    const chosen = bestBelow || best;
    if (!chosen) return null;
    return { target: chosen.target, dist: chosen.dist, occ: chosen.occ };
}
