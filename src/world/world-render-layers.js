/**
 * 世界空间贴地视觉的唯一深度注册表。
 *
 * 这些对象不参与按世界 Y 的前后遮挡；严格递增的独立层级避免同 depth 时退化为
 * Phaser 显示列表创建顺序。动态单位和建筑立面继续使用各自的世界/拓扑 depth。
 */
export const WORLD_RENDER_LAYERS = Object.freeze({
    TERRAIN: -1000,
    FIELD: -996,
    ROAD: -995,
    GROUND_RANGE: -994.8,
    FOUNDATION: -994.6,
    STRUCTURE_SHADOW: -994.4,
    FLAT_STRUCTURE: -994.2,
});
