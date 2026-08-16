// ============================================================
// 建筑图层统一口径（2026-08-16，世界-122 全建筑共用）
//
// 唯一规则（与掩体/铁闸门/仓鼠小屋同一套）：
// - `_faceLine`：建筑「接地线」= 脚底 y 处的水平线段，跨度 = 贴图显示半宽
//   （遮挡只跟贴图有关，碰撞 footprint 不参与）；
// - `_faceDepth`：建筑贴图深度 = 接地线 max y + 12；
// - 单位（玩家/敌人/侍从/友方单位）每帧经 WallSystem.junctionCorrectedDepth
//   仲裁：脚线在接地线之后（y < yLine）→ 压到建筑之下；在前/同线（y ≥ yLine）
//   → 抬到建筑之上（+0.5，消除同线 z-fight）。
//
// 新建筑/新结构构造时调用一次 `setupStructureDepth(entity, halfWidth)` 即可，
// 不需要再单独处理图层；新单位自动走 junctionCorrectedDepth，无需改代码。
// ============================================================

/**
 * 给建筑实体注册统一遮挡锚线。
 * @param {object} entity 建筑实体（x/y 已就位）
 * @param {number} halfWidth 贴图显示半宽（face 线跨度 = 2×halfWidth）
 * @param {number} [y=entity.y] 接地线 y（缺省脚底）
 * @param {number} [bias=0] 深度额外偏移（掩体上夹角左臂等特例用）
 * @returns {object} entity
 */
export function setupStructureDepth(entity, halfWidth, y = entity.y, bias = 0) {
    const w = Math.max(1, Number(halfWidth) || 1);
    entity._faceLine = [
        { x: entity.x - w, y },
        { x: entity.x + w, y },
    ];
    entity._faceDepth = Math.max(entity._faceLine[0].y, entity._faceLine[1].y) + 12 + (bias || 0);
    return entity;
}
