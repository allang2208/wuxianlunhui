import { GroundDirectedRect } from '../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../physics/elevation.js';
import { canMeleeShareSurface } from './melee-surface.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { WallSystem } from '../world/wall-system.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { distanceToIsoFootprint, isoFootprintVertices } from '../physics/iso-footprint.js';

export const BASIC_MELEE_DEBUG_TRACE_TTL_MS = 1800;
const BASIC_MELEE_DEBUG_TRACE_LIMIT = 80;
let basicMeleeDebugEnabled = false;
let basicMeleeDebugSourceId = null;
let basicMeleeDebugTraces = [];
const basicMeleeDebugLastSignatures = new Map();

function finiteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function debugNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function debugTargetCenter(target) {
    return {
        x: finiteNumber(target?.x, 0) + finiteNumber(target?.colliderOffsetX, 0),
        y: finiteNumber(target?.y, 0) + finiteNumber(target?.colliderOffsetY, 0),
    };
}

function debugTargetShapeSnapshot(target) {
    const center = debugTargetCenter(target);
    if (target?.collisionShape === 'iso_rect') {
        return { kind: 'iso_rect', center, vertices: isoFootprintVertices(target) };
    }
    if (target?.collisionShape === 'rect'
        && finiteNumber(target.collisionWidth, 0) > 0
        && finiteNumber(target.collisionHeight, 0) > 0) {
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
            finiteNumber(target?.groundRadius, finiteNumber(target?.collisionRadius, 0))
        )),
    };
}

function recordBasicMeleeDebugTrace(source, target, snapshot, phase, hit, reason) {
    if (!basicMeleeDebugEnabled
        || !basicMeleeDebugSourceId
        || source?.id !== basicMeleeDebugSourceId
        || !snapshot) return;
    const now = debugNow();
    const signature = [
        source.id,
        phase,
        target?.id || target?.name || 'unknown-target',
        Math.round(snapshot.originX),
        Math.round(snapshot.originY),
        hit ? 1 : 0,
        reason,
    ].join(':');
    const previous = basicMeleeDebugLastSignatures.get(signature);
    if (previous !== undefined && now - previous < 80) return;
    basicMeleeDebugLastSignatures.set(signature, now);
    basicMeleeDebugTraces.push({
        time: now,
        phase,
        hit,
        reason,
        sourceId: source.id,
        sourceName: source.name || source.id || '未知攻击者',
        sourceIsEditorTest: !!source._collisionEditorTest,
        targetId: target?.id || target?.name || 'unknown-target',
        targetName: target?.name || target?.id || '未知目标',
        targetShape: target ? debugTargetShapeSnapshot(target) : null,
        snapshot: {
            originX: snapshot.originX,
            originY: snapshot.originY,
            sourceX: snapshot.sourceX,
            sourceY: snapshot.sourceY,
            angle: snapshot.angle,
            worldAngle: snapshot.worldAngle,
            length: snapshot.length,
            width: snapshot.width,
            backExtension: snapshot.backExtension,
            reach: snapshot.reach,
            forwardOffset: snapshot.forwardOffset,
        },
    });
    if (basicMeleeDebugTraces.length > BASIC_MELEE_DEBUG_TRACE_LIMIT) {
        basicMeleeDebugTraces.splice(
            0,
            basicMeleeDebugTraces.length - BASIC_MELEE_DEBUG_TRACE_LIMIT
        );
    }
}

export function setBasicMeleeDebugEnabled(enabled, sourceId = null) {
    basicMeleeDebugEnabled = !!enabled;
    basicMeleeDebugSourceId = basicMeleeDebugEnabled ? sourceId : null;
    if (!basicMeleeDebugEnabled || !basicMeleeDebugSourceId) clearBasicMeleeDebugTraces();
}

export function clearBasicMeleeDebugTraces() {
    basicMeleeDebugTraces = [];
    basicMeleeDebugLastSignatures.clear();
}

