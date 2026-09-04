// 盾牌运行时与面板共用的口径。damageReduction 是承伤比例；parryAngle 是半角。
export function getShieldDefenseValues(item, skillEffect = {}) {
    const defense = item?.defense || {};
    const craft = item?._craftEffects || {};
    const finite = (value, fallback) => Number.isFinite(Number(value)) && value != null
        ? Number(value) : fallback;
    const nonNegative = (value, fallback) => Math.max(0, finite(value, fallback));
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const normalizeProc = (value) => {
        if (!value || typeof value !== 'object') return null;
        const chance = clamp(finite(value.chance, 0), 0, 1);
        const reductionPercent = clamp(finite(value.reductionPercent, 0), 0, 0.95);
        const cooldownMs = nonNegative(value.cooldownMs, 0);
        if (!(chance > 0) || !(reductionPercent > 0)) return null;
        return { chance, reductionPercent, cooldownMs };
    };
    const normalizeAfterBlock = (value) => {
        if (!value || typeof value !== 'object') return null;
        const reductionPercent = clamp(finite(value.reductionPercent, 0), 0, 0.95);
        const durationMs = nonNegative(value.durationMs, 0);
        const cooldownMs = nonNegative(value.cooldownMs, 0);
        const charges = Math.max(1, Math.floor(nonNegative(value.charges, 1)));
        if (!(reductionPercent > 0) || !(durationMs > 0)) return null;
        return { reductionPercent, durationMs, cooldownMs, charges };
    };
    const base = Math.max(0, nonNegative(defense.base, 0) + finite(craft.shieldDefenseFlat, 0));
    const perEnhance = nonNegative(defense.perEnhance, 0);
    const baseDamageRatio = Math.min(1, nonNegative(defense.damageReduction, 0.5));
    const blockReductionBonus = finite(craft.shieldBlockReductionBonus, 0);
    const hasDedicatedMagicBlock = defense.magicBlockRemainingDamageRatio != null;
    const magicBaseDamageRatio = Math.min(1,
        nonNegative(defense.magicBlockRemainingDamageRatio, baseDamageRatio));
    const magicBlockReductionBonus = hasDedicatedMagicBlock
        ? finite(craft.shieldMagicBlockReductionBonus, 0)
        : blockReductionBonus;
    const parryReflection = defense.parryReflection && typeof defense.parryReflection === 'object'
        ? {
            damageRatio: clamp(finite(
                defense.parryReflection.ratio ?? defense.parryReflection.damageRatio,
                0
            )
                + finite(craft.shieldParryReflectRatioDelta, 0), 0, 0.95),
            maxHpCapRatio: clamp(finite(defense.parryReflection.maxHpCapRatio, 0)
                + finite(craft.shieldParryReflectCapRatioDelta, 0), 0, 1),
            cooldownMs: Math.max(0, nonNegative(defense.parryReflection.cooldownMs, 0)
                + finite(craft.shieldParryReflectCooldownDelta, 0)),
        }
        : null;
    const arcaneRetort = defense.arcaneRetort && typeof defense.arcaneRetort === 'object'
        ? {
            baseDamage: Math.max(0, nonNegative(defense.arcaneRetort.baseDamage, 0)
                + finite(craft.shieldArcaneRetortBaseDamageDelta, 0)),
            matkRatio: Math.max(0, nonNegative(defense.arcaneRetort.matkRatio, 0)
                + finite(craft.shieldArcaneRetortMatkRatioDelta, 0)),
            preventedDamageRatio: Math.max(0, nonNegative(defense.arcaneRetort.preventedDamageRatio, 0)
                + finite(craft.shieldArcaneRetortPreventedRatioDelta, 0)),
            capBaseDamage: nonNegative(defense.arcaneRetort.capBaseDamage, 0),
            capMatkRatio: nonNegative(defense.arcaneRetort.capMatkRatio, 0),
            magicResistanceShred: clamp(nonNegative(
                defense.arcaneRetort.mdefShredRatio ?? defense.arcaneRetort.magicResistanceShred,
                0
            )
                + finite(craft.shieldArcaneRetortMdefShredDelta, 0), 0, 0.95),
            shredDurationMs: Math.max(0, nonNegative(
                defense.arcaneRetort.mdefShredDurationMs ?? defense.arcaneRetort.shredDurationMs,
                0
            )
                + finite(craft.shieldArcaneRetortDurationDelta, 0)),
            cooldownMs: Math.max(0, nonNegative(defense.arcaneRetort.cooldownMs, 0)
                + finite(craft.shieldArcaneRetortCooldownDelta, 0)),
        }
        : null;
    const returnGuard = defense.returnGuard && typeof defense.returnGuard === 'object'
        ? {
            requiredStacks: Math.round(clamp(nonNegative(defense.returnGuard.requiredStacks, 3)
                + finite(craft.shieldReturnGuardRequiredStacksDelta, 0), 1, 5)),
            stackDurationMs: Math.max(0, nonNegative(defense.returnGuard.stackDurationMs, 5000)),
            parryWindowPerStackMs: Math.max(0,
                nonNegative(defense.returnGuard.parryWindowPerStackMs, 120)
                + finite(craft.shieldReturnGuardWindowPerStackDelta, 0)),
            staminaRefundPerStack: Math.max(0,
                nonNegative(defense.returnGuard.staminaRefundPerStack, 5)
                + finite(craft.shieldReturnGuardStaminaRefundPerStackDelta, 0)),
            readyDurationMs: Math.max(0, nonNegative(defense.returnGuard.readyDurationMs, 3200)
                + finite(craft.shieldReturnGuardReadyDurationDelta, 0)),
            cooldownMs: Math.max(0, nonNegative(defense.returnGuard.cooldownMs, 5500)
                + finite(craft.shieldReturnGuardCooldownDelta, 0)),
        }
        : null;
    const nullField = defense.nullField && typeof defense.nullField === 'object'
        ? {
            triggerStamina: Math.max(0, nonNegative(defense.nullField.triggerStamina, 18)
                + finite(craft.shieldNullFieldTriggerStaminaDelta, 0)),
            durationMs: Math.max(0, nonNegative(defense.nullField.durationMs, 240)
                + finite(craft.shieldNullFieldDurationDelta, 0)),
            remainingDamageRatio: clamp(
                nonNegative(defense.nullField.remainingDamageRatio, 0.10)
                + finite(craft.shieldNullFieldRemainingDamageRatioDelta, 0), 0, 1),
            cooldownMs: Math.max(0, nonNegative(defense.nullField.cooldownMs, 3200)
                + finite(craft.shieldNullFieldCooldownDelta, 0)),
            parryCooldownRefundMs: Math.max(0,
                nonNegative(defense.nullField.parryCooldownRefundMs, 0)
                + finite(craft.shieldNullFieldParryCooldownRefundDelta, 0)),
        }
        : null;
    const causalDebt = defense.causalDebt && typeof defense.causalDebt === 'object'
        ? {
            splitRatio: clamp(nonNegative(defense.causalDebt.splitRatio, 0)
                + finite(craft.shieldCausalDebtSplitRatioDelta, 0), 0, 0.95),
            maxHpCapRatio: clamp(nonNegative(defense.causalDebt.maxHpCapRatio, 0)
                + finite(craft.shieldCausalDebtCapRatioDelta, 0), 0, 1),
            graceMs: Math.max(0, nonNegative(defense.causalDebt.graceMs, 0)
                + finite(craft.shieldCausalDebtGraceDelta, 0)),
            repayDurationMs: Math.max(1, nonNegative(defense.causalDebt.repayDurationMs, 1)
                + finite(craft.shieldCausalDebtRepayDurationDelta, 0)),
            eraseOnParryRatio: clamp(nonNegative(defense.causalDebt.eraseOnParryRatio, 0)
                + finite(craft.shieldCausalDebtEraseRatioDelta, 0), 0, 0.95),
        }
        : null;
    const oathReserve = defense.oathReserve && typeof defense.oathReserve === 'object'
        ? {
            conversionRatio: clamp(nonNegative(defense.oathReserve.conversionRatio, 0)
                + finite(craft.shieldOathReserveConversionDelta, 0), 0, 0.95),
            maxHpCapRatio: clamp(nonNegative(defense.oathReserve.maxHpCapRatio, 0)
                + finite(craft.shieldOathReserveCapRatioDelta, 0), 0, 1),
            decayAfterMs: Math.max(0, nonNegative(defense.oathReserve.decayAfterMs, 0)
                + finite(craft.shieldOathReserveDecayDelta, 0)),
            sanctifyDurationMs: Math.max(0, nonNegative(defense.oathReserve.sanctifyDurationMs, 0)
                + finite(craft.shieldOathSanctifyDurationDelta, 0)),
            wardDurationMs: Math.max(0, nonNegative(defense.oathReserve.wardDurationMs, 0)
                + finite(craft.shieldOathWardDurationDelta, 0)),
            wardRadius: Math.max(0, nonNegative(defense.oathReserve.wardRadius, 0)
                + finite(craft.shieldOathWardRadiusDelta, 0)),
            wardReductionRatio: clamp(nonNegative(defense.oathReserve.wardReductionRatio, 0)
                + finite(craft.shieldOathWardReductionDelta, 0), 0, 0.95),
        }
        : null;
    return {
        base,
        perEnhance,
        defense: Math.floor(base + perEnhance * nonNegative(item?.enhanceLevel, 0)),
        baseDamageRatio,
        // 百分点相减收敛浮点尾差，避免50×(0.5-0.4)被下游floor误扣成4而不是5。
        remainingDamageRatio: clamp(Math.round((baseDamageRatio
            - nonNegative(skillEffect.damageReductionBonus, 0)
            - blockReductionBonus) * 1e6) / 1e6, 0.05, 1),
        magicRemainingDamageRatio: clamp(Math.round((magicBaseDamageRatio
            - nonNegative(skillEffect.damageReductionBonus, 0)
            - magicBlockReductionBonus) * 1e6) / 1e6, 0.05, 1),
        staminaCost: Math.max(0, nonNegative(defense.staminaCost, 20)
            + finite(craft.shieldStaminaCostDelta, 0)),
        defenseMoveSpeedMultiplier: clamp(0.5
            + finite(craft.shieldDefenseMoveSpeedDelta, 0), 0.35, 0.75),
        parryWindow: Math.max(0, nonNegative(defense.parryWindow, 1000)
            + finite(craft.shieldParryWindowDelta, 0)),
        // 保留旧版左右各120度的宽容范围，不借命名修正收窄成总计120度。
        parryHalfAngle: Math.min(180, nonNegative(defense.parryAngle, 120)),
        parryStun: Math.max(0, nonNegative(defense.parryStun, 1000)
            + nonNegative(skillEffect.parryStunBonus, 0) * 1000
            + finite(craft.shieldParryStunDelta, 0)),
        parryKnockback: nonNegative(defense.parryKnockback, 100),
        stunOnExhaustion: nonNegative(defense.stunOnExhaustion, 1500),
        afterBlockGuard: normalizeAfterBlock(craft.shieldAfterBlockGuard),
        passiveMeleeBlock: normalizeProc(craft.shieldPassiveMeleeBlock),
        passiveProjectileBlock: normalizeProc(craft.shieldPassiveProjectileBlock),
        parryReflection,
        arcaneRetort,
        returnGuard,
        nullField,
        causalDebt,
        oathReserve,
    };
}

