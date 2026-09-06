import { ElevatedNavigationController } from './elevated-navigation-controller.js';
import { ElevatedGarrison } from './elevated-garrison.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { PathWorkScheduler } from './path-work-scheduler.js';

export const RTS_ROUTE_NODE_DISTANCE = 12;
export const RTS_ROUTE_Z_TOLERANCE = 12;
export const RTS_FORMATION_ARRIVE_DISTANCE = 4;
// 相邻单位各自提前到位时，仍为两个到达容差保留空间。
export const RTS_FORMATION_SLOT_CLEARANCE = RTS_FORMATION_ARRIVE_DISTANCE * 2;
const RTS_GROUND_REACH_DISTANCE = 8;
export const RTS_DEFAULT_ACQUIRE_RANGE = Math.max(
    0,
    Number(GAME_CONFIG.rtsCommand?.defaultAcquireRange) || 900
);

/** 兵种配置优先；默认值仅兜底，不作为狙击手等长射程单位的统一上限。 */
export function getRtsAcquireRange(unit) {
    const configured = Number(unit?.aiConfig?.engageRange);
    return Number.isFinite(configured) && configured > 0 ? configured : RTS_DEFAULT_ACQUIRE_RANGE;
}

function isElevatedSurfaceKind(kind) {
    return kind === 'stairs' || kind === 'wall_walk';
}

