/** 三段尸体时钟：动作、停留、淡出均由游戏dt推进，不受墙钟清理抢跑。 */
export function startCorpseTimeline(entity, config) {
    entity._deathAnimTimer = Math.max(1, Number(config.animMs) || 1);
    entity._corpseTimer = Math.max(0, Number(config.holdMs) || 0);
    entity._fadeTimer = Math.max(0, Number(config.fadeMs) || 0);
    entity._corpseFadeDuration = entity._fadeTimer;
    entity._deathRemoveDelay = Infinity;
}

export function updateCorpseTimeline(entity, dt) {
    let remaining = Math.max(0, Number(dt) || 0);
    for (const timer of ['_deathAnimTimer', '_corpseTimer', '_fadeTimer']) {
        const consumed = Math.min(entity[timer], remaining);
        entity[timer] -= consumed;
        remaining -= consumed;
    }
    if (entity._deathAnimTimer > 0 || entity._corpseTimer > 0) return;
    if (entity._phaserSprite?.active) {
        entity._phaserSprite.setAlpha(entity._corpseFadeDuration > 0
            ? entity._fadeTimer / entity._corpseFadeDuration : 0);
    }
    if (entity._fadeTimer <= 0) {
        entity._phaserSprite?.destroy();
        entity._phaserSprite = null;
        entity._deathRemoveDelay = 0;
    }
}