// 盾脐为盾牌自身的握点；人物握点由 PlayerShieldRig 的副手骨链提供。
// 仅渲染数据，不参与碰撞、格挡方向或弹反计时。
export const PLAYER_SHIELD_VISUAL = {
    originX: 578 / 1024,
    originY: 497 / 1024,
    // 防御水平握点默认沿用常态握点；单盾可在举盾时把掌点移入盾面中段，
    // 避免斜视长盾因背带/边缘握点而露出手掌。
    defenseOriginX: 578 / 1024,
    // 防御举稳后把手掌落在旧小圆盾有效 Alpha（y=95..872）的中段；
    // 常态仍保留原握点，举/收盾时由 PlayerShieldRig 的 lift 平滑过渡。
    defenseOriginY: 0.47216796875,
    visibleHeightRatio: 760 / 1024,
    bodyHeightRatio: 0.42,
    // 小圆盾基准：正面手持图在举盾时按 cos(42°)≈0.74 做水平透视收缩。
    // 已由美术直接画成同等斜视角的手持图应显式登记 1，避免二次压扁。
    defensePerspectiveScaleX: 0.74,
    // 未标定的奔跑等动作沿用身体挂载；普通步行与近战动作另读 player-shield-poses。
    fallbackAnchor: { x: 327 / 516, y: 268 / 516 },
    restTilt: -0.12,
    // Phaser 正角为顺时针。右向时负角让盾牌上沿向左贴近角色、下沿向右远离角色；
    // 左向由 mirror 自动反号，保持相同的人体工学内倾关系。
    guardTilt: -0.14,
    raiseMs: 200,
    lowerMs: 180,
};

