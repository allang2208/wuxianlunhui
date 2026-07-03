/**
 * Craft Effect Registry
 * Centralized definition of all craft/attachment effects.
 * Each entry defines: how to apply, how to display, and validation rules.
 */

export const CRAFT_EFFECT_REGISTRY = {
    // ========== 伤害类 ==========
    damagePercent: {
        category: 'damage',
        applyMode: 'multiply',      // base * (1 + value)
        display: (v) => `伤害+${Math.round(v * 100)}%`,
        tooltip: '提高武器基础伤害',
    },
    piercingBonus: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `穿透+${v}`,
        tooltip: '增加弹丸穿透目标数',
    },
    critChancePercent: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `暴击率+${Math.round(v * 100)}%`,
        tooltip: '提高暴击概率',
    },
    armorPenetrationPercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `护甲穿透+${Math.round(v * 100)}%`,
        tooltip: '无视目标部分物理防御',
    },
    magicPenetrationPercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `魔抗穿透+${Math.round(v * 100)}%`,
        tooltip: '无视目标部分魔法防御',
    },
    enchantedBlade: {
        category: 'damage',
        applyMode: 'flag',
        display: () => '附魔剑刃',
        tooltip: '近战攻击附加额外伤害',
    },
    bleedingOnHit: {
        category: 'damage',
        applyMode: 'flag',
        display: () => '流血效果',
        tooltip: '命中时使目标流血',
    },
    magicVulnerabilityOnHit: {
        category: 'damage',
        applyMode: 'flag',
        display: (v, stacks) => `魔法易伤${stacks || 1}层`,
        tooltip: '命中时使目标受到更多魔法伤害',
    },
    magicVulnerabilityStacks: {
        category: 'damage',
        applyMode: 'add',
        display: () => '', // companion to magicVulnerabilityOnHit
        tooltip: '',
    },

    // ========== 射程/速度类 ==========
    rangeDelta: {
        category: 'range',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}射程`,
        tooltip: '改变武器射程',
    },
    projectileSpeedPercent: {
        category: 'range',
        applyMode: 'multiply',
        display: (v) => `弹速${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '改变弹丸飞行速度',
    },
    knockbackDelta: {
        category: 'range',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}击退`,
        tooltip: '改变击退距离',
    },
    moveSpeedPercent: {
        category: 'mobility',
        applyMode: 'multiply',
        display: (v) => `移速${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '改变移动速度',
    },
    attackIntervalDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms攻击间隔`,
        tooltip: '改变攻击间隔',
    },

    // ========== 弹夹/换弹类 ==========
    magazineDelta: {
        category: 'ammo',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}弹容量`,
        tooltip: '改变弹夹容量',
    },
    magazineOverride: {
        category: 'ammo',
        applyMode: 'override',
        display: (v) => `弹容量→${v}`,
        tooltip: '覆盖弹夹容量',
    },
    reloadTimeDelta: {
        category: 'ammo',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms换弹时间`,
        tooltip: '改变换弹时间',
    },
    fastReload: {
        category: 'ammo',
        applyMode: 'flag',
        display: () => '快速换弹',
        tooltip: '每次换弹装入多发子弹',
    },

    // ========== 散布/精准类 ==========
    maxSpreadAngleDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}°最大散布`,
        tooltip: '改变最大散布角度',
    },
    spreadStartDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms散布开始`,
        tooltip: '改变散布开始时间',
    },
    spreadTimeDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms散布达到最大`,
        tooltip: '改变散布达到最大时间',
    },
    shotSpreadDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}°每次射击散布`,
        tooltip: '改变每次射击散布增加量',
    },
    recoilRecoveryDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms后坐恢复`,
        tooltip: '改变后坐力恢复时间',
    },
    slugRecoilRecovery: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms独头弹后坐恢复`,
        tooltip: '独头弹模式后坐力恢复时间',
    },

    // ========== 特殊模式类 ==========
    slugMode: {
        category: 'mode',
        applyMode: 'flag',
        display: () => '独头弹模式',
        tooltip: '散弹枪变为单发独头弹',
    },
    flechetteMode: {
        category: 'mode',
        applyMode: 'flag',
        display: () => '箭型弹模式',
        tooltip: '散弹枪变为穿透箭型弹',
    },
    hideMuzzleFlash: {
        category: 'mode',
        applyMode: 'flag',
        display: () => '隐藏枪口火焰',
        tooltip: '开火时不显示枪口火焰',
    },
    highPowerScope: {
        category: 'mode',
        applyMode: 'flag',
        display: () => '3倍瞄准镜',
        tooltip: '开启3倍瞄准模式',
    },
    redDotScope: {
        category: 'mode',
        applyMode: 'flag',
        display: () => '红点瞄准镜',
        tooltip: '开启1倍瞄准模式',
    },

    // ========== 过热类 ==========
    overheatTimeDelta: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms过热时间`,
        tooltip: '改变过热时间',
    },
    overheatRecoverDelta: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms过热恢复`,
        tooltip: '改变过热恢复时间',
    },

    // ========== 防御类 ==========
    defensePercent: {
        category: 'defense',
        applyMode: 'multiply',
        display: (v) => `防御+${Math.round(v * 100)}%`,
        tooltip: '提高防御力',
    },
    secondaryBlock: {
        category: 'defense',
        applyMode: 'flag',
        display: () => '副手格挡',
        tooltip: '副手武器也能触发格挡',
    },

    // ========== 特殊攻击类 ==========
    specialRangeDelta: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}特殊攻击射程`,
        tooltip: '改变特殊攻击射程',
    },
    specialDurationDelta: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}特殊攻击持续时间`,
        tooltip: '改变特殊攻击持续时间',
    },
    runeRestructureCount: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `+${v}符文剑数量`,
        tooltip: '增加符文长剑悬浮剑数量',
    },
};

/**
 * 应用改造效果到基础值
 * @param {number} baseValue - 基础值
 * @param {string} effectName - 效果名称
 * @param {number} effectValue - 效果值
 * @returns {number} 应用后的值
 */
export function applyCraftEffect(baseValue, effectName, effectValue) {
    const reg = CRAFT_EFFECT_REGISTRY[effectName];
    if (!reg || effectValue === undefined || effectValue === null) return baseValue;
    switch (reg.applyMode) {
        case 'add': return baseValue + effectValue;
        case 'multiply': return baseValue * (1 + effectValue);
        case 'override': return effectValue;
        case 'flag': return effectValue ? true : baseValue; // flags are booleans
        default: return baseValue + effectValue;
    }
}

/**
 * 获取改造效果的显示文本
 * @param {string} effectName - 效果名称
 * @param {number} effectValue - 效果值
 * @returns {string} 显示文本
 */
export function getCraftEffectDisplay(effectName, effectValue) {
    const reg = CRAFT_EFFECT_REGISTRY[effectName];
    if (!reg || !reg.display) return `${effectName}: ${effectValue}`;
    return reg.display(effectValue);
}

/**
 * 获取改造效果的 tooltip 说明
 * @param {string} effectName - 效果名称
 * @returns {string} 说明文本
 */
export function getCraftEffectTooltip(effectName) {
    const reg = CRAFT_EFFECT_REGISTRY[effectName];
    return reg?.tooltip || '';
}

/**
 * 遍历所有生效的改造效果
 * @param {object} craftEffects - item._craftEffects
 * @param {function} callback - (effectName, effectValue, registryEntry) => void
 */
export function forEachCraftEffect(craftEffects, callback) {
    if (!craftEffects || typeof callback !== 'function') return;
    for (const [name, value] of Object.entries(craftEffects)) {
        const reg = CRAFT_EFFECT_REGISTRY[name];
        if (reg) callback(name, value, reg);
    }
}

/**
 * 检查是否包含指定类别的改造效果
 * @param {object} craftEffects - item._craftEffects
 * @param {string} category - 类别名
 * @returns {boolean}
 */
export function hasCraftEffectCategory(craftEffects, category) {
    if (!craftEffects) return false;
    return Object.entries(craftEffects).some(([name, value]) => {
        const reg = CRAFT_EFFECT_REGISTRY[name];
        return reg && reg.category === category && value !== undefined && value !== null && value !== false;
    });
}

/**
 * 获取指定类别的所有改造效果
 * @param {object} craftEffects - item._craftEffects
 * @param {string} category - 类别名
 * @returns {Array<{name, value, registryEntry}>}
 */
export function getCraftEffectsByCategory(craftEffects, category) {
    if (!craftEffects) return [];
    const results = [];
    for (const [name, value] of Object.entries(craftEffects)) {
        const reg = CRAFT_EFFECT_REGISTRY[name];
        if (reg && reg.category === category && value !== undefined && value !== null && value !== false) {
            results.push({ name, value, registryEntry: reg });
        }
    }
    return results;
}
