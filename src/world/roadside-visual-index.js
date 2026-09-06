import { blockCellOf } from './gate4-grid.js';

export const ROAD_ROLE = Object.freeze({
    MAIN: 'main',
    SECONDARY: 'secondary',
    DEAD_END: 'dead_end',
});

export function roadsideCellKey(i, j) {
    return `${i},${j}`;
}

export function roadsideHash32(i, j, salt = 0) {
    let value = Math.imul((Number(i) | 0) ^ 0x45d9f3b, 0x27d4eb2d)
        ^ Math.imul((Number(j) | 0) ^ 0x165667b1, 0x85ebca6b)
        ^ (Number(salt) | 0);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
}

export function roadsideChunkKey(i, j, chunkSize = 8) {
    const size = Math.max(1, Math.floor(Number(chunkSize) || 8));
    return `${Math.floor(Number(i) / size)},${Math.floor(Number(j) / size)}`;
}

export function roadsideBuildingType(building) {
    return building?._economyType
        || building?._cfg?.economyType
        || building?.cfgKey
        || building?._cfg?.id
        || building?.kind
        || '';
}

export function roadsideProfileForBuilding(building, config = {}) {
    return building?._cfg?.roadsideProfile
        || config.profileByBuildingType?.[roadsideBuildingType(building)]
        || 'general';
}

export function roadsideActiveBuildings(buildings) {
    const source = buildings instanceof Map
        ? buildings.values()
        : (buildings && !Array.isArray(buildings) && typeof buildings[Symbol.iterator] === 'function'
            ? buildings : (buildings || []));
    return Array.from(source).filter((building) => building
        && building.active !== false
        && building._isGridBuilding === true
        && building._cfg);
}

export function roadsideBuildingStableKey(building, index = 0) {
    return String(building?.id || building?._cfg?.id || building?.cfgKey
        || `${roadsideBuildingType(building)}:${index}`);
}

export function roadsideActivityState(building) {
    if (building?._economyWorking === true) return 'working';
    if (building?._economyWorking === false) return 'idle';
    return 'neutral';
}

export function roadsideBuildingFootprintGeometry(building) {
    const cells = Number(building?._buildingFootprintCells) === 4 ? 4 : 2;
    const width = cells * 128;
    const depth = width * 0.5;
    return {
        width,
        depth,
        centerX: Number(building?.x) || 0,
        centerY: (Number(building?.y) || 0) - depth * 0.5,
    };
}

export function roadsidePointInsideBuildingFootprint(x, y, building, padding = 8) {
    const geometry = roadsideBuildingFootprintGeometry(building);
    const halfW = geometry.width * 0.5 + padding;
    const halfD = geometry.depth * 0.5 + padding * 0.5;
    return Math.abs(x - geometry.centerX) / Math.max(1, halfW)
        + Math.abs(y - geometry.centerY) / Math.max(1, halfD) <= 1;
}

export function roadsideBuildingAccessPoint(building, config = {}) {
    const cfg = building?._cfg || {};
    const type = roadsideBuildingType(building);
    const access = building?.spriteCfg?.roadsideAccess
        ?? cfg.roadsideAccess
        ?? config.accessByBuildingType?.[type]
        ?? config.defaultAccess
        ?? {};
    if (access === false || access?.mode === 'none') return null;
    const displayW = Math.max(1, Number(building?.spriteCfg?.size ?? cfg.displayW) || 256);
    const displayH = Math.max(1, Number(building?.spriteCfg?.sizeH ?? cfg.displayH) || 256);
    const footOffsetY = Number(building?.spriteCfg?.footOffsetY ?? cfg.footOffsetY)
        || displayH * 0.5;
    const xDirection = building?._facingLeft === true ? -1 : 1;
    if (Number.isFinite(Number(access?.xRatio)) && Number.isFinite(Number(access?.yRatio))) {
        return {
            x: (Number(building?.x) || 0)
                + (Number(access.xRatio) - 0.5) * displayW * xDirection,
            y: (Number(building?.y) || 0) - footOffsetY
                + (Number(access.yRatio) - 0.5) * displayH,
            radius: Math.max(24, Number(access.clearRadius) || 88),
        };
    }
    return {
        x: (Number(building?.x) || 0) + (Number(access?.xOffset) || 0) * xDirection,
        y: (Number(building?.y) || 0) + (Number(access?.yOffset) || 0),
        radius: Math.max(24, Number(access?.clearRadius)
            || (Number(building?._buildingFootprintCells) === 4 ? 128 : 82)),
    };
}

