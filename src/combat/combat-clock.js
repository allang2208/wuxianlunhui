// 只由未暂停的主循环推进；后台挂起回到前台时仍受 maxDt 截断。
// 从 1 开始，给以 0 作为“尚未发生”哨兵的武器状态留出明确边界。
let elapsedMs = 1;

export function advanceCombatClock(dt) {
    const delta = Number(dt);
    if (Number.isFinite(delta) && delta > 0) elapsedMs += delta;
    return elapsedMs;
}

export function combatNowMs() {
    return elapsedMs;
}
