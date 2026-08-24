import populationEconomyConfig from '../../data/population-economy.json';
import {
    isoFootprintVertices,
    resolveCircleFromIsoFootprint,
} from '../physics/iso-footprint.js';
import { WallSystem } from './wall-system.js';
import { resolveSpriteDepthProfile } from './sprite-depth-profile.js';

const activeCivilians = new Set();
let cachedStructureSource = null;
let cachedCivilianBuildings = [];
let cachedSegmentSource = null;
let cachedSegmentRevision = -1;
let cachedSegmentLength = -1;
let cachedCivilianSegments = [];
let lastCivilianTopologySignature = null;
let nextCivilianBuildingId = 1;
const civilianBuildingIds = new WeakMap();
let civilianDebugGraphics = null;
let lastCivilianBlockingContext = null;
const warnedCivilianStructureContracts = new WeakSet();

export function getCivilianVisualGroundRadius() {
    return Math.max(1, Number(populationEconomyConfig.civilianVisual?.groundRadius) || 18);
}

function civilianBuildingCandidates(structures = null) {
    const source = structures || WallSystem.collectDynamicStructureDepthEntities();
    if (source === cachedStructureSource) return cachedCivilianBuildings;
    cachedStructureSource = source;
    cachedCivilianBuildings = source.filter((entity) => entity?.active
        && !entity._sinking
        && entity._civilianBlocksVisuals !== false
        && entity.collisionShape === 'iso_rect'
        && Number(entity.collisionWidth) > 0);
    return cachedCivilianBuildings;
}

/**
 * 动态墙段是真正的开关门/墙/楼梯侧边真源：关门时门洞段存在，开门时被移除。
 * 掩体本身已经有 iso footprint，排除其重复线段，避免同一堵墙把平民推出两次。
 */
function civilianSegmentCandidates(segments = null) {
    const source = segments || WallSystem.isoSegments || [];
    const revision = segments ? -1 : (Number(WallSystem._collisionRevision) || 0);
    if (source === cachedSegmentSource
        && revision === cachedSegmentRevision
        && source.length === cachedSegmentLength) return cachedCivilianSegments;
    cachedSegmentSource = source;
    cachedSegmentRevision = revision;
    cachedSegmentLength = source.length;
    cachedCivilianSegments = Array.from(source).filter((segment) => segment
        && segment._civilianBlocksVisuals !== false
        && !segment._cover
        && !segment._elevatedOnly
        && Number.isFinite(Number(segment.x1))
        && Number.isFinite(Number(segment.y1))
        && Number.isFinite(Number(segment.x2))
        && Number.isFinite(Number(segment.y2)));
    return cachedCivilianSegments;
}

function civilianBlockingContext(structures = null, segments = null) {
    return {
        buildings: civilianBuildingCandidates(structures),
        segments: civilianSegmentCandidates(segments),
    };
}

function resolveCircleFromSegment(x, y, radius, segment) {
    const ax = Number(segment.x1) || 0;
    const ay = Number(segment.y1) || 0;
    const bx = Number(segment.x2) || 0;
    const by = Number(segment.y2) || 0;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-8) return null;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
    const nearestX = ax + dx * t;
    const nearestY = ay + dy * t;
    let nx = x - nearestX;
    let ny = y - nearestY;
    let distance = Math.hypot(nx, ny);
    const required = Math.max(1, Number(radius) || 1)
        + Math.max(0, Number(segment.halfThick) || 0);
    if (distance >= required) return null;
    if (distance <= 1e-6) {
        const length = Math.sqrt(lengthSq);
        nx = -dy / length;
        ny = dx / length;
        distance = 0;
    } else {
        nx /= distance;
        ny /= distance;
    }
    const amount = required - distance + 0.01;
    return { x: nx * amount, y: ny * amount };
}

