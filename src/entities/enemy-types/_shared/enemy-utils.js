import { SoundManager } from '../../../ui/sound-manager.js';

/**
 * 怪物共享工具（新怪物工作流基础件，勿在各怪物类内重复实现）
 *
 * - hostilesOf：敌对目标枚举（同阵营/无效/不可击除外）
 * - isTargetMeleeStyle：目标攻击风格判定（近战/远程，决定怪物的应对策略）
 * - playSoundFrom：按配置 sounds 键播放音效
 * - isFacingLeftFrom：朝向判定（与 _getPhaserOptions 的 flipX 同规则）
 */

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
    if (path && SoundManager && typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path);
    }
}

/** 朝向判定（与 _getPhaserOptions 的 flipX 同规则） */
export function isFacingLeftFrom(host) {
    if (host.target && host.target.active) return host.target.x < host.x;
    if (host.isMoving && Math.abs(host.vx) > 0.1) return host.vx < 0;
    return Math.cos(host.rotation ?? 0) < 0;
}
