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

/** 射击台占一个等距格；F 只改变格内楼梯/台面的朝向。 */
const ISO_CELL_HALF = ONE_CELL_BUILDING_FOOT.w / (2 * Math.SQRT2);

function firingPlatformFootprint(dir = 'e2') {
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

/** 把贴图 alpha 拟合出的地面四边形应用到实体；占格标记保持不变。 */
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

/** 将射击台设为单格 footprint；dir 仅描述格内楼梯向。 */
export function applyFiringPlatformFootprint(entity, dir = 'e2') {
    if (!entity) return entity;
    const foot = FIRING_PLATFORM_FOOTPRINTS[dir] || FIRING_PLATFORM_FOOTPRINTS.e2;
    entity._isGridBuilding = true;
    entity._buildingFootprintCells = 1;
    entity._isOneCellBuilding = true;
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
