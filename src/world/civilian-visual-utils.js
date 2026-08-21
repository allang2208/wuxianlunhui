import populationEconomyConfig from '../../data/population-economy.json';
import { WallSystem } from './wall-system.js';
import { resolveSpriteDepthProfile } from './sprite-depth-profile.js';

const activeCivilians = new Set();

/**
 * 纯视觉平民通用注册表。这里只登记 Phaser Sprite 记录，不创建游戏实体、物理体或存档对象。
 */
export function registerCivilianVisual(worker, kind) {
    if (!worker) return worker;
    worker.civilianKind = kind || worker.civilianKind || 'civilian';
    worker._civilianFadeStarted = false;
    activeCivilians.add(worker);
    return worker;
}

export function getActiveCivilianVisuals({ excludeKinds = [] } = {}) {
    const excluded = new Set(excludeKinds);
    const result = [];
    for (const worker of activeCivilians) {
        if (!worker?.sprite?.active || worker._civilianFadeStarted) {
            activeCivilians.delete(worker);
            continue;
        }
        if (!excluded.has(worker.civilianKind)) result.push(worker);
    }
    return result;
}

/**
 * 纯视觉平民的统一建筑/墙体遮挡入口。
 * 当前动作帧按 alpha 实测人物可见宽高；depthSideRange 仅作无碰撞平民的最小兜底。
 * 不创建实体、物理体或碰撞体。
 */
export function syncCivilianVisualDepth(worker) {
    const sprite = worker?.sprite;
    if (!sprite?.active) return;

    const x = Number.isFinite(worker.x) ? worker.x : sprite.x;
    const y = Number.isFinite(worker.y) ? worker.y : sprite.y;
    const depthProfile = resolveSpriteDepthProfile(worker, sprite, {
        footOffsetY: 0,
        logicalX: x,
        logicalY: y,
        minFrontRange: 60,
        maxFrontRange: 280,
        minSideRange: Number(populationEconomyConfig.civilianVisual?.depthSideRange) || 18,
    });
    const naturalDepth = y + 10;
    sprite.setDepth(WallSystem.junctionCorrectedDepth(
        x,
        y,
        naturalDepth,
        depthProfile.frontRange,
        depthProfile.sideRange,
        WallSystem.collectDynamicStructureDepthEntities()
    ));
}

/**
 * 统一平民各动作动画的显示尺寸（2026-08-21）：同一单位不同动作素材的帧内容
 * 大小不一（如银行家 running 比 idle 大约 10%），按配置 animations[state].scale
 * 缩放显示尺寸，并按 footRatio（帧内容底边比例，由素材实测）逐状态修正 originY，
 * 保证切换动作时人物大小一致、脚底不上下漂移。scale/footRatio 缺省时回退原行为。
 */
export function applyCivilianAnimSize(sprite, visual, state) {
    if (!sprite?.active) return;
    const anims = visual?.animations || {};
    const def = anims[state];
    if (!def) return;
    const base = Math.max(1, Number(visual.displaySize) || 128);
    const scale = Math.max(0.1, Number(def.scale) || 1);
    sprite.setDisplaySize(base * scale, base * scale);
    const baseOriginY = Number(visual.originY) || 0.8;
    const refFoot = Number(anims.idle?.footRatio) || 0;
    const foot = Number(def.footRatio) || 0;
    if (refFoot > 0 && foot > 0) {
        sprite.setOrigin(0.5, foot - (refFoot - baseOriginY) / scale);
    } else {
        sprite.setOrigin(0.5, baseOriginY);
    }
}

/**
 * 所有纯视觉平民必须通过此入口退出：先立即移出目标池，再淡出并销毁 Sprite。
 */
export function fadeOutAndDestroyCivilian(worker) {
    if (!worker) return;
    activeCivilians.delete(worker);
    if (worker._civilianFadeStarted) return;
    worker._civilianFadeStarted = true;

    const sprite = worker.sprite;
    if (!sprite?.active) return;
    const duration = Math.max(0,
        Number(populationEconomyConfig.civilianVisual?.fadeOutDurationMs) || 320
    );
    const tweens = sprite.scene?.tweens;
    if (duration <= 0 || !tweens?.add) {
        sprite.destroy();
        return;
    }
    tweens.add({
        targets: sprite,
        alpha: 0,
        duration,
        ease: 'Linear',
        onComplete: () => {
            if (sprite.active) sprite.destroy();
        },
    });
}
