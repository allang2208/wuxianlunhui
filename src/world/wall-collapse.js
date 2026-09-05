import { WallSystem } from './wall-system.js';
import { pathFinder } from '../ai/pathfinder.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { PerformanceMonitor } from '../systems/performance-monitor.js';

const recentLandingFailures = [];
const MAX_LANDING_FAILURES = 32;

export function getWallCollapseDiagnostics() {
    // 仅调试读取时复制；历史只保存数值/ID，不能延长已销毁实体的生命周期。
    return JSON.parse(JSON.stringify(recentLandingFailures));
}

export function clearWallCollapseDiagnostics() {
    recentLandingFailures.length = 0;
}

const COLLAPSE_HEALTH_LOSS_RATIO = 0.5;
const LANDING_RADII = [16, 32, 48, 64, 96, 128, 160, 192];
const LANDING_DIRECTIONS = Array.from({ length: 16 }, (_, index) => ({
    x: Math.cos(index * Math.PI / 8),
    y: Math.sin(index * Math.PI / 8),
}));
// 额外覆盖等距墙道的四个精确轴，窄通道不能只靠屏幕八方向判断是否有出口。
for (const x of [-1, 1]) {
    for (const y of [-PERSPECTIVE_SCALE_Y, PERSPECTIVE_SCALE_Y]) {
        const length = Math.hypot(x, y);
        LANDING_DIRECTIONS.push({ x: x / length, y: y / length });
    }
}

/** 只用于支撑损毁的落地：优先正下方，最多在192px内避开残存碰撞，不送回旧楼梯入口。 */
export function resolveWallCollapseLanding(unit, origin) {
    const startedAt = PerformanceMonitor.begin();
    const radius = Math.max(1, Number(unit.groundRadius) || Number(unit.collisionRadius) || 20);
    const offsetX = Number(unit.colliderOffsetX) || 0;
    const offsetY = Number(unit.colliderOffsetY) || 0;
    const counts = { candidates: 0, standChecks: 0, segmentChecks: 0, exitChecks: 0 };
    let firstBlockedPoint = null;
    let firstBlockedSegment = null;
    const canStand = (point) => {
        counts.standChecks++;
        const x = point.x + offsetX, y = point.y + offsetY;
        const clear = WallSystem.canMoveTo(x, y, radius) && !pathFinder.isPointBlocked(x, y, radius);
        if (!clear && !firstBlockedPoint) firstBlockedPoint = { x, y };
        return clear;
    };
    const canReach = (from, to, fromIsClear) => {
        counts.segmentChecks++;
        if (WallSystem.blocked(from.x + offsetX, from.y + offsetY, to.x + offsetX, to.y + offsetY)) {
            firstBlockedSegment ||= { from: { ...from }, to: { ...to } };
            return false;
        }
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / 8));
        let cleared = fromIsClear;
        // 起点结果由调用者复用，终点已通过canStand；只采样内部，避免每条候选线重复查询端点。
        for (let index = 1; index < steps; index++) {
            const point = {
                x: from.x + (to.x - from.x) * index / steps,
                y: from.y + (to.y - from.y) * index / steps,
            };
            if (canStand(point)) {
                cleared = true;
            } else if (cleared || distance * index / steps > Math.max(48, radius * 2 + 8)) {
                return false;
            }
        }
        // 允许从贴邻墙的初始重叠边缘退出；离开后不得再穿入任何残存障碍。
        return true;
    };
    const hasExit = (point) => LANDING_DIRECTIONS.some((direction) => {
        counts.exitChecks++;
        const next = { x: point.x + direction.x * 40, y: point.y + direction.y * 40 };
        return canStand(next) && canReach(point, next, true);
    });

    const finish = (point, blocked, reason = null) => {
        PerformanceMonitor.addCounter('wallCollapse.landings');
        PerformanceMonitor.addCounter('wallCollapse.standChecks', counts.standChecks);
        PerformanceMonitor.addCounter('wallCollapse.candidates', counts.candidates);
        unit._surfaceLandingDiagnostic = null;
        if (blocked) {
            PerformanceMonitor.addCounter('wallCollapse.blockedLandings');
            let blockerInfo = null;
            if (firstBlockedPoint) {
                const detail = {};
                const { x, y } = firstBlockedPoint;
                if (WallSystem.canMoveTo(x, y, radius, null, detail)) {
                    pathFinder.isPointBlocked(x, y, radius, detail);
                    // 半径桶比实体略宽时，定位是哪个墙/边缘造成保守拒绝。
                    if (detail.kind === 'navigation_clearance') {
                        WallSystem.canMoveTo(x, y, detail.radius, null, detail);
                    }
                }
                const obstacle = detail.obstacle;
                const owner = obstacle?._owner || obstacle;
                blockerInfo = {
                    kind: detail.kind || 'unknown', id: owner?.id ?? null,
                    type: owner?.constructor?.name || null, point: firstBlockedPoint,
                    radius: detail.radius ?? radius,
                };
            }
            const record = {
                at: Date.now(), unitId: unit.id ?? null,
                unitType: unit.constructor?.name || null,
                carrierId: unit._surfaceRef?.id ?? unit._surfaceWall?.id ?? null,
                fromKind: unit._surfaceKind || 'ground',
                origin: { ...origin }, landing: { x: point.x, y: point.y },
                reason, blocker: blockerInfo, blockedSegment: firstBlockedSegment,
                radius, offsetX, offsetY, counts: { ...counts }, elapsedMs: 0,
            };
            unit._surfaceLandingDiagnostic = record;
            recentLandingFailures.push(record);
            if (recentLandingFailures.length > MAX_LANDING_FAILURES) recentLandingFailures.shift();
        }
        const elapsedMs = PerformanceMonitor.end('wallCollapse.landing', startedAt);
        PerformanceMonitor.setCounter('wallCollapse.lastLandingMs', elapsedMs);
        if (unit._surfaceLandingDiagnostic) unit._surfaceLandingDiagnostic.elapsedMs = elapsedMs;
        return { x: point.x, y: point.y, blocked };
    };

    const originIsClear = canStand(origin);
    let standingFallback = originIsClear ? { ...origin } : null;
    if (standingFallback && hasExit(standingFallback)) return finish(standingFallback, false);
    for (const distance of LANDING_RADII) {
        for (const direction of LANDING_DIRECTIONS) {
            counts.candidates++;
            const point = {
                x: origin.x + direction.x * distance,
                y: origin.y + direction.y * distance,
            };
            if (!canStand(point) || !canReach(origin, point, originIsClear)) continue;
            standingFallback ||= point;
            if (hasExit(point)) return finish(point, false);
        }
    }
    // 真正被完整墙体围死时不穿墙传送；仍清高架状态、恢复地面命令，保留诊断标记。
    return finish(standingFallback || origin, true,
        standingFallback ? 'no_local_exit' : 'no_reachable_landing');
}

