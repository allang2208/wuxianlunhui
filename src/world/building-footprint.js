/** 世界-122 等距格 footprint 真源（单格投影包围盒 = 128×64 世界像素）。 */
export const ONE_CELL_BUILDING_FOOT = Object.freeze({
    w: 128,
    d: 64,
    offX: 0,
    offY: 0,
    collisionRadius: 64,
    clearRadius: 70,
});

/** 除墙、门、陷阱外的普通建筑统一占 2×2。 */
export const TWO_BY_TWO_BUILDING_FOOT = Object.freeze({
    w: ONE_CELL_BUILDING_FOOT.w * 2,
    d: ONE_CELL_BUILDING_FOOT.d * 2,
    offX: 0,
    offY: -64,
    // 统一 Collider 用圆在等距投影后形成 256×128 椭圆：
    // radius=128，屏幕 Y 按 PERSPECTIVE_SCALE_Y(0.5) 压缩为 64。
    collisionRadius: ONE_CELL_BUILDING_FOOT.w,
    clearRadius: 150,
    cells: 2,
});

/** 世界-122 基地核心统一占 4×4。 */
export const FOUR_BY_FOUR_BASE_FOOT = Object.freeze({
    w: ONE_CELL_BUILDING_FOOT.w * 4,
    d: ONE_CELL_BUILDING_FOOT.d * 4,
    offX: 0,
    offY: -128,
    collisionRadius: ONE_CELL_BUILDING_FOOT.w * 2,
    clearRadius: 290,
    cells: 4,
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
    entity._buildingFootprintCells = cells;
    entity._isOneCellBuilding = cells === 1;
    entity._isTwoByTwoBuilding = cells === 2;
    entity._isFourByFourBuilding = cells === 4;
    entity.collisionShape = 'iso_rect';
    entity.collisionWidth = foot.w;
    entity.collisionHeight = foot.d;
    entity.collisionIsoHalfU = foot.w / (2 * Math.SQRT2);
    entity.collisionIsoHalfV = foot.w / (2 * Math.SQRT2);
    entity.collisionRadius = foot.collisionRadius;
    entity.colliderOffsetX = foot.offX;
    entity.colliderOffsetY = foot.offY;
    return entity;
}

/** 兼容旧调用：仅墙体等明确需要 1×1 的对象继续使用。 */
export function applyOneCellBuildingFootprint(entity) {
    return applyBuildingFootprint(entity, 1);
}
