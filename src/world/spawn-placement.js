// ============================================================
// 世界-122 生产建筑安全出口（2026-08-18）
// - 固定出口槽位：优先朝集结目标/玩家一侧，再尝试其余边与四角
// - 同时校验墙体、建筑 footprint、动态单位占用和短距离离场通道
// - 成功槽位短时预约，避免多个建筑同帧把单位生成在同一点
// ============================================================
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import {
    circleIntersectsIsoFootprint,
    isoFootprintCenter,
    isoFootprintHalfExtents,
    isoLocalToWorldDelta,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';

const SLOT_GAP = 12;
const EGRESS_DISTANCE = 72;
const RESERVATION_MS = 750;
const reservations = [];

function entityIterable(entities) {
    if (!entities) return [];
    return entities.values ? entities.values() : entities;
}

function entityCenter(entity) {
    return {
        x: entity?.collider ? entity.collider.x : (entity?.x || 0) + (entity?.colliderOffsetX || 0),
        y: entity?.collider ? entity.collider.y : (entity?.y || 0) + (entity?.colliderOffsetY || 0),
    };
}

/** 世界圆（屏幕上为 Y 压缩椭圆）与轴对齐 footprint 矩形相交。 */
export function circleIntersectsBuildingRect(x, y, radius, entity) {
    if (!entity || !(entity.collisionWidth > 0) || !(entity.collisionHeight > 0)) return false;
    if (entity.collisionShape === 'iso_rect') {
        return circleIntersectsIsoFootprint(x, y, radius, entity);
    }
    const c = entityCenter(entity);
    const invScale = 1 / PERSPECTIVE_SCALE_Y;
    const hw = entity.collisionWidth / 2;
    const hh = entity.collisionHeight / 2 * invScale;
    const relX = x - c.x;
    const relY = (y - c.y) * invScale;
    const qx = Math.max(-hw, Math.min(hw, relX));
    const qy = Math.max(-hh, Math.min(hh, relY));
    return Math.hypot(relX - qx, relY - qy) < radius;
}

function cleanReservations(now) {
    for (let i = reservations.length - 1; i >= 0; i--) {
        if (reservations[i].expiresAt <= now) reservations.splice(i, 1);
    }
}

function isReserved(x, y, radius, now) {
    cleanReservations(now);
    const invScale = 1 / PERSPECTIVE_SCALE_Y;
    return reservations.some((slot) => {
        const dx = x - slot.x;
        const dy = (y - slot.y) * invScale;
        return Math.hypot(dx, dy) < radius + slot.radius;
    });
}

function reserve(x, y, radius, now) {
    const slot = { x, y, radius, expiresAt: now + RESERVATION_MS };
    reservations.push(slot);
    return slot;
}

/** 候选点是否同时避开静态墙、全部建筑 footprint、动态单位和出口预约。 */
export function isSpawnPositionFree(x, y, unitRadius, options = {}) {
    const {
        entities,
        wallSystem,
        now = Date.now(),
        ignoreEntity = null,
        checkReservation = true,
    } = options;
    if (wallSystem?.canMoveTo && !wallSystem.canMoveTo(x, y, unitRadius)) return false;
    if (checkReservation && isReserved(x, y, unitRadius, now)) return false;

    const invScale = 1 / PERSPECTIVE_SCALE_Y;
    for (const entity of entityIterable(entities)) {
        if (!entity || entity === ignoreEntity || !entity.active || entity.noSpawnCollision) continue;
        const isBuildingRect = (entity.collisionShape === 'rect' || entity.collisionShape === 'iso_rect')
            && entity.collisionWidth > 0
            && entity.collisionHeight > 0
            && (entity._isGridBuilding || entity._isDefenseStructure);
        if (isBuildingRect) {
            if (circleIntersectsBuildingRect(x, y, unitRadius, entity)) return false;
            continue;
        }
        if (entity.noCollision) continue;
        const r = entity.groundRadius || entity.collisionRadius || 0;
        if (!(r > 0)) continue;
        const c = entityCenter(entity);
        const dx = x - c.x;
        const dy = (y - c.y) * invScale;
        if (Math.hypot(dx, dy) < unitRadius + r + 4) return false;
    }
    return true;
}

function sideCandidates(building, unitRadius, preferredTarget) {
    const c = isoFootprintCenter(building);
    const { halfU, halfV } = isoFootprintHalfExtents(building);
    const outU = halfU + unitRadius + SLOT_GAP;
    const outV = halfV + unitRadius + SLOT_GAP;
    const dirs = [
        { u: 1, v: 0, side: 'right_down' },
        { u: -1, v: 0, side: 'left_up' },
        { u: 0, v: 1, side: 'left_down' },
        { u: 0, v: -1, side: 'right_up' },
    ];
    if (preferredTarget && Number.isFinite(preferredTarget.x) && Number.isFinite(preferredTarget.y)) {
        const p = worldDeltaToIsoLocal(preferredTarget.x - c.x, preferredTarget.y - c.y);
        const pl = Math.hypot(p.u, p.v) || 1;
        dirs.sort((a, b) => (b.u * p.u + b.v * p.v) / pl - (a.u * p.u + a.v * p.v) / pl);
    }

    const candidates = [];
    for (const dir of dirs) {
        if (dir.u !== 0) {
            for (const t of [0, -0.55, 0.55]) {
                const delta = isoLocalToWorldDelta(dir.u * outU, t * halfV);
                candidates.push({
                    x: c.x + delta.x,
                    y: c.y + delta.y,
                    dirU: dir.u,
                    dirV: 0,
                    side: dir.side,
                });
            }
        } else {
            for (const t of [0, -0.55, 0.55]) {
                const delta = isoLocalToWorldDelta(t * halfU, dir.v * outV);
                candidates.push({
                    x: c.x + delta.x,
                    y: c.y + delta.y,
                    dirU: 0,
                    dirV: dir.v,
                    side: dir.side,
                });
            }
        }
    }
    // 四角作为边出口被单位占满时的最后补位。
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const len = Math.SQRT2;
        const delta = isoLocalToWorldDelta(sx * outU, sy * outV);
        candidates.push({
            x: c.x + delta.x,
            y: c.y + delta.y,
            dirU: sx / len,
            dirV: sy / len,
            side: 'corner',
        });
    }
    return candidates;
}

