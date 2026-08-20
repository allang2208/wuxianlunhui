import { ElevatedRouteTraffic } from './elevated-route-traffic.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';

const DEFAULT_CONFIG = Object.freeze({
    replanIntervalMs: 450,
    failedPlanRetryMs: 900,
    progressTimeoutMs: 1800,
    maxRecoveryAttempts: 3,
    portalEntryRadius: 14,
    portalQueueCost: 180,
    maxUnitRadius: 30,
});

const isElevatedKind = (kind) => kind === 'stairs' || kind === 'wall_walk';

function targetSurfaceSource(entity, goal) {
    if (!goal) return null;
    if (goal._surfaceTarget && goal._surfaceTarget.active !== false) return goal._surfaceTarget;
    const combatTarget = entity?.target;
    if (combatTarget?.active && Number.isFinite(goal.x) && Number.isFinite(goal.y)) {
        const tolerance = Math.max(48, Number(combatTarget.groundRadius) || 0);
        if (Math.hypot(goal.x - combatTarget.x, goal.y - combatTarget.y) <= tolerance) {
            return combatTarget;
        }
    }
    return goal;
}

function surfaceKindOf(value) {
    if (!value) return 'ground';
    if (isElevatedKind(value.surfaceKind)) return value.surfaceKind;
    if (isElevatedKind(value._surfaceKind)) return value._surfaceKind;
    return (Number(value.z) || 0) > 12 ? 'elevated' : 'ground';
}

function wallIdOf(value) {
    return value?.wallId || value?._surfaceWall?.id || value?._surfaceStaircase?.wall?.id || null;
}

function stairGroupIdOf(value) {
    return value?.stairGroupId
        || value?._surfaceStairGroupId
        || value?._surfaceStaircase?._wallStairGroupId
        || null;
}

function goalKey(value) {
    if (!value) return 'none';
    const kind = surfaceKindOf(value);
    return [
        value.id || value._entityId || value.name || 'point',
        kind,
        (kind === 'stairs' ? stairGroupIdOf(value) : wallIdOf(value)) || '',
    ].join(':');
}

function routeDirection(route, routeIndex) {
    const current = route?.[routeIndex];
    const next = route?.[Math.min(route.length - 1, routeIndex + 1)];
    if (!current || !next) return 'up';
    if (current.surfaceKind === 'wall_walk' && next.surfaceKind === 'stairs') return 'down';
    if (current.surfaceKind === 'stairs' && next.surfaceKind === 'ground') return 'down';
    if (current.surfaceKind === 'ground' && next.surfaceKind === 'stairs') return 'up';
    return (Number(next.z) || 0) < (Number(current.z) || 0) ? 'down' : 'up';
}

export function canMeleeReachElevation(source, target) {
    return canMeleeShareSurface(source, target);
}

class ElevatedNavigationControllerImpl {
    constructor() {
        this._adapter = null;
        this._config = { ...DEFAULT_CONFIG };
        this._traffic = new ElevatedRouteTraffic();
    }

    configure(adapter, config = {}) {
        this._adapter = adapter || null;
        this._config = {
            ...DEFAULT_CONFIG,
            ...config,
            maxUnitRadius: Math.max(1, Number(config.maxUnitRadius) || DEFAULT_CONFIG.maxUnitRadius),
        };
        this._traffic.configure(config);
    }

    reset() {
        this._traffic.reset();
    }

    revision() {
        return Number(this._adapter?.revision?.()) || 0;
    }

    _stairTrafficKey(staircaseOrId) {
        const directGroupId = staircaseOrId?._wallStairGroupId;
        if (directGroupId) return directGroupId;
        const staircaseId = typeof staircaseOrId === 'string'
            ? staircaseOrId
            : staircaseOrId?.id;
        if (!staircaseId) return '';
        return this._adapter?.stairTrafficKey?.(staircaseId) || staircaseId;
    }

    _stairGroupSize(staircaseOrId) {
        const directMembers = staircaseOrId?._wallStairGroupMembers;
        if (Array.isArray(directMembers) && directMembers.length) {
            return Math.max(1, directMembers.filter((member) => member?.active !== false).length);
        }
        const staircaseId = typeof staircaseOrId === 'string'
            ? staircaseOrId
            : staircaseOrId?.id;
        return Math.max(1, Number(this._adapter?.stairGroupSize?.(staircaseId)) || 1);
    }

