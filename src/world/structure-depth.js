// ============================================================
import { isoFootprintVertices } from '../physics/iso-footprint.js';
import {
    compareIsoBoundsOrder,
    pointIsoBounds,
    structureIsoBounds,
    visualBoundsOverlap,
} from './structure-render-order.js';
// 建筑图层统一口径（2026-08-16，世界-122 全建筑共用）
//
// 唯一规则（与掩体/铁闸门/仓鼠小屋同一套）：
// - iso_rect 建筑：以完整地面 footprint 的屏幕前缘为排序边界；
// - 墙/门等线结构：以实际接地面线为排序边界；
// - `_faceDepth`：统一由 `structureDepthAtY(前缘Y)` 生成；
// - 普通建筑与移动单位共用 u/v footprint 前后关系；墙/门仍走面线仲裁；
//
// 新建筑/新结构构造时调用一次 `setupStructureDepth(entity, halfWidth)` 即可，
// 后续只要走 applyBuildingFootprint/rebuildCollider，深度几何会自动刷新；不需要再为
// 贴图尺寸、2×2/4×4 占地或 colliderOffset 编写图层补偿。
// ============================================================

/** 与动态单位脚底 depth（worldY + 10）保持同一排序空间，并预留 2px 接缝余量。 */
export const STRUCTURE_DEPTH_OFFSET = 12;
export const STRUCTURE_DEPTH_EPSILON = 0.5;

export function structureDepthAtY(frontY, bias = 0) {
    return (Number(frontY) || 0) + STRUCTURE_DEPTH_OFFSET + (Number(bias) || 0);
}

/** 按当前逻辑坐标/footprint 刷新建筑遮挡几何；不依赖可能尚未重建的 Collider。 */
export function refreshStructureDepth(entity) {
    if (!entity) return entity;
    const bias = Number(entity._structureDepthBias) || 0;
    if (entity._structureDepthMode === 'iso_footprint') {
        const vertices = isoFootprintVertices(entity);
        const byKey = Object.fromEntries(vertices.map((p) => [p.key, p]));
        if (!byKey.back || !byKey.left || !byKey.front || !byKey.right) return entity;
        entity._structureDepthHalfWidth = entity.collisionWidth / 2;
        entity._faceLines = [
            [byKey.left, byKey.front],
            [byKey.front, byKey.right],
        ];
        entity._faceLine = [byKey.left, byKey.right]; // 旧读取入口保留
        entity._structureBackY = byKey.back.y;
        entity._structureFrontY = byKey.front.y;
        entity._structureBackDepth = structureDepthAtY(byKey.back.y, bias);
        entity._structureFrontDepth = structureDepthAtY(byKey.front.y, bias);
        entity._faceDepth = entity._structureFrontDepth;
        // footprint/位置变化必须同步刷新拓扑基准。此前只更新遮挡线，却保留首次渲染时
        // 缓存的 _structureTopologyBaseDepth，移动、重建或运行时校正后的建筑会继续按旧位置排序。
        entity._structureTopologyBaseDepth = entity._structureFrontDepth;
        return entity;
    }

    const w = Math.max(1, Number(entity._structureDepthHalfWidth) || 1);
    const y = (Number(entity.y) || 0) + (Number(entity._structureDepthOffsetY) || 0);
    entity._faceLine = [
        { x: entity.x - w, y },
        { x: entity.x + w, y },
    ];
    entity._faceLines = [entity._faceLine];
    entity._faceDepth = structureDepthAtY(y, bias);
    entity._structureBackY = y;
    entity._structureFrontY = y;
    entity._structureBackDepth = entity._faceDepth;
    entity._structureFrontDepth = entity._faceDepth;
    entity._structureTopologyBaseDepth = entity._faceDepth;
    return entity;
}