export const SpawnPlacement = {
    retryMs: 500,

    clearReservations() {
        reservations.length = 0;
    },

    /**
     * 找到并预约一个安全出口。
     * @returns {{x:number,y:number,egressX:number,egressY:number,side:string}|null}
     */
    findAndReserve(building, options = {}) {
        if (!building || !building.active || !(building.collisionWidth > 0) || !(building.collisionHeight > 0)) {
            return null;
        }
        const unitRadius = Math.max(8, options.unitRadius || 24);
        const now = options.now ?? Date.now();
        const baseOptions = { ...options, now };
        for (const candidate of sideCandidates(building, unitRadius, options.preferredTarget)) {
            if (!isSpawnPositionFree(candidate.x, candidate.y, unitRadius, baseOptions)) continue;
            const egressDelta = isoLocalToWorldDelta(
                candidate.dirU * EGRESS_DISTANCE,
                candidate.dirV * EGRESS_DISTANCE
            );
            const egressX = candidate.x + egressDelta.x;
            const egressY = candidate.y + egressDelta.y;
            if (!isSpawnPositionFree(egressX, egressY, unitRadius, {
                ...baseOptions,
                checkReservation: false,
            })) continue;
            if (options.wallSystem?.blocked
                && options.wallSystem.blocked(candidate.x, candidate.y, egressX, egressY)) continue;
            reserve(candidate.x, candidate.y, unitRadius, now);
            return { ...candidate, egressX, egressY };
        }
        return null;
    },
};
