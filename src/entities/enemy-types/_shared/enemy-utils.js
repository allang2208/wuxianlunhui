import { SoundManager } from '../../../ui/sound-manager.js';
import { distanceToEntityShape } from '../../../utils/collision-helpers.js';

/**
 * 怪物共享工具（新怪物工作流基础件，勿在各怪物类内重复实现）
 *
 * - hostilesOf：敌对目标枚举（同阵营/无效/不可击除外）
 * - nearestHostileOf：入侵特工最近敌对目标（非 agent 阵营最近优先）
 * - isTargetMeleeStyle：目标攻击风格判定（近战/远程，决定怪物的应对策略）
 * - playSoundFrom：按配置 sounds 键播放音效
 * - isFacingLeftFrom：朝向判定（与 _getPhaserOptions 的 flipX 同规则）
 * - inMeleeRange：近战范围命中统一口径（与 CombatSystem 触发同语义：圆形边缘距离 ≤ range）
 */

/**
 * 近战范围命中统一口径（2026-07-25）：圆形边缘距离（中心距 − 目标 footprint 半径）≤ range。
 * 与 CombatSystem 触发的 distanceToEntityShape 同语义，杜绝"触发是圆、命中是椭圆（垂直半射程落空）"错位。
 * 注意：带地面椭圆圈视觉的范围技能（砸地冲击波/嚎叫/燃烧区）不在此列，仍用 GroundEllipse 保持视觉一致。
 */
export function inMeleeRange(attacker, target, range) {
    return distanceToEntityShape(target, attacker.x, attacker.y) <= range;
}

/** 敌对可击单位列表（entities 为 Map/数组/缺省 Game.entities） */
export function hostilesOf(host, entities) {
    const list = Array.isArray(entities)
        ? entities
        : (entities ? Array.from(entities.values()) : []);
    const src = list.length > 0
        ? list
        : (typeof window !== 'undefined' && window.Game && window.Game.entities
            ? Array.from(window.Game.entities.values()) : []);
    const out = [];
    for (const e of src) {
        if (!e || e === host || !e.active || !e.hittable) continue;
        if (e._faction === host._faction) continue;
        out.push(e);
    }
    return out;
}

/**
 * 入侵特工最近敌对目标（时空特工追击机制）：faction=agent 与全场敌对，
 * 玩家与地牢怪物皆为目标，取最近的非 agent 可击单位（PerceptionSystem 不接管入侵特工目标）
 */
export function nearestHostileOf(host, entities) {
    let best = null;
    let bestD = Infinity;
    const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
    for (const e of list) {
        if (!e || e === host || !e.active || !e.hittable) continue;
        if (e._faction === 'agent') continue;
        const d = Math.hypot(e.x - host.x, e.y - host.y);
        if (d < bestD) { bestD = d; best = e; }
    }
    return best;
}

/** 目标攻击风格：近战（玩家持近战武器/徒手、怪物 melee 武器模式）返回 true */
export function isTargetMeleeStyle(t) {
    if (!t) return false;
    if (t._faction === 'player') {
        const eq = t.equipments && t.equipments[t.weaponMode];
        if (eq) return eq.category === 'weapon_melee' || eq.weaponType === 'sword';
        return true; // 徒手按近战计
    }
    if (t.weaponMode) return t.weaponMode === 'melee';
    return !!(t.attacks && t.attacks.melee);
}

/** 播放配置音效（enemy-config.json 该怪物 sounds 块驱动） */
export function playSoundFrom(host, key) {
    const path = host.config?.sounds?.[key];
    if (path && SoundManager && typeof SoundManager.playWorld === 'function') {
        // 世界音效（2026-08-11 距离衰减）：怪物音效按自身位置衰减，覆盖全部走此共享函数的怪物
        SoundManager.playWorld(path, host.x, host.y);
    } else if (path && SoundManager && typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path);
    }
}

/** 朝向判定（与 _getPhaserOptions 的 flipX 同规则） */
export function isFacingLeftFrom(host) {
    if (host.target && host.target.active) return host.target.x < host.x;
    if (host.isMoving && Math.abs(host.vx) > 0.1) return host.vx < 0;
    return Math.cos(host.rotation ?? 0) < 0;
}
