import SpatialPartitionSystem from '../systems/spatial-partition-system.js';

/** 以单位稳定 ID 错开固定周期 AI，避免同批出兵永久同帧决策。 */
export function stableAiPhase(entity, intervalMs) {
    const text = String(entity?.id || entity?.name || 'friendly');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % Math.max(1, Math.floor(Number(intervalMs) || 1));
}
/**
 * 友军 AI/投射物统一局部查询。网格必须由同一 entities 集合于本帧重建，否则退回原集合，
 * 保持场景切换和独立测试环境兼容。
 */
export function queryNearbyEntities(entities, source, radius) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    const r = Math.max(0, Number(radius) || 0);
    if (Number.isFinite(x) && Number.isFinite(y) && r > 0
        && SpatialPartitionSystem?.cells?.size > 0
        && SpatialPartitionSystem._sourceEntities === entities) {
        return SpatialPartitionSystem.queryRadius(x, y, r, source);
    }
    return entities?.values ? entities.values() : (entities || []);
}
