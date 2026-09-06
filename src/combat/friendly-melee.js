import { isFriendlyAttackTarget } from './friendly-projectile-sweep.js';
import { createBasicMeleeSnapshot, canImpactBasicMelee } from './melee-attack-resolver.js';

function snapshot(unit, target, range) {
    return createBasicMeleeSnapshot(unit, target, {
        range, width: unit.aiConfig?.meleeWidth ?? 44,
    });
}

export function canStartFriendlyMelee(unit, target, range) {
    return isFriendlyAttackTarget(target)
        && canImpactBasicMelee(unit, target, snapshot(unit, target, range));
}

export function lockFriendlyMelee(ai, target, impactRange = ai.cfg.attackImpactRange ?? ai._attackRange) {
    ai._meleeTarget = target;
    ai._meleeSnapshot = snapshot(ai.m, target, impactRange);
}

export function canHitFriendlyMelee(ai, target = ai._meleeTarget) {
    return isFriendlyAttackTarget(target)
        && canImpactBasicMelee(ai.m, target, ai._meleeSnapshot);
}
