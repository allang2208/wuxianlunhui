import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';

/** 铁匠铺“标记”的统一命中入口；无 options 时完整保留原单位口径。 */
export function tryApplyMarkArrow(target, options = {}) {
    if (!target || typeof target.addStatusEffect !== 'function') return false;
    const level = getAbilityLevel('mark_arrow');
    const ability = getBuildingUpgradeAbility('mark_arrow');
    if (level <= 0 || !ability) return false;
    const configuredChanceMultiplier = Number(options.chanceMultiplier);
    const chanceMultiplier = Number.isFinite(configuredChanceMultiplier)
        ? Math.max(0, configuredChanceMultiplier) : 1;
    const chance = getAbilityValue(ability, level) * chanceMultiplier;
    if (Math.random() >= chance) return false;
    const durationMs = Math.max(1, Number(options.durationMs) || ability.durationMs);
    const damageAmplify = Math.max(0,
        Number.isFinite(Number(options.damageAmplify))
            ? Number(options.damageAmplify) : Number(ability.damageAmplify) || 0);
    const existing = target.statusEffects?.find((entry) => (
        entry?.type === 'marked' && entry.remaining > 0
    ));
    if (options.preserveStronger && existing
        && Number(existing.value) > damageAmplify) return false;
    if (options.preserveStronger && existing
        && Number(existing.value) < damageAmplify) {
        existing.value = damageAmplify;
        existing.duration = durationMs;
        existing.remaining = durationMs;
        EffectManager?.add?.(new FloatingTextEffect(
            target.x, target.y - 44, '🎯 标记', '#ffd700'));
        return true;
    }
    const effect = target.addStatusEffect('marked', durationMs, {
        name: '标记',
        icon: '🎯',
        color: '#ffd700',
        value: damageAmplify,
    });
    if (!effect) return false;
    EffectManager?.add?.(new FloatingTextEffect(target.x, target.y - 44, '🎯 标记', '#ffd700'));
    return true;
}
