// 盾牌运行时与面板共用的口径。damageReduction 是承伤比例；parryAngle 是半角。
export function getShieldDefenseValues(item, skillEffect = {}) {
    const defense = item?.defense || {};
    const finite = (value, fallback) => Number.isFinite(Number(value)) && value != null
        ? Number(value) : fallback;
    const nonNegative = (value, fallback) => Math.max(0, finite(value, fallback));
    const base = nonNegative(defense.base, 0);
    const perEnhance = nonNegative(defense.perEnhance, 0);
    const baseDamageRatio = Math.min(1, nonNegative(defense.damageReduction, 0.5));
    return {
        base,
        perEnhance,
        defense: Math.floor(base + perEnhance * nonNegative(item?.enhanceLevel, 0)),
        baseDamageRatio,
        // 百分点相减收敛浮点尾差，避免50×(0.5-0.4)被下游floor误扣成4而不是5。
        remainingDamageRatio: Math.max(0.05, Math.round((baseDamageRatio
            - nonNegative(skillEffect.damageReductionBonus, 0)) * 1e6) / 1e6),
        staminaCost: nonNegative(defense.staminaCost, 20),
        parryWindow: nonNegative(defense.parryWindow, 1000),
        // 保留旧版左右各120度的宽容范围，不借命名修正收窄成总计120度。
        parryHalfAngle: Math.min(180, nonNegative(defense.parryAngle, 120)),
        parryStun: nonNegative(defense.parryStun, 1000)
            + nonNegative(skillEffect.parryStunBonus, 0) * 1000,
        parryKnockback: nonNegative(defense.parryKnockback, 100),
        stunOnExhaustion: nonNegative(defense.stunOnExhaustion, 1500),
    };
}

// 盾脐为盾牌自身的握点；人物握点由 PlayerShieldRig 的副手骨链提供。
// 仅渲染数据，不参与碰撞、格挡方向或弹反计时。
export const PLAYER_SHIELD_VISUAL = {
    originX: 578 / 1024,
    originY: 497 / 1024,
    visibleHeightRatio: 760 / 1024,
    bodyHeightRatio: 0.42,
    // 未标定的奔跑等动作沿用身体挂载；普通步行与近战动作另读 player-shield-poses。
    fallbackAnchor: { x: 327 / 516, y: 268 / 516 },
    restTilt: -0.12,
    // Phaser 正角为顺时针。右向时负角让盾牌上沿向左贴近角色、下沿向右远离角色；
    // 左向由 mirror 自动反号，保持相同的人体工学内倾关系。
    guardTilt: -0.14,
    raiseMs: 200,
    lowerMs: 180,
};

// idle.png 原图逐关节标定（516×516）。主剑位在另一侧；这里是源图右臂。
// 分层仅复制原图像素，关节旋转不拉伸骨长，不改原始 PNG / 主手动画轨迹。
export const PLAYER_SHIELD_ARM = {
    source: 'player_idle',
    width: 516,
    height: 516,
    // 长按防御移动采用上下身分层：idle 保持胸廓/双臂和盾脐，现有 walk_body
    // 只从全部旧手臂像素下方开始显示腿部。旧walk掌部最深到约y=313，裁线留出
    // 7px安全区；上下层保留16px纵向重叠，由上身盖住膝上接缝。
    walkSplit: {
        animKey: 'walk',
        upperCutY: 336,
        lowerCropY: 320,
        frameWidth: 512,
        frameHeight: 516,
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