/** 渲染器使用的完整深度跨度；旧/非 footprint 结构退化为单层。 */
export function structureDepthSpan(entity) {
    if (!entity) return null;
    if (!Number.isFinite(entity._structureFrontDepth)
        || !Number.isFinite(entity._structureBackDepth)) {
        refreshStructureDepth(entity);
    }
    if (!Number.isFinite(entity._structureFrontDepth)
        || !Number.isFinite(entity._structureBackDepth)) return null;
    return {
        backY: entity._structureBackY,
        frontY: entity._structureFrontY,
        backDepth: entity._structureBackDepth,
        frontDepth: entity._structureFrontDepth,
    };
}

/**
 * 普通格网建筑主体的世界可见 AABB。
 *
 * 逻辑 footprint 只描述占格；贴图为了容纳屋檐、台阶或底座，画布通常会比 footprint
 * 略宽。单位与这些外伸像素已经相交时也必须参加拓扑仲裁，否则左右前角会出现一条
 * “画面重叠但算法未命中”的错层窄带。范围由统一 visualFootprint 反推，不为具体建筑
 * 维护额外偏移；运行时已有最终视觉缩放/偏移时优先读取最终值。
 */
export function structureOcclusionBounds(entity) {
    if (!entity || entity._structureDepthMode !== 'iso_footprint') return null;
    const vertices = isoFootprintVertices(entity);
    let logicalMinX = Infinity;
    let logicalMaxX = -Infinity;
    let logicalMinY = Infinity;
    let logicalMaxY = -Infinity;
    for (const point of vertices) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
        logicalMinX = Math.min(logicalMinX, point.x);
        logicalMaxX = Math.max(logicalMaxX, point.x);
        logicalMinY = Math.min(logicalMinY, point.y);
        logicalMaxY = Math.max(logicalMaxY, point.y);
    }
    if (!Number.isFinite(logicalMinX) || !Number.isFinite(logicalMaxX)
        || !Number.isFinite(logicalMinY) || !Number.isFinite(logicalMaxY)) return null;

    const runtimeMinX = Number(entity._structureOcclusionVisualMinX);
    const runtimeMaxX = Number(entity._structureOcclusionVisualMaxX);
    const runtimeMinY = Number(entity._structureOcclusionVisualMinY);
    const runtimeMaxY = Number(entity._structureOcclusionVisualMaxY);
    if (Number.isFinite(runtimeMinX) && Number.isFinite(runtimeMaxX)
        && Number.isFinite(runtimeMinY) && Number.isFinite(runtimeMaxY)) {
        return {
            minX: Math.min(logicalMinX, runtimeMinX),
            maxX: Math.max(logicalMaxX, runtimeMaxX),
            minY: Math.min(logicalMinY, runtimeMinY),
            maxY: Math.max(logicalMaxY, runtimeMaxY),
            logicalMinX,
            logicalMaxX,
            logicalMinY,
            logicalMaxY,
        };
    }

    const cfg = entity.spriteCfg || {};
    const calibration = cfg.visualFootprint;
    const configuredWidth = Math.max(0, Number(cfg.size) || 0);
    const configuredHeight = Math.max(0, Number(cfg.sizeH) || configuredWidth);
    const runtimeScaleX = Number(entity._structureVisualScaleX ?? entity._structureVisualScale);
    const runtimeScaleY = Number(entity._structureVisualScaleY ?? entity._structureVisualScale);
    const calibratedWidthRatio = Number(calibration?.widthRatio);
    const collisionWidth = Math.max(0, Number(entity.collisionWidth) || 0);
    let displayWidth = Number.isFinite(runtimeScaleX) && runtimeScaleX > 0 && configuredWidth > 0
        ? configuredWidth * runtimeScaleX
        : 0;
    if (!(displayWidth > 0) && calibratedWidthRatio > 0 && collisionWidth > 0) {
        displayWidth = collisionWidth / calibratedWidthRatio;
    }
    if (!(displayWidth > 0)) displayWidth = configuredWidth;
    if (!(displayWidth > 0)) {
        return {
            minX: logicalMinX,
            maxX: logicalMaxX,
            minY: logicalMinY,
            maxY: logicalMaxY,
            logicalMinX,
            logicalMaxX,
            logicalMinY,
            logicalMaxY,
        };
    }
    const displayHeight = Number.isFinite(runtimeScaleY) && runtimeScaleY > 0
        ? configuredHeight * runtimeScaleY
        : configuredHeight;

    let visualOffsetX = Number(entity._visualFootOffsetX);
    if (!Number.isFinite(visualOffsetX)) {
        const centerXRatio = Number(calibration?.centerXRatio);
        visualOffsetX = Number.isFinite(centerXRatio)
            ? -(centerXRatio - 0.5) * displayWidth
            : (Number(cfg.offsetX) || 0);
    }
    const visualCenterX = (Number(entity.x) || 0) + visualOffsetX;
    let visualFootOffsetY = Number(entity._visualFootOffsetY);
    if (!Number.isFinite(visualFootOffsetY)) {
        visualFootOffsetY = (Number(cfg.footOffsetY) || configuredHeight * 0.5)
            * (Number.isFinite(runtimeScaleY) && runtimeScaleY > 0 ? runtimeScaleY : 1);
    }
    const visualCenterY = (Number(entity.y) || 0) - visualFootOffsetY;
    let visualMinX = visualCenterX - displayWidth * 0.5;
    let visualMaxX = visualCenterX + displayWidth * 0.5;
    let visualMinY = visualCenterY - displayHeight * 0.5;
    let visualMaxY = visualCenterY + displayHeight * 0.5;
    const overlay = cfg.overlayAnimation;
    if (overlay) {
        const scaleX = Number.isFinite(runtimeScaleX) && runtimeScaleX > 0 ? runtimeScaleX : 1;
        const scaleY = Number.isFinite(runtimeScaleY) && runtimeScaleY > 0 ? runtimeScaleY : 1;
        const overlayWidth = Number(overlay.displayW) > 0
            ? Number(overlay.displayW) * scaleX
            : displayWidth;
        const overlayHeight = Number(overlay.displayH) > 0
            ? Number(overlay.displayH) * scaleY
            : displayHeight;
        const overlayCenterX = visualCenterX + (Number(overlay.offsetX) || 0) * scaleX;
        const overlayCenterY = visualCenterY + (Number(overlay.offsetY) || 0) * scaleY;
        visualMinX = Math.min(visualMinX, overlayCenterX - overlayWidth * 0.5);
        visualMaxX = Math.max(visualMaxX, overlayCenterX + overlayWidth * 0.5);
        visualMinY = Math.min(visualMinY, overlayCenterY - overlayHeight * 0.5);
        visualMaxY = Math.max(visualMaxY, overlayCenterY + overlayHeight * 0.5);
    }
    return {
        minX: Math.min(logicalMinX, visualMinX),
        maxX: Math.max(logicalMaxX, visualMaxX),
        minY: Math.min(logicalMinY, visualMinY),
        maxY: Math.max(logicalMaxY, visualMaxY),
        logicalMinX,
        logicalMaxX,
        logicalMinY,
        logicalMaxY,
    };
}

