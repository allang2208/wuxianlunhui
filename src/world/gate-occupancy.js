import {
    circleIntersectsIsoFootprint,
    isoFootprintsOverlap,
} from '../physics/iso-footprint.js';

function isActiveGate(entity) {
    return !!(entity
        && entity.active !== false
        && !entity._sinking
        && entity._isCoverGate
        && entity.collisionShape === 'iso_rect');
}

/**
 * 城门的固定结构占地与当前通行状态无关。
 * 开门会移除 WallSystem 门段，但资源生成、建筑放置和出生点校验仍必须避开门体。
 */
export function isoFootprintOverlapsActiveGate(probe, entities) {
    if (!probe || !entities) return false;
    for (const entity of entities) {
        if (!isActiveGate(entity)) continue;
        if (isoFootprintsOverlap(probe, entity)) return true;
    }
    return false;
}

/** 出生圆是否压到任意活动城门的固定 footprint。 */
export function circleOverlapsActiveGate(x, y, radius, entities) {
    if (!entities) return false;
    for (const entity of entities) {
        if (!isActiveGate(entity)) continue;
        if (circleIntersectsIsoFootprint(x, y, Math.max(1, Number(radius) || 1), entity)) {
            return true;
        }
    }
    return false;
}
