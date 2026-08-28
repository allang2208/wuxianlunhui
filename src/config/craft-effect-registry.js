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
        tooltip: '命中后获得限时移动速度提升；支持每发子弹首次命中触发',
    },
    attackIntervalDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `${v >= 0 ? '+' : ''}${v}ms攻击间隔`,
        tooltip: '改变攻击间隔',
    },
    rampMinCooldownDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `升速峰值间隔${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变持续射击升速机制的峰值攻击间隔',
    },
    rampUpTimeDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `升速时间${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变持续射击达到峰值射速所需时间',
    },
    energyPeakCooldownDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `能量峰值间隔${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变能量轻机枪达到峰值后的攻击间隔',
    },
    energyRampUpTimeDelta: {
        category: 'mobility',
        applyMode: 'add',
        display: (v) => `能量升速时间${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变能量轻机枪达到峰值射速所需时间',
    },
    energyPeakDamageMultiplierDelta: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `峰值弹束伤害${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '仅在能量轻机枪达到峰值射速后提高单发伤害',
    },
    energyPeakPiercingBonus: {
        category: 'damage',
        applyMode: 'add',
        display: (v) => `峰值弹束穿透+${v}`,
        tooltip: '仅在能量轻机枪达到峰值射速后增加穿透目标数',
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
    moveSpreadPercent: {
        category: 'spread',
        applyMode: 'multiply',
        display: (v) => `移动散布${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '移动射击时的散布倍率（负值=移动中更准）',
    },
    stationarySpreadPercent: {
        category: 'spread',
        applyMode: 'multiply',
        display: (v) => `静止散布${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '静止射击时的散布倍率（负值=架枪更准）',
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
            ? (v.startShots !== undefined || v.maxShots !== undefined
                ? `散布模板：第${v.startShots ?? 0}发开始/第${v.maxShots ?? 1}发最大/±${v.maxAngle ?? 25}°`
                : `散布模板：开始${v.startDelay ?? 500}ms/最大${v.maxTime ?? 4000}ms/±${v.maxAngle ?? 25}°`)
            : '散布模板覆盖',
        tooltip: '整体覆盖渐进式散布参数（起始发数/最大发数/恢复/最大角）',
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

    // ========== 神话霰弹机制类 ==========
    terminusCycleShotsDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `终钟周期${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '改变末日钟摆触发终钟齐射所需的实际击发数',
    },
    terminusDamageMultiplierDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `终钟伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变终钟齐射的独立伤害倍率',
    },
    terminusSpreadMultiplierDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `终钟散布倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变终钟齐射散布倍率（负值=进一步收束）',
    },
    terminusPiercingBonus: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `终钟穿透+${v}`,
        tooltip: '只为终钟齐射增加穿透目标数',
    },
    terminusKnockbackDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `终钟击退${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '只改变终钟齐射的击退距离',
    },
    voidFuneralRangeDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `葬潮范围${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '改变虚空葬潮首命中裂隙搜索半径',
    },
    voidFuneralDamageMultiplierDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `葬潮伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变葬潮回响相对整次弹群伤害的倍率',
    },
    voidFuneralMaxTargetsDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `葬潮目标${v >= 0 ? '+' : ''}${v}`,
        tooltip: '改变每次葬潮回响最多影响的额外目标数',
    },
    voidFuneralBindDurationDelta: {
        category: 'mythicShotgun', applyMode: 'add',
        display: (v) => `葬潮束缚${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变葬潮回响对幸存目标的束缚时长',
    },

    // ========== 传说霰弹机制类 ==========
    eclipseMarkDurationDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `蚀印时限${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变黑日圣裁月相蚀印的持续时间',
    },
    eclipseSlowDurationDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `月蚀迟滞${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变月相首命中造成的迟滞时长',
    },
    eclipseFocusDamageMultiplierDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `日冕聚焦倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变日相消耗蚀印时对主目标追加的整组伤害倍率',
    },
    eclipseSplashDamageMultiplierDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `日冕溅射倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变日相裁决对周围目标追加的整组伤害倍率',
    },
    eclipseRadiusDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `日冕范围${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '改变日相裁决搜索周围目标的半径',
    },
    eclipseMaxTargetsDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `日冕目标${v >= 0 ? '+' : ''}${v}`,
        tooltip: '改变日相裁决最多溅射的额外目标数',
    },
    huntResetTimeDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `猎印窗口${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变王猎终局连续命中同一目标的判定窗口',
    },
    huntRequiredHitsDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `终局触发${v >= 0 ? '+' : ''}${v}次命中`,
        tooltip: '改变触发终局处决所需的连续有效命中次数',
    },
    huntFinisherDamageMultiplierDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `终局基础倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变终局处决相对整组弹群伤害的基础倍率',
    },
    huntMissingHealthMultiplierDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `已损生命倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变终局处决按目标已损生命追加伤害的比例',
    },
    huntMissingHealthCapMultiplierDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `处决封顶倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变已损生命追加伤害相对整组弹群的封顶倍率',
    },
    huntBindDurationDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `王猎束缚${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '改变终局处决对幸存目标的束缚时长',
    },
    huntKnockbackDelta: {
        category: 'legendaryShotgun', applyMode: 'add',
        display: (v) => `终局击退${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '改变终局处决追加伤害的击退距离',
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
    overheatRecoverPercent: {
        category: 'overheat',
        applyMode: 'multiply',
        display: (v) => `过热恢复${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '按比例改变过热恢复时间（负值=恢复更快）',
    },
    overheatShotsRequiredDelta: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `进入红热所需射击${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '改变红热增压武器进入红热状态所需的连续射击数',
    },
    overheatPiercingBonus: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `红热时穿透+${v}`,
        tooltip: '仅在武器进入红热状态后增加弹丸穿透目标数',
    },
    overheatCritChancePercent: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `红热时暴击率+${Math.round(v * 100)}%`,
        tooltip: '仅在武器进入红热状态后提高暴击概率',
    },
    overheatDamageMultiplierDelta: {
        category: 'overheat',
        applyMode: 'add',
        display: (v) => `红热伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '改变红热状态的独立伤害倍率',
    },
    overheatSpreadPercent: {
        category: 'overheat',
        applyMode: 'multiply',
        display: (v) => `红热散布${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '改变红热状态下的弹道散布（负值=更准）',
    },
    overheatProjectileSpeedPercent: {
        category: 'overheat',
        applyMode: 'multiply',
        display: (v) => `红热弹速${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '改变红热状态下的弹丸飞行速度',
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
    calibrationHitsRequiredDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `仲裁校准命中${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '调整零点仲裁触发下一发相位弹所需的首次命中数',
    },
    calibrationDamageMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `仲裁弹倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '调整零点仲裁相位弹的伤害倍率',
    },
    calibrationPiercingBonusDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `仲裁弹额外穿透${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整零点仲裁相位弹额外穿透的目标数',
    },
    rhythmStartShotDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `稳定窗起始${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '调整日冕裁律稳定窗开始的射击序号',
    },
    rhythmEndShotDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `稳定窗结束${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '调整日冕裁律稳定窗结束的射击序号',
    },
    rhythmDamageMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `稳定窗伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '调整日冕裁律稳定窗内的伤害倍率',
    },
    rhythmResetMsDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `节律重置${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '调整停火后射击节律重置所需时间',
    },
    convergenceStartShotDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `收束起始${v >= 0 ? '+' : ''}${v}发`,
        tooltip: '调整终末回声开始积累收束层数的射击序号',
    },
    convergenceMaxStacksDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `收束上限${v >= 0 ? '+' : ''}${v}层`,
        tooltip: '调整终末回声收束机制的最大层数',
    },
    convergenceDamagePerStackDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `每层伤害${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`,
        tooltip: '调整终末回声每层收束提供的伤害倍率',
    },
    convergenceSpreadPerStackDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `每层散布收束${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`,
        tooltip: '调整终末回声每层收束降低的散布比例',
    },
    convergenceResetMsDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `收束重置${v >= 0 ? '+' : ''}${v}ms`,
        tooltip: '调整终末回声停火后清空收束层数的等待时间',
    },
    ricochetRangeDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射范围${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '调整奇点织机主弹命中后搜索最近弹射目标的范围',
    },
    ricochetDamageMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '调整奇点织机弹射命中的伤害倍率',
    },
    ricochetExtraTargets: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射分岔+${v}个目标`,
        tooltip: '让奇点织机从首个命中目标同时分岔至更多合法目标',
    },
    ricochetReturnDamageMultiplier: {
        category: 'special', applyMode: 'add',
        display: (v) => `折返伤害${Math.round(v * 100)}%`,
        tooltip: '弹射命中后折返首个命中目标，并按该倍率追加一次伤害',
    },
    ricochetTargetMode: {
        category: 'special', applyMode: 'override',
        display: (v) => v === 'lowestHp' ? '弹射优先：最低生命比例' : `弹射优先：${v}`,
        tooltip: '覆盖奇点织机的弹射目标选择规则',
    },
    ricochetKillChainCount: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射击杀续跳+${v}次`,
        tooltip: '弹射击杀目标后，继续跳向附近另一合法目标的次数',
    },
    ricochetChainDamageMultiplier: {
        category: 'special', applyMode: 'add',
        display: (v) => `续跳伤害${Math.round(v * 100)}%`,
        tooltip: '奇点织机击杀续跳造成的伤害倍率',
    },
    ricochetSplashRadius: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射余震半径${v}px`,
        tooltip: '奇点织机首段弹射落点释放余震的搜索半径',
    },
    ricochetSplashDamageMultiplier: {
        category: 'special', applyMode: 'add',
        display: (v) => `弹射余震伤害${Math.round(v * 100)}%`,
        tooltip: '奇点织机弹射余震造成的伤害倍率',
    },
    ricochetSplashMaxTargets: {
        category: 'special', applyMode: 'add',
        display: (v) => `每个落点余震目标上限${v}`,
        tooltip: '每条首段弹射落点各自可命中的余震目标上限',
    },
    ricochetAnchorHitsRequired: {
        category: 'special', applyMode: 'add',
        display: (v) => `同目标第${v}次弹射触发锚定`,
        tooltip: '同一目标累计多少次首段弹射命中后触发时滞锚定',
    },
    ricochetAnchorDurationMs: {
        category: 'special', applyMode: 'add',
        display: (v) => `时滞锚定${(v / 1000).toFixed(2)}s`,
        tooltip: '时滞锚定触发后束缚目标的持续时间',
    },
    constellationAnchorHitDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `星图锚点命中序号${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整天穹测绘者建立星图锚点所需的连续有效命中数',
    },
    constellationResolveHitDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `星图结算命中序号${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整天穹测绘者触发经纬线或天顶坠击所需的连续有效命中数',
    },
    constellationPowerMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `星图结算威力${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`,
        tooltip: '同时调整经纬线、天顶坠击与坠击余波的威力',
    },
    constellationLineWidthDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `经纬线宽度${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '调整星图锚点与终段目标之间的经纬线判定宽度',
    },
    constellationLineMaxTargetsDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `经纬线目标上限${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整一次经纬线能够结算的最大目标数',
    },
    constellationLineDamageMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `经纬线伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '调整经纬线对沿线目标造成的伤害倍率',
    },
    constellationFocusRadiusDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `天顶余波半径${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '调整同目标结算天顶坠击后的余波范围',
    },
    constellationFocusMaxTargetsDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `天顶余波目标上限${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整天顶坠击余波能够命中的最大目标数',
    },
    constellationSlowDurationMs: {
        category: 'special', applyMode: 'add',
        display: (v) => `星图迟滞${(v / 1000).toFixed(2)}s`,
        tooltip: '让星图结算命中的目标短暂减速',
    },
    constellationCarryHits: {
        category: 'special', applyMode: 'override',
        display: (v) => `星图结算后保留${v}次命中进度`,
        tooltip: '星图结算后让下一轮观测序列从指定命中进度继续',
    },
    runeMarksPerHit: {
        category: 'special', applyMode: 'override',
        display: (v) => `每次命中刻下${v}种轮转符文`,
        tooltip: '调整冥约颂炮每次有效命中刻下的轮转符文数量',
    },
    runeMemoryDurationDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `符文记忆${v >= 0 ? '+' : ''}${(v / 1000).toFixed(1)}s`,
        tooltip: '调整目标身上未完成符文组合的保留时间',
    },
    runeVerdictRadiusDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `黑弥撒半径${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '调整集齐血骨烬三印后黑弥撒裁决的范围',
    },
    runeVerdictMaxTargetsDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `黑弥撒目标上限${v >= 0 ? '+' : ''}${v}`,
        tooltip: '调整一次黑弥撒裁决能够命中的最大目标数',
    },
    runeVerdictDamageMultiplierDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `黑弥撒伤害倍率${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
        tooltip: '调整黑弥撒裁决的伤害倍率',
    },
    runeInheritanceTargets: {
        category: 'special', applyMode: 'add',
        display: (v) => `未完成符文迁移至${v}个目标`,
        tooltip: '直击击杀时把未完成的符文分配给附近目标；迁移最多只产生一代裁决',
    },
    runeInheritanceRangeDelta: {
        category: 'special', applyMode: 'add',
        display: (v) => `符文迁移范围${v >= 0 ? '+' : ''}${v}px`,
        tooltip: '调整直击击杀后搜索符文继承目标的范围',
    },
    runeVerdictSeedMarks: {
        category: 'special', applyMode: 'flag',
        display: () => '裁决幸存者继承末印',
        tooltip: '黑弥撒的幸存目标继承触发裁决时的最后一枚符文；不会立即再次裁决',
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