    portalPenalty(staircaseId, direction) {
        if (this._stairGroupSize(staircaseId) > 1) return 0;
        return this._traffic.penalty(this._stairTrafficKey(staircaseId), direction)
            * (Number(this._config.portalQueueCost) || DEFAULT_CONFIG.portalQueueCost);
    }

    portalEntryRadius() {
        return Math.max(1, Number(this._config.portalEntryRadius) || DEFAULT_CONFIG.portalEntryRadius);
    }

    isRouteControlled(entity) {
        const explicitRoute = Array.isArray(entity?._command?.point?.route)
            && entity._command.point.route.length > 0;
        const autonomousRoute = Array.isArray(entity?._surfaceNavCommand?.point?.route)
            && entity._surfaceNavCommand.point.route.length > 0;
        return explicitRoute || autonomousRoute || !!entity?._surfaceRouteActive;
    }

    canCrossPortal(entity, staircaseId, direction) {
        const trafficKey = this._stairTrafficKey(staircaseId);
        if (!entity || !trafficKey) return false;
        if (this._stairGroupSize(staircaseId) > 1) {
            this._traffic.release(entity);
            entity._surfaceNavWaiting = false;
            return true;
        }
        if (entity._surfaceKind === 'stairs'
            && this._traffic.permission(entity, trafficKey, direction)) {
            return true;
        }
        if (!this.isRouteControlled(entity)) {
            // 手动/无路线移动同样必须在实际切面前占用楼梯；否则会先进入窄梯，
            // 再与已获许可的AI发生物理重叠。request 对同一持有者是幂等续租。
            const reservation = this._traffic.request(entity, trafficKey, direction);
            entity._surfaceNavWaiting = !reservation.granted && !reservation.timedOut;
            if (entity._surfaceNavWaiting) entity._surfaceRouteStage = 'portal_queue';
            else if (entity._surfaceRouteStage === 'portal_queue') entity._surfaceRouteStage = null;
            return !!reservation.granted;
        }
        return this._traffic.permission(entity, trafficKey, direction);
    }

    _releaseRouteTraffic(entity, now = Date.now()) {
        // 通行权属于实际占用的楼梯，而不是某条已经完成/取消的命令。
        // 停在楼梯中段、攻击或待机的单位必须继续持有，直到原子提交离开该楼梯。
        if (entity?._surfaceKind === 'stairs' && entity?._surfaceStaircase?.id) {
            return this.syncSurfaceOccupancy(entity, now);
        }
        return this._traffic.release(entity);
    }

    syncSurfaceOccupancy(entity, now = Date.now()) {
        if (!entity) return false;
        if (entity._surfaceKind === 'stairs') {
            if (this._stairGroupSize(
                entity._surfaceStairGroupId || entity._surfaceStaircase
            ) > 1) {
                this._traffic.release(entity);
                return true;
            }
            const trafficKey = this._stairTrafficKey(
                entity._surfaceStairGroupId || entity._surfaceStaircase
            );
            return this._traffic.occupy(entity, trafficKey, now);
        }
        return false;
    }

    _modeFor(entity) {
        if (!entity || entity.active === false) return null;
        const radius = Number(entity.groundRadius) || Number(entity.collisionRadius) || 20;
        if (radius > this._config.maxUnitRadius) return null;
        if (entity._faction === 'enemy') return entity._elevatedNavigationMode || null;
        if (entity._faction === 'player' || entity._faction === 'companion'
            || entity._faction === 'friendly' || entity._isFriendlyUnit) return 'auto';
        return null;
    }

    _rangedCanHoldLayer(entity, target) {
        const ranged = !!entity?.attacks?.ranged
            || entity?.aiConfig?.role === 'ranged'
            || entity?.ai?.role === 'ranged'
            || Number(entity?.attackRange) > 220;
        if (!ranged || !target) return false;
        const range = Number(entity.attackRange) || Number(entity.attackDistance) || 0;
        if (range <= 0 || Math.hypot(target.x - entity.x, target.y - entity.y) > range) return false;
        return entity?._perception?.hasLOS !== false;
    }

