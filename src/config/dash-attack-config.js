const DASH_READY_BASE_MS = Object.freeze({
    dashAttack: 1000,
    dashAttackFire: 1000,
    dashAttackThrust: 1000,
});

const DASH_READY_REDUCTION_PER_LEVEL = 0.03;

/**
 * 冲刺攻击连续奔跑到可释放所需的时间。
 * skills.json 的 readyMs 是正式真源；缺失/旧缓存时才按当前技能的基准值回退。
 */
export function getDashReadyTimeMs(skillId, level = 1, skill = null) {
    const safeLevel = Math.max(1, Number(level) || 1);
    const configured = Number(skill?.getEffect?.(safeLevel)?.readyMs);
    if (Number.isFinite(configured) && configured > 0) return configured;

    const base = DASH_READY_BASE_MS[skillId] ?? DASH_READY_BASE_MS.dashAttack;
    return Math.max(1, base * (1 - (safeLevel - 1) * DASH_READY_REDUCTION_PER_LEVEL));
}

export { DASH_READY_BASE_MS, DASH_READY_REDUCTION_PER_LEVEL };