/**
 * 移动节点相对所有真实画面相交建筑的统一深度约束。
 * lowerDepth：节点必须绘制在这些建筑之后；upperDepth：必须绘制在这些建筑之前。
 */
export function dynamicStructureDepthConstraints(
    x,
    y,
    naturalDepth,
    visualBounds,
    structures,
    epsilon = STRUCTURE_DEPTH_EPSILON
) {
    const px = Number(x) || 0;
    const py = Number(y) || 0;
    const baseDepth = Number(naturalDepth) || 0;
    const unitVisualBounds = visualBounds && Number.isFinite(visualBounds.minX)
        && Number.isFinite(visualBounds.maxX)
        && Number.isFinite(visualBounds.minY)
        && Number.isFinite(visualBounds.maxY)
        ? visualBounds
        : { minX: px, maxX: px, minY: py, maxY: py };
    const unitGroundBounds = pointIsoBounds(px, py);
    let lowerDepth = -Infinity;
    let upperDepth = Infinity;
    let matched = 0;

    for (const structure of structures || []) {
        if (!structure?.active || structure._structureDepthMode !== 'iso_footprint') continue;
        const structureVisualBounds = structureOcclusionBounds(structure);
        if (!visualBoundsOverlap(unitVisualBounds, structureVisualBounds)) continue;
        const structureGroundBounds = structureIsoBounds(structure);
        if (!structureGroundBounds) continue;

        const renderDepth = Number.isFinite(structure._structureRenderDepth)
            ? structure._structureRenderDepth
            : (Number.isFinite(structure._structureFrontDepth)
                ? structure._structureFrontDepth
                : structureDepthAtY(structure.y, structure._structureDepthBias));
        const structureBaseDepth = Number.isFinite(structure._structureTopologyBaseDepth)
            ? structure._structureTopologyBaseDepth
            : renderDepth;
        let relation = compareIsoBoundsOrder(unitGroundBounds, structureGroundBounds);
        if (relation === 0) {
            // 斜向交叉/同角接触时，与静态结构的 stableNodeCompare 一样回退自然深度；
            // 完全同深度时让移动节点居前，避免停在建筑边缘时被创建顺序随机压住。
            relation = baseDepth < structureBaseDepth ? -1 : 1;
        }
        matched++;
        if (relation < 0) upperDepth = Math.min(upperDepth, renderDepth - epsilon);
        else lowerDepth = Math.max(lowerDepth, renderDepth + epsilon);
    }

    return {
        lowerDepth,
        upperDepth,
        matched,
        conflict: lowerDepth > upperDepth,
    };
}

