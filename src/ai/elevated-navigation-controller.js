import { ElevatedRouteTraffic } from './elevated-route-traffic.js';
import { ElevatedGarrison } from './elevated-garrison.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';
import { PathWorkScheduler } from './path-work-scheduler.js';
import { ElevatedNavigationDiagnostics, snapshotElevatedNavigation } from './elevated-navigation-diagnostics.js';

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

/** 跟随到达必须同层且已离开楼梯，平面距离接近不能替代承载面判定。 */
export function canFinishSurfaceFollow(entity, target) {
    return entity?._surfaceKind !== 'stairs' && target?._surfaceKind !== 'stairs'
        && !entity?._surfaceExitCommand && canMeleeShareSurface(entity, target, 12);
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
        this._plannedPortals?.clear();
        this._traffic.reset();
        ElevatedGarrison.reset();
        ElevatedNavigationDiagnostics.clear();
    }

    debugEntity(entity, command = null, now = Date.now()) {
        const activeCommand = command || entity?._surfaceExitCommand
            || entity?._surfaceNavCommand || entity?._rtsController?.command || entity?._command;
        return snapshotElevatedNavigation(entity, activeCommand,
            this._traffic.debugEntity(entity, now), this.revision(), now);
    }

    _recordDiagnostic(entity, command, event, now) {
        // 默认关闭；仅在现有异常分支上取快照，正常移动不增加采样/全场扫描。
        if (!ElevatedNavigationDiagnostics.enabled) return;
        ElevatedNavigationDiagnostics.record(entity, event,
            () => this.debugEntity(entity, command, now), now);
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

    portalPenalty(staircaseId, direction, queryingUnit = null) {
        if (this._stairGroupSize(staircaseId) > 1) return 0;
        let approaches = 0;
        if (queryingUnit && this._plannedPortals) {
            const now = Date.now();
            for (const [unit, intent] of this._plannedPortals) {
                if (!unit.active || unit._dying || intent.until < now || intent.owner !== unit._command) {
                    this._plannedPortals.delete(unit); continue;
                }
                if (unit !== queryingUnit && unit._surfaceKind !== 'stairs'
                    && intent.id === this._stairTrafficKey(staircaseId)) approaches++;
            }
        }
        return (this._traffic.penalty(this._stairTrafficKey(staircaseId), direction) + approaches * 0.25)
            * (Number(this._config.portalQueueCost) || DEFAULT_CONFIG.portalQueueCost)
            + this.portalRecoveryPenalty(staircaseId, queryingUnit);
    }

    portalRecoveryPenalty(staircaseId, unit, now = Date.now()) {
        const key = this._stairTrafficKey(staircaseId);
        const entry = unit?._surfacePortalPenalties?.get(key);
        if (!entry) return 0;
        if (entry.revision !== this.revision() || entry.until <= now) {
            unit._surfacePortalPenalties.delete(key);
            return 0;
        }
        return entry.cost;
    }

    _notePortalCongestion(entity, staircaseId, now) {
        const key = this._stairTrafficKey(staircaseId);
        if (!key) return;
        entity._surfacePortalPenalties ||= new Map();
        const revision = this.revision();
        for (const [id, entry] of entity._surfacePortalPenalties) {
            if (entry.until <= now || entry.revision !== revision) entity._surfacePortalPenalties.delete(id);
        }
        entity._surfacePortalPenalties.set(key, {
            revision, until: now + Math.max(6000, this._config.failedPlanRetryMs),
            cost: 4 * (Number(this._config.portalQueueCost) || DEFAULT_CONFIG.portalQueueCost),
        });
    }

    portalEntryRadius() {
        return Math.max(1, Number(this._config.portalEntryRadius) || DEFAULT_CONFIG.portalEntryRadius);
    }

    isRouteControlled(entity) {
        const explicitRoute = Array.isArray(entity?._command?.point?.route)
            && entity._command.point.route.length > 0;
        const autonomousRoute = Array.isArray(entity?._surfaceNavCommand?.point?.route)
            && entity._surfaceNavCommand.point.route.length > 0;
        return explicitRoute || autonomousRoute || !!entity?._surfaceExitCommand
            || !!entity?._surfaceRouteActive;
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
        this._plannedPortals?.delete(entity);
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
            // 拆建后实体缓存的组ID可能尚未提交，实际楼梯对象上的新分组才是当前真源。
            const staircase = entity._surfaceStaircase || entity._surfaceStairGroupId;
            if (this._stairGroupSize(staircase) > 1) {
                this._traffic.release(entity);
                return true;
            }
            const trafficKey = this._stairTrafficKey(staircase);
            // 宽梯原本没有预约记录；缩为窄梯时沿当前路线，缺少路线则朝较近出口恢复。
            const height = Number(entity.z) || 0;
            const destinationHeight = Number(entity._surfaceNavDestination?.z);
            const direction = Number.isFinite(destinationHeight)
                && Math.abs(destinationHeight - height) > 1
                ? (destinationHeight < height ? 'down' : 'up')
                : (height >= (Number(entity._surfaceStaircase?.targetTopZ) || 0) / 2 ? 'up' : 'down');
            return this._traffic.occupy(entity, trafficKey, now, direction);
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
        if (entity?._surfaceKind === 'stairs' || target !== entity?.target) return false;
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
        // 路线已按当前载体生成；不能按欧氏最近点跳过墙链转角或跳回楼梯的地面入口。
        if (route[0]?.fromCurrentSurface) return 0;
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
        // 同一攻击命令也可能结束寻路转为开火；让其旧成本查询释放活跃任务名额。
        entity._navigationPlanEpoch = (entity._navigationPlanEpoch || 0) + 1;
        this._releaseRouteTraffic(entity);
        entity._surfaceNavCommand = null;
        entity._surfaceNavDestination = null;
        entity._surfaceNavWaiting = false;
        entity._surfaceNavRetryAt = retryAt;
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = null;
    }

    _plan(entity, semanticGoal, target, now) {
        let point = this._adapter?.planRoute?.(entity, target, semanticGoal);
        this._clearGroundPath(entity);
        if (!point || point.unreachable || (!point.navigationPending
            && (!Array.isArray(point.route) || !point.route.length))) {
            // 不可达仍返回明确的失败命令，不能退回直线移动撞墙或在楼梯上误停。
            point = { ...point, x: target.x, y: target.y, z: Number(target.z) || 0,
                surfaceKind: surfaceKindOf(target), wallId: wallIdOf(target),
                route: [], unreachable: true, reason: point?.reason || '没有可用高架路线' };
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
            _surfaceRetryAt: point.unreachable ? now + this._config.failedPlanRetryMs : 0,
        };
        entity._surfaceNavCommand = command;
        entity._surfaceNavRetryAt = 0;
        this._adapter?.trackUnit?.(entity);
        if (point.unreachable) this._recordDiagnostic(entity, command, 'route_unreachable', now);
        return command;
    }

    prepareAutonomousCommand(entity, semanticGoal, _dt, now = Date.now()) {
        if (!this._adapter || !entity || entity.active === false) return null;
        if (entity._surfaceExitCommand) return entity._surfaceExitCommand;
        if (entity._command?.mode === 'move' && Array.isArray(entity._command?.point?.route)) {
            if (entity._surfaceNavCommand) this._cancelAutonomous(entity);
            return null;
        }
        const mode = this._modeFor(entity);
        const target = targetSurfaceSource(entity, semanticGoal);
        const transit = entity._surfaceNavCommand;
        if (transit?._groundTransit) {
            const sameOwner = transit._surfaceOwner === entity._command;
            const sameTarget = target && transit._surfaceGoalKey === goalKey(target)
                && Math.abs((Number(target.z) || 0) - transit._surfaceTargetZ) <= 12
                && Math.hypot(target.x - transit.point.x, target.y - transit.point.y) <= 48;
            if (sameOwner && sameTarget && transit.point.routeRevision === this.revision()) return transit;
            this._cancelAutonomous(entity);
            if (entity._surfaceKind === 'stairs') return this.prepareExitCommand(entity);
        }
        if (!this._needsRoute(entity, target, mode)) {
            if (entity._surfaceNavCommand || entity._surfaceRouteActive) {
                this._cancelAutonomous(entity);
            }
            return mode && entity._surfaceKind === 'stairs' ? this.prepareExitCommand(entity) : null;
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
            command = this._plan(entity, semanticGoal, target, now);
        }
        // 自主/显式路线共用 prepareExplicitRoute 的一份进展状态，避免双看门狗互相重算。
        return command;
    }

    adoptGroundTransit(entity, owner, destination, route) {
        const point = { ...destination, surfaceKind: 'ground', z: 0, route,
            routeRevision: this.revision(), navigationPending: false, unreachable: false };
        if (owner.mode === 'move' || entity._rtsController?.command === owner) {
            owner.point = { ...owner.point, ...point };
            owner.routeIndex = 0;
            owner._surfaceProgress = null;
        } else {
            const target = targetSurfaceSource(entity, destination);
            entity._surfaceNavCommand = { mode: 'move', point, routeIndex: 0,
                _surfaceAutonomous: true, _groundTransit: true, _surfaceOwner: owner,
                _surfaceTarget: target, _surfaceGoal: destination, _surfaceTargetZ: Number(target?.z) || 0,
                _surfaceGoalKey: goalKey(target), _surfaceNextPlanAt: Date.now() + this._config.replanIntervalMs };
        }
        this._clearGroundPath(entity);
        this._adapter?.trackUnit?.(entity);
    }

    _clearGroundPath(entity) {
        const manager = entity._surfaceGroundPathManager || entity._pathManager;
        PathWorkScheduler.cancel(manager);
        manager?._clearPath?.();
    }

    isPortalUnavailable(entity, staircaseId, now = Date.now()) {
        const key = this._stairTrafficKey(staircaseId);
        const failure = entity?._surfaceFailedPortals?.get(key);
        if (!failure) return false;
        if (failure.revision !== this.revision() || failure.until <= now) {
            entity._surfaceFailedPortals.delete(key);
            return false;
        }
        return true;
    }

    _deferPortal(entity, waypoint, now) {
        if (!waypoint?.staircaseId) return;
        entity._surfaceFailedPortals ||= new Map();
        entity._surfaceFailedPortals.set(this._stairTrafficKey(waypoint.staircaseId), {
            revision: this.revision(),
            until: now + Math.max(6000, this._config.failedPlanRetryMs),
        });
    }

    _planExit(entity) {
        const direction = this._traffic.directionFor(entity)
            || ((Number(entity.z) || 0) >= (Number(entity._surfaceStaircase?.targetTopZ) || 0) / 2
                ? 'up' : 'down');
        const point = this._adapter?.exitRoute?.(entity, direction);
        if (direction === 'up' && point?.surfaceKind === 'ground'
            && point.route?.length && !point.unreachable
            && this._stairGroupSize(entity._surfaceStaircase) === 1) {
            // 上方出口失效使路线改为下撤，通行方向必须一起改变；否则多人持有旧up许可
            // 会在下一级航点互等，且 holder 不受入口队列超时回收。普通反向命令仍先离梯。
            this._traffic.retreatToGround(entity, this._stairTrafficKey(entity._surfaceStaircase));
        }
        return point;
    }

    prepareExitCommand(entity) {
        // 切面完成后仍要走到出口安全点，不能刚取得地面/墙顶身份就停在入口。
        const existing = entity?._surfaceExitCommand;
        if (existing) return existing;
        if (entity?._surfaceKind !== 'stairs') return null;
        const point = this._planExit(entity);
        if (!point?.route?.length || point.unreachable) return null;
        point.routeRevision = this.revision();
        this._clearGroundPath(entity);
        entity._surfaceExitCommand = {
            mode: 'move', point, routeIndex: 0, _surfaceExitRoute: true,
        };
        return entity._surfaceExitCommand;
    }

    _failRoute(entity, command, reason, now) {
        this._releaseRouteTraffic(entity, now);
        this._clearGroundPath(entity);
        // 保留原始终点，失败不能伪装成脚下到达。物理驻梯者由独立出口路线带离。
        command.point = { ...command.point, route: [], navigationPending: false, unreachable: true, reason };
        command.routeIndex = 0;
        command._surfaceRetryAt = now + this._config.failedPlanRetryMs;
        command._surfaceProgress = null;
        entity._surfaceNavFailure = reason;
        return command;
    }

    _replan(entity, command, { restart = false } = {}) {
        // 超时/失败重试须重新冻结当前拥堵成本；pending轮询只续算，不能每帧重启。
        if (restart) entity._navigationPlanEpoch = (entity._navigationPlanEpoch || 0) + 1;
        const point = command._surfaceExitRoute && entity._surfaceKind === 'stairs'
            ? this._planExit(entity)
            : command._surfaceAutonomous
                ? this._adapter?.planRoute?.(entity, command._surfaceTarget, command._surfaceGoal)
                : this._adapter?.replanRoute?.(entity, {
                ...command.point, unreachable: false, reason: null,
            });
        if (!point || point.unreachable || !Array.isArray(point.route)) {
            if (point?.unreachable) command.point = { ...point, navigationPending: false };
            return false;
        }
        if (point.navigationPending) this._releaseRouteTraffic(entity);
        this._clearGroundPath(entity);
        command.point = { ...point, routeRevision: this.revision(), unreachable: false, reason: null };
        command.routeIndex = this._nearestRouteIndex(entity, point.route);
        command._surfaceProgress = null;
        command._surfaceRetryAt = 0;
        entity._surfaceNavFailure = null;
        return true;
    }

    prepareExplicitRoute(entity, command, now = Date.now()) {
        let point = command?.point;
        if (!point) return command;
        if (point.navigationPending) {
            if (entity._surfaceKind === 'stairs' && !command._surfaceExitRoute) return command;
            if (now >= (command._surfaceQueryAt || 0)) {
                command._surfaceQueryAt = now + 16;
                if (!this._replan(entity, command)) {
                    return this._failRoute(entity, command, command.point?.reason || '无法规划完整路线', now);
                }
                entity._navigationStatus = command.point.navigationPending ? 'pending' : 'complete';
            }
            return command;
        }
        if (point.unreachable) {
            if ((entity._surfaceKind !== 'stairs' || command._surfaceExitRoute)
                && (command._surfaceExitRoute || !entity._surfaceExitCommand)
                && now >= (command._surfaceRetryAt || 0)) {
                if (this._replan(entity, command, { restart: true })) command._surfaceRecoveries = 0;
                else {
                    this._recordDiagnostic(entity, command, 'replan_failed', now);
                    command._surfaceRetryAt = now + this._config.failedPlanRetryMs;
                }
            }
            return command;
        }
        if (!Array.isArray(point.route) || !point.route.length) return command;
        if (point.staircaseId && entity._surfaceKind !== 'stairs') {
            this._plannedPortals ||= new Map();
            if (!this._plannedPortals.has(entity) && this._plannedPortals.size >= 512) {
                this._plannedPortals.delete(this._plannedPortals.keys().next().value);
            }
            this._plannedPortals.set(entity, { id: this._stairTrafficKey(point.staircaseId),
                owner: entity._command, until: now + 1500 });
        }
        const routeRevision = Number(point.routeRevision);
        if (Number.isFinite(routeRevision) && routeRevision !== this.revision()) {
            if (!this._replan(entity, command)) {
                this._recordDiagnostic(entity, command, 'topology_replan_failed', now);
                return this._failRoute(entity, command, '高架路线已失效', now);
            }
            point = command.point;
        }

        const route = command.point.route;
        // 下楼后拓扑重算可合法退回纯地面命令；没有高架节点时交还地面解析，不能读取空航点。
        if (!route.length) return command;
        const routeIndex = Math.max(0, Math.min(
            route.length - 1,
            Number(command.routeIndex) || 0
        ));
        const waypoint = route[routeIndex];
        if (!command._surfaceExitRoute && entity._surfaceKind === 'stairs') {
            const direction = this._traffic.directionFor(entity);
            const nextHeight = route.slice(routeIndex).find((node) =>
                Math.abs((Number(node.z) || 0) - (Number(entity.z) || 0)) > 1);
            const wantedDirection = nextHeight
                ? ((Number(nextHeight.z) || 0) < (Number(entity.z) || 0) ? 'down' : 'up')
                : null;
            if (direction && wantedDirection && direction !== wantedDirection) {
                return this._failRoute(entity, command, '先沿当前通行方向离梯，再执行反向路线', now);
            }
        }
        const distance = Math.hypot(waypoint.x - entity.x, waypoint.y - entity.y)
            + Math.abs((Number(waypoint.z) || 0) - (Number(entity.z) || 0));
        const key = `${this.revision()}:${routeIndex}`;
        const ground = surfaceKindOf(entity) === 'ground' && waypoint.surfaceKind === 'ground';
        const manager = entity._surfaceGroundPathManager || entity._pathManager;
        const path = ground && manager?.hasValidPath?.() ? manager.path : null;
        const pathIndex = path ? manager.pathIdx : -1;
        const pathNode = path?.[pathIndex];
        const pathDistance = pathNode ? Math.hypot(pathNode.x - entity.x, pathNode.y - entity.y) : Infinity;
        let progress = command._surfaceProgress;
        if (!progress || progress.key !== key) {
            // 真正通过航点才清连续失败计数；重算本身不算成功。
            if (progress && routeIndex > progress.index) command._surfaceRecoveries = 0;
            progress = command._surfaceProgress = {
                key, index: routeIndex, at: now, distance, path, pathIndex, pathDistance,
                x: entity.x, y: entity.y,
            };
        }
        const moved = Math.hypot(entity.x - progress.x, entity.y - progress.y) > 1;
        const pathAdvanced = ground && path && moved && (path !== progress.path
            || pathIndex > progress.pathIndex || pathDistance + 1 < progress.pathDistance);
        const advanced = distance + 1 < progress.distance || pathAdvanced;
        const pending = ground && (PathWorkScheduler.hasPendingRecalculation(manager)
            || (manager?.lastPlanResult?.pending
                && now - manager.lastPlanResult.at < this._config.progressTimeoutMs));
        if (advanced || entity._surfaceNavWaiting || pending) {
            progress.at = now;
            progress.distance = distance;
            progress.x = entity.x;
            progress.y = entity.y;
            if (advanced) command._surfaceRecoveries = 0;
        }
        if (path !== progress.path || pathIndex !== progress.pathIndex || pathAdvanced) {
            progress.path = path;
            progress.pathIndex = pathIndex;
            progress.pathDistance = pathDistance;
        }
        const planResult = manager?.lastPlanResult;
        const failedEntry = ground && planResult?.reachable === false
            && planResult.at >= progress.at
            && Math.hypot(planResult.x - waypoint.x, planResult.y - waypoint.y) < 1;
        if (!command._surfaceForceRecovery && !failedEntry
            && now - progress.at < this._config.progressTimeoutMs) return command;
        const queueTimedOut = command._surfaceForceRecovery;
        this._recordDiagnostic(entity, command, queueTimedOut ? 'queue_timeout'
            : failedEntry ? 'ground_entry_unreachable' : 'progress_timeout', now);
        command._surfaceForceRecovery = false;
        if (queueTimedOut && !command._surfaceExitRoute && entity._surfaceKind !== 'stairs') {
            // 排队超时只临时加价，保留唯一入口仍可重试；实际驻梯者始终先安全离梯。
            this._notePortalCongestion(entity, command._surfaceTimedOutPortal || waypoint.staircaseId, now);
        }
        command._surfaceTimedOutPortal = null;
        if (ground && !entity._surfaceNavWaiting && !queueTimedOut) {
            this._deferPortal(entity, waypoint, now);
        }
        const recoveries = (Number(command._surfaceRecoveries) || 0) + 1;
        this._releaseRouteTraffic(entity, now);
        command._surfaceRecoveries = recoveries;
        if (recoveries > this._config.maxRecoveryAttempts && !command._surfaceExitRoute) {
            return this._failRoute(entity, command, '高架路线进度超时', now);
        }
        if (!this._replan(entity, command, { restart: true })) {
            this._recordDiagnostic(entity, command, 'replan_failed', now);
            return this._failRoute(entity, command, '没有可用高架路线，等待重试', now);
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
                if (command) {
                    command._surfaceForceRecovery = true;
                    command._surfaceTimedOutPortal = activeStair;
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
            if (command) {
                command._surfaceForceRecovery = true;
                command._surfaceTimedOutPortal = activeStair;
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
        if (transition.kind === 'carrier_removed' || transition.kind === 'support_invalidated'
            || transition.kind === 'scene_teardown') {
            ElevatedGarrison.forget(entity);
            // 落地或场景卸载已清掉承托身份，旧出口不能继续优先于真实命令。
            this.complete(entity);
            entity._surfaceNavFailure = null;
            entity._surfaceFailedPortals?.clear();
            entity._surfacePortalPenalties?.clear();
            // 玩家RTS与AI可能各持有PathManager；失去支撑时不能留下另一份旧路径回写。
            if (entity._surfaceGroundPathManager && entity._pathManager
                && entity._surfaceGroundPathManager !== entity._pathManager) {
                PathWorkScheduler.cancel(entity._pathManager);
                entity._pathManager._clearPath?.();
            }
            entity._rtsController?._clearPath?.();
            // 玩家 RTS 命令归其控制器所有；只使派生路线失效，不改目标或伪装到达。
            for (const command of [entity._command, entity._rtsController?.command]) {
                if (!command?.point) continue;
                command.point = { ...command.point, routeRevision: -1 };
                command.routeIndex = 0;
                command._surfaceProgress = null;
                command._surfaceRetryAt = 0;
                command._surfaceRecoveries = 0;
                command._surfaceForceRecovery = false;
            }
            return;
        }
        // 正常切面仍须走完出口安全距离，不能用落地异常的清理逻辑提前结束。
        if (transition.kind === 'stairs_to_ground' || transition.kind === 'stairs_to_wall') {
            this._traffic.release(entity);
            entity._surfaceNavWaiting = false;
            return;
        }
        if (transition.kind === 'ground_to_stairs' || transition.kind === 'wall_to_stairs') {
            this._clearGroundPath(entity);
            this.syncSurfaceOccupancy(entity);
        }
    }

    afterRouteResolution(entity, command, destination, arrived) {
        if (arrived && command?._surfaceExitRoute) {
            ElevatedGarrison.invalidateRoute(entity);
            const deferred = entity._command;
            if (deferred?.mode === 'move' && deferred !== command && deferred.point?.route?.length) {
                // 新命令可能是在梯中规划的；完成离梯后要从实际出口重算，不能追旧起点。
                deferred.point = { ...deferred.point, routeRevision: -1 };
            }
        }
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

    complete(entity, { preserveGroundPath = false } = {}) {
        if (!entity) return;
        this._cancelAutonomous(entity);
        entity._surfaceExitCommand = null;
        if (!preserveGroundPath) this._clearGroundPath(entity);
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = null;
    }
}

export const ElevatedNavigationController = new ElevatedNavigationControllerImpl();
