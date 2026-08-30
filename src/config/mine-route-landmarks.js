// 废弃矿洞静态母图的通道真源。像素坐标对应1672×941原图，绝不写回玩法节点。
// lanes只登记完整可行走的平台；connectors记录上下通道的楼梯两端，不跨塌方/水面补线。
const makeProfile = (lanes, connectors, topology) => {
    const paths = lanes.map(points => points.map(([x, y]) => ({ x, y })));
    return {
        width: 1672,
        height: 941,
        terrainRouting: true,
        sectorColumnSpan: 3,
        minimumNodeDistance: 76,
        bounds: { left: 300, top: 165, right: 1490, bottom: 835 },
        lanes: paths,
        // 只供既有异常降级展示消费；正常聚焦始终使用互斥平台槽位。
        columns: Array.from({ length: 6 }, (_, index) => {
            const sample = lane => lanePoint(lane, lane[0].x + (lane[lane.length - 1].x - lane[0].x) * index / 5);
            return { upper: sample(paths[0]), lower: sample(paths[paths.length - 1]) };
        }),
        connectors: connectors.map(([upper, upperX, lowerX]) => ({ upper, lower: upper + 1, upperX, lowerX })),
        topology,
    };
};

export const MINE_ROUTE_LANDMARKS = {
    'assets/scenes/dungeon-map-mine-landmarks/mine-01-rail-junction.png': makeProfile([
        [[340,275],[560,255],[760,225],[990,180],[1200,200]],
        [[330,505],[560,475],[850,440],[1120,410],[1430,395]],
        [[330,830],[550,810],[870,780],[1120,800],[1430,665]],
    ], [[0,760,790],[0,1200,1320],[1,850,890],[1,1400,1430]],
    { branchDensity: 0.38, columnLoad: 0.65, verticality: 0.35, rowSpread: 0.7 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-02-winding-shaft.png': makeProfile([
        [[330,580],[550,550],[800,505],[1020,430],[1240,365],[1420,345]],
        [[470,820],[680,790],[930,730],[1090,670],[1240,580],[1370,600]],
    ], [[0,810,930],[0,1260,1190]],
    { branchDensity: 0.24, columnLoad: 0.45, verticality: 0.25, rowSpread: 0.5 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-03-pump-hall.png': makeProfile([
        [[350,230],[600,275],[850,325],[1150,385],[1450,455]],
        [[340,420],[580,475],[850,560],[1150,655],[1430,745]],
    ], [[0,605,510],[0,1240,1140]],
    { branchDensity: 0.28, columnLoad: 0.5, verticality: 0.3, rowSpread: 0.52 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-04-slate-quarry.png': makeProfile([
        [[350,322],[650,335],[950,360],[1200,380],[1450,400]],
        [[350,435],[600,460],[900,500],[1150,545],[1450,575]],
        [[350,600],[600,655],[850,700],[1100,755],[1410,800]],
    ], [[0,650,575],[0,950,885],[0,1400,1340],[1,355,350],[1,1000,925]],
    { branchDensity: 0.46, columnLoad: 0.8, verticality: 0.38, rowSpread: 0.8 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-05-crushing-works.png': makeProfile([
        [[330,315],[570,355],[800,395],[1100,430],[1450,475]],
        [[330,450],[570,490],[800,530],[1100,590],[1410,675]],
        [[330,620],[570,650],[800,730],[1100,780],[1400,740]],
    ], [[0,460,420],[0,990,960],[0,1450,1410],[1,335,330],[1,1340,1160]],
    { branchDensity: 0.4, columnLoad: 0.72, verticality: 0.42, rowSpread: 0.72 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-06-mineral-gallery.png': makeProfile([
        [[330,275],[550,305],[800,320],[1080,315],[1380,310],[1430,330]],
        [[330,510],[550,550],[800,595],[1080,590],[1380,575],[1460,570]],
        [[350,755],[560,805],[800,830],[1060,825],[1220,795]],
    ], [[0,800,780],[0,1410,1460],[1,775,745]],
    { branchDensity: 0.3, columnLoad: 0.58, verticality: 0.3, rowSpread: 0.65 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-07-supply-depot.png': makeProfile([
        [[340,300],[560,315],[800,290],[1100,260],[1430,220]],
        [[330,455],[570,440],[800,400],[1100,370],[1450,325]],
        [[330,730],[550,690],[800,650],[1100,600],[1450,520]],
    ], [[0,450,400],[0,1080,1140],[0,1360,1400],[1,1450,1450]],
    { branchDensity: 0.36, columnLoad: 0.65, verticality: 0.24, rowSpread: 0.65 }),
    // 上层岩道中部已塌毁，只登记完整的中层木桥和下层石道；二者经右侧阶梯连接。
    'assets/scenes/dungeon-map-mine-landmarks/mine-08-collapse-bypass.png': makeProfile([
        [[410,350],[650,385],[900,408],[1120,418],[1280,415]],
        [[410,600],[650,675],[900,750],[1120,780],[1300,750]],
    ], [[0,1290,1290]],
    { branchDensity: 0.2, columnLoad: 0.38, verticality: 0.15, rowSpread: 0.4 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-09-excavated-vault.png': makeProfile([
        [[350,270],[600,300],[850,330],[1100,350],[1390,370]],
        [[330,455],[550,480],[800,520],[1100,560],[1390,600]],
        [[330,670],[550,725],[800,755],[1100,795],[1390,825]],
    ], [[0,395,355],[0,850,820],[0,1340,1330],[1,340,330],[1,800,765],[1,1360,1340]],
    { branchDensity: 0.44, columnLoad: 0.74, verticality: 0.5, rowSpread: 0.75 }),
    'assets/scenes/dungeon-map-mine-landmarks/mine-10-deep-smelter.png': makeProfile([
        [[340,365],[570,340],[800,315],[1090,290],[1360,265]],
        [[330,545],[570,510],[850,465],[1110,425],[1430,375]],
        [[350,805],[580,775],[820,735],[1080,680],[1430,585]],
    ], [[0,790,845],[0,1350,1390],[1,900,1060],[1,1450,1460]],
    { branchDensity: 0.32, columnLoad: 0.6, verticality: 0.4, rowSpread: 0.6 }),
};

