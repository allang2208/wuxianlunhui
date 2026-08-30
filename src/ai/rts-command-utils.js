import { ElevatedNavigationController } from './elevated-navigation-controller.js';
import { GAME_CONFIG } from '../config/game-config.js';

export const RTS_ROUTE_NODE_DISTANCE = 12;
export const RTS_ROUTE_Z_TOLERANCE = 12;
export const RTS_DEFAULT_ACQUIRE_RANGE = Math.max(
    0,
    Number(GAME_CONFIG.rtsCommand?.defaultAcquireRange) || 900
);

function isElevatedSurfaceKind(kind) {
    return kind === 'stairs' || kind === 'wall_walk';
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
    command = ElevatedNavigationController.prepareExplicitRoute(entity, command) || command;
    const point = command?.point || { x: entity.x, y: entity.y, z: entity.z || 0 };
    const route = Array.isArray(point.route) ? point.route : [];
    const effectiveArriveDistance = route.length
        ? Math.min(arriveDistance, RTS_ROUTE_NODE_DISTANCE)
        : arriveDistance;
    const effectiveZTolerance = route.length
        ? Math.min(zTolerance, RTS_ROUTE_Z_TOLERANCE)
        : zTolerance;
    const explicitRouteIndex = Number.isInteger(command?.routeIndex);
    let routeIndex = route.length && explicitRouteIndex
        ? Math.max(0, Math.min(route.length - 1, command.routeIndex))
        : 0;
    // 已在楼梯/墙顶上的单位从离自己最近的高架节点开始；地面单位仍从路线入口开始。
    if (route.length && !explicitRouteIndex && entity?._surfaceKind && entity._surfaceKind !== 'ground') {
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
    const arrived = waypointAccepted(
        entity,
        destination,
        distance,
        verticalDistance,
        effectiveArriveDistance,
        effectiveZTolerance
    );
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
    return result;
}

export function clearRtsSurfaceRoute(entity) {
    ElevatedNavigationController.complete(entity);
}

/** 显式移动或攻击完成后的统一终态：停在当前位置，等待下一条指令。 */
export function finishRtsCommandAtHold(entity) {
    if (!entity) return;
    entity._command = { mode: 'hold', point: null, target: null };
    entity.target = null;
    entity._tacticalTarget = null;
    clearRtsSurfaceRoute(entity);
    entity._pathManager?._clearPath?.();
    entity.vx = 0;
    entity.vy = 0;
    entity.isMoving = false;
    entity.maxSpeed = 0;
    entity._animState = 'idle';
}
