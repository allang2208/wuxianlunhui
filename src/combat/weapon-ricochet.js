import { DamagePipeline } from './damage-pipeline.js';
import { hasRangedLineOfSight } from './ranged-line-of-sight.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';

const RICOCHET_STATE = new WeakMap();

function getRicochetState(weapon) {
    if (!weapon || (typeof weapon !== 'object' && typeof weapon !== 'function')) return null;
    let state = RICOCHET_STATE.get(weapon);
    if (!state) {
        state = { anchorHits: new WeakMap() };
        RICOCHET_STATE.set(weapon, state);
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

function canRicochetTo(source, hitTarget, candidate) {
    if (!candidate || candidate === source || candidate === hitTarget) return false;
    if (!candidate.active || !candidate.hittable) return false;
    if (isFriendlyFire(source, candidate)) return false;
    const devFriendlyFire = typeof window !== 'undefined' && window.Game?._devFriendlyFire;
    if (!devFriendlyFire && source?._faction && candidate._faction
            && source._faction === candidate._faction) return false;
    return true;
}

function healthRatio(entity) {
    const hp = Number(entity?.hp ?? entity?.data?.hp);
    const maxHp = Number(entity?.maxHp ?? entity?.data?.maxHp);
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 1;
    return Math.max(0, hp / maxHp);
}

function orderedRicochetTargets(source, origin, entities, range, exclude, mode = 'nearest') {
    const candidates = [];
    for (const candidate of entityList(entities)) {
        if (!canRicochetTo(source, origin, candidate) || exclude?.has(candidate)) continue;
        const distance = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
        if (distance > range || !hasRangedLineOfSight(origin, candidate)) continue;
        candidates.push({ candidate, distance, health: healthRatio(candidate) });
    }
    candidates.sort((a, b) => mode === 'lowestHp'
        ? (a.health - b.health || a.distance - b.distance)
        : a.distance - b.distance);
    return candidates.map((entry) => entry.candidate);
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

function spawnRicochetArc(source, target, widthScale = 0.42) {
    EffectManager.add(new LightningBoltEffect(source, target, {
        durationMs: 90,
        fadeMs: 140,
        segments: 8,
        jitter: 0.08,
        widthScale,
        uniform: true,
        colors: {
            glowOuter: 0x00a9ff,
            glowInner: 0x54e6ff,
            core: 0xd4fbff,
            white: 0xffffff,
        },
    }));
}

function applyRicochetHit(source, weapon, projectile, from, target, baseDamage, multiplier, knockback) {
    spawnRicochetArc(from, target);
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

/**
 * 为带 ricochetParams 的枪械创建一次性弹射回调。
 * 主弹首次有效命中后按改造规则选择合法目标；所有追加伤害直接结算且严格限次，避免递归。
 */
export function createWeaponRicochetHandler(source, weapon, entities) {
    const params = weapon?.ricochetParams;
    if (!params) return null;
    return (hitTarget, projectile) => {
        if (!source || source.active === false || !hitTarget) return;
        const effects = weapon._craftEffects || {};
        const range = Math.max(80, (Number(params.range) || 400) + (Number(effects.ricochetRangeDelta) || 0));
        const damageMultiplier = Math.max(0.1,
            (Number(params.damageMultiplier) || 0.65) + (Number(effects.ricochetDamageMultiplierDelta) || 0));
        const extraTargets = Math.max(0, Math.round(Number(effects.ricochetExtraTargets) || 0));
        const targetMode = effects.ricochetTargetMode || 'nearest';
        const returnMultiplier = Math.max(0, Number(effects.ricochetReturnDamageMultiplier) || 0);
        const killChainCount = Math.max(0, Math.round(Number(effects.ricochetKillChainCount) || 0));
        const chainMultiplier = Math.max(0.1, Number(effects.ricochetChainDamageMultiplier) || 0.45);
        const splashRadius = Math.max(0, Number(effects.ricochetSplashRadius) || 0);
        const splashMultiplier = Math.max(0.1, Number(effects.ricochetSplashDamageMultiplier) || 0.25);
        const splashMaxTargets = Math.max(0, Math.round(Number(effects.ricochetSplashMaxTargets) || 0));
        const anchorHitsRequired = Math.max(0, Math.round(Number(effects.ricochetAnchorHitsRequired) || 0));
        const anchorDurationMs = Math.max(0, Number(effects.ricochetAnchorDurationMs) || 0);
        const knockback = Math.max(0, Number(params.knockback) || 0);
        const allEntities = entities || projectile?.entities;
        const targets = orderedRicochetTargets(source, hitTarget, allEntities, range, new Set([hitTarget]), targetMode)
            .slice(0, 1 + extraTargets);
        if (!targets.length) return;

        const baseDamage = rollProjectileDamage(projectile);
        const state = getRicochetState(weapon);
        for (const target of targets) {
            // 每条首段弹射都是独立分支，完整继承协议与增幅；分支内访问集只负责阻止回跳成环。
            const branchVisited = new Set([hitTarget, ...targets]);
            const result = applyRicochetHit(
                source, weapon, projectile, hitTarget, target,
                baseDamage, damageMultiplier, knockback
            );

            // 时滞锚定：按每个目标独立累计首段弹射命中，达到阈值后短暂束缚并清零。
            if (anchorHitsRequired > 0 && anchorDurationMs > 0 && state
                    && target.active !== false && Number(target.hp) > 0) {
                const hits = (state.anchorHits.get(target) || 0) + 1;
                if (hits >= anchorHitsRequired) {
                    state.anchorHits.set(target, 0);
                    target.addStatusEffect?.('bind', anchorDurationMs, {
                        name: '时滞锚定', icon: '◉', color: '#54e6ff',
                    });
                } else {
                    state.anchorHits.set(target, hits);
                }
            }

            // 星坍余震：每个首段弹射落点独立获得完整余震目标额度。
            if (splashRadius > 0 && splashMaxTargets > 0) {
                const splashTargets = orderedRicochetTargets(
                    source, target, allEntities, splashRadius, new Set([hitTarget, ...targets]), 'nearest'
                ).slice(0, splashMaxTargets);
                for (const splashTarget of splashTargets) {
                    applyRicochetHit(
                        source, weapon, projectile, target, splashTarget,
                        baseDamage, splashMultiplier, 0
                    );
                }
            }

            // 闭环回授：弹射落点向仍存活的首个命中目标折返一次；折返不再触发其他弹射规则。
            if (returnMultiplier > 0 && hitTarget.active !== false && Number(hitTarget.hp) > 0) {
                applyRicochetHit(
                    source, weapon, projectile, target, hitTarget,
                    baseDamage, returnMultiplier, 0
                );
            }

            // 断链收割：只有本次弹射确实击杀才继续，续跳始终按最近目标且次数严格受配件限制。
            let killChainBudget = killChainCount;
            let cursor = target;
            let killed = result.killed;
            while (killed && killChainBudget > 0) {
                const next = orderedRicochetTargets(source, cursor, allEntities, range, branchVisited, 'nearest')[0];
                if (!next) break;
                branchVisited.add(next);
                const chainResult = applyRicochetHit(
                    source, weapon, projectile, cursor, next,
                    baseDamage, chainMultiplier, 0
                );
                killChainBudget--;
                cursor = next;
                killed = chainResult.killed;
            }
        }
    };
}
