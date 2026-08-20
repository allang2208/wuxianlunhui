export const RTS_ROUTE_NODE_DISTANCE = 12;
export const RTS_ROUTE_Z_TOLERANCE = 12;

function isElevatedSurfaceKind(kind) {
    return kind === 'stairs' || kind === 'wall_walk';
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

    // 跳过已抵达或重复的路线点，避免每个决策周期只前进一个零距离节点。
    while (route.length
        && distance <= effectiveArriveDistance
        && verticalDistance <= effectiveZTolerance
        && routeIndex < route.length - 1) {
        routeIndex++;
        destination = route[routeIndex];
        distance = Math.hypot(destination.x - entity.x, destination.y - entity.y);
        verticalDistance = Math.abs((Number(destination.z) || 0) - (Number(entity.z) || 0));
    }

    if (route.length) command.routeIndex = routeIndex;
    const arrived = distance <= effectiveArriveDistance
        && verticalDistance <= effectiveZTolerance;
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
        : (surfaceRouteActive ? 'elevated_traverse' : 'ground_approach');
    return {
        destination,
        distance,
        verticalDistance,
        arrived,
        hasRoute: route.length > 0,
        routeStage: entity._surfaceRouteStage,
    };
}

export function clearRtsSurfaceRoute(entity) {
    entity._surfaceRouteActive = false;
    entity._surfaceRouteStage = null;
}