const slotCache = new WeakMap();
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function lanePoint(lane, x) {
    const safeX = Math.max(lane[0].x, Math.min(lane[lane.length - 1].x, x));
    for (let index = 1; index < lane.length; index++) {
        const a = lane[index - 1], b = lane[index];
        if (safeX > b.x) continue;
        const t = (safeX - a.x) / Math.max(1, b.x - a.x);
        return { x: safeX, y: a.y + (b.y - a.y) * t };
    }
    return { ...lane[lane.length - 1] };
}

function laneSection(lane, fromX, toX) {
    const points = [lanePoint(lane, Math.min(fromX, toX))];
    for (const point of lane) {
        if (point.x > Math.min(fromX, toX) && point.x < Math.max(fromX, toX)) points.push({ ...point });
    }
    points.push(lanePoint(lane, Math.max(fromX, toX)));
    return fromX > toX ? points.reverse() : points;
}

/** 候选槽位本身两两相隔76px；运行时只分配槽位，不把节点挤到通道之外。 */
export function getMineRouteSlots(profile, { bounds = profile.bounds, spacing = profile.minimumNodeDistance } = {}) {
    const cacheKey = [bounds.left, bounds.top, bounds.right, bounds.bottom, spacing].join('|');
    const cached = slotCache.get(profile);
    if (cached?.key === cacheKey) return cached.slots;
    const slots = [];
    profile.lanes.forEach((lane, laneIndex) => {
        const lengths = lane.slice(1).map((point, index) => distance(lane[index], point));
        const total = lengths.reduce((sum, length) => sum + length, 0);
        const count = Math.max(1, Math.floor(total / (spacing + 6)));
        for (let index = 0; index < count; index++) {
            let remaining = (index + 0.5) * total / count;
            let segment = 0;
            while (segment < lengths.length - 1 && remaining > lengths[segment]) remaining -= lengths[segment++];
            const a = lane[segment], b = lane[segment + 1];
            const t = remaining / Math.max(1, lengths[segment]);
            const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
                lane: laneIndex, u: (index + 0.5) / count };
            if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) continue;
            if (slots.some(other => distance(point, other) < spacing)) continue;
            slots.push(point);
        }
    });
    slots.sort((a, b) => a.u - b.u || a.lane - b.lane);
    slotCache.set(profile, { key: cacheKey, slots });
    return slots;
}

/** 先按进度顺序选互斥槽位，同列内部再按row分配上下层；不依赖每帧随机数。 */
export function projectMineRouteNodes(nodes, profile, slots = getMineRouteSlots(profile)) {
    if (nodes.length > slots.length) return null;
    const selected = nodes.map((_, index) => slots[Math.floor((index + 0.5) * slots.length / nodes.length)]);
    const columns = [...new Set(nodes.map(node => Number(node.col)))].sort((a, b) => a - b);
    const points = new Map();
    let cursor = 0;
    for (const col of columns) {
        const group = nodes.filter(node => Number(node.col) === col)
            .sort((a, b) => Number(a.row) - Number(b.row) || String(a.id).localeCompare(String(b.id)));
        const groupSlots = selected.slice(cursor, cursor + group.length).sort((a, b) => a.lane - b.lane || a.u - b.u);
        group.forEach((node, index) => points.set(node.id, { ...groupSlots[index] }));
        cursor += group.length;
    }
    return points;
}