// 动作状态机只负责给出玩家副手掌点；不同盾牌仍必须使用各自贴图内的握点和可见尺寸。
// 未登记 shieldVisual 的旧盾继续回退小圆盾口径，兼容旧存档和历史掉落实例。
const playerShieldVisualCache = new WeakMap();
export function getPlayerShieldVisual(item) {
    const override = item?.shieldVisual;
    if (!override || typeof override !== 'object') return PLAYER_SHIELD_VISUAL;
    const cached = playerShieldVisualCache.get(item);
    if (cached?.source === override) return cached.visual;
    const finite = (value, fallback) => Number.isFinite(Number(value))
        ? Number(value) : fallback;
    const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));
    const originX = clamp(override.originX, 0, 1, PLAYER_SHIELD_VISUAL.originX);
    const visual = {
        ...PLAYER_SHIELD_VISUAL,
        originX,
        originY: clamp(override.originY, 0, 1, PLAYER_SHIELD_VISUAL.originY),
        defenseOriginX: clamp(override.defenseOriginX, 0, 1, originX),
        defenseOriginY: clamp(override.defenseOriginY, 0, 1, PLAYER_SHIELD_VISUAL.defenseOriginY),
        visibleHeightRatio: clamp(override.visibleHeightRatio, 0.01, 1, PLAYER_SHIELD_VISUAL.visibleHeightRatio),
        bodyHeightRatio: clamp(override.bodyHeightRatio, 0.05, 2, PLAYER_SHIELD_VISUAL.bodyHeightRatio),
        defensePerspectiveScaleX: clamp(
            override.defensePerspectiveScaleX,
            0.45,
            1,
            PLAYER_SHIELD_VISUAL.defensePerspectiveScaleX
        ),
    };
    playerShieldVisualCache.set(item, { source: override, visual });
    return visual;
}

