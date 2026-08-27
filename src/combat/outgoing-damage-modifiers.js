import { getEnemyFamilies } from '../config/enemy-family.js';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';
import { getUnitKind } from '../world/unit-upgrade-store.js';

const GIANT_SLAYER_ID = 'giant_slayer';

/** 铁匠铺“巨人杀手”：只匹配能力配置声明的兵种与怪物 family/families 词条。 */
function getGiantSlayerMultiplier(source, target) {
    if (!source || !target || target._faction !== 'enemy') return 1;
    const ability = getBuildingUpgradeAbility(GIANT_SLAYER_ID);
    const level = getAbilityLevel(GIANT_SLAYER_ID);
    if (!ability || level <= 0 || !ability.unitKinds?.includes(getUnitKind(source))) return 1;
    const targetFamilies = new Set(getEnemyFamilies(target));
    const eligible = (ability.targetFamilies || []).some((family) => targetFamilies.has(family));
    return eligible ? 1 + Math.max(0, getAbilityValue(ability, level)) : 1;
}

/**
 * 攻击来源侧的最终伤害倍率统一入口。
 * 同时消费来源减益与针对目标词条的增伤；保持纯计算，供统一受击链共用。
 */
export function getOutgoingDamageMultiplier(source, target = null) {
    let multiplier = getGiantSlayerMultiplier(source, target);
    if (source?._faction === 'enemy' && typeof source.hasStatusEffect === 'function'
        && source.hasStatusEffect('camelFright')) {
        const effect = source.statusEffects?.find((entry) => (
            entry?.type === 'camelFright' && entry.remaining > 0
        ));
        const reduction = Math.max(0, Math.min(0.9, Number(effect?.value) || 0));
        multiplier *= 1 - reduction;
    }
    return multiplier;
}

export function applyOutgoingDamageModifiers(damage, source, target = null) {
    const amount = Math.max(0, Number(damage) || 0);
    if (!(amount > 0)) return 0;
    const multiplier = getOutgoingDamageMultiplier(source, target);
    if (multiplier === 1) return amount;
    return Math.max(1, Math.floor(amount * multiplier));
}