/** 在已登记的通道与楼梯网络内取最短展示路径，不修改实际地图边或节点可达性。 */
export function buildMineRouteEdgePaths(nodes, edges, points, profile) {
    const stations = [];
    const stationByPosition = new Map();
    const graph = new Map();
    const nodeStation = new Map();
    // 道路中心线既用于放节点，也用于画线；不能为避让徽记把线路平移到路外。
    // 节点在连线之后绘制，自身遮住线头；多条路线仍由显示层合束。
    const addStation = (lane, x) => {
        const point = lanePoint(profile.lanes[lane], x);
        const key = `${lane}:${point.x.toFixed(3)}`;
        if (stationByPosition.has(key)) return stationByPosition.get(key);
        const station = { ...point, lane, id: stations.length };
        stations.push(station);
        stationByPosition.set(key, station);
        graph.set(station.id, []);
        return station;
    };
    const connect = (a, b, path) => {
        if (a.id === b.id) return;
        const cost = path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
        const geometry = path.map(point => ({ x: point.x, y: point.y }));
        const section = { geometry };
        graph.get(a.id).push({ to: b.id, cost, section, reverse: false });
        graph.get(b.id).push({ to: a.id, cost, section, reverse: true });
    };
    for (const node of nodes) {
        const point = points.get(node.id);
        if (point) nodeStation.set(node.id, addStation(point.lane, point.x));
    }
    for (const connector of profile.connectors) {
        const a = addStation(connector.upper, connector.upperX);
        const b = addStation(connector.lower, connector.lowerX);
        connect(a, b, [a, b]);
    }
    profile.lanes.forEach((lane, laneIndex) => {
        const ordered = stations.filter(station => station.lane === laneIndex).sort((a, b) => a.x - b.x);
        for (let index = 1; index < ordered.length; index++) {
            const a = ordered[index - 1], b = ordered[index];
            connect(a, b, laneSection(lane, a.x, b.x));
        }
    });
    const routes = [];
    const uniqueEdges = new Map();
    for (const edge of edges) {
        const [from, to] = [edge.from, edge.to].sort();
        uniqueEdges.set([from, to].join('::'), { from, to });
    }
    // 固定最短通道；不因其它线路占用而临时改走另一座楼梯。
    for (const [key, edge] of [...uniqueEdges].sort(([a], [b]) => a.localeCompare(b))) {
        const start = nodeStation.get(edge.from), goal = nodeStation.get(edge.to);
        if (!start || !goal) continue;
        const costs = new Map([[start.id, 0]]), previous = new Map(), open = new Set([start.id]);
        while (open.size) {
            let current;
            for (const id of open) if (current === undefined || costs.get(id) < costs.get(current)) current = id;
            open.delete(current);
            if (current === goal.id) break;
            for (const link of graph.get(current)) {
                const cost = costs.get(current) + link.cost;
                if (cost >= (costs.get(link.to) ?? Infinity)) continue;
                costs.set(link.to, cost);
                previous.set(link.to, { from: current, link });
                open.add(link.to);
            }
        }
        if (!previous.has(goal.id)) continue;
        const sections = [];
        let cursor = goal.id;
        while (cursor !== start.id) {
            const step = previous.get(cursor);
            sections.unshift(step.link);
            cursor = step.from;
        }
        routes.push({ key, edge, sections });
    }

    // 返回各真实边的公共中心线路径；显示层把重合片段合束，只描一次主干。
    const paths = new Map();
    for (const route of routes) {
        const path = [{ ...points.get(route.edge.from) }];
        for (const link of route.sections) {
            const shared = link.section.geometry;
            path.push(...(link.reverse ? shared.slice().reverse() : shared));
        }
        path.push({ ...points.get(route.edge.to) });
        paths.set(route.key, simplifyRoutePolyline(path));
    }
    return paths;
}

/** 只删重复点与同向共线折点，不新增避障绕行或跨段捷径。 */
function simplifyRoutePolyline(source) {
    const result = [];
    for (const point of source) {
        if (result.length && distance(result[result.length - 1], point) < 0.001) continue;
        while (result.length >= 2) {
            const a = result[result.length - 2], b = result[result.length - 1];
            const ux = b.x - a.x, uy = b.y - a.y, vx = point.x - b.x, vy = point.y - b.y;
            if (Math.abs(ux * vy - uy * vx) > 0.001 || ux * vx + uy * vy < 0) break;
            result.pop();
        }
        result.push(point);
    }
    return result;
}

export function mineRoutePathMidpoint(path) {
    const total = path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
    let remaining = total / 2;
    for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index];
        const length = distance(a, b);
        if (length >= remaining) {
            const t = remaining / Math.max(0.001, length);
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
                angle: Math.atan2(b.y - a.y, b.x - a.x) };
        }
        remaining -= length;
    }
    return { ...path[0], angle: 0 };
}