    _needsRoute(entity, target, mode) {
        if (!mode || !target) return false;
        const entityKind = surfaceKindOf(entity);
        const targetKind = surfaceKindOf(target);
        const entityHigh = entityKind !== 'ground';
        const targetHigh = targetKind !== 'ground';
        if (!entityHigh && !targetHigh) return false;
        if (this._rangedCanHoldLayer(entity, target)) return false;
        if (entityHigh !== targetHigh) return true;
        if (entityKind === 'stairs' || targetKind === 'stairs') return true;
        if (wallIdOf(entity) !== wallIdOf(target)) return true;
        return Math.hypot(target.x - entity.x, target.y - entity.y) > 16;
    }

    _nearestRouteIndex(entity, route) {
        if (!Array.isArray(route) || !route.length || surfaceKindOf(entity) === 'ground') return 0;
        let nearestIndex = 0;
        let nearestScore = Number.POSITIVE_INFINITY;
        for (let index = 0; index < route.length; index++) {
            const candidate = route[index];
            const score = Math.hypot(candidate.x - entity.x, candidate.y - entity.y)
                + Math.abs((Number(candidate.z) || 0) - (Number(entity.z) || 0));
            if (score >= nearestScore) continue;
            nearestScore = score;
            nearestIndex = index;
        }
        return nearestIndex;
    }

    _cancelAutonomous(entity, retryAt = 0) {
        this._releaseRouteTraffic(entity);
        entity._surfaceNavCommand = null;
        entity._surfaceNavDestination = null;
        entity._surfaceNavWaiting = false;
        entity._surfaceNavRetryAt = retryAt;
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = null;
    }

    _plan(entity, semanticGoal, target, now, previousRecoveries = 0) {
        const point = this._adapter?.planRoute?.(entity, target, semanticGoal);
        if (!point || point.unreachable || !Array.isArray(point.route) || !point.route.length) {
            this._cancelAutonomous(entity, now + this._config.failedPlanRetryMs);
            return null;
        }
        point.routeRevision = this.revision();
        const routeIndex = this._nearestRouteIndex(entity, point.route);
        const command = {
            mode: 'move',
            point,
            routeIndex,
            _surfaceAutonomous: true,
            _surfaceGoal: semanticGoal,
            _surfaceTarget: target,
            _surfaceGoalKey: goalKey(target),
            _surfaceNextPlanAt: now + this._config.replanIntervalMs,
            _surfaceProgressMs: 0,
            _surfaceLastDistance: Infinity,
            _surfaceRecoveries: previousRecoveries,
        };
        entity._surfaceNavCommand = command;
        entity._surfaceNavRetryAt = 0;
        this._adapter?.trackUnit?.(entity);
        return command;
    }

    prepareAutonomousCommand(entity, semanticGoal, dt, now = Date.now()) {
        if (!this._adapter || !entity || entity.active === false) return null;
        if (entity._command?.mode === 'move' && Array.isArray(entity._command?.point?.route)) {
            if (entity._surfaceNavCommand) this._cancelAutonomous(entity);
            return null;
        }
        const mode = this._modeFor(entity);
        const target = targetSurfaceSource(entity, semanticGoal);
        if (!this._needsRoute(entity, target, mode)) {
            if (entity._surfaceNavCommand || entity._surfaceRouteActive) {
                this._cancelAutonomous(entity);
            }
            return null;
        }
        if ((Number(entity._surfaceNavRetryAt) || 0) > now) return null;

        let command = entity._surfaceNavCommand;
        const staleRevision = command
            && Number(command.point?.routeRevision) !== this.revision();
        const changedGoal = command && command._surfaceGoalKey !== goalKey(target);
        const targetMoved = command && Math.hypot(
            (Number(command.point?.x) || 0) - (Number(target.x) || 0),
            (Number(command.point?.y) || 0) - (Number(target.y) || 0)
        ) > 48;
        if (!command || staleRevision || changedGoal
            || (now >= command._surfaceNextPlanAt && targetMoved)) {
            command = this._plan(entity, semanticGoal, target, now, command?._surfaceRecoveries || 0);
        }
        if (!command) return null;

        const route = command.point.route;
        const index = Math.max(0, Math.min(route.length - 1, Number(command.routeIndex) || 0));
        const waypoint = route[index];
        const distance = waypoint
            ? Math.hypot(waypoint.x - entity.x, waypoint.y - entity.y)
                + Math.abs((Number(waypoint.z) || 0) - (Number(entity.z) || 0))
            : 0;
        if (entity._surfaceNavWaiting || distance + 1 < command._surfaceLastDistance) {
            command._surfaceProgressMs = 0;
            command._surfaceLastDistance = distance;
        } else {
            command._surfaceProgressMs += Math.max(0, Number(dt) || 0);
        }
        if (command._surfaceProgressMs >= this._config.progressTimeoutMs) {
            const recoveries = (Number(command._surfaceRecoveries) || 0) + 1;
            if (recoveries > this._config.maxRecoveryAttempts) {
                this._cancelAutonomous(entity, now + this._config.failedPlanRetryMs);
                entity.vx = 0;
                entity.vy = 0;
                return null;
            }
            entity._pathManager?._clearPath?.();
            command = this._plan(entity, semanticGoal, target, now, recoveries);
        }
        return command;
    }

