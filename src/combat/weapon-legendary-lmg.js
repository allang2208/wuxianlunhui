import { DamagePipeline } from './damage-pipeline.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';

const LEGENDARY_LMG_STATE = new WeakMap();
const FULL_RUNE_MASK = 0b111;

function configuredSlowReduction(value, fallback = 0.5) {
    if (value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(0.9, number)) : fallback;
}

function getWeaponState(weapon) {
    if (!weapon || (typeof weapon !== 'object' && typeof weapon !== 'function')) return null;
    let state = LEGENDARY_LMG_STATE.get(weapon);
    if (!state) {
        state = {
            constellation: { hits: 0, lastHitAt: 0, anchor: null },
            litany: { runeIndex: -1, marks: new WeakMap() },
        };
        LEGENDARY_LMG_STATE.set(weapon, state);
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

function canReceiveSecondaryHit(source, candidate) {
    if (!candidate || candidate === source || !candidate.active || !candidate.hittable) return false;
    if (isFriendlyFire(source, candidate)) return false;
    const devFriendlyFire = typeof window !== 'undefined' && window.Game?._devFriendlyFire;
    if (!devFriendlyFire && source?._faction && candidate._faction
            && source._faction === candidate._faction) return false;
    return true;
}

function rollProjectileDamage(projectile) {
    const damage = projectile?.damage;
    if (damage && typeof damage === 'object') {
        const min = Number(damage.min) || 0;
        const max = Number(damage.max) || min;
        return Math.floor(min + Math.random() * (Math.max(min, max) - min + 1));
    }
    return Number(damage) || 0;
}

function applySecondaryHit(source, weapon, projectile, from, target, baseDamage, multiplier, knockback = 0) {
    if (!target || target.active === false) return { hit: false, killed: false };
    const angle = Math.atan2(target.y - from.y, target.x - from.x);
    return DamagePipeline.applyHit(source, target, {
        damage: Math.max(1, Math.round(baseDamage * multiplier)),
        damageType: projectile?.damageType || 'physical',
        currentWeapon: weapon,
        effectContext: { _hitContext: null },
        isMelee: false,
        knockback,
        angle,
    });
}

function spawnArc(from, to, colors, widthScale = 0.5, durationMs = 120) {
    if (!from || !to) return;
    EffectManager.add(new LightningBoltEffect(from, to, {
        durationMs,
        fadeMs: 180,
        segments: 6,
        jitter: 0.035,
        widthScale,
        uniform: true,
        colors,
    }));
}

const CONSTELLATION_COLORS = {
    glowOuter: 0x325dff,
    glowInner: 0x65d8ff,
    core: 0xffdd82,
    white: 0xffffff,
};

const LITANY_COLORS = {
    glowOuter: 0x541017,
    glowInner: 0xc73b2a,
    core: 0xffa23d,
    white: 0xfff1c7,
};

function segmentDistance(candidate, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-6) return { distance: Math.hypot(candidate.x - start.x, candidate.y - start.y), t: 0 };
    const t = Math.max(0, Math.min(1,
        ((candidate.x - start.x) * dx + (candidate.y - start.y) * dy) / lenSq));
    const px = start.x + dx * t;
    const py = start.y + dy * t;
    return { distance: Math.hypot(candidate.x - px, candidate.y - py), t };
}

function resolveConstellation(source, weapon, projectile, entities, anchor, terminal, baseDamage, params, effects) {
    const power = Math.max(0.1, 1 + (Number(effects.constellationPowerMultiplierDelta) || 0));
    const allEntities = entityList(entities || projectile?.entities);
    if (anchor === terminal) {
        const strikeMultiplier = Math.max(0.1,
            (Number(params.focusDamageMultiplier) || 1.05) * power);
        const splashRadius = Math.max(30,
            (Number(params.focusSplashRadius) || 110) + (Number(effects.constellationFocusRadiusDelta) || 0));
        const splashMultiplier = Math.max(0.1,
            (Number(params.focusSplashMultiplier) || 0.35) * power);
        const splashMaxTargets = Math.max(0, Math.round(
            (Number(params.focusSplashMaxTargets) || 4) + (Number(effects.constellationFocusMaxTargetsDelta) || 0)));
        const zenith = { x: terminal.x, y: terminal.y - 180, active: true, bodyHeight: 0 };
        spawnArc(zenith, terminal, CONSTELLATION_COLORS, 0.8, 160);
        applySecondaryHit(source, weapon, projectile, zenith, terminal, baseDamage, strikeMultiplier,
            Number(params.knockback) || 0);
        const splashTargets = allEntities
            .filter((candidate) => candidate !== terminal && canReceiveSecondaryHit(source, candidate))
            .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - terminal.x, candidate.y - terminal.y) }))
            .filter((entry) => entry.distance <= splashRadius)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, splashMaxTargets);
        for (const { candidate } of splashTargets) {
            spawnArc(terminal, candidate, CONSTELLATION_COLORS, 0.28, 90);
            applySecondaryHit(source, weapon, projectile, terminal, candidate, baseDamage, splashMultiplier, 0);
        }
        return [terminal, ...splashTargets.map((entry) => entry.candidate)];
    }

    const width = Math.max(18,
        (Number(params.lineWidth) || 58) + (Number(effects.constellationLineWidthDelta) || 0));
    const maxTargets = Math.max(1, Math.round(
        (Number(params.lineMaxTargets) || 6) + (Number(effects.constellationLineMaxTargetsDelta) || 0)));
    const multiplier = Math.max(0.1,
        ((Number(params.lineDamageMultiplier) || 0.6)
            + (Number(effects.constellationLineDamageMultiplierDelta) || 0)) * power);
    spawnArc(anchor, terminal, CONSTELLATION_COLORS, Math.max(0.42, width / 90), 150);
    const crossed = allEntities
        .filter((candidate) => canReceiveSecondaryHit(source, candidate))
        .map((candidate) => ({ candidate, ...segmentDistance(candidate, anchor, terminal) }))
        .filter((entry) => entry.distance <= width)
        .sort((a, b) => a.t - b.t || a.distance - b.distance)
        .slice(0, maxTargets);
    for (const { candidate } of crossed) {
        applySecondaryHit(source, weapon, projectile, anchor, candidate, baseDamage, multiplier,
            Number(params.knockback) || 0);
    }
    return crossed.map((entry) => entry.candidate);
}