export function getBasicMeleeDebugTraces() {
    const cutoff = debugNow() - BASIC_MELEE_DEBUG_TRACE_TTL_MS;
    if (basicMeleeDebugTraces.length && basicMeleeDebugTraces[0].time < cutoff) {
        basicMeleeDebugTraces = basicMeleeDebugTraces.filter((trace) => trace.time >= cutoff);
    }
    return basicMeleeDebugTraces.slice();
}

function targetPoint(target) {
    return {
        x: finiteNumber(target?.collider?.x, finiteNumber(target?.x, 0)),
        y: finiteNumber(target?.collider?.y, finiteNumber(target?.y, 0)),
    };
}

/**
 * 通用敌人普通近战的唯一几何合同。
 *
 * legacy attack.range 仍表示“从攻击者逻辑中心量出的总前伸距离”；解析器把攻击者
 * footprint 半径拆成 forwardOffset，再从 footprint 前缘发出剩余长度。这样判定形状
 * 与视觉方向一致，同时保持旧 range 的总射程语义，便于逐怪迁移。
 */
export function createBasicMeleeProfile(source, attackConfig = {}) {
    const configured = source?.config?.basicMelee || {};
    const fallbackReach = finiteNumber(
        source?.attackDistance,
        finiteNumber(source?.attackRange, 70)
    );
    const reach = Math.max(1, finiteNumber(
        configured.reach,
        finiteNumber(attackConfig.range, fallbackReach)
    ));
    const sourceRadius = Math.max(0, finiteNumber(source?.groundRadius, 0));
    const defaultForwardOffset = Math.min(sourceRadius, reach * 0.45);
    const forwardOffset = Math.max(0, Math.min(
        reach - 1,
        finiteNumber(configured.forwardOffset, defaultForwardOffset)
    ));
    const length = Math.max(1, finiteNumber(configured.length, reach - forwardOffset));

    return {
        reach: forwardOffset + length,
        forwardOffset,
        length,
        width: Math.max(1, finiteNumber(configured.width, finiteNumber(attackConfig.width, 20))),
        backExtension: Math.max(0, finiteNumber(configured.backExtension, 0)),
        requiresSameSurface: configured.requiresSameSurface !== false,
        requiresLosAtImpact: configured.requiresLosAtImpact !== false,
        targetMode: 'primary',
        maxTargets: 1,
    };
}

export function createBasicMeleeSnapshot(source, target, attackConfig = {}) {
    const profile = createBasicMeleeProfile(source, attackConfig);
    const point = targetPoint(target);
    const dx = point.x - source.x;
    const dy = point.y - source.y;
    const worldAngle = (dx !== 0 || dy !== 0)
        ? Math.atan2(dy, dx)
        : finiteNumber(source.rotation, 0);
    // GroundDirectedRect 在本地把 Y 除以 2:1 透视系数，因此方向也必须在同一
    // 未压缩平面计算；否则对角目标会落在矩形侧面之外。
    const angle = (dx !== 0 || dy !== 0)
        ? Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx)
        : worldAngle;
    const originX = source.x + Math.cos(angle) * profile.forwardOffset;
    const originY = source.y + Math.sin(angle) * profile.forwardOffset * PERSPECTIVE_SCALE_Y;
    return {
        ...profile,
        angle,
        worldAngle,
        originX,
        originY,
        sourceX: source.x,
        sourceY: source.y,
    };
}

/**
 * 多段连击可在保持起手方向不变的前提下，按攻击者当前脚点重锚判定区。
 * 这只允许既有突进带着攻击区前移，不会重新瞄准已经绕到身后的目标。
 */
export function rebaseBasicMeleeSnapshot(source, snapshot) {
    if (!source || !snapshot) return null;
    return {
        ...snapshot,
        originX: source.x + Math.cos(snapshot.angle) * snapshot.forwardOffset,
        originY: source.y
            + Math.sin(snapshot.angle) * snapshot.forwardOffset * PERSPECTIVE_SCALE_Y,
        sourceX: source.x,
        sourceY: source.y,
    };
}

