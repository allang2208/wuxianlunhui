// 独立探索面板的展示布局。逻辑节点/边只读，不依赖背景图片或通道模板。
export function buildExpeditionLayout(nodes, edges, { corridors = false } = {}) {
    if (corridors) return buildAlignedCorridors(nodes, edges);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const columns = [...new Set(nodes.map(node => Number(node.col)))].sort((a, b) => a - b);
    const groups = new Map(columns.map(col => [col, nodes.filter(node => Number(node.col) === col)
        .slice().sort((a, b) => Number(a.row) - Number(b.row) || String(a.id).localeCompare(String(b.id)))]));
    const neighbors = new Map(nodes.map(node => [node.id, []]));
    const links = edges.filter(edge => byId.has(edge.from) && byId.has(edge.to));
    for (const edge of links) {
        neighbors.get(edge.from).push(byId.get(edge.to));
        neighbors.get(edge.to).push(byId.get(edge.from));
    }
    const ranks = () => new Map([...groups.values()].flatMap(group =>
        group.map((node, index) => [node.id, (index + 0.5) / group.length])));
    // 只接受减少相邻列连线交叉的换序。以完整图定序，切区/悬停不重新洗牌。
    const crossingCount = () => {
        const rank = ranks();
        let count = 0;
        for (let index = 1; index < columns.length; index++) {
            const left = columns[index - 1], right = columns[index];
            const pairs = links.map(edge => [byId.get(edge.from), byId.get(edge.to)])
                .map(([a, b]) => Number(a.col) > Number(b.col) ? [b, a] : [a, b])
                .filter(([a, b]) => Number(a.col) === left && Number(b.col) === right);
            for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
                if ((rank.get(pairs[a][0].id) - rank.get(pairs[b][0].id))
                    * (rank.get(pairs[a][1].id) - rank.get(pairs[b][1].id)) < 0) count++;
            }
        }
        return count;
    };
    let crossings = crossingCount();
    for (let pass = 0; pass < 4; pass++) {
        for (const col of pass % 2 ? columns.slice().reverse() : columns) {
            const rank = ranks(), group = groups.get(col);
            const score = node => {
                const adjacent = neighbors.get(node.id).filter(other => pass % 2 ? Number(other.col) > col : Number(other.col) < col);
                return adjacent.length ? adjacent.reduce((sum, other) => sum + rank.get(other.id), 0) / adjacent.length : rank.get(node.id);
            };
            const sorted = group.slice().sort((a, b) => score(a) - score(b) || rank.get(a.id) - rank.get(b.id));
            groups.set(col, sorted);
            const next = crossingCount();
            if (next < crossings) crossings = next;
            else groups.set(col, group);
        }
    }
    const points = new Map();
    columns.forEach((col, columnIndex) => {
        const group = groups.get(col);
        group.forEach((node, row) => points.set(node.id, { x: columnIndex * 220, y: (row - (group.length - 1) / 2) * 100 }));
    });
    const edgePaths = new Map();
    for (const edge of links) {
        const [from, to] = [edge.from, edge.to].sort();
        const key = [from, to].join('::');
        if (edgePaths.has(key)) continue;
        const a = points.get(from), b = points.get(to);
        if (a.x === b.x) {
            // 同列支路统一从列侧接入，避免直穿中间徽记。
            const rail = a.x + 62;
            edgePaths.set(key, [a, { x: rail, y: a.y }, { x: rail, y: b.y }, b]);
        } else {
            const direction = Math.sign(b.x - a.x);
            // 列间只保留短水平出入口与中间直线，不汇成一根贯穿整列的大总线。
            edgePaths.set(key, [a, { x: a.x + direction * 36, y: a.y },
                { x: b.x - direction * 36, y: b.y }, b]);
        }
    }
    return { points, edgePaths };
}

/** 当前生成器就是平面横纵网格：保持全图同一 row 的高度，不做逐列居中或重排。 */
function buildAlignedCorridors(nodes, edges) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const columns = [...new Set(nodes.map(node => Number(node.col)))].sort((a, b) => a - b);
    const points = new Map();
    const columnGap = 196, rowGap = 112;
    columns.forEach((col, index) => {
        const group = nodes.filter(node => Number(node.col) === col)
            .sort((a, b) => Number(a.row) - Number(b.row) || String(a.id).localeCompare(String(b.id)));
        let lastY = -Infinity;
        for (const node of group) {
            // 仅同槽异常点向下让位；缺行保持空位，四条或更多主通道不会上下换道。
            const y = Math.max(Number(node.row) * rowGap, lastY + rowGap);
            points.set(node.id, { x: index * columnGap, y });
            lastY = y;
        }
    });
    const unique = new Map();
    for (const edge of edges) {
        if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
        const ids = [edge.from, edge.to].sort();
        unique.set(ids.join('::'), ids);
    }
    const edgePaths = new Map(), sideRails = new Map();
    const maxY = Math.max(0, ...[...points.values()].map(point => point.y));
    let outerRail = 0;
    for (const [key, [from, to]] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
        const a = points.get(from), b = points.get(to);
        const blockers = nodes.filter(node => node.id !== from && node.id !== to).map(node => points.get(node.id));
        const vertical = a.x === b.x;
        const horizontal = a.y === b.y;
        const blocked = blockers.some(point => vertical
            ? point.x === a.x && point.y > Math.min(a.y, b.y) && point.y < Math.max(a.y, b.y)
            : horizontal && point.y === a.y && point.x > Math.min(a.x, b.x) && point.x < Math.max(a.x, b.x));
        let path;
        if ((vertical || horizontal) && !blocked) {
            // 绝大多数边直接成为平行横线或短竖线，节点就是唯一真实接头。
            path = [a, b];
        } else if (vertical) {
            // 岔路占到直线中间时才走侧轨；不同区间复用不相交的侧轨。
            const rails = sideRails.get(a.x) || [];
            const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
            let lane = rails.findIndex(ranges => ranges.every(range => hi < range.lo || lo > range.hi));
            if (lane < 0) { lane = rails.length; rails.push([]); }
            rails[lane].push({ lo, hi }); sideRails.set(a.x, rails);
            const x = a.x + 64 + lane * 18;
            path = [a, { x, y: a.y }, { x, y: b.y }, b];
        } else {
            const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
            if (right.x - left.x <= columnGap && !blocked) {
                // 起点向首列的扇形只在两列间展开；不让四条支线先绕到同一根侧轨。
                path = [left, { x: left.x + 44, y: left.y }, { x: right.x - 44, y: right.y }, right];
            } else {
                const y = maxY + 80 + outerRail++ * 20;
                path = [left, { x: left.x + 58, y: left.y }, { x: left.x + 58, y },
                    { x: right.x - 58, y }, { x: right.x - 58, y: right.y }, right];
            }
            if (path[0] !== a) path.reverse();
        }
        edgePaths.set(key, path);
    }
    return { points, edgePaths, columnGap, rowGap };
}
