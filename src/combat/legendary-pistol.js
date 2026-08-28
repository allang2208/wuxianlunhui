import { DamagePipeline } from './damage-pipeline.js';
import { hasRangedLineOfSight } from './ranged-line-of-sight.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';

const LEGENDARY_PISTOL_STATES = new WeakMap();

const SETTLEMENT_COLORS = {
    glowOuter: 0x451018,
    glowInner: 0xc62e3f,
    core: 0xe5a13a,
    white: 0xffe6b0,
};

const CORRIDOR_COLORS = {
    glowOuter: 0x183d68,
    glowInner: 0x24bad1,
    core: 0x8cecff,
    white: 0xf3ffff,
};

function getWeaponState(weapon) {
    if (!weapon || (typeof weapon !== 'object' && typeof weapon !== 'function')) return null;
    let state = LEGENDARY_PISTOL_STATES.get(weapon);
    if (!state) {
        state = {
            settlement: { target: null, hits: 0, lastHitAt: 0 },
            corridor: { targets: [], lastHitAt: 0 },
        };
        LEGENDARY_PISTOL_STATES.set(weapon, state);
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
    if (!target || target === source || target.active === false || target.hittable === false) return false;
    if (isFriendlyFire(source, target)) return false;
    const devFriendlyFire = typeof window !== 'undefined' && window.Game?._devFriendlyFire;
    return !!devFriendlyFire || !source?._faction || !target._faction
        || source._faction !== target._faction;
}

function projectileBaseDamage(projectile, confirmedDamage = null) {
    const applied = Number(confirmedDamage);
    if (Number.isFinite(applied)) return Math.max(0, applied);
    const damage = projectile?.damage;
    if (typeof damage === 'number') return Math.max(0, damage);
    if (!damage || typeof damage !== 'object') return 0;
    const min = Number(damage.min);
    const max = Number(damage.max);
    if (Number.isFinite(min) && Number.isFinite(max)) return Math.max(0, (min + max) * 0.5);
    return Math.max(0, Number.isFinite(min) ? min : (Number.isFinite(max) ? max : 0));
}

function spawnArc(from, target, colors, widthScale = 0.45, durationMs = 110) {
    if (!from || !target) return;
    EffectManager.add(new LightningBoltEffect(from, target, {
        durationMs,
        fadeMs: 170,
        segments: 8,
        jitter: 0.05,
        widthScale,
        uniform: true,
        colors,
    }));
}

function applySecondaryHit(source, weapon, projectile, from, target, damage, knockback = 0) {
    if (!target || target.active === false || (Number.isFinite(Number(target.hp)) && Number(target.hp) <= 0) || damage <= 0) {
        return { hit: false, killed: false };
    }
    const angle = Math.atan2(target.y - from.y, target.x - from.x);
    return DamagePipeline.applyHit(source, target, {
        damage: Math.max(1, Math.round(damage)),
        damageType: projectile?.damageType || 'ranged',
        currentWeapon: weapon,
        effectContext: { _hitContext: null },
        isMelee: false,
        knockback,
        angle,
    });
}

function targetHealthRatio(target) {
    const hp = Number(target?.hp ?? target?.data?.hp);
    const maxHp = Number(target?.maxHp ?? target?.data?.maxHp);
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 1;
    return Math.max(0, hp) / maxHp;
}

function handleSettlementHit(source, weapon, entities, hitTarget, projectile, confirmedDamage) {
    const params = weapon.bloodDebtParams;
    const state = getWeaponState(weapon)?.settlement;
    if (!params || !state || !hitTarget || hitTarget.shieldSystem?._lastParried) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const resetMs = Math.max(500,
        (Number(params.resetMs) || 1800) + (Number(effects.settlementResetMsDelta) || 0));
    const requiredHits = Math.max(2, Math.round(
        (Number(params.requiredHits) || 3) + (Number(effects.settlementHitsRequiredDelta) || 0)));

    if (state.target !== hitTarget || now - state.lastHitAt > resetMs || state.target?.active === false) {
        state.target = hitTarget;
        state.hits = 0;
    }
    state.lastHitAt = now;
    state.hits += 1;
    if (state.hits < requiredHits) return;
    state.target = null;
    state.hits = 0;
    if (hitTarget.active === false || (Number.isFinite(Number(hitTarget.hp)) && Number(hitTarget.hp) <= 0)) return;

    let multiplier = Math.max(0.05,
        (Number(params.damageMultiplier) || 0.75)
            + (Number(effects.settlementDamageMultiplierDelta) || 0));
    const lowHealthThreshold = Math.max(0, Math.min(1,
        Number(effects.settlementLowHealthThreshold) || 0));
    if (lowHealthThreshold > 0 && targetHealthRatio(hitTarget) <= lowHealthThreshold) {
        multiplier += Math.max(0, Number(effects.settlementLowHealthMultiplierDelta) || 0);
    }
    const baseDamage = projectileBaseDamage(projectile, confirmedDamage);
    const zenith = { x: hitTarget.x, y: hitTarget.y - 150, active: true, bodyHeight: 0 };
    spawnArc(zenith, hitTarget, SETTLEMENT_COLORS, 0.82, 145);
    applySecondaryHit(source, weapon, projectile, zenith, hitTarget, baseDamage * multiplier, 0);

    const splashRadius = Math.max(0, Number(effects.settlementSplashRadius) || 0);
    const splashMultiplier = Math.max(0, Number(effects.settlementSplashMultiplier) || 0);
    const splashMaxTargets = Math.max(0, Math.round(Number(effects.settlementSplashMaxTargets) || 0));
    if (splashRadius <= 0 || splashMultiplier <= 0 || splashMaxTargets <= 0) return;
    const splashTargets = entityList(entities || projectile?.entities)
        .filter((target) => target !== hitTarget && isHostileTarget(source, target))
        .map((target) => ({ target, distance: Math.hypot(target.x - hitTarget.x, target.y - hitTarget.y) }))
        .filter((entry) => entry.distance <= splashRadius
            && hasRangedLineOfSight(hitTarget, entry.target))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, splashMaxTargets);
    for (const { target } of splashTargets) {
        spawnArc(hitTarget, target, SETTLEMENT_COLORS, 0.24, 80);
        applySecondaryHit(source, weapon, projectile, hitTarget, target, baseDamage * splashMultiplier, 0);
    }
}

