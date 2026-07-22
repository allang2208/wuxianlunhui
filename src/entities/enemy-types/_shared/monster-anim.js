/**
 * 怪物动画共享件（新怪物工作流基础件）
 *
 * - twoStageWalkKey：两段式移动动画（首段播一轮 → 循环段），按连续移动计时切换
 * - frameHitElapsed：命中帧 → 触发时间（ms）换算（动画时长内第 N 帧触发）
 */

/**
 * 两段式移动动画键
 * @param {string} introKey 首段动画键（播一轮）
 * @param {string} loopKey 循环段动画键
 * @param {number} elapsed 连续移动计时（ms）
 * @param {number} introMs 首段时长（ms）
 */
export function twoStageWalkKey(introKey, loopKey, elapsed, introMs) {
    return elapsed >= introMs ? loopKey : introKey;
}

/**
 * 命中帧 → 触发时间（ms）
 * @param {number} hitFrame 命中帧（1 起）
 * @param {number} startFrame 片段起始帧（0 起）
 * @param {number} fps 帧率
 */
export function frameHitElapsed(hitFrame, startFrame, fps) {
    return (hitFrame - startFrame) / fps * 1000;
}

/**
 * 按比例命中帧 → 触发时间（ms）（(hitFrame-1)/frames × duration）
 */
export function ratioHitElapsed(hitFrame, frames, duration) {
    return ((hitFrame || 1) - 1) / (frames || 1) * (duration || 0);
}
