/** Friendly attacks share the AI's clock with rendering; projectile travel uses real dt. */
export function beginFriendlyAttackClock(ai, key, durationMs, options = {}) {
    const animation = ai.m.animations?.[key] || {};
    const first = options.firstFrame ?? 0;
    const last = options.lastFrame ?? Math.max(0, (animation.frameCount || 1) - 1);
    const interval = Math.max(200, Number(ai._attackInterval) || durationMs);
    const rate = options.fitInterval === false ? 1 : Math.max(1, durationMs / interval);
    const clock = {
        key, state: options.state || key, firstFrame: first, lastFrame: last,
        fps: options.fps ?? animation.frameRate ?? 24,
        frameDurations: animation.frameDurations,
        durationMs, elapsedMs: 0, rate,
    };
    ai.m._friendlyAttackClock = clock;
    return clock;
}

/** Returns action time, so hit/release timers and displayed frames advance together. */
export function advanceFriendlyAttackClock(unit, dt) {
    const clock = unit._friendlyAttackClock;
    const actionDt = Math.max(0, Number(dt) || 0) * (clock?.rate || 1);
    if (clock) clock.elapsedMs = Math.min(clock.durationMs, clock.elapsedMs + actionDt);
    return actionDt;
}

export function friendlyAttackFrame(unit) {
    const clock = unit._friendlyAttackClock;
    if (!clock || unit._animState !== clock.state) return null;
    let frame = clock.firstFrame;
    if (Array.isArray(clock.frameDurations)) {
        let remaining = clock.elapsedMs;
        while (frame < clock.lastFrame && remaining >= clock.frameDurations[frame]) {
            remaining -= clock.frameDurations[frame++];
        }
    } else {
        frame += Math.floor(clock.elapsedMs * clock.fps / 1000);
    }
    return { key: clock.key, frame: Math.min(clock.lastFrame, frame) };
}
