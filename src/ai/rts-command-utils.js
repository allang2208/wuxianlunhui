export const RTS_ROUTE_NODE_DISTANCE = 12;
export const RTS_ROUTE_Z_TOLERANCE = 12;

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
    entity._surfaceRouteActive = route.length > 0 && !arrived;
    return { destination, distance, verticalDistance, arrived, hasRoute: route.length > 0 };
}

export function clearRtsSurfaceRoute(entity) {
    entity._surfaceRouteActive = false;
}
