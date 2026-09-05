/** 技能贴图只读取逻辑动作时钟；支持变时长帧，不另启 Phaser 播放器。 */
export function attackFrameAt(layout, elapsedMs, durationMs) {
    const count = Math.max(1, layout?.frameCount || 1);
    const durations = layout?.frameDurations;
    const elapsed = Math.max(0, elapsedMs || 0);
    if (Array.isArray(durations) && durations.length === count) {
        const total = durations.reduce((sum, ms) => sum + Math.max(1, Number(ms) || 1), 0);
        let remaining = elapsed * total / Math.max(1, durationMs || total);
        for (let frame = 0; frame < count; frame++) {
            remaining -= Math.max(1, Number(durations[frame]) || 1);
            if (remaining < 0) return frame;
        }
        return count - 1;
    }
    return Math.min(count - 1, Math.floor(elapsed / Math.max(1, durationMs) * count));
}

/** 0-based事件帧的起点；与选帧共用变时长表，避免仅加快后摇时提前命中。 */
export function attackFrameStartMs(layout, frameIndex, durationMs) {
    const count = Math.max(1, layout?.frameCount || 1);
    const frame = Math.max(0, Math.min(count - 1, Math.floor(frameIndex) || 0));
    const durations = layout?.frameDurations;
    if (Array.isArray(durations) && durations.length === count) {
        let total = 0;
        let start = 0;
        for (let index = 0; index < count; index++) {
            const ms = Math.max(1, Number(durations[index]) || 1);
            total += ms;
            if (index < frame) start += ms;
        }
        return start * Math.max(1, durationMs || total) / total;
    }
    return frame * Math.max(1, durationMs) / count;
}