function handleCorridorHit(source, weapon, entities, hitTarget, projectile, confirmedDamage) {
    const params = weapon.corridorParams;
    const state = getWeaponState(weapon)?.corridor;
    if (!params || !state || !hitTarget || hitTarget.shieldSystem?._lastParried) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const resetMs = Math.max(700,
        (Number(params.resetMs) || 2400) + (Number(effects.corridorResetMsDelta) || 0));
    if (now - state.lastHitAt > resetMs) state.targets.length = 0;
    state.lastHitAt = now;
    if (!state.targets.includes(hitTarget)) state.targets.push(hitTarget);

    const requiredTargets = Math.max(2, Math.round(
        (Number(params.requiredTargets) || 3)
            + (Number(effects.corridorTargetsRequiredDelta) || 0)));
    if (state.targets.length < requiredTargets) return;
    const markedTargets = state.targets.slice(0, requiredTargets);
    state.targets.length = 0;

    const baseDamage = projectileBaseDamage(projectile, confirmedDamage);
    const lastTarget = markedTargets[markedTargets.length - 1];
    const focusLastTarget = !!effects.corridorFocusLastTarget;
    const echoMultiplier = focusLastTarget
        ? Math.max(0.05, Number(effects.corridorFocusMultiplier) || 0.9)
        : Math.max(0.05,
            (Number(params.echoMultiplier) || 0.25)
                + (Number(effects.corridorEchoMultiplierDelta) || 0));
    const echoTargets = focusLastTarget ? [lastTarget] : markedTargets;
    let previous = { x: source.x, y: source.y, active: true, bodyHeight: source.bodyHeight || 0 };
    for (const target of echoTargets) {
        if (target?.active === false || (Number.isFinite(Number(target?.hp)) && Number(target.hp) <= 0)) continue;
        spawnArc(previous, target, CORRIDOR_COLORS, focusLastTarget ? 0.72 : 0.38, 110);
        applySecondaryHit(source, weapon, projectile, previous, target, baseDamage * echoMultiplier, 0);
        previous = target;
    }

    const scatterCount = Math.max(0, Math.round(Number(effects.corridorScatterExtraTargets) || 0));
    const scatterRange = Math.max(0, Number(effects.corridorScatterRange) || 0);
    const scatterMultiplier = Math.max(0, Number(effects.corridorScatterMultiplier) || 0);
    if (scatterCount <= 0 || scatterRange <= 0 || scatterMultiplier <= 0 || lastTarget?.active === false) return;
    const unmarkedTargets = entityList(entities || projectile?.entities)
        .filter((target) => !markedTargets.includes(target) && isHostileTarget(source, target))
        .map((target) => ({ target, distance: Math.hypot(target.x - lastTarget.x, target.y - lastTarget.y) }))
        .filter((entry) => entry.distance <= scatterRange
            && hasRangedLineOfSight(lastTarget, entry.target))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, scatterCount);
    for (const { target } of unmarkedTargets) {
        spawnArc(lastTarget, target, CORRIDOR_COLORS, 0.25, 85);
        applySecondaryHit(source, weapon, projectile, lastTarget, target, baseDamage * scatterMultiplier, 0);
    }
}

/** 传说手枪只在玩家真实投射物首次、未被盾牌弹反的命中后推进专属状态。 */
export function createLegendaryPistolHitHandler(source, weapon, entities) {
    if (!weapon?.bloodDebtParams && !weapon?.corridorParams) return null;
    return (hitTarget, projectile, confirmedDamage) => {
        if (!source || source.active === false || !hitTarget) return;
        if (weapon.bloodDebtParams) {
            handleSettlementHit(source, weapon, entities, hitTarget, projectile, confirmedDamage);
        } else if (weapon.corridorParams) {
            handleCorridorHit(source, weapon, entities, hitTarget, projectile, confirmedDamage);
        }
    };
}
