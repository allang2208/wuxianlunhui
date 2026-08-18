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

/**
 * 射击台是唯一的定向 1×2 建筑：锚点始终是楼梯格中心，另一格为台面。
 * e1/e2 分别沿两条等距地板轴延展；F 只在这两个方向间切换。
 */
const ISO_CELL_HALF = ONE_CELL_BUILDING_FOOT.w / (2 * Math.SQRT2);
const ISO_CELL_STEP = ISO_CELL_HALF * 2;

function firingPlatformFootprint(dir = 'e2') {
    const alongU = dir === 'e1';
    const halfU = alongU ? ISO_CELL_STEP : ISO_CELL_HALF;
    const halfV = alongU ? ISO_CELL_HALF : ISO_CELL_STEP;
    const collisionWidth = (halfU + halfV) * Math.SQRT2;
    return Object.freeze({
        dir: alongU ? 'e1' : 'e2',
        halfU,
        halfV,
        collisionWidth,
        collisionHeight: collisionWidth * 0.5,
        collisionRadius: Math.hypot(halfU, halfV),
        // 楼梯格 → 台面格的半步，即整个 1×2 footprint 的中心。
        offX: alongU ? 32 : -32,
        offY: 16,
        clearRadius: 120,
    });
}

export const FIRING_PLATFORM_FOOTPRINTS = Object.freeze({
    e1: firingPlatformFootprint('e1'),
    e2: firingPlatformFootprint('e2'),
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
    if (typeof entity._refreshStructureDepth === 'function') entity._refreshStructureDepth();
    return entity;
}

/** 将射击台设为“楼梯格 + 台面格”的定向 1×2 footprint。 */
export function applyFiringPlatformFootprint(entity, dir = 'e2') {
    if (!entity) return entity;
    const foot = FIRING_PLATFORM_FOOTPRINTS[dir] || FIRING_PLATFORM_FOOTPRINTS.e2;
    entity._isGridBuilding = true;
    entity._buildingFootprintCells = '1x2';
    entity._isOneCellBuilding = false;
    entity._isTwoByTwoBuilding = false;
    entity._isFourByFourBuilding = false;
    entity._firingPlatformDir = foot.dir;
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