// idle.png 原图逐关节标定（516×516）。格挡移动的头—胸—腰—胯—腿全部
// 来自同一帧原生 walking；这里只把初版双臂作为独立部件挂到该帧肩点。
export const PLAYER_SHIELD_ARM = {
    source: 'player_idle',
    width: 516,
    height: 516,
    stand: {
        // 站立防御与步行防御共用收拢姿态；放盾后的原始 idle 不受影响。
        guardUpperDegrees: 8,
        guardForearmDegrees: -132,
    },
    walk: {
        textureKey: 'player_shield_walk_body',
        animationKey: 'player_shield_walk_body',
        frameWidth: 512,
        frameHeight: 516,
        frameCount: 21,
        frameRate: 24,
        // 格挡步行单独把上臂收向躯干、前臂再屈肘；骨段长度不缩放，
        // 手掌和盾脐沿同一骨链回到身体侧，不影响待机/攻击/手枪持盾。
        guardUpperDegrees: 8,
        guardForearmDegrees: -132,
        mainShoulders: [
            [227, 115], [228, 114], [224, 112], [223, 113], [224, 113], [221, 114], [227, 114],
            [229, 116], [234, 115], [242, 117], [237, 110], [239, 111], [240, 109], [241, 106],
            [240, 106], [239, 103], [237, 104], [236, 110], [235, 113], [231, 119], [228, 117],
        ],
        offShoulders: [
            [313, 110], [312, 108], [305, 107], [303, 108], [302, 109], [294, 116], [299, 119],
            [301, 122], [305, 124], [313, 130], [317, 119], [319, 119], [319, 119], [322, 117],
            [323, 116], [323, 113], [322, 111], [322, 116], [321, 116], [319, 117], [315, 112],
        ],
    },
    // 主手保持初版整臂刚体，只随原生 walking 肩点平移、镜像及整体旋转；
    // 不拆成多关节重算，避免再次出现错误肘腕和僵硬折线。
    main: {
        shoulder: { x: 217, y: 105 },
        grip: { x: 204.81366831734726, y: 277.93666530675546 },
        upperPolygon: [[209, 96], [226, 96], [220, 140], [210, 188], [195, 193], [192, 180], [205, 129]],
        forearmPolygon: [[193, 176], [211, 176], [212, 240], [210, 252], [196, 261], [191, 254], [193, 214]],
        handPolygon: [[195, 251], [210, 245], [226, 267], [225, 289], [196, 289]],
    },
    shoulder: { x: 301, y: 106 },
    elbow: { x: 310, y: 185 },
    wrist: { x: 325, y: 249 },
    grip: { x: 327, y: 268 },
    upperPolygon: [[290, 97], [314, 97], [320, 184], [300, 184], [293, 139]],
    forearmPolygon: [[300, 178], [320, 178], [340, 244], [340, 290], [310, 290], [307, 239], [300, 195]],
    // 前40%先把手送离身体，后60%才屈肘举盾。负角让右向源图的上臂向外，
    // 不再先+25度向躯干内收；收盾沿同一路径倒放，先落手再收回。
    reachFraction: 0.4,
    // 缩小外伸；举稳时上臂少向外摆、前臂再内折，让盾牌靠近胸肋，
    // 同时基本保持原抬盾高度。盾脐仍与这条骨链的真实掌点共用挂点。
    reachUpperDegrees: -16,
    reachForearmDegrees: -24,
    guardUpperDegrees: -12,
    guardForearmDegrees: -110,
    // pistol 原图512×516：保留上方握枪臂及原肩轴，移除下方辅助臂的可见部分。
    // 辅助臂近肩段被主臂遮住，采用同角色 idle 副手像素补全，接到另一肩关节。
    pistol: {
        source: 'player_gun_idle_pistol_arm',
        width: 512,
        height: 516,
        shoulder: { x: 233, y: 94 },
        removePolygon: [[242, 107], [270, 112], [290, 113], [299, 113], [300, 110], [344, 106], [354, 102], [388, 102], [388, 128], [300, 129], [243, 115]],
    },
};