/** 固定最大生命损失不是普通攻击；护甲、盾牌、闪避、女墙及承伤上限均不参与。 */
export function applyWallCollapseHealthLoss(unit) {
    if (!unit || unit.active === false || unit._dying || unit._isDead) return 0;
    const ownHp = Object.getOwnPropertyDescriptor(unit, 'hp');
    // Enemy读独立hp；玩家即使继承了可写hp也只认data.hp，Companion/兵种同样以data为真源。
    const before = Number(unit._isEnemyEntity ? unit.hp : (unit.data?.hp ?? unit.hp));
    const maxHp = Number(unit._isEnemyEntity ? unit.maxHp : (unit.data?.maxHp ?? unit.maxHp));
    if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
    const after = Math.max(0, before - maxHp * COLLAPSE_HEALTH_LOSS_RATIO);
    if (unit.data) unit.data.hp = after;
    if (ownHp?.writable) unit.hp = after;
    const applied = before - after;
    unit.hitFlash = Number(unit.hitFlashDuration) || 120;
    if (after <= 0) {
        unit.vx = 0;
        unit.vy = 0;
        unit.isMoving = false;
        if (typeof unit._startDying === 'function') unit._startDying();
        else if (typeof unit.onDeath === 'function') unit.onDeath(null);
        else {
            // 普通Companion没有死亡hook，沿用零生命停步状态，不擅自移出队伍。
            unit.target = null;
            unit._animState = 'idle';
        }
    }
    EffectManager.add(new FloatingTextEffect(unit.x, unit.y - 30, `坠落 -${applied}`, '#ff8855'));
    return applied;
}
