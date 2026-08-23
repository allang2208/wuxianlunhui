import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';

/** 铁匠铺“标记”的统一命中入口，供仓鼠斥候与赏金猎人共享。 */
export function tryApplyMarkArrow(target) {
    if (!target || typeof target.addStatusEffect !== 'function') return false;
    const level = getAbilityLevel('mark_arrow');
    const ability = getBuildingUpgradeAbility('mark_arrow');
    if (level <= 0 || !ability || Math.random() >= getAbilityValue(ability, level)) return false;
    const effect = target.addStatusEffect('marked', ability.durationMs, {
        name: '标记',
        icon: '🎯',
        color: '#ffd700',
        value: ability.damageAmplify,
    });
    if (!effect) return false;
    EffectManager?.add?.(new FloatingTextEffect(target.x, target.y - 44, '🎯 标记', '#ffd700'));
    return true;
}
