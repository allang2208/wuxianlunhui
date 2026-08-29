function sourceValues(source) {
    if (!source) return [];
    if (typeof source.values === 'function') return Array.from(source.values());
    return Array.from(source);
}

function wallKey(wall) {
    return String(wall?.id || `${Number(wall?.x) || 0},${Number(wall?.y) || 0}`);
}

function positionKey(x, y) {
    return `${Math.round(Number(x) || 0)},${Math.round(Number(y) || 0)}`;
}

function pairKey(left, right) {
    const a = wallKey(left);
    const b = wallKey(right);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function bucketKey(x, y, size) {
    return `${Math.floor((Number(x) || 0) / size)},${Math.floor((Number(y) || 0) / size)}`;
}

function addToBucket(index, key, value) {
    let values = index.get(key);
    if (!values) {
        values = [];
        index.set(key, values);
    }
    values.push(value);
}

/**
 * 墙顶、墙间连接与楼梯入口的共享拓扑缓存。
 * 几何仍由调用方提供；本类只负责唯一索引、连通关系、空间粗筛和版本失效。
 */
export class ElevatedTopology {
    constructor(options = {}) {
        this._isWall = options.isWall || (() => false);
        this._getTopZ = options.getTopZ || (() => 0);
        this._connectorFor = options.connectorFor || (() => null);
        this._junctionFor = options.junctionFor || (() => null);
        this._expandWallCandidates = options.expandWallCandidates || ((candidate) => [candidate]);
        this._stepVectors = options.stepVectors || [];
        this._neighborToleranceFor = options.neighborToleranceFor || (() => 0);
        this._bucketSize = Math.max(32, Number(options.bucketSize) || 128);
        this.reset();
    }

    reset() {
        this.revision = 0;
        this.signature = '';
        this._source = null;
        this._dirty = true;
        this._walls = [];
        this._stairs = [];
        this._positionIndex = new Map();
        this._wallBuckets = new Map();
        this._stairBuckets = new Map();
        this._connectorBuckets = new Map();
        this._junctionBuckets = new Map();
        this._neighbors = new Map();
        this._connectors = new Map();
        this._junctions = new Map();
        this._components = new Map();
        this._stairsByWall = new Map();
    }

    invalidate() {
        this._dirty = true;
    }

    ensure(entitySource, staircases = []) {
        if (this._dirty || this._source !== entitySource || !this.revision) {
            this.refresh(entitySource, staircases);
        }
        return this;
    }

    refresh(entitySource, staircases = []) {
        const walls = sourceValues(entitySource)
            .flatMap((candidate) => this._expandWallCandidates(candidate) || [])
            .filter((wall) => wall?.active !== false && this._isWall(wall))
            .sort((left, right) => wallKey(left).localeCompare(wallKey(right)));
        const stairs = Array.from(staircases || [])
            .filter((staircase) => staircase?.active !== false && staircase?._isWallStaircase)
            .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
        const wallParts = walls.map((wall) => [
            wallKey(wall),
            Number(wall.x).toFixed(2),
            Number(wall.y).toFixed(2),
            Number(this._getTopZ(wall)).toFixed(2),
        ].join(':'));
        const stairParts = stairs.map((staircase) => [
            staircase.id,
            staircase.wall?.id,
            Number(staircase.x).toFixed(2),
            Number(staircase.y).toFixed(2),
            staircase.dir,
            staircase.ascendingSign,
            staircase.segmentCount,
            Number(staircase.targetTopZ).toFixed(2),
            ...(staircase.segments || []).flatMap((segment) => [
                Number(segment.x).toFixed(2),
                Number(segment.y).toFixed(2),
            ]),
        ].join(':'));
        const signature = wallParts.concat(stairParts).join('|');
        this._source = entitySource;
        this._dirty = false;
        if (signature === this.signature && this.revision) return false;

        this.signature = signature;
        this._walls = walls;
        this._stairs = stairs;
        this._positionIndex = new Map();
        this._wallBuckets = new Map();
        this._stairBuckets = new Map();
        this._connectorBuckets = new Map();
        this._junctionBuckets = new Map();
        this._neighbors = new Map(walls.map((wall) => [wall, []]));
        this._connectors = new Map();
        this._junctions = new Map();
        this._components = new Map();
        this._stairsByWall = new Map();

        for (const wall of walls) {
            addToBucket(this._positionIndex, positionKey(wall.x, wall.y), wall);
            addToBucket(this._wallBuckets, bucketKey(wall.x, wall.y, this._bucketSize), wall);
        }

        for (const values of this._positionIndex.values()) {
            values.sort((left, right) => wallKey(left).localeCompare(wallKey(right)));
        }

        const seenPairs = new Set();
        for (const wall of walls) {
            const tolerance = Math.max(0, Number(this._neighborToleranceFor(wall)) || 0);
            for (const [dx, dy] of this._stepVectors) {
                const candidates = this._wallsNearPoint(wall.x + dx, wall.y + dy, tolerance);
                for (const neighbor of candidates) {
                    if (!neighbor || neighbor === wall) continue;
                    const key = pairKey(wall, neighbor);
                    if (seenPairs.has(key)) continue;
                    seenPairs.add(key);
                    // 是否允许连接不同高度由 connectorFor 的真实几何决定。普通墙仍会
                    // 拒绝高差；城墙塔则在同一 wall_walk 拓扑内提供瞬时高度切换接缝。
                    const connector = this._connectorFor(wall, neighbor);
                    if (!connector) continue;
                    this._neighbors.get(wall).push(neighbor);
                    this._neighbors.get(neighbor).push(wall);
                    this._connectors.set(key, connector);
                    addToBucket(
                        this._connectorBuckets,
                        bucketKey(connector.center?.x, connector.center?.y, this._bucketSize),
                        connector
                    );
                }
            }
        }

        // 四块墙围成一个最小网格时，两墙接缝只能覆盖四条边；中心需要一个独立交汇面。
        // 只从已经通过连接面复核的邻接图中找四环，避免把斜邻、叠墙或断开的墙误合并。
        const seenJunctions = new Set();
        for (const wall of walls) {
            const neighbors = this.neighbors(wall);
            for (let leftIndex = 0; leftIndex < neighbors.length; leftIndex++) {
                for (let rightIndex = leftIndex + 1; rightIndex < neighbors.length; rightIndex++) {
                    const left = neighbors[leftIndex];
                    const right = neighbors[rightIndex];
                    for (const opposite of this.neighbors(left)) {
                        if (!opposite || opposite === wall || opposite === right) continue;
                        if (!this.neighbors(right).includes(opposite)) continue;
                        const junctionWalls = [wall, left, opposite, right];
                        const key = junctionWalls.map(wallKey).sort().join('|');
                        if (seenJunctions.has(key)) continue;
                        seenJunctions.add(key);
                        const junction = this._junctionFor(junctionWalls);
                        if (!junction) continue;
                        this._junctions.set(key, junction);
                        addToBucket(
                            this._junctionBuckets,
                            bucketKey(junction.center?.x, junction.center?.y, this._bucketSize),
                            junction
                        );
                    }
                }
            }
        }

        let componentId = 0;
        for (const root of walls) {
            if (this._components.has(root)) continue;
            componentId += 1;
            const queue = [root];
            const componentWalls = [];
            while (queue.length) {
                const wall = queue.shift();
                if (!wall || this._components.has(wall)) continue;
                this._components.set(wall, { id: componentId, walls: componentWalls });
                componentWalls.push(wall);
                for (const neighbor of this.neighbors(wall)) queue.push(neighbor);
            }
        }

        for (const staircase of stairs) {
            const component = staircase.wall ? this.component(staircase.wall) : [];
            const attached = new Set((component.length ? component : [staircase.wall]).filter(Boolean));
            for (const wall of attached) addToBucket(this._stairsByWall, wall, staircase);
            const bucketKeys = new Set();
            for (const segment of staircase.segments || []) {
                bucketKeys.add(bucketKey(segment.x, segment.y, this._bucketSize));
            }
            if (staircase.wall) {
                bucketKeys.add(bucketKey(staircase.wall.x, staircase.wall.y, this._bucketSize));
            }
            for (const key of bucketKeys) addToBucket(this._stairBuckets, key, staircase);
        }
        this.revision += 1;
        return true;
    }

    _wallsNearPoint(x, y, tolerance = 0) {
        const roundedX = Math.round(x);
        const roundedY = Math.round(y);
        const radius = Math.max(0, Math.ceil(tolerance));
        const found = [];
        const seen = new Set();
        for (let ox = -radius; ox <= radius; ox++) {
            for (let oy = -radius; oy <= radius; oy++) {
                for (const wall of this._positionIndex.get(`${roundedX + ox},${roundedY + oy}`) || []) {
                    if (seen.has(wall)) continue;
                    const distance = Math.hypot(wall.x - x, wall.y - y);
                    if (distance > tolerance + 1e-6) continue;
                    seen.add(wall);
                    found.push(wall);
                }
            }
        }
        return found.sort((left, right) =>
            Math.hypot(left.x - x, left.y - y) - Math.hypot(right.x - x, right.y - y)
            || wallKey(left).localeCompare(wallKey(right)));
    }

    values() {
        return this._walls.values();
    }

    wallsAt(x, y) {
        return [...(this._positionIndex.get(positionKey(x, y)) || [])];
    }

    isCanonicalWall(wall) {
        const stacked = this.wallsAt(wall?.x, wall?.y);
        // 同格叠墙没有稳定、可到达的外表面；拒绝整组吸附，避免代表实体拆除后楼梯悬空。
        return stacked.length === 1 && stacked[0] === wall;
    }

    neighbors(wall) {
        return this._neighbors.get(wall) || [];
    }

    connector(left, right) {
        return this._connectors.get(pairKey(left, right)) || null;
    }

    connectors() {
        return this._connectors.values();
    }

    junctions() {
        return this._junctions.values();
    }

    component(wall) {
        return this._components.get(wall)?.walls || [];
    }

    componentId(wall) {
        return this._components.get(wall)?.id || 0;
    }

    route(startWall, targetWall) {
        if (!startWall || !targetWall) return [];
        if (startWall === targetWall) return [startWall];
        if (this.componentId(startWall) !== this.componentId(targetWall)) return [];
        const queue = [startWall];
        const previous = new Map([[startWall, null]]);
        while (queue.length) {
            const wall = queue.shift();
            for (const neighbor of this.neighbors(wall)) {
                if (previous.has(neighbor)) continue;
                previous.set(neighbor, wall);
                if (neighbor === targetWall) {
                    const route = [];
                    let cursor = neighbor;
                    while (cursor) {
                        route.push(cursor);
                        cursor = previous.get(cursor) || null;
                    }
                    return route.reverse();
                }
                queue.push(neighbor);
            }
        }
        return [];
    }

    nearbyWalls(x, y, radius = this._bucketSize * 1.5) {
        const bucketRadius = Math.max(1, Math.ceil(radius / this._bucketSize));
        const bx = Math.floor((Number(x) || 0) / this._bucketSize);
        const by = Math.floor((Number(y) || 0) / this._bucketSize);
        const result = [];
        const seen = new Set();
        for (let ox = -bucketRadius; ox <= bucketRadius; ox++) {
            for (let oy = -bucketRadius; oy <= bucketRadius; oy++) {
                for (const wall of this._wallBuckets.get(`${bx + ox},${by + oy}`) || []) {
                    if (!seen.has(wall)) {
                        seen.add(wall);
                        result.push(wall);
                    }
                }
            }
        }
        return result;
    }

    nearbyConnectors(x, y, radius = this._bucketSize * 1.5) {
        const bucketRadius = Math.max(1, Math.ceil(radius / this._bucketSize));
        const bx = Math.floor((Number(x) || 0) / this._bucketSize);
        const by = Math.floor((Number(y) || 0) / this._bucketSize);
        const result = [];
        const seen = new Set();
        for (let ox = -bucketRadius; ox <= bucketRadius; ox++) {
            for (let oy = -bucketRadius; oy <= bucketRadius; oy++) {
                for (const connector of this._connectorBuckets.get(`${bx + ox},${by + oy}`) || []) {
                    if (!seen.has(connector)) {
                        seen.add(connector);
                        result.push(connector);
                    }
                }
            }
        }
        return result;
    }

    nearbyJunctions(x, y, radius = this._bucketSize * 1.5) {
        const bucketRadius = Math.max(1, Math.ceil(radius / this._bucketSize));
        const bx = Math.floor((Number(x) || 0) / this._bucketSize);
        const by = Math.floor((Number(y) || 0) / this._bucketSize);
        const result = [];
        const seen = new Set();
        for (let ox = -bucketRadius; ox <= bucketRadius; ox++) {
            for (let oy = -bucketRadius; oy <= bucketRadius; oy++) {
                for (const junction of this._junctionBuckets.get(`${bx + ox},${by + oy}`) || []) {
                    if (!seen.has(junction)) {
                        seen.add(junction);
                        result.push(junction);
                    }
                }
            }
        }
        return result;
    }

    nearbyStaircases(x, y, radius = this._bucketSize * 2) {
        const bucketRadius = Math.max(1, Math.ceil(radius / this._bucketSize));
        const bx = Math.floor((Number(x) || 0) / this._bucketSize);
        const by = Math.floor((Number(y) || 0) / this._bucketSize);
        const result = [];
        const seen = new Set();
        for (let ox = -bucketRadius; ox <= bucketRadius; ox++) {
            for (let oy = -bucketRadius; oy <= bucketRadius; oy++) {
                for (const staircase of this._stairBuckets.get(`${bx + ox},${by + oy}`) || []) {
                    if (!seen.has(staircase)) {
                        seen.add(staircase);
                        result.push(staircase);
                    }
                }
            }
        }
        return result;
    }

    staircasesForWall(wall) {
        return [...(this._stairsByWall.get(wall) || [])];
    }

    isExternalAttachment(wall, dx, dy) {
        if (!wall || !this.isCanonicalWall(wall)) return false;
        const tolerance = Math.max(0, Number(this._neighborToleranceFor(wall)) || 0);
        return this._wallsNearPoint(wall.x + dx, wall.y + dy, tolerance).length === 0;
    }
}