function roadTileAt(roadTiles, i, j, roadColumns = null) {
    return roadColumns?.get(i)?.get(j) || roadTiles.get(roadsideCellKey(i, j));
}

function roadShape(tile, roadTiles, roadColumns = null) {
    const iMinus = roadTileAt(roadTiles, tile.i - 1, tile.j, roadColumns)?.kind === 'road';
    const iPlus = roadTileAt(roadTiles, tile.i + 1, tile.j, roadColumns)?.kind === 'road';
    const jMinus = roadTileAt(roadTiles, tile.i, tile.j - 1, roadColumns)?.kind === 'road';
    const jPlus = roadTileAt(roadTiles, tile.i, tile.j + 1, roadColumns)?.kind === 'road';
    return {
        degree: Number(iMinus) + Number(iPlus) + Number(jMinus) + Number(jPlus),
        straight: (iMinus && iPlus) || (jMinus && jPlus),
    };
}

function buildingRecord(building, index, config) {
    const id = roadsideBuildingStableKey(building, index);
    const [baseI, baseJ] = blockCellOf(Number(building?.x) || 0, Number(building?.y) || 0);
    const access = roadsideBuildingAccessPoint(building, config);
    const profile = roadsideProfileForBuilding(building, config);
    const activity = roadsideActivityState(building);
    const signature = `${id}:${roadsideBuildingType(building)}`
        + `:${Math.round(Number(building?.x) || 0)}:${Math.round(Number(building?.y) || 0)}`
        + `:${building?._buildingFootprintCells || 2}:${building?._facingLeft === true ? 1 : 0}`
        + `:${profile}:${activity}`
        + `:${access ? `${Math.round(access.x)}:${Math.round(access.y)}:${Math.round(access.radius)}` : 'none'}`;
    return { id, building, baseI, baseJ, access, profile, activity, signature };
}

function buildRecords(buildings, config) {
    const records = new Map();
    const buckets = new Map();
    for (const [index, building] of roadsideActiveBuildings(buildings).entries()) {
        const record = buildingRecord(building, index, config);
        records.set(record.id, record);
        const key = roadsideCellKey(record.baseI, record.baseJ);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = [];
            buckets.set(key, bucket);
        }
        bucket.push(record);
    }
    return { records, buckets };
}

function addAffectedBuildingCells(target, record, influenceCells) {
    if (!record) return;
    for (let di = -influenceCells; di <= influenceCells; di++) {
        for (let dj = -influenceCells; dj <= influenceCells; dj++) {
            target.add(roadsideCellKey(record.baseI + di, record.baseJ + dj));
        }
    }
}

function addAffectedRoadCells(target, key, radius) {
    const [rawI, rawJ] = String(key).split(',');
    const i = Number(rawI);
    const j = Number(rawJ);
    if (!Number.isInteger(i) || !Number.isInteger(j)) return;
    for (let di = -radius; di <= radius; di++) {
        for (let dj = -radius; dj <= radius; dj++) {
            target.add(roadsideCellKey(i + di, j + dj));
        }
    }
}

export class RoadsideVisualIndex {
    constructor(config = {}) {
        this.config = config;
        this.cells = new Map();
        this.buildingRecords = new Map();
        this.buildingBuckets = new Map();
        this.roadTiles = new Map();
        this.roadColumns = new Map();
        this.stats = {
            fullRebuilds: 0,
            partialRebuilds: 0,
            processedCells: 0,
            lastDirtyCells: 0,
            buildingCandidates: 0,
        };
    }

    reset() {
        this.cells.clear();
        this.buildingRecords.clear();
        this.buildingBuckets.clear();
        this.roadTiles = new Map();
        this.roadColumns.clear();
        this.stats.fullRebuilds = 0;
        this.stats.partialRebuilds = 0;
        this.stats.processedCells = 0;
        this.stats.lastDirtyCells = 0;
        this.stats.buildingCandidates = 0;
    }

