import populationEconomyConfig from '../../data/population-economy.json';
import { resolveCircleFromIsoFootprint } from '../physics/iso-footprint.js';
import { WallSystem } from './wall-system.js';
import { resolveSpriteDepthProfile } from './sprite-depth-profile.js';

const activeCivilians = new Set();
let cachedStructureSource = null;
let cachedCivilianBuildings = [];

export function getCivilianVisualGroundRadius() {
    return Math.max(1, Number(populationEconomyConfig.civilianVisual?.groundRadius) || 18);
}

function civilianBuildingCandidates(structures = null) {
    const source = structures || WallSystem.collectDynamicStructureDepthEntities();
    if (source === cachedStructureSource) return cachedCivilianBuildings;
    cachedStructureSource = source;
    cachedCivilianBuildings = source.filter((entity) => entity?.active
        && !entity._sinking
        && entity.collisionShape === 'iso_rect'
        && Number(entity.collisionWidth) > 0);
    return cachedCivilianBuildings;
}

function resolveCivilianAt(x, y, radius, structures) {
    let resolvedX = x;
    let resolvedY = y;
    let blocked = false;
    let lastPush = null;
    // 建筑相邻或前角贴合时可能一次推出后进入另一栋，做有限轮收敛。
    for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const entity of structures) {
            const push = resolveCircleFromIsoFootprint(resolvedX, resolvedY, radius, entity);
            if (!push) continue;
            resolvedX += push.x;
            resolvedY += push.y;
            lastPush = push;
            blocked = true;
            moved = true;
        }
        if (!moved) break;
    }
    return { x: resolvedX, y: resolvedY, blocked, lastPush };
}

/** 把平民目标点投影到所有活动建筑 footprint 之外。 */
export function resolveCivilianVisualPosition(x, y, options = {}) {
    const radius = Math.max(1, Number(options.radius) || getCivilianVisualGroundRadius());
    const structures = civilianBuildingCandidates(options.structures);
    return resolveCivilianAt(Number(x) || 0, Number(y) || 0, radius, structures);
}

/**
 * 纯视觉平民的轻量移动扫掠：不创建实体/物理体，但每个小步都对建筑菱形 footprint
 * 做圆形推出。正面撞上建筑、法线推出几乎吃掉全部位移时，选择朝目标更近的切线方向
 * 滑行，避免直线目标位于建筑另一侧时永久顶墙。
 */
export function sweepCivilianVisualMove(worker, targetX, targetY, options = {}) {
    const sprite = worker?.sprite;
    let x = Number.isFinite(worker?.x) ? worker.x : (Number(sprite?.x) || 0);
    let y = Number.isFinite(worker?.y) ? worker.y : (Number(sprite?.y) || 0);
    const endX = Number(targetX) || 0;
    const endY = Number(targetY) || 0;
    const radius = Math.max(1, Number(options.radius) || getCivilianVisualGroundRadius());
    const structures = civilianBuildingCandidates(options.structures);
    const dx = endX - x;
    const dy = endY - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-6 || structures.length === 0) {
        return { x: endX, y: endY, blocked: false };
    }

    const maxStep = Math.max(4, radius * 0.45);
    const steps = Math.min(64, Math.max(1, Math.ceil(distance / maxStep)));
    const stepX = dx / steps;
    const stepY = dy / steps;
    let blocked = false;
    for (let i = 0; i < steps; i++) {
        const fromX = x;
        const fromY = y;
        const direct = resolveCivilianAt(x + stepX, y + stepY, radius, structures);
        x = direct.x;
        y = direct.y;
        if (!direct.blocked) continue;
        blocked = true;

        const actualX = x - fromX;
        const actualY = y - fromY;
        const wantedSq = stepX * stepX + stepY * stepY;
        const forward = actualX * stepX + actualY * stepY;
        const pushLength = Math.hypot(direct.lastPush?.x || 0, direct.lastPush?.y || 0);
        if (wantedSq <= 1e-6 || forward > wantedSq * 0.2 || pushLength <= 1e-6) continue;

        // 直接推进被法线抵消：沿建筑边缘尝试两个切向，选择更接近最终目标的一侧。
        const normalX = direct.lastPush.x / pushLength;
        const normalY = direct.lastPush.y / pushLength;
        const slideLength = Math.sqrt(wantedSq);
        const candidates = [
            { x: -normalY, y: normalX },
            { x: normalY, y: -normalX },
        ].map((tangent) => resolveCivilianAt(
            fromX + tangent.x * slideLength,
            fromY + tangent.y * slideLength,
            radius,
            structures
        ));
        candidates.sort((a, b) =>
            Math.hypot(a.x - endX, a.y - endY) - Math.hypot(b.x - endX, b.y - endY));
        const slide = candidates[0];
        if (slide && Math.hypot(slide.x - fromX, slide.y - fromY)
            > Math.hypot(x - fromX, y - fromY)) {
            x = slide.x;
            y = slide.y;
        }
    }
    return { x, y, blocked };
}

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
export function syncCivilianVisualDepth(worker, structureCandidates = null) {
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
        structureCandidates || WallSystem.collectDynamicStructureDepthEntities()
    ));
}

/**
 * Phaser 渲染帧的平民深度总入口。必须在建筑拓扑深度落定之后调用，避免业务更新阶段
 * 各自写入旧建筑 depth，随后又被本帧建筑 Sprite 覆盖。
 */
export function syncAllCivilianVisualDepths(structureCandidates = null) {
    const candidates = structureCandidates || WallSystem.collectDynamicStructureDepthEntities();
    for (const worker of activeCivilians) {
        if (!worker?.sprite?.active || worker._civilianFadeStarted) {
            activeCivilians.delete(worker);
            continue;
        }
        syncCivilianVisualDepth(worker, candidates);
    }
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