function snapshotShape(source, snapshot) {
    return new GroundDirectedRect(
        snapshot.originX,
        snapshot.originY,
        snapshot.angle,
        snapshot.length,
        snapshot.width,
        snapshot.backExtension,
        surfaceEffectFromEntity(source)
    );
}

function shapeIntersectsTarget(source, target, snapshot) {
    if (snapshotShape(source, snapshot).intersectsEntity(target)) return true;
    // 长条掩体/门的 Collider 半径不能代表完整 AABB；建筑沿用点到真实 footprint
    // 的距离兜底，避免恢复“贴墙挥击但零伤害”的旧问题。
    return !!target?._isDefenseStructure
        && distanceToEntityShape(target, snapshot.sourceX, snapshot.sourceY) <= snapshot.reach;
}

function hasImpactLineOfSight(source, target, snapshot) {
    if (!snapshot.requiresLosAtImpact || !WallSystem?.blocked) return true;
    if (target?._isDefenseStructure
        && distanceToEntityShape(target, snapshot.sourceX, snapshot.sourceY) <= snapshot.reach) {
        return true;
    }
    const ignore = target?._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
    return !WallSystem.blocked(snapshot.sourceX, snapshot.sourceY, target.x, target.y, ignore);
}

export function canStartBasicMelee(source, target, attackConfig = {}) {
    if (!source || !target || !target.active || !target.hittable) return false;
    const snapshot = createBasicMeleeSnapshot(source, target, attackConfig);
    if (snapshot.requiresSameSurface && !canMeleeShareSurface(source, target)) return false;
    const hit = shapeIntersectsTarget(source, target, snapshot);
    // 起手轮询只保留真正触发攻击的锁定框，避免追击阶段持续刷屏。
    if (hit) recordBasicMeleeDebugTrace(source, target, snapshot, 'start', true, '起手锁定');
    return hit;
}

export function canImpactBasicMelee(source, target, snapshot) {
    if (!source || !target || !snapshot) return false;
    const finish = (hit, reason) => {
        recordBasicMeleeDebugTrace(source, target, snapshot, 'impact', hit, reason);
        return hit;
    };
    if (!target.active || !target.hittable) return finish(false, '锁定目标失效');
    if (snapshot.requiresSameSurface && !canMeleeShareSurface(source, target)) {
        return finish(false, '承载面不一致');
    }
    if (!hasImpactLineOfSight(source, target, snapshot)) return finish(false, '目标隔墙');
    if (!shapeIntersectsTarget(source, target, snapshot)) {
        return finish(false, '目标离开锁定矩形');
    }
    return finish(true, '命中帧复查通过');
}

export function basicMeleeApproachRange(source, attackConfig = {}) {
    return createBasicMeleeProfile(source, attackConfig).reach;
}

export function distanceToMeleeTarget(source, target) {
    if (!source || !target) return Infinity;
    if (target.collisionShape === 'iso_rect') {
        return distanceToIsoFootprint(source.x, source.y, target);
    }
    // 防守结构的轴对齐矩形仍与其既有 AABB 兜底同口径；普通圆 footprint
    // 则必须在逆透视后的地面平面量距，否则纵向会比横向提前一倍刹车。
    if (target._isDefenseStructure || target.collisionShape === 'rect') {
        return distanceToEntityShape(target, source.x, source.y);
    }
    const c = target.collider;
    if (c) {
        return Math.hypot(source.x - c.x, (source.y - c.y) / PERSPECTIVE_SCALE_Y)
            - c.radius;
    }
    const radius = target.collisionRadius || target.size * 0.6 || 10;
    return Math.hypot(source.x - target.x, (source.y - target.y) / PERSPECTIVE_SCALE_Y)
        - radius;
}
