import { DamagePipeline } from './damage-pipeline.js';
import { hasRangedLineOfSight } from './ranged-line-of-sight.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';

const TERMINUS_STATES = new WeakMap();

function entityList(entities) {
    if (!entities) return [];
    if (entities instanceof Map) return Array.from(entities.values());
    if (Array.isArray(entities)) return entities;
    if (typeof entities.values === 'function') return Array.from(entities.values());
    return [];
}

function isHostileTarget(source, target) {
    if (!target || target === source || !target.active || !target.hittable) return false;
    if (isFriendlyFire(source, target)) return false;
    const devFriendlyFire = typeof window !== 'undefined' && window.Game?._devFriendlyFire;
    if (!devFriendlyFire && source?._faction && target._faction
            && source._faction === target._faction) return false;
    return true;
}

/** 每次实际扣除一发弹壳后推进一次终钟节拍；玩家和防御塔共用武器实例态。 */
export function prepareMythicShotgunBlast(weapon) {
    const params = weapon?.terminusVolleyParams;
    if (!params) return null;
    const effects = weapon._craftEffects || {};
    const cycleShots = Math.max(2, Math.round(
        (Number(params.cycleShots) || 4) + (Number(effects.terminusCycleShotsDelta) || 0)
    ));
    let state = TERMINUS_STATES.get(weapon);
    if (!state) {
        state = { shot: 0 };
        TERMINUS_STATES.set(weapon, state);
    }
    const previousShot = state.shot;
    state.shot = state.shot % cycleShots + 1;
    const charged = state.shot === cycleShots;
    return {
        charged,
        shot: state.shot,
        previousShot,
        cycleShots,
        damageMultiplier: charged ? Math.max(1,
            (Number(params.damageMultiplier) || 1.45)
            + (Number(effects.terminusDamageMultiplierDelta) || 0)) : 1,
        spreadMultiplier: charged ? Math.max(0.2, Math.min(1,
            (Number(params.spreadMultiplier) || 0.45)
            + (Number(effects.terminusSpreadMultiplierDelta) || 0))) : 1,
        piercingBonus: charged ? Math.max(0, Math.round(
            (Number(params.piercingBonus) || 0)
            + (Number(effects.terminusPiercingBonus) || 0))) : 0,
        knockbackDelta: charged
            ? (Number(params.knockbackDelta) || 0) + (Number(effects.terminusKnockbackDelta) || 0)
            : 0,
    };
}

export function rollbackMythicShotgunBlast(weapon, blast) {
    if (!weapon || !blast || !weapon.terminusVolleyParams) return;
    const state = TERMINUS_STATES.get(weapon);
    if (state) state.shot = Math.max(0, Number(blast.previousShot) || 0);
}

function spawnRiftArc(from, target) {
    EffectManager.add(new LightningBoltEffect(from, target, {
        durationMs: 110,
        fadeMs: 180,
        segments: 9,
        jitter: 0.1,
        widthScale: 0.5,
        uniform: true,
        colors: {
            glowOuter: 0x4a35aa,
            glowInner: 0x7b61ff,
            core: 0x4de8ff,
            white: 0xe8fbff,
        },
    }));
}

/**
 * 虚空葬潮一次击发只在首个有效命中撕开一次裂隙；追加伤害直达统一伤害管道，
 * 不挂回投射物命中回调，避免多 pellet 递归重复触发。
 */
export function createVoidFuneralHitHandler(source, weapon, entities, blastDamage) {
    const params = weapon?.voidFuneralParams;
    if (!params) return null;
    let triggered = false;
    return (hitTarget, projectile) => {
        if (triggered || !source || source.active === false || !hitTarget) return;
        triggered = true;
        const effects = weapon._craftEffects || {};
        const range = Math.max(80,
            (Number(params.range) || 240) + (Number(effects.voidFuneralRangeDelta) || 0));
        const damageMultiplier = Math.max(0.05,
            (Number(params.damageMultiplier) || 0.3)
            + (Number(effects.voidFuneralDamageMultiplierDelta) || 0));
        const maxTargets = Math.max(1, Math.round(
            (Number(params.maxTargets) || 3) + (Number(effects.voidFuneralMaxTargetsDelta) || 0)
        ));
        const bindDurationMs = Math.max(0,
            (Number(params.bindDurationMs) || 500)
            + (Number(effects.voidFuneralBindDurationDelta) || 0));
        const knockback = Math.max(0, Number(params.knockback) || 0);
        const candidates = entityList(entities || projectile?.entities)
            .filter((target) => target !== hitTarget && isHostileTarget(source, target))
            .map((target) => ({ target, distance: Math.hypot(target.x - hitTarget.x, target.y - hitTarget.y) }))
            .filter((entry) => entry.distance <= range && hasRangedLineOfSight(hitTarget, entry.target))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, maxTargets);
        const echoDamage = Math.max(1, Math.round((Number(blastDamage) || 0) * damageMultiplier));
        for (const { target } of candidates) {
            spawnRiftArc(hitTarget, target);
            const angle = Math.atan2(target.y - hitTarget.y, target.x - hitTarget.x);
            const result = DamagePipeline.applyHit(source, target, {
                damage: echoDamage,
                damageType: projectile?.damageType || 'physical',
                currentWeapon: weapon,
                effectContext: { _hitContext: null },
                isMelee: false,
                knockback,
                angle,
            });
            if (result.hit && !result.killed && bindDurationMs > 0) {
                target.addStatusEffect?.('bind', bindDurationMs, {
                    name: '葬潮束缚', icon: '◈', color: '#7b61ff',
                });
            }
        }
    };
}
