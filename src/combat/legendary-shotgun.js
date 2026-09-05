import { DamagePipeline } from './damage-pipeline.js';
import { hasRangedLineOfSight } from './ranged-line-of-sight.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';

const LEGENDARY_SHOTGUN_STATES = new WeakMap();

function getWeaponState(weapon) {
    if (!weapon || (typeof weapon !== 'object' && typeof weapon !== 'function')) return null;
    let state = LEGENDARY_SHOTGUN_STATES.get(weapon);
    if (!state) {
        state = {
            eclipseNextPhase: 'lunar',
            eclipseMarks: new WeakMap(),
            hunt: { target: null, hits: 0, lastHitAt: 0 },
        };
        LEGENDARY_SHOTGUN_STATES.set(weapon, state);
    }
    return state;
}

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

function spawnArc(from, target, colors, widthScale = 0.5, durationMs = 110) {
    if (!from || !target) return;
    EffectManager.add(new LightningBoltEffect(from, target, {
        durationMs,
        fadeMs: 180,
        segments: 8,
        jitter: 0.055,
        widthScale,
        uniform: true,
        colors,
    }));
}

const LUNAR_COLORS = {
    glowOuter: 0x233f72,
    glowInner: 0x6ebcff,
    core: 0xd8f4ff,
    white: 0xffffff,
};

const SOLAR_COLORS = {
    glowOuter: 0x7a2e00,
    glowInner: 0xff8a18,
    core: 0xffd65a,
    white: 0xfff7d6,
};

const HUNT_COLORS = {
    glowOuter: 0x48101b,
    glowInner: 0xc52c42,
    core: 0xffb24d,
    white: 0xfff0ce,
};

function applySecondaryHit(source, weapon, projectile, from, target, damage, knockback = 0) {
    if (!target || target.active === false) return { hit: false, killed: false };
    const angle = Math.atan2(target.y - from.y, target.x - from.x);
    return DamagePipeline.applyHit(source, target, {
        damage: Math.max(1, Math.round(damage)),
        damageType: projectile?.damageType || 'physical',
        currentWeapon: weapon,
        effectContext: { _hitContext: null },
        isMelee: false,
        knockback,
        angle,
    });
}

/** 黑日圣裁的月相/日相只随真实出弹推进；塔射击失败时由 rollback 恢复。 */
export function prepareLegendaryShotgunBlast(weapon) {
    if (!weapon?.eclipseVerdictParams) return null;
    const state = getWeaponState(weapon);
    const phase = state.eclipseNextPhase;
    state.eclipseNextPhase = phase === 'lunar' ? 'solar' : 'lunar';
    return { type: 'eclipse', phase, previousPhase: phase };
}

export function rollbackLegendaryShotgunBlast(weapon, blast) {
    if (!weapon || !blast || blast.type !== 'eclipse') return;
    const state = getWeaponState(weapon);
    if (state) state.eclipseNextPhase = blast.previousPhase || 'lunar';
}

function handleEclipseHit(source, weapon, entities, blastDamage, blast, hitTarget, projectile) {
    const params = weapon.eclipseVerdictParams;
    const state = getWeaponState(weapon);
    if (!params || !state || !blast || !hitTarget) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const markDurationMs = Math.max(500,
        (Number(params.markDurationMs) || 3000) + (Number(effects.eclipseMarkDurationDelta) || 0));

    if (blast.phase === 'lunar') {
        state.eclipseMarks.set(hitTarget, { expiresAt: now + markDurationMs });
        const slowDurationMs = Math.max(0,
            (Number(params.lunarSlowDurationMs) || 500) + (Number(effects.eclipseSlowDurationDelta) || 0));
        if (slowDurationMs > 0) {
            hitTarget.addStatusEffect?.('slow', slowDurationMs, {
                name: '月蚀迟滞', icon: '☾', color: '#6ebcff',
            });
        }
        const moon = { x: hitTarget.x, y: hitTarget.y - 95, active: true, bodyHeight: 0 };
        spawnArc(moon, hitTarget, LUNAR_COLORS, 0.28, 80);
        return;
    }

    const mark = state.eclipseMarks.get(hitTarget);
    if (!mark || now > mark.expiresAt) {
        if (mark) state.eclipseMarks.delete(hitTarget);
        return;
    }
    state.eclipseMarks.delete(hitTarget);
    const focusMultiplier = Math.max(0.1,
        (Number(params.focusDamageMultiplier) || 0.35)
            + (Number(effects.eclipseFocusDamageMultiplierDelta) || 0));
    const splashMultiplier = Math.max(0.1,
        (Number(params.splashDamageMultiplier) || 0.45)
            + (Number(effects.eclipseSplashDamageMultiplierDelta) || 0));
    const radius = Math.max(50,
        (Number(params.radius) || 170) + (Number(effects.eclipseRadiusDelta) || 0));
    const maxTargets = Math.max(0, Math.round(
        (Number(params.maxTargets) || 4) + (Number(effects.eclipseMaxTargetsDelta) || 0)));
    const knockback = Math.max(0, Number(params.knockback) || 0);
    const zenith = { x: hitTarget.x, y: hitTarget.y - 170, active: true, bodyHeight: 0 };
    spawnArc(zenith, hitTarget, SOLAR_COLORS, 0.82, 150);
    applySecondaryHit(
        source, weapon, projectile, zenith, hitTarget,
        (Number(blastDamage) || 0) * focusMultiplier, knockback
    );
    const targets = entityList(entities || projectile?.entities)
        .filter((target) => target !== hitTarget && isHostileTarget(source, target))
        .map((target) => ({ target, distance: Math.hypot(target.x - hitTarget.x, target.y - hitTarget.y) }))
        .filter((entry) => entry.distance <= radius && hasRangedLineOfSight(hitTarget, entry.target))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxTargets);
    for (const { target } of targets) {
        spawnArc(hitTarget, target, SOLAR_COLORS, 0.26, 85);
        applySecondaryHit(
            source, weapon, projectile, hitTarget, target,
            (Number(blastDamage) || 0) * splashMultiplier, 0
        );
    }
}

