/** 门叶精灵的纯视觉状态工具；不触碰碰撞、寻路或声音。 */
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