/** 只对地面编队的最终槽位精确收口；普通移动、高架航点及自主表面路线保持原语义。 */
export function getRtsFormationGroundPoint(entity, command = entity?._command) {
    const point = command?.point;
    if (command?.mode !== 'move' || point?.formationSlot !== true || point.unreachable || point.navigationPending) return null;
    if (isElevatedSurfaceKind(point.surfaceKind)
        || Number(point.z) > RTS_ROUTE_Z_TOLERANCE
        || isElevatedSurfaceKind(entity?._surfaceKind)
        || Number(entity?.z) > RTS_ROUTE_Z_TOLERANCE
        || entity?._surfaceNavCommand || entity?._surfaceExitCommand || entity?._spawnEgress
        || entity?._surfaceNavWaiting || entity?._elevatedNavigationBridge) return null;
    // 下楼后仍保留完整route，但最后的地面编队槽应恢复编队精度；入口/踏步/墙顶节点不适用。
    const route = point.route;
    if (route?.length) {
        const last = route[route.length - 1];
        if (command.routeIndex !== route.length - 1
            || last?.surfaceKind !== 'ground'
            || Number(last.z) > RTS_ROUTE_Z_TOLERANCE
            || Math.hypot(last.x - point.x, last.y - point.y) > 0.001) return null;
    }
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function entityMatchesWaypointSurface(entity, waypoint) {
    const kind = waypoint?.surfaceKind;
    if (!kind) return true;
    if (kind === 'ground') {
        return !isElevatedSurfaceKind(entity?._surfaceKind)
            && (Number(entity?.z) || 0) <= RTS_ROUTE_Z_TOLERANCE;
    }
    if (kind === 'stairs') {
        if (entity?._surfaceKind !== 'stairs') return false;
        const staircaseId = waypoint?.staircaseId;
        const stairGroupId = waypoint?.stairGroupId;
        const entityGroupId = entity?._surfaceStairGroupId
            || entity?._surfaceStaircase?._wallStairGroupId
            || null;
        if (stairGroupId && entityGroupId) return stairGroupId === entityGroupId;
        if (!staircaseId) return true;
        return entity?._surfaceStaircase?.id === staircaseId
            || entity?._surfaceRef?.id === staircaseId
            || entity?._surfaceStairGroupMembers?.some((member) => member?.id === staircaseId)
            || entity?._surfaceStaircase?._wallStairGroupMembers?.some((member) =>
                member?.id === staircaseId);
    }
    if (kind === 'wall_walk') {
        if (entity?._surfaceKind !== 'wall_walk') return false;
        const wallId = waypoint?.wallId;
        if (!wallId) return true;
        if (entity?._surfaceWall?.id === wallId) return true;
        return Array.isArray(entity?._surfaceWalls)
            && entity._surfaceWalls.some((wall) => wall?.id === wallId);
    }
    return true;
}

function waypointAccepted(
    entity,
    waypoint,
    distance,
    verticalDistance,
    arriveDistance,
    zTolerance
) {
    return distance <= arriveDistance
        && verticalDistance <= zTolerance
        && entityMatchesWaypointSurface(entity, waypoint);
}

function elevatedRouteStage(entity, destination, surfaceRouteActive) {
    if (entity?._surfaceNavWaiting) return 'portal_queue';
    if (destination?.transition === 'ground_to_stairs') return 'ground_to_stairs';
    if (destination?.transition === 'stairs_to_ground') return 'stairs_to_ground';
    if (destination?.transition === 'stairs_to_wall') return 'handoff_to_wall';
    if (destination?.transition === 'wall_to_stairs') return 'handoff_to_stairs';
    if (destination?.surfaceKind === 'wall_walk'
        && entity?._surfaceKind === 'stairs') return 'handoff_to_wall';
    if (destination?.surfaceKind === 'stairs'
        && entity?._surfaceKind === 'wall_walk') return 'handoff_to_stairs';
    return surfaceRouteActive ? 'elevated_traverse' : 'ground_approach';
}

/**
 * 统一解析 RTS move 命令的当前航点。
 * point.route 存放楼梯/墙顶的分段路线；普通地面命令直接使用 point。
 */
export function resolveRtsMoveDestination(
    entity,
    command,
    arriveDistance = 40,
    zTolerance = RTS_ROUTE_Z_TOLERANCE
) {
    const originalCommand = command;
    // 新命令可以替换最终目标，但不能在旧出口尚未走完时抢走当前通行目的地。
    const pendingExit = entity?._surfaceExitCommand;
    if (pendingExit && command !== pendingExit && !command?._surfaceExitRoute) {
        const exitMove = resolveRtsMoveDestination(entity, pendingExit, arriveDistance, zTolerance);
        // 玩家控制器等调用方持有自己的命令，不一定挂在 entity._command 上。
        if (exitMove.arrived && command?.point?.route?.length) {
            command.point = { ...command.point, routeRevision: -1 };
        }
        return { ...exitMove, arrived: false, recovering: true };
    }
    const garrison = ElevatedGarrison.prepareMove(entity, command);
    if (garrison?.failed) {
        if (entity._surfaceKind === 'stairs') {
            const exit = ElevatedNavigationController.prepareExitCommand(entity);
            if (exit) return { ...resolveRtsMoveDestination(entity, exit, arriveDistance, zTolerance),
                arrived: false, recovering: true };
        }
        if (entity._command === originalCommand && entity._surfaceKind !== 'stairs') {
            failRtsMoveCommand(entity, garrison.reason, garrison.status);
        }
        return { destination: { x: entity.x, y: entity.y, z: entity.z || 0 }, distance: 0,
            verticalDistance: 0, arrived: false, failed: true, reason: garrison.reason, hasRoute: false };
    }
    if (garrison?.waiting) {
        // 不先把全队送往同一个墙心。已在梯中的单位仍须走完出口，不能占梯等空位。
        if (entity._surfaceKind === 'stairs') {
            const exit = ElevatedNavigationController.prepareExitCommand(entity);
            if (exit) return { ...resolveRtsMoveDestination(entity, exit, arriveDistance, zTolerance),
                arrived: false, recovering: true };
        }
        ElevatedNavigationController.complete(entity);
        entity._navigationStatus = null;
        entity.vx = 0;
        entity.vy = 0;
        entity.isMoving = false;
        return { destination: { x: entity.x, y: entity.y, z: entity.z || 0 },
            distance: 0, verticalDistance: 0, arrived: false, hasRoute: false,
            waitingForGarrison: true, routeStage: 'garrison_wait' };
    }
    if (garrison?.command) command = garrison.command;
    command = ElevatedNavigationController.prepareExplicitRoute(entity, command) || command;
    const point = command?.point || { x: entity.x, y: entity.y, z: entity.z || 0 };
    if (point.navigationPending) {
        // 查询期间不持有入口预约；已在梯中者优先沿现有许可安全离梯。
        if (!command._surfaceExitRoute && entity._surfaceKind === 'stairs') {
            const exit = ElevatedNavigationController.prepareExitCommand(entity);
            if (exit) return { ...resolveRtsMoveDestination(entity, exit, arriveDistance, zTolerance),
                arrived: false, recovering: true };
        }
        entity._navigationStatus = 'pending';
        entity._surfaceRouteActive = false;
        entity._surfaceNavDestination = null;
        entity.vx = 0; entity.vy = 0; entity.isMoving = false;
        return { destination: { x: entity.x, y: entity.y, z: entity.z || 0 },
            distance: 0, verticalDistance: 0, arrived: false, hasRoute: false,
            navigationPending: true, routeStage: 'planning' };
    }
    if (point.unreachable) {
        if (!command?._surfaceExitRoute
            && (entity._surfaceKind === 'stairs' || entity._surfaceExitCommand)) {
            const exitCommand = ElevatedNavigationController.prepareExitCommand(entity);
            if (exitCommand) {
                const exitMove = resolveRtsMoveDestination(entity, exitCommand, arriveDistance, zTolerance);
                if (exitMove.arrived) entity._surfaceExitCommand = null;
                // 安全离梯不是原命令到达；保留原始终点等待重试。
                return { ...exitMove, arrived: false, recovering: true };
            }
        }
        const destination = { x: entity.x, y: entity.y, z: Number(entity.z) || 0 };
        entity._surfaceNavWaiting = false;
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = 'route_failed';
        entity.vx = 0;
        entity.vy = 0;
        ElevatedNavigationController.afterRouteResolution(entity, command, destination, false);
        if (entity._command === originalCommand && !command._surfaceExitRoute
            && !command._surfaceAutonomous && entity._surfaceKind !== 'stairs') {
            failRtsMoveCommand(entity, point.reason || '目标不可达', point.navigationStatus || 'unreachable');
        }
        return { destination, distance: 0, verticalDistance: 0, arrived: false,
            hasRoute: false, failed: true, reason: point.reason, routeStage: 'route_failed' };
    }
    const route = Array.isArray(point.route) ? point.route : [];
    const effectiveArriveDistance = route.length
        ? Math.min(arriveDistance, RTS_ROUTE_NODE_DISTANCE)
        : (getRtsFormationGroundPoint(entity, command)
            ? Math.min(arriveDistance, RTS_FORMATION_ARRIVE_DISTANCE)
            : arriveDistance);
    const effectiveZTolerance = route.length
        ? Math.min(zTolerance, RTS_ROUTE_Z_TOLERANCE)
        : zTolerance;
    const explicitRouteIndex = Number.isInteger(command?.routeIndex);
    let routeIndex = route.length && explicitRouteIndex
        ? Math.max(0, Math.min(route.length - 1, command.routeIndex))
        : 0;
    // 已在楼梯/墙顶上的单位从离自己最近的高架节点开始；地面单位仍从路线入口开始。
    if (route.length && !route[0]?.fromCurrentSurface && !explicitRouteIndex
        && entity?._surfaceKind && entity._surfaceKind !== 'ground') {
        let nearestScore = Number.POSITIVE_INFINITY;
        for (let index = 0; index < route.length; index++) {
            const candidate = route[index];
            const score = Math.hypot(candidate.x - entity.x, candidate.y - entity.y)
                + Math.abs((Number(candidate.z) || 0) - (Number(entity.z) || 0));
            if (score < nearestScore) {
                nearestScore = score;
                routeIndex = index;
            }
        }
    }
    let destination = route.length ? route[routeIndex] : point;
    let distance = Math.hypot(destination.x - entity.x, destination.y - entity.y);
    let verticalDistance = Math.abs((Number(destination.z) || 0) - (Number(entity.z) || 0));

    const atWaypoint = waypointAccepted(
        entity,
        destination,
        distance,
        verticalDistance,
        Math.max(
            effectiveArriveDistance,
            ElevatedNavigationController.portalEntryRadius()
        ),
        effectiveZTolerance
    );
    const reservation = ElevatedNavigationController.gateRouteAdvance(
        entity,
        command,
        route,
        routeIndex,
        atWaypoint
    );
    if (!reservation.granted
        && (reservation.blocked || (atWaypoint && routeIndex < route.length - 1))) {
        command.routeIndex = routeIndex;
        entity._surfaceRouteActive = false;
        entity._surfaceRouteStage = 'portal_queue';
        entity.vx = 0;
        entity.vy = 0;
        // 排队时把共享目的地收回到单位脚下。玩家控制器会直接发布零意图；士兵 AI
        // 则会继续消费 destination，因此这里必须统一返回“原地等待”，否则下一层
        // MovementSystem 会再次把它推向已被占用的楼梯 Portal。
        const holdDestination = {
            x: entity.x,
            y: entity.y,
            z: Number(entity.z) || 0,
            surfaceKind: entity._surfaceKind || 'ground',
            wallId: entity._surfaceWall?.id || null,
            staircaseId: entity._surfaceStaircase?.id || null,
        };
        ElevatedNavigationController.afterRouteResolution(entity, command, holdDestination, false);
        return {
            destination: holdDestination,
            routeDestination: destination,
            distance: 0,
            verticalDistance: 0,
            arrived: false,
            hasRoute: true,
            routeStage: 'portal_queue',
            waitingForPortal: true,
            queuePosition: reservation.queuePosition,
        };
    }

    // 跳过已抵达或重复的路线点，避免每个决策周期只前进一个零距离节点。
    while (route.length
        && waypointAccepted(
            entity,
            destination,
            distance,
            verticalDistance,
            effectiveArriveDistance,
            effectiveZTolerance
        )
        && routeIndex < route.length - 1) {
        routeIndex++;
        destination = route[routeIndex];
        distance = Math.hypot(destination.x - entity.x, destination.y - entity.y);
        verticalDistance = Math.abs((Number(destination.z) || 0) - (Number(entity.z) || 0));
    }

    if (route.length) command.routeIndex = routeIndex;
    // 本轮可能刚从楼梯出口推进到最终地面槽，必须用更新后的routeIndex重新判定精度。
    const finalArriveDistance = command?.point?.garrisonSlot && routeIndex >= route.length - 1
        ? ElevatedGarrison.config.arriveDistance
        : getRtsFormationGroundPoint(entity, command)
        ? Math.min(effectiveArriveDistance, RTS_FORMATION_ARRIVE_DISTANCE)
        : effectiveArriveDistance;
    let arrived = waypointAccepted(
        entity,
        destination,
        distance,
        verticalDistance,
        finalArriveDistance,
        effectiveZTolerance
    );
    if (arrived && !route.length && distance > RTS_GROUND_REACH_DISTANCE
        && (entity._faction === 'companion' || entity._faction === 'player')) {
        const manager = entity._surfaceGroundPathManager || entity._pathManager, request = manager?._commandRoute;
        // 近距离隔墙也不能仅凭欧氏到达圈结束命令；必须已经走到有效路线末段。
        arrived = request?.owner === (entity._rtsController?.command || entity._command) && request.status === 'complete'
            && request.x === destination.x && request.y === destination.y
            && manager.hasValidPath() && manager.pathIdx >= manager.path.length - 2;
    }
    // 路线的第一个节点通常是楼梯在地面的入口。单位尚在地面时必须继续使用普通 A* 靠近
    // 该入口；若仅因为 route 非空就提前关闭 A*，单位会直线撞向城墙，而且高架防卡死逻辑
    // 也会同时屏蔽地面脱困。只有目标节点或单位本身已经属于高架表面时，才切换到表面路线。
    const entityElevated = isElevatedSurfaceKind(entity?._surfaceKind)
        || (Number(entity?.z) || 0) > effectiveZTolerance;
    const destinationElevated = isElevatedSurfaceKind(destination?.surfaceKind)
        || (Number(destination?.z) || 0) > effectiveZTolerance;
    const surfaceRouteActive = route.length > 0
        && !arrived
        && (entityElevated || destinationElevated);
    entity._surfaceRouteActive = surfaceRouteActive;
    entity._surfaceRouteStage = !route.length || arrived
        ? null
        : elevatedRouteStage(entity, destination, surfaceRouteActive);
    const result = {
        destination,
        distance,
        verticalDistance,
        arrived,
        hasRoute: route.length > 0,
        routeStage: entity._surfaceRouteStage,
    };
    ElevatedNavigationController.afterRouteResolution(entity, command, destination, arrived);
    if (arrived && command?._garrisonEvacuation) {
        ElevatedGarrison.finishInternal(entity);
        return { ...result, arrived: false, waitingForGarrison: true };
    }
    if (arrived && command?._surfaceExitRoute) entity._surfaceExitCommand = null;
    return result;
}

export function clearRtsSurfaceRoute(entity) {
    const request = entity?._pathManager?._commandRoute;
    // 兵种每次攻击决策都会清理旧高架状态。该清理不拥有同一攻击命令的地面搜索；
    // 真正结束/换令、进入高架或站定攻击仍由各自执行器清理PathManager。
    const preserveGroundPath = request?.owner === entity?._command && entity?._command?.mode === 'attack'
        && !entity._surfaceNavCommand && !entity._surfaceExitCommand && !entity._surfaceRouteActive
        && entity._surfaceKind !== 'stairs' && entity._surfaceKind !== 'wall_walk';
    ElevatedNavigationController.complete(entity, { preserveGroundPath });
}

/** 显式移动或攻击完成后的统一终态：停在当前位置，等待下一条指令。 */
export function finishRtsCommandAtHold(entity) {
    if (!entity) return;
    // 只在执行器自然完成时发布完成信号；拒绝/替换命令不能推进 Shift 队列。
    const completed = entity._command;
    entity._command = { mode: 'hold', point: null, target: null,
        ...(entity._command?._rtsStop ? { _rtsStop: true } : {}) };
    entity._rtsCompletedCommand = { command: completed, result: entity._command };
    entity.target = null;
    entity._tacticalTarget = null;
    clearRtsSurfaceRoute(entity);
    PathWorkScheduler.cancel(entity._pathManager);
    entity._pathManager?._clearPath?.();
    entity._navigationStatus = null;
    delete entity._rtsFormationSettle;
    entity.vx = 0;
    entity.vy = 0;
    entity.isMoving = false;
    entity.maxSpeed = 0;
    entity._animState = 'idle';
}

/** 失败绑定原始高层命令，让Shift队列跳过失败项；绝不报告为成功抵达。 */
export function failRtsMoveCommand(entity, reason, status = 'unreachable') {
    if (!entity || !['move', 'attack'].includes(entity._command?.mode)) return;
    const order = entity._rtsTacticalOrder;
    const command = order && entity._command._tacticalOrderId === order.id ? order : entity._command;
    finishRtsCommandAtHold(entity);
    if (command === order) delete entity._rtsTacticalOrder;
    entity._rtsCompletedCommand = { command, result: entity._command, failed: true, reason };
    entity._navigationStatus = status;
    entity._navigationFailure = reason;
}