function resolveCivilianAt(x, y, radius, context) {
    let resolvedX = x;
    let resolvedY = y;
    let blocked = false;
    let lastPush = null;
    // 建筑、墙门相邻或前角贴合时可能一次推出后进入另一阻挡体，做有限轮收敛。
    for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const entity of context.buildings) {
            const push = resolveCircleFromIsoFootprint(resolvedX, resolvedY, radius, entity);
            if (!push) continue;
            resolvedX += push.x;
            resolvedY += push.y;
            lastPush = push;
            blocked = true;
            moved = true;
        }
        for (const segment of context.segments) {
            const push = resolveCircleFromSegment(resolvedX, resolvedY, radius, segment);
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

function civilianBuildingId(entity) {
    let id = civilianBuildingIds.get(entity);
    if (!id) {
        id = nextCivilianBuildingId++;
        civilianBuildingIds.set(entity, id);
    }
    return id;
}

/** 只在建筑/墙门集合或占地发生变化时重新安置静止平民，避免逐平民逐帧重投影。 */
function civilianTopologySignature(context) {
    const buildingSignature = context.buildings.map((entity) => [
        civilianBuildingId(entity),
        Number(entity._structureFootprintRevision) || 0,
        Number(entity.x) || 0,
        Number(entity.y) || 0,
        Number(entity.colliderOffsetX) || 0,
        Number(entity.colliderOffsetY) || 0,
        Number(entity.collisionWidth) || 0,
        Number(entity.collisionHeight) || 0,
        Number(entity.collisionIsoHalfU) || 0,
        Number(entity.collisionIsoHalfV) || 0,
    ].join(':')).join('|');
    // isoSegments 的跟踪数组在 push/splice/替换时会递增 revision；开门移除门洞段、
    // 关门重新加入时因此能触发一次静止平民重投影，而不再逐帧序列化全部墙段。
    const wallRevision = Number(WallSystem._collisionRevision) || 0;
    return `${buildingSignature}#walls:${wallRevision}:${context.segments.length}`;
}

function setCivilianVisualPosition(worker, x, y) {
    const previousX = Number.isFinite(worker.x) ? worker.x : (Number(worker.sprite?.x) || x);
    const previousY = Number.isFinite(worker.y) ? worker.y : (Number(worker.sprite?.y) || y);
    worker.x = x;
    worker.y = y;
    // 农夫使用分段缓动。建筑拓扑把它推出时同步平移本段起点，避免下一帧仍从旧起点
    // 计算期望位置并重新撞回建筑。
    if (Number.isFinite(worker.moveFromX)) worker.moveFromX += x - previousX;
    if (Number.isFinite(worker.moveFromY)) worker.moveFromY += y - previousY;
    worker.sprite?.setPosition?.(x, y);
}

function reconcileCivilianVisualOccupancy(worker, context) {
    const sprite = worker?.sprite;
    if (!sprite?.active) return;
    // 面包师等可选择只受城墙约束；深度仲裁仍读取完整建筑候选，因此穿楼不等于穿模显示。
    const blockingContext = worker.civilianCollisionMode === 'walls_only'
        ? { ...context, buildings: [] }
        : context;
    const radius = getCivilianVisualGroundRadius();
    const x = Number.isFinite(worker.x) ? worker.x : (Number(sprite.x) || 0);
    const y = Number.isFinite(worker.y) ? worker.y : (Number(sprite.y) || 0);
    const current = resolveCivilianAt(x, y, radius, blockingContext);
    if (current.blocked) setCivilianVisualPosition(worker, current.x, current.y);

    // 新建筑或关闭的门也可能正好压住既有目标；目标一并投影，避免平民持续尝试走回阻挡区。
    if (Number.isFinite(worker.destination?.x) && Number.isFinite(worker.destination?.y)) {
        const destination = resolveCivilianAt(
            worker.destination.x,
            worker.destination.y,
            radius,
            blockingContext
        );
        worker.destination = { ...worker.destination, x: destination.x, y: destination.y };
    }
    if (Number.isFinite(worker.targetX) && Number.isFinite(worker.targetY)) {
        const target = resolveCivilianAt(worker.targetX, worker.targetY, radius, blockingContext);
        worker.targetX = target.x;
        worker.targetY = target.y;
    }
}

/** 把平民目标点投影到所有活动建筑 footprint 与有效地面墙门段之外。 */
export function resolveCivilianVisualPosition(x, y, options = {}) {
    const radius = Math.max(1, Number(options.radius) || getCivilianVisualGroundRadius());
    const context = civilianBlockingContext(options.structures, options.segments);
    return resolveCivilianAt(Number(x) || 0, Number(y) || 0, radius, context);
}

/**
 * 纯视觉平民的轻量移动扫掠：不创建实体/物理体，但每个小步都对建筑菱形 footprint
 * 和有效地面墙门段做圆形推出。正面撞上阻挡体、法线推出几乎吃掉全部位移时，选择朝目标更近的切线方向
 * 滑行，避免直线目标位于建筑另一侧时永久顶墙。
 */
export function sweepCivilianVisualMove(worker, targetX, targetY, options = {}) {
    const sprite = worker?.sprite;
    let x = Number.isFinite(worker?.x) ? worker.x : (Number(sprite?.x) || 0);
    let y = Number.isFinite(worker?.y) ? worker.y : (Number(sprite?.y) || 0);
    const endX = Number(targetX) || 0;
    const endY = Number(targetY) || 0;
    const radius = Math.max(1, Number(options.radius) || getCivilianVisualGroundRadius());
    const context = civilianBlockingContext(options.structures, options.segments);
    const dx = endX - x;
    const dy = endY - y;
    const distance = Math.hypot(dx, dy);
    if (context.buildings.length === 0 && context.segments.length === 0) {
        return { x: endX, y: endY, blocked: false };
    }
    if (distance <= 1e-6) return resolveCivilianAt(endX, endY, radius, context);

    const maxStep = Math.max(4, radius * 0.45);
    const steps = Math.min(64, Math.max(1, Math.ceil(distance / maxStep)));
    const stepX = dx / steps;
    const stepY = dy / steps;
    let blocked = false;
    for (let i = 0; i < steps; i++) {
        const fromX = x;
        const fromY = y;
        const direct = resolveCivilianAt(x + stepX, y + stepY, radius, context);
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
            context
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
    // 所有纯视觉平民统一持有逻辑脚点；Sprite 只是该脚点的显示结果。
    if (!Number.isFinite(worker.x)) worker.x = Number(worker.sprite?.x) || 0;
    if (!Number.isFinite(worker.y)) worker.y = Number(worker.sprite?.y) || 0;
    activeCivilians.add(worker);
    // 创建阶段也使用统一仲裁入口，业务系统不再各自写一个临时 depth。
    syncCivilianVisualDepth(worker);
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

function auditCivilianStructureContracts() {
    const entities = (typeof window !== 'undefined') ? window.Game?.entities : null;
    if (!entities?.values) return;
    for (const entity of entities.values()) {
        if (!entity?.active || warnedCivilianStructureContracts.has(entity)) continue;
        const buildingSemantic = entity._isGridBuilding
            || entity._isDefenseStructure
            || entity._isProducerBuilding;
        if (!buildingSemantic) continue;
        const hasDepthGeometry = entity._structureDepthMode
            || (Array.isArray(entity._faceLines) && entity._faceLines.length > 0)
            || (Array.isArray(entity._faceLine) && entity._faceLine.length === 2)
            || entity._isCoverGate;
        const hasOccupancyGeometry = entity._civilianBlocksVisuals === false
            || (entity.collisionShape === 'iso_rect' && Number(entity.collisionWidth) > 0)
            || entity._isCoverGate;
        if (hasDepthGeometry && hasOccupancyGeometry) continue;
        warnedCivilianStructureContracts.add(entity);
        console.warn('[CivilianVisual] 建筑未完整接入平民遮挡契约', {
            id: entity.id,
            name: entity.name,
            hasDepthGeometry,
            hasOccupancyGeometry,
            collisionShape: entity.collisionShape,
        });
    }
}

function civilianVisualDebugEnabled() {
    return (typeof window !== 'undefined' && window.__civilianVisualDebug === true);
}

function destroyCivilianDebugGraphics() {
    if (civilianDebugGraphics?.active) civilianDebugGraphics.destroy();
    civilianDebugGraphics = null;
}

function syncCivilianDebugOverlay(context) {
    lastCivilianBlockingContext = context;
    if (!civilianVisualDebugEnabled()) {
        destroyCivilianDebugGraphics();
        return;
    }
    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
    if (!scene?.add?.graphics) return;
    if (!civilianDebugGraphics?.active || civilianDebugGraphics.scene !== scene) {
        destroyCivilianDebugGraphics();
        civilianDebugGraphics = scene.add.graphics();
        civilianDebugGraphics.setDepth(999999);
    }
    const graphics = civilianDebugGraphics;
    graphics.clear();
    graphics.lineStyle(2, 0x42a5f5, 0.9);
    for (const entity of context.buildings) {
        const vertices = isoFootprintVertices(entity);
        if (vertices.length === 4) graphics.strokePoints(vertices, true);
    }
    graphics.lineStyle(2, 0xff7043, 0.9);
    for (const segment of context.segments) {
        graphics.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
    }
    const radius = getCivilianVisualGroundRadius();
    graphics.lineStyle(2, 0xffd54f, 1);
    for (const worker of activeCivilians) {
        if (!worker?.sprite?.active || worker._civilianFadeStarted) continue;
        const x = Number.isFinite(worker.x) ? worker.x : worker.sprite.x;
        const y = Number.isFinite(worker.y) ? worker.y : worker.sprite.y;
        graphics.strokeCircle(x, y, radius);
        graphics.lineBetween(x - 4, y, x + 4, y);
        graphics.lineBetween(x, y - 4, x, y + 4);
    }
}

export function setCivilianVisualDebugEnabled(enabled) {
    if (typeof window !== 'undefined') window.__civilianVisualDebug = !!enabled;
    if (!enabled) destroyCivilianDebugGraphics();
}

export function getCivilianVisualDebugSnapshot() {
    const context = lastCivilianBlockingContext || civilianBlockingContext();
    return {
        enabled: civilianVisualDebugEnabled(),
        buildingCount: context.buildings.length,
        segmentCount: context.segments.length,
        civilians: getActiveCivilianVisuals().map((worker) => ({
            kind: worker.civilianKind,
            x: Number.isFinite(worker.x) ? worker.x : worker.sprite?.x,
            y: Number.isFinite(worker.y) ? worker.y : worker.sprite?.y,
            depth: worker.sprite?.depth,
        })),
    };
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
    sprite.setDepth(WallSystem.resolveDynamicEntityDepth(
        x,
        y,
        naturalDepth,
        depthProfile.frontRange,
        depthProfile.sideRange,
        depthProfile.visibleWorldBounds,
        structureCandidates || WallSystem.collectDynamicStructureDepthEntities()
    ));
}

/**
 * Phaser 渲染帧的平民深度总入口。必须在建筑拓扑深度落定之后调用，避免业务更新阶段
 * 各自写入旧建筑 depth，随后又被本帧建筑 Sprite 覆盖。
 */
export function syncAllCivilianVisualDepths(structureCandidates = null) {
    const candidates = structureCandidates || WallSystem.collectDynamicStructureDepthEntities();
    const context = civilianBlockingContext(candidates);
    const topologySignature = civilianTopologySignature(context);
    const topologyChanged = topologySignature !== lastCivilianTopologySignature;
    lastCivilianTopologySignature = topologySignature;
    if (topologyChanged) auditCivilianStructureContracts();
    for (const worker of activeCivilians) {
        if (!worker?.sprite?.active || worker._civilianFadeStarted) {
            activeCivilians.delete(worker);
            continue;
        }
        if (topologyChanged) reconcileCivilianVisualOccupancy(worker, context);
        syncCivilianVisualDepth(worker, candidates);
    }
    syncCivilianDebugOverlay(context);
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

if (typeof window !== 'undefined') {
    window.CivilianVisualDebug = {
        setEnabled: setCivilianVisualDebugEnabled,
        snapshot: getCivilianVisualDebugSnapshot,
    };
}
