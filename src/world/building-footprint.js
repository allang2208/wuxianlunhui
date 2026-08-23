import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/** 世界-122 格网 footprint 公式真源：单格宽128，屏幕Y按0.5投影。 */
export const BUILDING_GRID_CELL_WIDTH = 128;

function standardGridFootprint(cells, { frontAnchored = true, clearRadius }) {
    const count = Math.max(1, Number(cells) || 1);
    const w = BUILDING_GRID_CELL_WIDTH * count;
    const d = w * PERSPECTIVE_SCALE_Y;
    return {
        cells: count,
        w,
        d,
        halfU: w / (2 * Math.SQRT2),
        halfV: w / (2 * Math.SQRT2),
        offX: 0,
        // 普通建筑的 entity.y 是前顶点；墙块/楼梯段的 entity.y 是格心。
        offY: frontAnchored ? -d / 2 : 0,
        collisionRadius: w / 2,
        clearRadius,
    };
}

/** 1×1墙块/楼梯段：实体锚点位于格心。 */
export const ONE_CELL_BUILDING_FOOT = Object.freeze(standardGridFootprint(1, {
    frontAnchored: false,
    clearRadius: 70,
}));

/** 除墙、门外的普通建筑统一占 2×2。 */
export const TWO_BY_TWO_BUILDING_FOOT = Object.freeze(standardGridFootprint(2, {
    clearRadius: 150,
}));

/** 世界-122 基地核心统一占 4×4。 */
export const FOUR_BY_FOUR_BASE_FOOT = Object.freeze(standardGridFootprint(4, {
    clearRadius: 290,
}));

/** 城墙楼梯的每一段占一个等距格；dir 描述该段的登高轴。 */
const ISO_CELL_HALF = ONE_CELL_BUILDING_FOOT.w / (2 * Math.SQRT2);

function wallStairFootprint(dir = 'e2') {
    const halfU = ISO_CELL_HALF;
    const halfV = ISO_CELL_HALF;
    const collisionWidth = (halfU + halfV) * Math.SQRT2;
    return Object.freeze({
        dir: dir === 'e1' ? 'e1' : 'e2',
        halfU,
        halfV,
        collisionWidth,
        collisionHeight: collisionWidth * 0.5,
        collisionRadius: Math.hypot(halfU, halfV),
        offX: 0,
        offY: 0,
        clearRadius: ONE_CELL_BUILDING_FOOT.clearRadius,
    });
}

export const WALL_STAIR_FOOTPRINTS = Object.freeze({
    e1: wallStairFootprint('e1'),
    e2: wallStairFootprint('e2'),
});

/** 按格数取得标准 footprint；当前只开放 1/2/4 三档。 */
export function getBuildingFootprint(cells = 2) {
    if (cells === 1) return ONE_CELL_BUILDING_FOOT;
    if (cells === 4) return FOUR_BY_FOUR_BASE_FOOT;
    return TWO_BY_TWO_BUILDING_FOOT;
}

/** 将实体碰撞统一成沿地面 u/v 轴的旋转矩形；屏幕投影为菱形。 */
export function applyBuildingFootprint(entity, cells = 2) {
    if (!entity) return entity;
    const foot = getBuildingFootprint(cells);
    entity._isGridBuilding = true;
    if (entity._civilianBlocksVisuals === undefined) entity._civilianBlocksVisuals = true;
    entity._buildingFootprintCells = cells;
    entity._isOneCellBuilding = cells === 1;
    entity._isTwoByTwoBuilding = cells === 2;
    entity._isFourByFourBuilding = cells === 4;
    entity.collisionShape = 'iso_rect';
    entity.collisionWidth = foot.w;
    entity.collisionHeight = foot.d;
    entity.collisionIsoHalfU = foot.halfU;
    entity.collisionIsoHalfV = foot.halfV;
    entity.collisionRadius = foot.collisionRadius;
    entity.colliderOffsetX = foot.offX;
    entity.colliderOffsetY = foot.offY;
    // 标准格网公式重新应用时必须清掉旧像素拟合，避免热更新/旧实例残留。
    delete entity._pixelFootprintLocal;
    if (typeof entity._refreshStructureDepth === 'function') entity._refreshStructureDepth();
    return entity;
}

/** 显式异形建筑扩展：把贴图 alpha 拟合四边形应用到实体；普通格网建筑禁止默认调用。 */
export function applyFittedBuildingFootprint(entity, fit) {
    if (!entity || !fit || !Array.isArray(fit.localVertices) || fit.localVertices.length !== 4) {
        return entity;
    }
    entity.collisionShape = 'iso_rect';
    entity._pixelFootprintLocal = fit.localVertices.map((point) => ({
        key: point.key,
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
    }));
    entity.collisionWidth = Math.max(1, Number(fit.collisionWidth) || entity.collisionWidth || 1);
    entity.collisionHeight = Math.max(1, Number(fit.collisionHeight) || entity.collisionHeight || 1);
    entity.collisionRadius = Math.max(1, Number(fit.collisionRadius) || entity.collisionRadius || 1);
    entity.colliderOffsetX = Number(fit.centerX) || 0;
    entity.colliderOffsetY = Number(fit.centerY) || 0;
    // spawn-placement 等仍需要 u/v 半径作为候选槽位的保守外框。
    const half = entity.collisionRadius / Math.SQRT2;
    entity.collisionIsoHalfU = half;
    entity.collisionIsoHalfV = half;
    if (typeof entity._refreshStructureDepth === 'function') entity._refreshStructureDepth();
    return entity;
}

/** 将城墙楼梯逻辑根实体设为单格 footprint；其余分段由组合实体单独校验。 */
export function applyWallStairFootprint(entity, dir = 'e2') {
    if (!entity) return entity;
    const foot = WALL_STAIR_FOOTPRINTS[dir] || WALL_STAIR_FOOTPRINTS.e2;
    entity._isGridBuilding = true;
    if (entity._civilianBlocksVisuals === undefined) entity._civilianBlocksVisuals = true;
    entity._buildingFootprintCells = 1;
    entity._isOneCellBuilding = true;
    entity._isTwoByTwoBuilding = false;
    entity._isFourByFourBuilding = false;
    entity._wallStairDir = foot.dir;
    entity.collisionShape = 'iso_rect';
    entity.collisionWidth = foot.collisionWidth;
    entity.collisionHeight = foot.collisionHeight;
    entity.collisionIsoHalfU = foot.halfU;
    entity.collisionIsoHalfV = foot.halfV;
    entity.collisionRadius = foot.collisionRadius;
    entity.colliderOffsetX = foot.offX;
    entity.colliderOffsetY = foot.offY;
    if (typeof entity._refreshStructureDepth === 'function') entity._refreshStructureDepth();
    return entity;
}

/** 兼容旧调用：仅墙体等明确需要 1×1 的对象继续使用。 */
export function applyOneCellBuildingFootprint(entity) {
    return applyBuildingFootprint(entity, 1);
}
