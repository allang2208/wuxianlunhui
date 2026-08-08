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
        display: (v, allEffects) => `魔法易伤${(allEffects && allEffects.magicVulnerabilityStacks) || 1}层`,
        tooltip: '命中时使目标受到更多魔法伤害',
    },
    magicVulnerabilityStacks: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `易伤层数×${v}`, // companion to magicVulnerabilityOnHit
        tooltip: '魔法易伤的叠加层数',
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
    onHitSpeedBuff: {
        category: 'mobility',
        applyMode: 'override',
        display: (v) => (v && typeof v === 'object')
            ? `命中获得加速+${Math.round((v.speedPercent ?? 0.10) * 100)}%/${((v.durationMs ?? 2000) / 1000)}s`
            : '命中获得加速',
        tooltip: '每次射击击中目标后获得限时移动速度提升',
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
    magazinePercent: {
        category: 'ammo',
        applyMode: 'multiply',
        display: (v) => `弹容量${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '按比例改变弹夹容量（与固定值叠加）',
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
    // 全自动专属增量：仅当武器被改造为全自动（fireModeOverride='fullAuto'）时才叠加
    autoSpreadStartDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `全自动散布开始${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '仅全自动模式下改变散布开始时间',
    },
    autoSpreadTimeDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `全自动散布达最大${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '仅全自动模式下改变散布达到最大时间',
    },
    autoMaxSpreadAngleDelta: {
        category: 'spread',
        applyMode: 'add',
        display: (v) => `全自动最大散布${v >= 0 ? '+' : ''}${v}°`,
        tooltip: '仅全自动模式下改变最大散布角度',
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
    burstMode: {
        category: 'mode',
        applyMode: 'add',
        display: (v) => `${v}连发爆发模式`,
        tooltip: '一次扳机连射 N 发子弹',
    },
    fireModeOverride: {
        category: 'mode',
        applyMode: 'override',
        display: (v) => (v === 'fullAuto' ? '切换全自动模式' : `射击模式→${v}`),
        tooltip: '覆盖武器射击模式',
    },
    spreadParamsOverride: {
        category: 'spread',
        applyMode: 'override',
        display: (v) => (v && typeof v === 'object')
            ? `散布模板：开始${v.startDelay ?? 500}ms/最大${v.maxTime ?? 4000}ms/±${v.maxAngle ?? 25}°`
            : '散布模板覆盖',
        tooltip: '整体覆盖渐进式散布参数（开始/到最大/最大角）',
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
    fireSoundOverride: {
        category: 'mode',
        applyMode: 'override',
        display: () => '替换射击音效',
        tooltip: '开火音效替换为指定音频文件',
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
        display: () => '次级格挡',
        tooltip: '受到近战攻击时 50% 概率减少 50% 伤害',
    },

    // ========== 消耗/技能类 ==========
    staminaCostDelta: {
        category: 'stamina',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}攻击体力消耗`,
        tooltip: '改变普通攻击的体力消耗',
    },
    skillStaminaCostDelta: {
        category: 'stamina',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}技能体力消耗`,
        tooltip: '改变技能的体力消耗',
    },
    dashDoubleHit: {
        category: 'special',
        applyMode: 'flag',
        display: () => '双段突刺',
        tooltip: '冲刺攻击命中两次',
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

    // ========== 法杖 / 魔法改造类 ==========
    staffSpecialty: {
        category: 'mode',
        applyMode: 'override',
        display: (v) => ({ ice: '冰系专精', fire: '火系专精', electric: '电系专精', light: '光系专精' }[v] || `${v}专精`),
        tooltip: '杖头元素专精，激活杖冠对应词条',
    },
    iceSpikeCountDelta: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `+${v}冰锥`,
        tooltip: '冰锥技能生成的冰锥数量增加',
    },
    fireballExplosionRadiusPercent: {
        category: 'range',
        applyMode: 'multiply',
        display: (v) => `火球爆炸范围+${Math.round(v * 100)}%`,
        tooltip: '火球爆炸判定半径增加',
    },
    holyLightHoTStacks: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `圣光续疗${v}层`,
        tooltip: '圣光治疗后给目标添加持续回血 buff',
    },
    holyLightHoTSeconds: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `圣光续疗${v}s`,
        tooltip: '圣光治疗后持续回血 buff 的持续时间',
    },
    lightningChainTargetsDelta: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `+${v}闪电传导`,
        tooltip: '闪电传导目标数增加',
    },
    iceDamagePercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `冰魔法伤害+${Math.round(v * 100)}%`,
        tooltip: '提高冰魔法造成的伤害',
    },
    fireDamagePercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `火魔法伤害+${Math.round(v * 100)}%`,
        tooltip: '提高火魔法造成的伤害',
    },
    electricDamagePercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `电魔法伤害+${Math.round(v * 100)}%`,
        tooltip: '提高电魔法造成的伤害',
    },
    lightHealPercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `光魔法治疗+${Math.round(v * 100)}%`,
        tooltip: '提高光魔法的治疗量',
    },
    magicRangePercent: {
        category: 'range',
        applyMode: 'multiply',
        display: (v) => `魔法距离+${Math.round(v * 100)}%`,
        tooltip: '提高所有魔法的释放距离',
    },
    magicCritPercent: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `魔法暴击率+${Math.round(v * 100)}%`,
        tooltip: '提高魔法伤害的暴击概率',
    },
    magicCooldownPercent: {
        category: 'special',
        applyMode: 'multiply',
        display: (v) => `魔法冷却-${Math.round(v * 100)}%`,
        tooltip: '减少所有魔法的冷却时间',
    },
    magicMpCostPercent: {
        category: 'stamina',
        applyMode: 'multiply',
        display: (v) => `魔法耗蓝+${Math.round(v * 100)}%`,
        tooltip: '增加所有魔法的 MP 消耗',
    },
    castSpeedPercent: {
        category: 'mobility',
        applyMode: 'multiply',
        display: (v) => `施法速度+${Math.round(v * 100)}%`,
        tooltip: '加快施法前摇/后摇动画',
    },
    chainSpellDamagePercent: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `链式强化伤害+${Math.round(v * 100)}%`,
        tooltip: '松木握柄每层链式强化提供的下次施法伤害加成',
    },
    chainSpellMpCostPercent: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `链式强化耗蓝+${Math.round(v * 100)}%`,
        tooltip: '松木握柄每层链式强化提供的下次施法 MP 消耗加成',
    },
    castHasteDuration: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `施法加速${(v / 1000).toFixed(1)}s`,
        tooltip: '檀木握柄施法后获得加速 buff 的持续时间',
    },
    castHasteStacks: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `施法加速${v}层`,
        tooltip: '檀木握柄施法后获得加速 buff 的层数',
    },
    iceChillSlowPercent: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `寒冷减速${Math.round(v * 100)}%`,
        tooltip: '冰魄吊坠每层寒冷 debuff 的减速比例',
    },
    iceChillDuration: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `寒冷持续${(v / 1000).toFixed(1)}s`,
        tooltip: '冰魄吊坠寒冷 debuff 的持续时间',
    },
    electricStunExtendMs: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `眩晕延长${v}ms`,
        tooltip: '爆鸣雷铃电系魔法眩晕延长',
    },
    lightHasteStacks: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `光愈加速${v}层`,
        tooltip: '净厄藤坠光系治疗后给目标加速 buff 的层数',
    },
    lightHasteDuration: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `光愈加速${(v / 1000).toFixed(1)}s`,
        tooltip: '净厄藤坠光系治疗后给目标加速 buff 的持续时间',
    },
    fireBurnDamageMul: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `灼伤倍率${v.toFixed(1)}`,
        tooltip: '烈焰吊坠灼伤 debuff 每次伤害 = 施法者 matk × 倍率',
    },
    fireBurnTickMs: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `灼伤间隔${(v / 1000).toFixed(2)}s`,
        tooltip: '烈焰吊坠灼伤 debuff 的伤害间隔',
    },
    fireBurnDuration: {
        category: 'special',
        applyMode: 'add',
        display: (v) => `灼伤持续${(v / 1000).toFixed(1)}s`,
        tooltip: '烈焰吊坠灼伤 debuff 的持续时间',
    },
    magicDamagePercent: {
        category: 'damage',
        applyMode: 'multiply',
        display: (v) => `魔法伤害+${Math.round(v * 100)}%`,
        tooltip: '提高所有魔法造成的伤害',
    },
};

/**
 * 获取改造效果的显示文本
 * @param {string} effectName - 效果名称
 * @param {number} effectValue - 效果值
 * @param {object} [allEffects] - 全部聚合效果（供联动显示取值，如易伤层数）
 * @returns {string} 显示文本
 */
export function getCraftEffectDisplay(effectName, effectValue, allEffects) {
    const reg = CRAFT_EFFECT_REGISTRY[effectName];
    if (!reg || !reg.display) return `${effectName}: ${effectValue}`;
    return reg.display(effectValue, allEffects);
}