    _settings() {
        const indexConfig = this.config.visualIndex || {};
        return {
            urbanRadius: Math.max(0, Number(this.config.urbanRadius) || 420),
            influenceCells: Math.max(1, Math.floor(Number(indexConfig.influenceCells) || 4)),
            roadDirtyRadius: Math.max(1, Math.floor(Number(indexConfig.roadDirtyRadius) || 2)),
            chunkSize: Math.max(1, Math.floor(Number(indexConfig.chunkSizeCells) || 8)),
            directOwnerWeight: Math.max(1, Number(indexConfig.directOwnerWeight) || 3),
            mainInfluenceThreshold: Math.max(0, Number(indexConfig.mainInfluenceThreshold) || 1.2),
            denseThreshold: Math.max(0, Number(indexConfig.denseThreshold) || 1.8),
            sparseThreshold: Math.max(0, Number(indexConfig.sparseThreshold) || 0.85),
        };
    }

    _nearbyBuildingRecords(tile, settings) {
        const records = [];
        for (let di = -settings.influenceCells; di <= settings.influenceCells; di++) {
            for (let dj = -settings.influenceCells; dj <= settings.influenceCells; dj++) {
                const bucket = this.buildingBuckets.get(roadsideCellKey(tile.i + di, tile.j + dj));
                if (bucket) records.push(...bucket);
            }
        }
        return records;
    }

    _emptyVote() {
        return {
            profileWeights: Object.create(null),
            activityWeights: { working: 0, idle: 0, neutral: 0 },
            influence: 0,
            direct: false,
            accessClear: false,
            nearestBuilding: null,
            nearestDistanceSq: Infinity,
        };
    }

    _applyBuildingVote(vote, tile, record, settings) {
        this.stats.buildingCandidates++;
        const dx = (Number(record.building?.x) || 0) - tile.x;
        const dy = (Number(record.building?.y) || 0) - tile.y;
        const distanceSq = dx * dx + dy * dy;
        const isDirect = tile.owners?.has?.(record.building) === true;
        if (!isDirect && distanceSq > settings.urbanRadius * settings.urbanRadius) return;
        const distance = Math.sqrt(distanceSq);
        const baseWeight = isDirect
            ? settings.directOwnerWeight
            : Math.max(0.05, 1 - distance / Math.max(1, settings.urbanRadius));
        vote.profileWeights[record.profile] = (vote.profileWeights[record.profile] || 0) + baseWeight;
        vote.activityWeights[record.activity] += baseWeight;
        vote.influence += baseWeight;
        vote.direct ||= isDirect;
        if (distanceSq < vote.nearestDistanceSq) {
            vote.nearestDistanceSq = distanceSq;
            vote.nearestBuilding = record.building;
        }
        if (record.access) {
            const accessDx = tile.x - record.access.x;
            const accessDy = tile.y - record.access.y;
            vote.accessClear ||= accessDx * accessDx + accessDy * accessDy
                <= record.access.radius * record.access.radius;
        }
    }

    _metaFromVote(tile, settings, vote) {
        const shape = roadShape(tile, this.roadTiles, this.roadColumns);
        const degree = shape.degree;
        let dominantProfile = 'general';
        let dominantWeight = 0;
        for (const [profile, weight] of Object.entries(vote.profileWeights)) {
            if (weight > dominantWeight) {
                dominantWeight = weight;
                dominantProfile = profile;
            }
        }
        let role = ROAD_ROLE.SECONDARY;
        if (degree <= 1) role = ROAD_ROLE.DEAD_END;
        else if (degree >= 3
            || (shape.straight && vote.influence >= settings.mainInfluenceThreshold)) {
            role = ROAD_ROLE.MAIN;
        }
        const densityBand = vote.influence >= settings.denseThreshold
            ? 'dense'
            : (vote.influence < settings.sparseThreshold ? 'sparse' : 'standard');
        return {
            key: tile.key || roadsideCellKey(tile.i, tile.j),
            i: tile.i,
            j: tile.j,
            x: tile.x,
            y: tile.y,
            degree,
            role,
            densityBand,
            profileWeights: vote.profileWeights,
            dominantProfile,
            activityWeights: vote.activityWeights,
            influence: vote.influence,
            direct: vote.direct,
            accessClear: vote.accessClear,
            nearestBuilding: vote.nearestBuilding,
            chunkKey: roadsideChunkKey(tile.i, tile.j, settings.chunkSize),
        };
    }

    _cellMeta(tile, settings, nearbyRecords = null) {
        const vote = this._emptyVote();
        const nearby = nearbyRecords || this._nearbyBuildingRecords(tile, settings);
        for (const record of nearby) this._applyBuildingVote(vote, tile, record, settings);
        return this._metaFromVote(tile, settings, vote);
    }

