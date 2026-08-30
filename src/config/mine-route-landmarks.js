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
export function buildMineRouteEdgePaths(nodes, edges, points, profile, clearance = 36) {
    const stations = [];
    const graph = new Map();
    const nodeStation = new Map();
    const addStation = (lane, x) => {
        const point = lanePoint(profile.lanes[lane], x);
        const station = { ...point, lane, id: stations.length };
        stations.push(station);
        graph.set(station.id, []);
        return station;
    };
    const connect = (a, b, path) => {
        const cost = path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
        const key = [a.id, b.id].sort((left, right) => left - right).join(':');
        graph.get(a.id).push({ to: b.id, cost, path, key });
        graph.get(b.id).push({ to: a.id, cost, path: path.slice().reverse(), key });
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
    const usage = new Map();
    const uniqueEdges = new Map();
    for (const edge of edges) {
        const [from, to] = [edge.from, edge.to].sort();
        uniqueEdges.set([from, to].join('::'), { from, to });
    }
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
                // 同长的通路优先分散到另一座楼梯；仍只能走母图登记的完整通道。
                const cost = costs.get(current) + link.cost + (usage.get(link.key) || 0) * 18;
                if (cost >= (costs.get(link.to) ?? Infinity)) continue;
                costs.set(link.to, cost);
                previous.set(link.to, { from: current, path: link.path, key: link.key });
                open.add(link.to);
            }
        }
        if (!previous.has(goal.id)) continue;
        const sections = [];
        const links = new Set();
        let cursor = goal.id;
        while (cursor !== start.id) {
            const step = previous.get(cursor);
            sections.unshift(step.path);
            links.add(step.key);
            cursor = step.from;
        }
        const path = sections.flatMap((section, index) => index ? section.slice(1) : section);
        for (const link of links) usage.set(link, (usage.get(link) || 0) + 1);
        routes.push({ key, edge, path, links });
    }

    // 共用实体线段的逻辑边必须使用不同轨道；正反方向也按同一物理法线偏移。
    let trackCount = 1;
    for (const route of routes) {
        const occupied = new Set(routes.filter(other => other.track !== undefined
            && [...route.links].some(link => other.links.has(link))).map(other => other.track));
        route.track = 0;
        while (occupied.has(route.track)) route.track++;
        trackCount = Math.max(trackCount, route.track + 1);
    }
    const trackSpacing = trackCount > 1 ? Math.min(6, 48 / (trackCount - 1)) : 0;
    const paths = new Map();
    for (const route of routes) {
        const offset = (route.track - (trackCount - 1) / 2) * trackSpacing;
        const obstacles = nodes.filter(node => node.id !== route.edge.from && node.id !== route.edge.to)
            .map(node => points.get(node.id)).filter(Boolean);
        let path = offsetRoutePath(route.path, offset);
        // 徽记不是通道交叉点。不同轨道用不同绕行半径，避免绕过节点后又合成一条线。
        const radius = clearance + 3 + (trackCount > 1 ? route.track / (trackCount - 1) * 8 : 0);
        for (const obstacle of obstacles) path = bypassRouteNode(path, obstacle, radius, obstacles, offset);
        paths.set(route.key, path);
    }
    return paths;
}

function pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function offsetRoutePath(source, offset) {
    if (!source.length) return [];
    const points = [{ ...source[0] }];
    for (let index = 1; index < source.length; index++) {
        const a = source[index - 1], b = source[index];
        const length = distance(a, b);
        if (length < 0.001) continue;
        const steps = Math.max(1, Math.ceil(length / 20));
        for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    const normal = (a, b) => {
        let dx = b.x - a.x, dy = b.y - a.y;
        if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
        const length = Math.hypot(dx, dy) || 1;
        return { x: -dy / length, y: dx / length };
    };
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
    const total = cumulative[cumulative.length - 1];
    return points.map((point, index) => {
        if (index === 0 || index === points.length - 1) return point;
        const a = normal(points[index - 1], point), b = normal(point, points[index + 1]);
        const fade = Math.min(1, cumulative[index] / 40, (total - cumulative[index]) / 40);
        return { x: point.x + (a.x + b.x) * 0.5 * offset * fade,
            y: point.y + (a.y + b.y) * 0.5 * offset * fade };
    });
}

/** 用圆外弧替换穿过无关徽记的连续路径，不移动节点或改变逻辑边。 */
function bypassRouteNode(path, center, radius, obstacles, offset) {
    let entry = null, exit = null;
    for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index];
        if (pointSegmentDistance(center, a, b) >= radius) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const fx = a.x - center.x, fy = a.y - center.y;
        const aa = dx * dx + dy * dy;
        if (aa < 0.0001) continue;
        const bb = 2 * (fx * dx + fy * dy);
        const cc = fx * fx + fy * fy - radius * radius;
        const discriminant = bb * bb - 4 * aa * cc;
        if (discriminant < 0) continue;
        for (const t of [(-bb - Math.sqrt(discriminant)) / (2 * aa), (-bb + Math.sqrt(discriminant)) / (2 * aa)]) {
            if (t < 0 || t > 1) continue;
            const hit = { index, point: { x: a.x + dx * t, y: a.y + dy * t } };
            if (!entry) entry = hit;
            exit = hit;
        }
    }
    if (!entry || !exit || distance(entry.point, exit.point) < 0.001) return path;
    const angleA = Math.atan2(entry.point.y - center.y, entry.point.x - center.x);
    const angleB = Math.atan2(exit.point.y - center.y, exit.point.x - center.x);
    const positive = (angleB - angleA + Math.PI * 2) % (Math.PI * 2);
    const options = [positive, positive - Math.PI * 2].map(sweep => {
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
        const arc = Array.from({ length: steps + 1 }, (_, index) => {
            const angle = angleA + sweep * index / steps;
            return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
        });
        const collisions = arc.filter(point => obstacles.some(other => other !== center && distance(point, other) < 36)).length;
        return { arc, score: collisions * 10000 + Math.abs(sweep) * radius
            + ((offset >= 0) === (sweep >= 0) ? 0 : 0.01) };
    }).sort((a, b) => a.score - b.score);
    return [...path.slice(0, entry.index), ...options[0].arc, ...path.slice(exit.index)];
}

export function mineRoutePathMidpoint(path) {
    const total = path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
    let remaining = total / 2;
    for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index];
        const length = distance(a, b);
        if (length >= remaining) {
            const t = remaining / Math.max(0.001, length);
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        remaining -= length;
    }
    return path[0];
}