function handleConstellationHit(source, weapon, hitTarget, projectile, entities) {
    const params = weapon?.constellationParams;
    const state = getWeaponState(weapon)?.constellation;
    if (!params || !state || !hitTarget) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const resetMs = Math.max(150, Number(params.resetMs) || 700);
    const anchorHit = Math.max(2, Math.round(
        (Number(params.anchorHit) || 4) + (Number(effects.constellationAnchorHitDelta) || 0)));
    const resolveHit = Math.max(anchorHit + 1, Math.round(
        (Number(params.resolveHit) || 8) + (Number(effects.constellationResolveHitDelta) || 0)));
    // 主弹伤害先于首次命中回调结算；第 resolveHit 发恰好击杀锚点时仍应完成本轮天顶解析。
    const resolvingKilledAnchor = state.hits + 1 >= resolveHit
        && state.anchor === hitTarget
        && state.anchor?.active === false;
    if (now - state.lastHitAt > resetMs
            || (state.anchor && state.anchor.active === false && !resolvingKilledAnchor)) {
        state.hits = 0;
        state.anchor = null;
    }
    state.lastHitAt = now;
    state.hits += 1;

    if (state.hits === anchorHit) {
        state.anchor = hitTarget;
        const crown = { x: hitTarget.x, y: hitTarget.y - 80, active: true, bodyHeight: 0 };
        spawnArc(crown, hitTarget, CONSTELLATION_COLORS, 0.3, 80);
        return;
    }
    if (state.hits < resolveHit) return;

    const anchor = state.anchor?.active === false && state.anchor !== hitTarget ? null : state.anchor;
    if (anchor) {
        const affected = resolveConstellation(
            source, weapon, projectile, entities, anchor, hitTarget,
            rollProjectileDamage(projectile), params, effects
        );
        const slowDurationMs = Math.max(0, Number(effects.constellationSlowDurationMs) || 0);
        if (slowDurationMs > 0) {
            for (const target of affected) {
                target?.addStatusEffect?.('slow', slowDurationMs, {
                    name: '星图迟滞', icon: '✦', color: '#65d8ff',
                    value: configuredSlowReduction(params.slowReduction),
                });
            }
        }
    }
    state.hits = Math.max(0, Math.round(Number(effects.constellationCarryHits) || 0));
    state.anchor = null;
}

function getRuneMark(state, target, now, durationMs) {
    let mark = state.marks.get(target);
    if (!mark || now > mark.expiresAt) mark = { mask: 0, expiresAt: 0 };
    mark.expiresAt = now + durationMs;
    state.marks.set(target, mark);
    return mark;
}

function runeBits(mask) {
    const bits = [];
    for (const bit of [1, 2, 4]) if ((mask & bit) !== 0) bits.push(bit);
    return bits;
}

function orderedNearbyTargets(source, origin, entities, range, exclude = null) {
    return entityList(entities)
        .filter((candidate) => candidate !== exclude && canReceiveSecondaryHit(source, candidate))
        .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - origin.x, candidate.y - origin.y) }))
        .filter((entry) => entry.distance <= range)
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.candidate);
}

