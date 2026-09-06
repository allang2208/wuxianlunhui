import { PathWorkScheduler } from './path-work-scheduler.js';

const MAX_RECORDS = 64;
const RECORD_COOLDOWN_MS = 2000;
const records = [];
let enabled = false;
let lastRecorded = new WeakMap();
const entityKeys = new WeakMap();
let nextEntityKey = 1;

const number = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const scalar = (value) => typeof value === 'string' || typeof value === 'number' ? value : null;
const point = (value) => value ? {
    x: number(value.x), y: number(value.y), z: number(value.z),
    surfaceKind: scalar(value.surfaceKind || value._surfaceKind),
    wallId: scalar(value.wallId), staircaseId: scalar(value.staircaseId),
    stairGroupId: scalar(value.stairGroupId),
} : null;

export function navigationEntityKey(entity) {
    if (!entityKeys.has(entity)) entityKeys.set(entity, `unit-${nextEntityKey++}`);
    return entityKeys.get(entity);
}

/** 只读取现有状态；不寻路、不续租、不移动单位，不保留实体或整条路径引用。 */
export function snapshotElevatedNavigation(entity, command, traffic, revision, now = Date.now()) {
    if (!entity) return null;
    const route = command?.point?.route || [];
    const routeIndex = Math.max(0, Math.trunc(Number(command?.routeIndex) || 0));
    const manager = entity._surfaceGroundPathManager || entity._pathManager;
    const progress = command?._surfaceProgress;
    const plan = manager?.lastPlanResult;
    const controlled = !!(entity._dashStunned || entity.knockbackX || entity.knockbackY
        || ['stun', 'frozen', 'petrified', 'bind', 'fear'].some((kind) => entity.hasStatusEffect?.(kind)));
    const action = !!(entity._attackSwing || entity._attackAnimTimer > 0
        || entity.weaponAnim?.isAttacking || entity._frozenForCast);
    const pending = !!(manager && PathWorkScheduler.hasPendingRecalculation(manager));
    const waiting = !!entity._surfaceNavWaiting || traffic?.role === 'queued';
    const status = entity.active === false || entity.hp <= 0 ? 'inactive'
        : controlled ? 'controlled' : action ? 'action'
            : waiting ? 'portal_queue' : pending ? 'path_pending'
                : command?.point?.unreachable ? 'unreachable'
                    : route.length ? 'route_following'
                        : command?.mode === 'move' ? 'ground_move' : 'idle';
    return {
        at: now,
        unit: {
            key: navigationEntityKey(entity), id: scalar(entity.id),
            name: scalar(entity.name || entity.title), type: entity.constructor?.name || null,
            faction: scalar(entity._faction || entity.faction),
            x: number(entity.x), y: number(entity.y), z: number(entity.z),
            hp: number(entity.hp), maxHp: number(entity.maxHp),
            radius: number(entity.groundRadius ?? entity.collisionRadius),
            offsetX: number(entity.colliderOffsetX), offsetY: number(entity.colliderOffsetY),
        },
        status, controlled, action, pending, waiting,
        surface: {
            kind: entity._surfaceKind || 'ground',
            carrierId: scalar(entity._surfaceRef?.id || entity._surfaceWall?.id),
            staircaseId: scalar(entity._surfaceStaircase?.id),
            stairGroupId: scalar(entity._surfaceStairGroupId),
            stage: scalar(entity._surfaceRouteStage),
            landingBlocked: !!entity._surfaceLandingBlocked,
        },
        command: {
            mode: scalar(command?.mode), exitRoute: !!command?._surfaceExitRoute,
            autonomous: !!command?._surfaceAutonomous,
            goal: point(command?.point), destination: point(entity._surfaceNavDestination),
            targetId: scalar(command?.target?.id || entity.target?.id),
            unreachable: !!command?.point?.unreachable,
            failure: scalar(command?.point?.reason || entity._surfaceNavFailure),
            revision: number(command?.point?.routeRevision), currentRevision: revision,
            routeIndex, routeLength: route.length,
            nextWaypoint: point(route[routeIndex]),
            // 保留接下来8个节点，足够查看楼梯出入口，不复制长路径。
            upcomingWaypoints: route.slice(routeIndex, routeIndex + 8).map(point),
            recoveries: Number(command?._surfaceRecoveries) || 0,
            progressAgeMs: progress ? Math.max(0, now - progress.at) : null,
            retryInMs: Math.max(0, (Number(command?._surfaceRetryAt || entity._surfaceNavRetryAt) || 0) - now),
        },
        groundPath: {
            index: number(manager?.pathIdx), length: manager?.path?.length || 0,
            nextWaypoint: point(manager?.path?.[manager.pathIdx]),
            lastPlan: plan ? {
                at: number(plan.at), x: number(plan.x), y: number(plan.y),
                reachable: plan.reachable ?? null, pending: !!plan.pending,
                reason: scalar(plan.reason),
            } : null,
        },
        traffic,
    };
}

export const ElevatedNavigationDiagnostics = {
    get enabled() { return enabled; },
    get count() { return records.length; },
    setEnabled(value) { enabled = !!value; },
    clear() {
        records.length = 0;
        lastRecorded = new WeakMap();
    },
    getRecords(limit = MAX_RECORDS) { return JSON.parse(JSON.stringify(records.slice(-limit))); },
    record(entity, event, buildSnapshot, now = Date.now()) {
        if (!enabled || !entity || entity.active === false || entity._collisionPreview) return;
        const last = lastRecorded.get(entity);
        if (last?.[event] !== undefined && now - last[event] < RECORD_COOLDOWN_MS) return;
        const snapshot = buildSnapshot();
        // 普通排队、异步寻路、控制及攻击停步不是卡死；仅队列真正超时单独记事件。
        if (!snapshot || snapshot.status === 'inactive') return;
        if (event === 'progress_timeout' && (snapshot.waiting || snapshot.pending
            || snapshot.controlled || snapshot.action)) return;
        records.push({ event, ...snapshot });
        if (records.length > MAX_RECORDS) records.shift();
        const eventTimes = last || Object.create(null);
        eventTimes[event] = now;
        lastRecorded.set(entity, eventTimes);
    },
};