    update({ roadTiles = new Map(), buildings = [], dirtyRoadKeys = null, full = false } = {}) {
        const settings = this._settings();
        const next = buildRecords(buildings, this.config);
        const affected = new Set();
        const changedBuildingIds = new Set();
        const hasExistingIndex = this.roadTiles.size > 0 || this.cells.size > 0;
        const fullRebuild = full || !hasExistingIndex;
        if (fullRebuild) {
            this.roadColumns.clear();
            for (const tile of roadTiles.values()) {
                if (tile?.kind !== 'road') continue;
                let column = this.roadColumns.get(tile.i);
                if (!column) {
                    column = new Map();
                    this.roadColumns.set(tile.i, column);
                }
                column.set(tile.j, tile);
            }
        } else {
            for (const key of dirtyRoadKeys || []) {
                const [rawI, rawJ] = String(key).split(',');
                const i = Number(rawI);
                const j = Number(rawJ);
                if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
                const tile = roadTiles.get(key);
                let column = this.roadColumns.get(i);
                if (tile?.kind === 'road') {
                    if (!column) {
                        column = new Map();
                        this.roadColumns.set(i, column);
                    }
                    column.set(j, tile);
                } else if (column) {
                    column.delete(j);
                    if (column.size === 0) this.roadColumns.delete(i);
                }
            }
        }
        if (!fullRebuild) {
            for (const key of dirtyRoadKeys || []) {
                addAffectedRoadCells(affected, key, settings.roadDirtyRadius);
            }
            const buildingIds = new Set([...this.buildingRecords.keys(), ...next.records.keys()]);
            for (const id of buildingIds) {
                const previous = this.buildingRecords.get(id);
                const current = next.records.get(id);
                if (previous?.signature === current?.signature) continue;
                changedBuildingIds.add(id);
                addAffectedBuildingCells(affected, previous, settings.influenceCells);
                addAffectedBuildingCells(affected, current, settings.influenceCells);
            }
        }
        if (fullRebuild) {
            for (const id of next.records.keys()) changedBuildingIds.add(id);
        }

        this.roadTiles = roadTiles;
        this.buildingRecords = next.records;
        this.buildingBuckets = next.buckets;
        this.stats.buildingCandidates = 0;
        let fullVotes = null;
        if (fullRebuild) {
            // 全量重建走“建筑向局部道路投票”的正向索引：80栋建筑只访问各自9×9
            // 邻域，避免1024条道路各自扫描81个建筑桶。
            fullVotes = new Map();
            for (const record of this.buildingRecords.values()) {
                for (let di = -settings.influenceCells; di <= settings.influenceCells; di++) {
                    for (let dj = -settings.influenceCells; dj <= settings.influenceCells; dj++) {
                        const tile = this.roadColumns.get(record.baseI + di)?.get(record.baseJ + dj);
                        if (!tile) continue;
                        let vote = fullVotes.get(tile);
                        if (!vote) {
                            vote = this._emptyVote();
                            fullVotes.set(tile, vote);
                        }
                        this._applyBuildingVote(vote, tile, record, settings);
                    }
                }
            }
        }
        let processedCellCount = affected.size;
        if (fullRebuild) {
            this.cells.clear();
            processedCellCount = 0;
            for (const [key, tile] of roadTiles) {
                if (tile?.kind !== 'road') continue;
                processedCellCount++;
                this.cells.set(key, this._metaFromVote(
                    tile,
                    settings,
                    fullVotes.get(tile) || this._emptyVote()
                ));
            }
        } else {
            for (const key of affected) {
                const tile = roadTiles.get(key);
                if (tile?.kind === 'road') this.cells.set(key, this._cellMeta(tile, settings));
                else this.cells.delete(key);
            }
        }
        this.stats.processedCells += processedCellCount;
        this.stats.lastDirtyCells = processedCellCount;
        if (fullRebuild) this.stats.fullRebuilds++;
        else if (affected.size) this.stats.partialRebuilds++;
        return { full: fullRebuild, dirtyKeys: affected, changedBuildingIds };
    }

    get(key) {
        return this.cells.get(key) || null;
    }

    getStats() {
        return {
            ...this.stats,
            roadCells: this.cells.size,
            buildings: this.buildingRecords.size,
        };
    }
}
