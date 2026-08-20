// ============================================================
import { isoFootprintVertices } from '../physics/iso-footprint.js';
// 建筑图层统一口径（2026-08-16，世界-122 全建筑共用）
//
// 唯一规则（与掩体/铁闸门/仓鼠小屋同一套）：
// - iso_rect 建筑：以完整地面 footprint 的屏幕前缘为排序边界；
// - 墙/门等线结构：以实际接地面线为排序边界；
// - `_faceDepth`：统一由 `structureDepthAtY(前缘Y)` 生成；
// - 单位（玩家/敌人/侍从/友方单位）每帧经 WallSystem.junctionCorrectedDepth
//   仲裁：脚线在局部前缘之后（y < frontY）→ 压到建筑之下；在前/同线
//   （y ≥ frontY）
//   → 抬到建筑之上（+0.5，消除同线 z-fight）。
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
 * 取得 iso 建筑在指定屏幕 X 位置的真实地面前缘 Y。
 * 只采样 footprint 两条前边。sideRange 仅表示移动精灵真实接地/碰撞的横向半径，
 * 不等于显示贴图宽度；当其中心略越过前角、但贴图仍与建筑相交时，仍以端点作为前缘，
 * 不能无限延长线段。
 */
export function structureFrontYAtX(entity, x, sideRange = 0) {
    if (!entity || entity._structureDepthMode !== 'iso_footprint') return null;
    if (!Array.isArray(entity._faceLines) || entity._faceLines.length !== 2) {
        refreshStructureDepth(entity);
    }
    let frontY = null;
    for (const line of entity._faceLines || []) {
        const [a, b] = line || [];
        if (!a || !b) continue;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const lateralReach = Math.max(0, Number(sideRange) || 0);
        if (x < minX - lateralReach || x > maxX + lateralReach) continue;
        const dx = b.x - a.x;
        const t = Math.max(0, Math.min(1, (x - a.x) / (Math.abs(dx) > 1e-6 ? dx : 1)));
        const y = a.y + (b.y - a.y) * t;
        if (frontY === null || y > frontY) frontY = y;
    }
    return frontY;
}

/** 给 WallSystem 的无分支采样结果：null 表示单位可见横向范围不与该建筑前缘相交。 */
export function structureDepthRelationAtPoint(entity, x, y, sideRange = 0) {
    const frontY = structureFrontYAtX(entity, x, sideRange);
    if (frontY === null) return null;
    const inFront = y >= frontY;
    const span = structureDepthSpan(entity);
    const renderDepth = Number.isFinite(entity._structureRenderDepth)
        ? entity._structureRenderDepth
        : span?.frontDepth;
    return {
        frontY,
        depth: Number.isFinite(renderDepth)
            ? renderDepth
            : structureDepthAtY(frontY, entity._structureDepthBias),
        inFront,
    };
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
