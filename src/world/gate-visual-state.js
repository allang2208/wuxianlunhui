/** 门叶精灵的纯视觉状态工具；不触碰碰撞、寻路或声音。 */
/**
 * 固定源图列的门切片（调用前设置好中心原点、缩放和镜像；每个精灵只绑定一次）。
 * Phaser 4 的 flipX 会同时镜像 crop UV 的取图列和渲染 quad；直接 setCrop(tx)
 * 会把另一端的图像放进本段底线/depth。改用负 scaleX 镜像完整画布，保持
 * flipX=false，让源图列、世界底线和切片层级始终一一对应。
 */
export function bindGateSourceCrop(sprite, crop, frameHeight) {
    if (!crop || typeof sprite.setCrop !== 'function') return;
    if (sprite.flipX) {
        sprite.setScale(-sprite.scaleX, sprite.scaleY);
        sprite.setFlipX(false);
    }
    const applyCrop = () => sprite.setCrop(crop.x, 0, crop.w, frameHeight);
    const originalSetFrame = sprite.setFrame.bind(sprite);
    sprite.setFrame = (frame, updateSize, updateOrigin) => {
        const result = originalSetFrame(frame, updateSize, updateOrigin);
        // 帧切换后重新计算当前帧在精灵表中的 crop UV。
        applyCrop();
        return result;
    };
    applyCrop();
}

/**
 * 独立刚性门叶用完整关闭帧升降，避免旧序列画布顶部硬裁断。
 * 先绑定源列裁片；只移动视觉Y，不改变六段depth/底线/碰撞。
 * 时间轴末段在顶部淡出，倒放即先在顶部完整淡入、再下落。
 */
export function bindGateLeafMotion(sprite, geo, initialFrame) {
    const motion = geo.leafMotion;
    if (!motion || sprite._gateLeafMotion) return;
    const baseY = sprite.y;
    const baseAlpha = sprite.alpha;
    const last = (geo.frames || 16) - 1;
    const lifts = motion.liftPixels;
    const originalSetFrame = sprite.setFrame.bind(sprite);
    sprite._gateLeafMotion = true;
    sprite.setFrame = (frame, updateSize, updateOrigin) => {
        const progress = Math.max(0, Math.min(last, Number(frame)));
        const openness = progress / last;
        const moveEnd = 1 - motion.fadeFraction;
        const sample = Math.min(1, openness / moveEnd) * (lifts.length - 1);
        const lo = Math.floor(sample), hi = Math.min(lo + 1, lifts.length - 1);
        const lift = lifts[lo] + (lifts[hi] - lifts[lo]) * (sample - lo);
        const fade = Math.max(0, Math.min(1, (openness - moveEnd) / motion.fadeFraction));
        sprite._gateVisualFrame = progress;
        const result = originalSetFrame(0, updateSize, updateOrigin);
        sprite.setY(baseY - lift * sprite.scaleY);
        sprite.setAlpha(baseAlpha * (1 - fade * fade * (3 - 2 * fade)));
        return result;
    };
    sprite.setFrame(initialFrame);
}

/** 矿洞位移/淡化消费连续时间，其它门保留各调用方原有的离散帧。 */
export function updateGateSprites(sprites, frame, quantize = Math.round) {
    for (const sprite of sprites || []) {
        if (!sprite || !sprite.active) continue;
        sprite.setFrame(sprite._gateLeafMotion ? frame : quantize(frame));
    }
}

export function setGateSpritesVisible(sprites, visible) {
    for (const sprite of sprites || []) {
        if (sprite && sprite.active) sprite.setVisible(!!visible);
    }
}

/** 每次开/关门动画前都把门叶显现在确定的起始帧。 */
export function prepareGateSprites(sprites, frame) {
    for (const sprite of sprites || []) {
        if (!sprite || !sprite.active) continue;
        sprite.setVisible(true);
        sprite.setFrame(frame);
    }
}

/** 收口帧并套用“完全开启后消失”的样式合同。 */
export function finishGateSprites(sprites, frame, open, hideWhenOpen) {
    for (const sprite of sprites || []) {
        if (!sprite || !sprite.active) continue;
        sprite.setFrame(frame);
        sprite.setVisible(!(open && hideWhenOpen));
    }
}
