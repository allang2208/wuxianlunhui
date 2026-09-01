import { StatusBar } from '../ui/status-bar.js';

const TYPE = 'waxSealSlow';

/** 封蜡独立于通用致残；重复命中只刷新同一状态，不改写角色基础速度。 */
export function applyWaxSealSlow(target, durationMs, reduction) {
    if (!target?.active || target._isDead || target.hp <= 0) return;
    const effect = target.addStatusEffect?.(TYPE, durationMs, {
        name: '封蜡减速', icon: '🕯️', color: '#ba9272',
        value: Math.max(0, Math.min(0.9, reduction)),
    });
    if (effect && target._faction === 'player') {
        StatusBar.addEffect(TYPE, effect.remaining);
    }
}

/** 玩家与友军 AI 共用数值；到期/净化后立即回到 1，不叠加多个蜡印。 */
export function waxSealSpeedMultiplier(entity) {
    const effect = entity.statusEffects?.find(e => e.type === TYPE && e.remaining > 0);
    return effect ? 1 - Math.max(0, Math.min(0.9, Number(effect.value) || 0)) : 1;
}