export function resolveDynamicStructureDepth(
    x,
    y,
    naturalDepth,
    visualBounds,
    structures,
    epsilon = STRUCTURE_DEPTH_EPSILON
) {
    const natural = Number(naturalDepth) || 0;
    const constraints = dynamicStructureDepthConstraints(
        x,
        y,
        natural,
        visualBounds,
        structures,
        epsilon
    );
    if (constraints.matched === 0) return natural;
    if (!constraints.conflict) {
        return Math.max(constraints.lowerDepth, Math.min(constraints.upperDepth, natural));
    }
    // 理论上统一静态 gap 与同源 u/v 关系后不会进入此分支；旧存档中的异常重叠结构
    // 仍按离自然脚线最近的稳定边界收敛，禁止在两条互斥分支间逐帧翻转。
    const lowerDistance = Math.abs(constraints.lowerDepth - natural);
    const upperDistance = Math.abs(natural - constraints.upperDepth);
    return lowerDistance <= upperDistance ? constraints.lowerDepth : constraints.upperDepth;
}

/**
 * 给建筑实体注册统一遮挡锚线。
 * @param {object} entity 建筑实体（x/y 已就位）
 * @param {number|null} halfWidth 接地线半宽；省略时取 collisionWidth/2
 * @param {number} [y=entity.y] 接地线 y（缺省脚底）
 * @param {number} [bias=0] 深度额外偏移（掩体上夹角左臂等特例用）
 * @returns {object} entity
 */
export function setupStructureDepth(entity, halfWidth = null, y = entity.y, bias = 0) {
    if (entity?.collisionShape === 'iso_rect') {
        entity._structureDepthMode = 'iso_footprint';
    } else {
        const footprintHalfW = entity && entity.collisionWidth > 0 ? entity.collisionWidth / 2 : 0;
        entity._structureDepthMode = 'line';
        entity._structureDepthHalfWidth = Math.max(1, Number(halfWidth ?? footprintHalfW) || 1);
        entity._structureDepthOffsetY = (Number(y) || 0) - (Number(entity.y) || 0);
    }
    entity._structureDepthBias = Number(bias) || 0;
    // applyBuildingFootprint/rebuildCollider 会调用该钩子，尺寸或 offset 改动后图层自动同步。
    entity._refreshStructureDepth = () => refreshStructureDepth(entity);
    return refreshStructureDepth(entity);
}