function targetHealth(target) {
    const hp = Number(target?.hp ?? target?.data?.hp);
    const maxHp = Number(target?.maxHp ?? target?.data?.maxHp);
    return {
        hp: Number.isFinite(hp) ? Math.max(0, hp) : 0,
        maxHp: Number.isFinite(maxHp) ? Math.max(0, maxHp) : 0,
    };
}

function handleRoyalHuntHit(source, weapon, blastDamage, hitTarget, projectile) {
    const params = weapon.royalHuntParams;
    const state = getWeaponState(weapon)?.hunt;
    if (!params || !state || !hitTarget) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const resetMs = Math.max(500,
        (Number(params.resetMs) || 2200) + (Number(effects.huntResetTimeDelta) || 0));
    const requiredHits = Math.max(2, Math.round(
        (Number(params.requiredHits) || 3) + (Number(effects.huntRequiredHitsDelta) || 0)));
    if (state.target !== hitTarget || now - state.lastHitAt > resetMs || state.target?.active === false) {
        state.target = hitTarget;
        state.hits = 0;
    }
    state.lastHitAt = now;
    state.hits += 1;
    if (state.hits < requiredHits) return;
    state.target = null;
    state.hits = 0;
    if (hitTarget.active === false) return;

    const finisherMultiplier = Math.max(0.1,
        (Number(params.finisherDamageMultiplier) || 0.65)
            + (Number(effects.huntFinisherDamageMultiplierDelta) || 0));
    const missingHealthMultiplier = Math.max(0,
        (Number(params.missingHealthMultiplier) || 0.1)
            + (Number(effects.huntMissingHealthMultiplierDelta) || 0));
    const missingHealthCapMultiplier = Math.max(0,
        (Number(params.missingHealthCapMultiplier) || 0.35)
            + (Number(effects.huntMissingHealthCapMultiplierDelta) || 0));
    const { hp, maxHp } = targetHealth(hitTarget);
    const missingDamage = Math.min(
        Math.max(0, maxHp - hp) * missingHealthMultiplier,
        (Number(blastDamage) || 0) * missingHealthCapMultiplier
    );
    const crown = { x: hitTarget.x, y: hitTarget.y - 145, active: true, bodyHeight: 0 };
    spawnArc(crown, hitTarget, HUNT_COLORS, 0.9, 155);
    const result = applySecondaryHit(
        source, weapon, projectile, crown, hitTarget,
        (Number(blastDamage) || 0) * finisherMultiplier + missingDamage,
        Math.max(0, (Number(params.knockback) || 8) + (Number(effects.huntKnockbackDelta) || 0))
    );
    const bindDurationMs = Math.max(0,
        (Number(params.bindDurationMs) || 400) + (Number(effects.huntBindDurationDelta) || 0));
    if (result.hit && !result.killed && !hitTarget.shieldSystem?._lastParried && bindDurationMs > 0) {
        hitTarget.addStatusEffect?.('bind', bindDurationMs, {
            name: '王猎锁定', icon: '♛', color: '#c52c42',
        });
    }
}

/** 每次弹群共享同一闭包，确保多 pellet 只推进一次蚀相或猎印。 */
export function createLegendaryShotgunHitHandler(source, weapon, entities, blastDamage, blast) {
    if (!weapon?.eclipseVerdictParams && !weapon?.royalHuntParams) return null;
    let triggered = false;
    return (hitTarget, projectile) => {
        if (triggered || !source || source.active === false || !hitTarget || hitTarget.shieldSystem?._lastParried) return;
        triggered = true;
        if (weapon.eclipseVerdictParams) {
            handleEclipseHit(source, weapon, entities, blastDamage, blast, hitTarget, projectile);
        } else if (weapon.royalHuntParams) {
            handleRoyalHuntHit(source, weapon, blastDamage, hitTarget, projectile);
        }
    };
}
