import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { isoFootprintVertices } from '../physics/iso-footprint.js';
import { WallSystem } from '../world/wall-system.js';
import { canMeleeShareSurface } from './melee-surface.js';

export const MOTION_MELEE_DEBUG_TRACE_TTL_MS = 1800;
const DEBUG_TRACE_LIMIT = 160;
let debugTracingEnabled = false;
let debugTraceSourceId = null;
let debugTraces = [];

function finiteNumber(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function targetCenter(target) {
    return {
        x: finiteNumber(target?.x) + finiteNumber(target?.colliderOffsetX),
        y: finiteNumber(target?.y) + finiteNumber(target?.colliderOffsetY),
    };
}

function debugNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function targetShapeSnapshot(target) {
    const center = targetCenter(target);
    if (target?.collisionShape === 'iso_rect') {
        return { kind: 'iso_rect', center, vertices: isoFootprintVertices(target) };
    }
    if (target?.collisionShape === 'rect'
        && finiteNumber(target.collisionWidth) > 0
        && finiteNumber(target.collisionHeight) > 0) {
        return {
            kind: 'rect',
            center,
            width: target.collisionWidth,
            height: target.collisionHeight,
        };
    }
    return {
        kind: 'circle',
        center,
        radius: Math.max(0, finiteNumber(
            target?.collider?.radius,
            finiteNumber(target?.groundRadius, finiteNumber(target?.collisionRadius))
        )),
    };
}

function recordDebugTrace(
    source,
    target,
    fromX,
    fromY,
    toX,
    toY,
    reach,
    hit,
    reason,
    options,
    impact = null
) {
    if (!debugTracingEnabled || !debugTraceSourceId || source?.id !== debugTraceSourceId) return;
    const now = debugNow();
    debugTraces.push({
        time: now,
        fromX,
        fromY,
        toX,
        toY,
        reach,
        hit,
        blocked: !!options?.blocked,
        reason,
        skill: options?.skill || '位移近战',
        sourceId: source?.id || source?.name || 'unknown-source',
        sourceName: source?.name || source?.id || '未知攻击者',
        sourceIsEditorTest: !!source?._collisionEditorTest,
        targetId: target?.id || target?.name || 'unknown-target',
        targetName: target?.name || target?.id || '未知目标',
        targetShape: target ? targetShapeSnapshot(target) : null,
        impactX: impact?.x ?? toX,
        impactY: impact?.y ?? toY,
    });
    if (debugTraces.length > DEBUG_TRACE_LIMIT) {
        debugTraces.splice(0, debugTraces.length - DEBUG_TRACE_LIMIT);
    }
}

export function setMotionMeleeDebugEnabled(enabled, sourceId = null) {
    debugTracingEnabled = !!enabled;
    debugTraceSourceId = debugTracingEnabled ? sourceId : null;
    if (!debugTracingEnabled || !debugTraceSourceId) debugTraces = [];
}

export function clearMotionMeleeDebugTraces() {
    debugTraces = [];
}

export function getMotionMeleeDebugTraces() {
    const cutoff = debugNow() - MOTION_MELEE_DEBUG_TRACE_TTL_MS;
    if (debugTraces.length && debugTraces[0].time < cutoff) {
        debugTraces = debugTraces.filter((trace) => trace.time >= cutoff);
    }
    return debugTraces.slice();
}

function closestSegmentParameter(ax, ay, bx, by, px, py) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-9) return 0;
    return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const t = closestSegmentParameter(ax, ay, bx, by, px, py);
    return Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t));
}

function orientation(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax, ay, bx, by, px, py) {
    return px >= Math.min(ax, bx) - 1e-8 && px <= Math.max(ax, bx) + 1e-8
        && py >= Math.min(ay, by) - 1e-8 && py <= Math.max(ay, by) + 1e-8;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const abC = orientation(ax, ay, bx, by, cx, cy);
    const abD = orientation(ax, ay, bx, by, dx, dy);
    const cdA = orientation(cx, cy, dx, dy, ax, ay);
    const cdB = orientation(cx, cy, dx, dy, bx, by);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
        && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (Math.abs(abC) <= 1e-8 && onSegment(ax, ay, bx, by, cx, cy))
        || (Math.abs(abD) <= 1e-8 && onSegment(ax, ay, bx, by, dx, dy))
        || (Math.abs(cdA) <= 1e-8 && onSegment(cx, cy, dx, dy, ax, ay))
        || (Math.abs(cdB) <= 1e-8 && onSegment(cx, cy, dx, dy, bx, by));
}

function segmentDistance(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
        pointSegmentDistance(ax, ay, cx, cy, dx, dy),
        pointSegmentDistance(bx, by, cx, cy, dx, dy),
        pointSegmentDistance(cx, cy, ax, ay, bx, by),
        pointSegmentDistance(dx, dy, ax, ay, bx, by)
    );
}

function pointInPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i];
        const b = vertices[j];
        if (Math.abs(orientation(a.x, a.y, b.x, b.y, x, y)) <= 1e-8
            && onSegment(a.x, a.y, b.x, b.y, x, y)) return true;
        const crosses = ((a.y > y) !== (b.y > y))
            && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function segmentPolygonDistance(ax, ay, bx, by, vertices) {
    if (!vertices.length) return Infinity;
    if (pointInPolygon(ax, ay, vertices) || pointInPolygon(bx, by, vertices)) return 0;
    let minDistance = Infinity;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        minDistance = Math.min(minDistance, segmentDistance(ax, ay, bx, by, a.x, a.y, b.x, b.y));
        if (minDistance <= 0) return 0;
    }
    return minDistance;
}

function distanceFromSweepToTarget(target, fromX, fromY, toX, toY) {
    if (target.collisionShape === 'iso_rect') {
        const vertices = isoFootprintVertices(target).map((point) => ({
            x: point.x,
            y: point.y / PERSPECTIVE_SCALE_Y,
        }));
        return segmentPolygonDistance(
            fromX,
            fromY / PERSPECTIVE_SCALE_Y,
            toX,
            toY / PERSPECTIVE_SCALE_Y,
            vertices
        );
    }

    if (target.collisionShape === 'rect'
        && finiteNumber(target.collisionWidth) > 0
        && finiteNumber(target.collisionHeight) > 0) {
        const center = targetCenter(target);
        const halfW = target.collisionWidth / 2;
        const halfH = target.collisionHeight / 2;
        return segmentPolygonDistance(fromX, fromY, toX, toY, [
            { x: center.x - halfW, y: center.y - halfH },
            { x: center.x + halfW, y: center.y - halfH },
            { x: center.x + halfW, y: center.y + halfH },
            { x: center.x - halfW, y: center.y + halfH },
        ]);
    }

    const center = targetCenter(target);
    const radius = Math.max(0, finiteNumber(
        target?.collider?.radius,
        finiteNumber(target?.groundRadius, finiteNumber(target?.collisionRadius))
    ));
    return Math.max(0, pointSegmentDistance(center.x, center.y, fromX, fromY, toX, toY) - radius);
}

function impactLineIsClear(target, impactX, impactY) {
    if (!WallSystem?.blocked) return true;
    // 墙段目标只忽略自身的阻挡线；其它墙仍参与判定，防止“目标本身是建筑”
    // 成为绕过隔墙门禁的通行证。
    const ignore = target?._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
    const center = targetCenter(target);
    return !WallSystem.blocked(impactX, impactY, center.x, center.y, ignore);
}

/**
 * 位移近战的连续命中合同：只检查锁定目标与攻击者本帧实际可达轨迹。
 */
export function sweptMotionMeleeHits(
    source,
    target,
    fromX,
    fromY,
    toX,
    toY,
    reach = 0,
    debugOptions = null
) {
    const hitReach = Math.max(0, finiteNumber(reach));
    const finish = (hit, reason, impact = null) => {
        recordDebugTrace(
            source,
            target,
            fromX,
            fromY,
            toX,
            toY,
            hitReach,
            hit,
            reason,
            debugOptions,
            impact
        );
        return hit;
    };
    if (!source || !target || !target.active || !target.hittable || target._isDead) {
        return finish(false, '锁定目标失效');
    }
    if (Number.isFinite(target.hp) && target.hp <= 0) return finish(false, '锁定目标死亡');
    if (!target.collider?.isGroundTarget) return finish(false, '目标不在地面层');
    if (!canMeleeShareSurface(source, target)) return finish(false, '承载面不一致');

    if (distanceFromSweepToTarget(target, fromX, fromY, toX, toY) > hitReach) {
        return finish(false, debugOptions?.blocked ? '撞墙截断' : '轨迹未接触');
    }

    const center = targetCenter(target);
    const t = closestSegmentParameter(fromX, fromY, toX, toY, center.x, center.y);
    const impactX = fromX + (toX - fromX) * t;
    const impactY = fromY + (toY - fromY) * t;
    const impact = { x: impactX, y: impactY };
    if (!impactLineIsClear(target, impactX, impactY)) return finish(false, '目标隔墙', impact);
    return finish(true, '实际轨迹命中', impact);
}

/**
 * WallSystem.resolve 若把直冲意图裁短或改成沿墙滑动，则本次直冲在实际落点停止。
 */
export function straightMotionWasBlocked(fromX, fromY, intendedX, intendedY, resolvedX, resolvedY) {
    const intendedDistance = Math.hypot(intendedX - fromX, intendedY - fromY);
    if (intendedDistance <= 0.5) return false;
    const deviation = Math.hypot(resolvedX - intendedX, resolvedY - intendedY);
    return deviation > Math.max(1, intendedDistance * 0.2);
}