function resolveRuneVerdict(source, weapon, projectile, origin, entities, baseDamage, params, effects, seedRuneBit) {
    const radius = Math.max(40,
        (Number(params.verdictRadius) || 130) + (Number(effects.runeVerdictRadiusDelta) || 0));
    const maxTargets = Math.max(1, Math.round(
        (Number(params.verdictMaxTargets) || 5) + (Number(effects.runeVerdictMaxTargetsDelta) || 0)));
    const multiplier = Math.max(0.1,
        (Number(params.verdictDamageMultiplier) || 0.75)
            + (Number(effects.runeVerdictDamageMultiplierDelta) || 0));
    const zenith = { x: origin.x, y: origin.y - 150, active: true, bodyHeight: 0 };
    spawnArc(zenith, origin, LITANY_COLORS, 0.85, 150);
    const targets = orderedNearbyTargets(source, origin, entities || projectile?.entities, radius)
        .slice(0, maxTargets);
    const survivors = [];
    for (const target of targets) {
        spawnArc(origin, target, LITANY_COLORS, 0.26, 80);
        const result = applySecondaryHit(source, weapon, projectile, origin, target, baseDamage, multiplier,
            Number(params.knockback) || 0);
        if (result.hit && !result.killed && target.active !== false) survivors.push(target);
    }

    if (effects.runeVerdictSeedMarks && seedRuneBit) {
        const state = getWeaponState(weapon)?.litany;
        const durationMs = Math.max(500,
            (Number(params.markDurationMs) || 5000) + (Number(effects.runeMemoryDurationDelta) || 0));
        const now = Date.now();
        for (const target of survivors) {
            const mark = getRuneMark(state, target, now, durationMs);
            mark.mask |= seedRuneBit;
        }
    }
}

function migrateRunes(source, weapon, projectile, origin, entities, mask, params, effects, baseDamage) {
    const maxTargets = Math.max(0, Math.round(Number(effects.runeInheritanceTargets) || 0));
    if (maxTargets <= 0 || mask === 0) return;
    const range = Math.max(80,
        (Number(params.inheritanceRange) || 360) + (Number(effects.runeInheritanceRangeDelta) || 0));
    const targets = orderedNearbyTargets(source, origin, entities || projectile?.entities, range, origin)
        .slice(0, maxTargets);
    if (!targets.length) return;
    const state = getWeaponState(weapon)?.litany;
    const durationMs = Math.max(500,
        (Number(params.markDurationMs) || 5000) + (Number(effects.runeMemoryDurationDelta) || 0));
    const now = Date.now();
    const bits = runeBits(mask);
    for (let i = 0; i < bits.length; i++) {
        const target = targets[i % targets.length];
        spawnArc(origin, target, LITANY_COLORS, 0.22, 80);
        const mark = getRuneMark(state, target, now, durationMs);
        mark.mask |= bits[i];
        if (mark.mask === FULL_RUNE_MASK) {
            state.marks.delete(target);
            // 迁移可完成一次裁决；裁决伤害不会刻印，也不会再次触发迁移。
            resolveRuneVerdict(source, weapon, projectile, target, entities, baseDamage, params, effects, bits[i]);
        }
    }
}

function handleRuneLitanyHit(source, weapon, hitTarget, projectile, entities) {
    const params = weapon?.runeLitanyParams;
    const state = getWeaponState(weapon)?.litany;
    if (!params || !state || !hitTarget) return;
    const effects = weapon._craftEffects || {};
    const now = Date.now();
    const durationMs = Math.max(500,
        (Number(params.markDurationMs) || 5000) + (Number(effects.runeMemoryDurationDelta) || 0));
    const marksPerHit = Math.max(1, Math.min(3, Math.round(Number(effects.runeMarksPerHit) || 1)));
    let appliedMask = 0;
    for (let i = 0; i < marksPerHit; i++) {
        state.runeIndex = (state.runeIndex + 1) % 3;
        appliedMask |= (1 << state.runeIndex);
    }
    const mark = getRuneMark(state, hitTarget, now, durationMs);
    mark.mask |= appliedMask;
    const baseDamage = rollProjectileDamage(projectile);

    if (mark.mask === FULL_RUNE_MASK) {
        state.marks.delete(hitTarget);
        resolveRuneVerdict(
            source, weapon, projectile, hitTarget, entities,
            baseDamage, params, effects, 1 << state.runeIndex
        );
        return;
    }
    if (hitTarget.active === false || Number(hitTarget.hp) <= 0) {
        state.marks.delete(hitTarget);
        migrateRunes(source, weapon, projectile, hitTarget, entities, mark.mask, params, effects, baseDamage);
    }
}

/**
 * 传说轻机枪的共享命中入口。玩家与防御塔都只挂这一个回调；所有追加结算均直达
 * DamagePipeline，不再进入本回调，因此跨组改造可以完整组合而不会形成递归伤害环。
 */
export function createLegendaryLmgHitHandler(source, weapon, entities) {
    if (weapon?.constellationParams) {
        return (hitTarget, projectile) => handleConstellationHit(source, weapon, hitTarget, projectile, entities);
    }
    if (weapon?.runeLitanyParams) {
        return (hitTarget, projectile) => handleRuneLitanyHit(source, weapon, hitTarget, projectile, entities);
    }
    return null;
}
