/**
 * 世界空间贴地视觉的唯一深度注册表。
 *
 * 这些对象不参与按世界 Y 的前后遮挡；严格递增的独立层级避免同 depth 时退化为
 * Phaser 显示列表创建顺序。动态单位和建筑立面继续使用各自的世界/拓扑 depth。
 */
export const WORLD_RENDER_LAYERS = Object.freeze({
    TERRAIN: -1000,
    ROAD: -995,
    ROAD_EDGE: -994.95,
    ROAD_DECAL: -994.9,
    // 农田菱形会与相邻道路产生像素重叠，必须盖过完整道路层族。
    FIELD: -994.85,
    GROUND_RANGE: -994.8,
    // 独立建筑地台必须能接收共享太阳阴影，不能沿用建筑立面的 rearFx 通道。
    STRUCTURE_GROUND_CONTACT: -994.5,
    STRUCTURE_SHADOW: -994.4,
    GROUND_WEATHER: -994.3,
    FLAT_STRUCTURE: -994.2,
});