    prepareExplicitRoute(entity, command, now = Date.now()) {
        let point = command?.point;
        if (!point || !Array.isArray(point.route) || !point.route.length) return command;
        const routeRevision = Number(point.routeRevision);
        if (Number.isFinite(routeRevision) && routeRevision !== this.revision()) {
            const replanned = this._adapter?.replanRoute?.(entity, point);
            if (replanned && !replanned.unreachable && Array.isArray(replanned.route)) {
                replanned.routeRevision = this.revision();
                command.point = replanned;
                command.routeIndex = this._nearestRouteIndex(entity, replanned.route);
                point = replanned;
            } else {
                command.point = { ...point, route: [], unreachable: true, reason: '高架路线已失效' };
                command.routeIndex = 0;
                return command;
            }
        }

        const route = command.point.route;
        const routeIndex = Math.max(0, Math.min(
            route.length - 1,
            Number(command.routeIndex) || 0
        ));
        const waypoint = route[routeIndex];
        const distance = Math.hypot(waypoint.x - entity.x, waypoint.y - entity.y)
            + Math.abs((Number(waypoint.z) || 0) - (Number(entity.z) || 0));
        const progressKey = `${this.revision()}:${routeIndex}`;
        if (entity._surfaceNavWaiting
            || command._surfaceExplicitProgressKey !== progressKey
            || distance + 1 < (Number(command._surfaceExplicitLastDistance) || Infinity)) {
            command._surfaceExplicitProgressKey = progressKey;
            command._surfaceExplicitProgressAt = now;
            command._surfaceExplicitLastDistance = distance;
            return command;
        }
        if (now - (Number(command._surfaceExplicitProgressAt) || now) < this._config.progressTimeoutMs) {
            return command;
        }

        const recoveries = (Number(command._surfaceExplicitRecoveries) || 0) + 1;
        this._releaseRouteTraffic(entity, now);
        entity._pathManager?._clearPath?.();
        if (recoveries > this._config.maxRecoveryAttempts) {
            command.point = {
                x: entity.x,
                y: entity.y,
                z: Number(entity.z) || 0,
                surfaceKind: surfaceKindOf(entity),
                route: [],
                unreachable: true,
                reason: '高架路线进度超时',
            };
            command.routeIndex = 0;
            return command;
        }
        const replanned = this._adapter?.replanRoute?.(entity, point);
        if (replanned && !replanned.unreachable && Array.isArray(replanned.route)
            && replanned.route.length) {
            replanned.routeRevision = this.revision();
            command.point = replanned;
            command.routeIndex = this._nearestRouteIndex(entity, replanned.route);
            command._surfaceExplicitRecoveries = recoveries;
            command._surfaceExplicitProgressKey = null;
            command._surfaceExplicitProgressAt = now;
            command._surfaceExplicitLastDistance = Infinity;
        } else {
            command._surfaceExplicitRecoveries = recoveries;
            command._surfaceExplicitProgressAt = now;
        }
        return command;
    }

    gateRouteAdvance(entity, command, route, routeIndex, atWaypoint, now = Date.now()) {
        entity._surfaceNavWaiting = false;
        if (!route?.length) {
            this._releaseRouteTraffic(entity, now);
            return { granted: true };
        }
        const current = route[routeIndex];
        const next = route[routeIndex + 1];
        const pointStair = command?.point?.stairGroupId || command?.point?.staircaseId;
        const currentStair = current?.stairGroupId || current?.staircaseId
            || (current?.surfaceKind === 'stairs' ? pointStair : null);
        const nextStair = next?.stairGroupId || next?.staircaseId
            || (next?.surfaceKind === 'stairs' ? pointStair : null);
        const activeStair = this._stairTrafficKey(currentStair || nextStair);
        if (this._stairGroupSize(currentStair || nextStair) > 1) {
            this._traffic.release(entity);
            entity._surfaceNavWaiting = false;
            return { granted: true, wideGroup: true };
        }
        if (entity._surfaceKind === 'stairs' && activeStair) {
            this.syncSurfaceOccupancy(entity, now);
        }
        if (!activeStair) return { granted: true };

        // wall→stairs 的顶端节点与墙顶等高，不能等“高度变化”后才预约；在实体取得
        // stairs身份前先拿到down许可，队列单位的物理Portal转换也会校验同一许可。
        const enteringCurrentStair = current?.surfaceKind === 'stairs'
            && entity._surfaceKind !== 'stairs';
        if (enteringCurrentStair) {
            const direction = entity._surfaceKind === 'wall_walk' ? 'down' : 'up';
            const reservation = this._traffic.request(entity, activeStair, direction, now);
            if (reservation.timedOut) {
                entity._surfaceNavWaiting = false;
                if (command?._surfaceAutonomous) {
                    command._surfaceProgressMs = this._config.progressTimeoutMs;
                } else if (command) {
                    command._surfaceExplicitProgressAt = 0;
                }
                return { ...reservation, blocked: true };
            }
            if (!reservation.granted) {
                entity._surfaceNavWaiting = true;
                entity._surfaceRouteStage = 'portal_queue';
            }
            return { ...reservation, blocked: !reservation.granted };
        }

        if (!atWaypoint || !next) return { granted: true };

        const changesHeight = Math.abs((Number(next.z) || 0) - (Number(current.z) || 0)) > 1;
        const changesSurface = current?.surfaceKind !== next?.surfaceKind;
        if (!changesHeight && !changesSurface) return { granted: true };
        const direction = routeDirection(route, routeIndex);
        const reservation = this._traffic.request(entity, activeStair, direction, now);
        if (reservation.timedOut) {
            entity._surfaceNavWaiting = false;
            if (command?._surfaceAutonomous) {
                command._surfaceProgressMs = this._config.progressTimeoutMs;
            } else if (command) {
                command._surfaceExplicitProgressAt = 0;
            }
            return { ...reservation, blocked: true };
        }
        if (!reservation.granted) {
            entity._surfaceNavWaiting = true;
            entity._surfaceRouteStage = 'portal_queue';
        }
        return reservation;
    }

    onSurfaceTransition(entity, transition) {
        if (!entity || !transition) return;
        if (transition.kind === 'stairs_to_ground' || transition.kind === 'stairs_to_wall'
            || transition.kind === 'carrier_removed'
            || transition.kind === 'support_invalidated') {
            this._traffic.release(entity);
            entity._surfaceNavWaiting = false;
            return;
        }
        if (transition.kind === 'ground_to_stairs' || transition.kind === 'wall_to_stairs') {
            this.syncSurfaceOccupancy(entity);
        }
    }

    afterRouteResolution(entity, command, destination, arrived) {
        entity._surfaceNavDestination = arrived ? null : destination;
        const route = command?.point?.route || [];
        const activeNode = route[Number(command?.routeIndex) || 0];
        if ((arrived && entity._surfaceKind !== 'stairs') || (entity._surfaceKind !== 'stairs'
            && activeNode?.surfaceKind !== 'stairs'
            && !entity._surfaceNavWaiting)) {
            this._traffic.release(entity);
        } else {
            if (entity._surfaceKind === 'stairs') this.syncSurfaceOccupancy(entity);
            else this._traffic.touch(entity);
        }
    }

    complete(entity) {
        if (!entity) return;
        this._cancelAutonomous(entity);
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = null;
    }
}

export const ElevatedNavigationController = new ElevatedNavigationControllerImpl();
