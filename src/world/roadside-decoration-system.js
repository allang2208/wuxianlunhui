import roadsideConfig from '../../data/roadside-decorations.json';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

function cellKey(i, j) {
    return `${i},${j}`;
}

function hash32(i, j, salt = 0) {
    let value = Math.imul((Number(i) | 0) ^ 0x45d9f3b, 0x27d4eb2d)
        ^ Math.imul((Number(j) | 0) ^ 0x165667b1, 0x85ebca6b)
        ^ (Number(salt) | 0);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
}

function ratioOf(hash) {
    return (hash >>> 0) / 0x100000000;
}

function roadDegree(tile, roadTiles) {
    let degree = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (roadTiles.get(cellKey(tile.i + di, tile.j + dj))?.kind === 'road') degree++;
    }
    return degree;
}

function buildingType(building) {
    return building?._economyType
        || building?._cfg?.economyType
        || building?.cfgKey
        || building?._cfg?.id
        || building?.kind
        || '';
}

function profileForBuilding(building) {
    return roadsideConfig.profileByBuildingType?.[buildingType(building)] || 'general';
}

function activeBuildings(buildings) {
    return (buildings || []).filter((building) => building && building.active !== false);
}

function activityState(building) {
    if (building?._economyWorking === true) return 'working';
    if (building?._economyWorking === false) return 'idle';
    return 'neutral';
}

function activitySignature(buildings) {
    return activeBuildings(buildings)
        .map((building, index) => `${index}:${activityState(building)}`)
        .join('|');
}

function activityDensityMultiplier(building) {
    const multipliers = roadsideConfig.dynamic?.activityDensityMultipliers || {};
    const configured = Number(multipliers[activityState(building)]);
    return Number.isFinite(configured) ? Math.max(0, configured) : 1;
}

function rainDensityMultiplier(intensityId) {
    const multipliers = roadsideConfig.dynamic?.rainDensityMultipliers || {};
    const configured = Number(multipliers[intensityId]);
    return Number.isFinite(configured) ? Math.max(0, configured) : 1;
}

function dynamicTextureKey(key, dynamicState) {
    if (!dynamicState?.isNight) return key;
    const swap = roadsideConfig.dynamic?.nightTextureSwaps?.[key];
    return swap?.key || key;
}

function nearestBuilding(tile, buildings, radius) {
    const direct = Array.from(tile.owners || []).filter((building) => building?.active !== false);
    if (direct.length) {
        return direct.reduce((best, building) => {
            const distance = Math.hypot((Number(building.x) || 0) - tile.x,
                (Number(building.y) || 0) - tile.y);
            return !best || distance < best.distance ? { building, distance, direct: true } : best;
        }, null);
    }
    let best = null;
    for (const building of buildings) {
        const distance = Math.hypot((Number(building.x) || 0) - tile.x,
            (Number(building.y) || 0) - tile.y);
        if (distance > radius || (best && distance >= best.distance)) continue;
        best = { building, distance, direct: false };
    }
    return best;
}

function isFrontAccessCell(tile, building) {
    const cells = building?._buildingRoadLayout?.roadCells || [];
    if (!cells.length || !tile.owners?.has(building)) return false;
    const maxY = Math.max(...cells.map((cell) => Number(cell.y) || 0));
    return tile.y >= maxY - 1;
}

function weightedList(assets, hash) {
    const list = assets || [];
    const total = list.reduce((sum, asset) => sum + Math.max(0, Number(asset.weight) || 0), 0);
    if (!(total > 0)) return null;
    let target = ratioOf(hash) * total;
    for (const asset of list) {
        target -= Math.max(0, Number(asset.weight) || 0);
        if (target <= 0) return asset;
    }
    return list[list.length - 1] || null;
}

function weightedAsset(layerConfig, profile, hash) {
    const assets = layerConfig?.profiles?.[profile]
        || layerConfig?.profiles?.general
        || [];
    return weightedList(assets, hash);
}

function decorationSpecs(tile, roadTiles, buildings, dynamicState) {
    if (tile?.kind !== 'road' || tile.sprite?.active === false) return [];
    const degree = roadDegree(tile, roadTiles);
    const urban = nearestBuilding(tile, buildings,
        Math.max(0, Number(roadsideConfig.urbanRadius) || 420));
    if (!urban?.building || isFrontAccessCell(tile, urban.building)) return [];

    const seed = Number(roadsideConfig.seed) || 0;
    const profile = profileForBuilding(urban.building);
    const specs = [];
    for (const [layer, layerConfig] of Object.entries(roadsideConfig.layers || {})) {
        if (layerConfig?.enabledWhen === 'rain' && !dynamicState?.rainActive) continue;
        const exclusiveWith = layerConfig?.exclusiveWith || [];
        if (specs.some((spec) => exclusiveWith.includes(spec.layer))) continue;
        const maxDegreeValue = Number(layerConfig?.maxDecoratedRoadDegree);
        const maxDegree = Number.isFinite(maxDegreeValue) ? Math.max(0, maxDegreeValue) : 2;
        if (degree > maxDegree) continue;

        let density = urban.direct
            ? Math.max(0, Number(layerConfig?.frontageDensity) || 0)
            : Math.max(0, Number(layerConfig?.manualUrbanDensity) || 0);
        if (layerConfig?.activitySensitive === true) {
            density *= activityDensityMultiplier(urban.building);
        }
        if (layerConfig?.enabledWhen === 'rain') {
            density *= rainDensityMultiplier(dynamicState?.rainIntensityId);
        }
        if (degree <= 1) density *= Math.max(0,
            Number(layerConfig?.deadEndDensityMultiplier) || 0);
        const densitySalt = Number(layerConfig?.densitySalt) || 0;
        if (ratioOf(hash32(tile.i, tile.j, seed ^ densitySalt)) >= Math.min(1, density)) continue;

        const slots = layerConfig?.slots || [];
        if (!slots.length) continue;
        const slotSalt = Number(layerConfig?.slotSalt) || 0;
        const assetSalt = Number(layerConfig?.assetSalt) || 0;
        const slot = slots[hash32(tile.i, tile.j, seed ^ slotSalt) % slots.length];
        const asset = weightedAsset(layerConfig, profile,
            hash32(tile.i, tile.j, seed ^ assetSalt));
        if (!asset?.key) continue;
        const textureKey = dynamicTextureKey(asset.key, dynamicState);
        const x = tile.x + (Number(slot.x) || 0);
        const y = tile.y + (Number(slot.y) || 0);
        specs.push({
            key: textureKey,
            layer,
            profile,
            x,
            y,
            signature: `${layer}:${textureKey}:${Math.round(x)}:${Math.round(y)}`,
        });
    }

    const edgeConfig = roadsideConfig.edgeLayer;
    const minEdgeDegree = Math.max(0, Number(edgeConfig?.minRoadDegree) || 0);
    const maxEdgeDegreeValue = Number(edgeConfig?.maxRoadDegree);
    const maxEdgeDegree = Number.isFinite(maxEdgeDegreeValue) ? Math.max(0, maxEdgeDegreeValue) : 3;
    if (edgeConfig?.enabled !== false && degree >= minEdgeDegree && degree <= maxEdgeDegree) {
        const exposed = (edgeConfig?.directions || []).filter((direction) =>
            roadTiles.get(cellKey(tile.i + (Number(direction.di) || 0),
                tile.j + (Number(direction.dj) || 0)))?.kind !== 'road');
        let density = urban.direct
            ? Math.max(0, Number(edgeConfig.frontageDensity) || 0)
            : Math.max(0, Number(edgeConfig.manualUrbanDensity) || 0);
        if (degree <= 1) density *= Math.max(0, Number(edgeConfig.deadEndDensityMultiplier) || 0);
        const densityHash = hash32(tile.i, tile.j,
            seed ^ (Number(edgeConfig.densitySalt) || 0));
        if (exposed.length && ratioOf(densityHash) < Math.min(1, density)) {
            const directionHash = hash32(tile.i, tile.j,
                seed ^ (Number(edgeConfig.directionSalt) || 0));
            const direction = exposed[directionHash % exposed.length];
            const asset = weightedList(edgeConfig.variants?.[direction.id],
                hash32(tile.i, tile.j, seed ^ (Number(edgeConfig.assetSalt) || 0)));
            if (asset?.key) {
                specs.push({
                    key: asset.key,
                    layer: 'edge',
                    profile,
                    x: tile.x,
                    y: tile.y,
                    signature: `edge:${direction.id}:${asset.key}:${Math.round(tile.x)}:${Math.round(tile.y)}`,
                });
            }
        }
    }
    return specs;
}

function destroyRecord(record) {
    if (record?.sprite?.active) record.sprite.destroy();
}

/**
 * 道路街景只投影现有道路与附近建筑语义：大件/公共设施按脚点排序，生活痕迹固定贴地。
 * 所有静态/动态层都不创建碰撞、占格、寻路或存档字段。
 * 结果完全由格坐标派生，道路拓扑变化时重建即可。
 */
export const RoadsideDecorationSystem = {
    _scene: null,
    _records: new Map(),
    _pendingSync: null,
    _syncScheduled: false,
    _lastSyncPayload: null,
    _dynamicState: {
        isNight: false,
        rainActive: false,
        rainIntensityId: null,
        activitySignature: '',
    },
    _nextActivityRefreshAt: 0,

    reset() {
        for (const record of this._records.values()) destroyRecord(record);
        this._records.clear();
        this._scene = null;
        this._pendingSync = null;
        this._lastSyncPayload = null;
        this._dynamicState = {
            isNight: false,
            rainActive: false,
            rainIntensityId: null,
            activitySignature: '',
        };
        this._nextActivityRefreshAt = 0;
    },

    requestSync(payload) {
        this._pendingSync = payload;
        if (this._syncScheduled) return;
        this._syncScheduled = true;
        const enqueue = typeof queueMicrotask === 'function'
            ? queueMicrotask
            : (callback) => Promise.resolve().then(callback);
        enqueue(() => {
            this._syncScheduled = false;
            const pending = this._pendingSync;
            this._pendingSync = null;
            if (pending) this.sync(pending);
        });
    },

    sync({ scene = null, roadTiles = new Map(), buildings = [] } = {}) {
        if (scene !== this._scene) {
            this.reset();
            this._scene = scene;
        }
        this._lastSyncPayload = { scene, roadTiles, buildings };
        if (!roadsideConfig.enabled || !scene?.add?.image) {
            for (const record of this._records.values()) destroyRecord(record);
            this._records.clear();
            return;
        }

        const availableBuildings = activeBuildings(buildings);
        const wanted = new Map();
        for (const [key, tile] of roadTiles) {
            for (const spec of decorationSpecs(
                tile,
                roadTiles,
                availableBuildings,
                this._dynamicState
            )) {
                wanted.set(`${key}:${spec.layer}`, spec);
            }
        }

        for (const [key, record] of this._records) {
            const spec = wanted.get(key);
            if (spec?.signature === record.signature && record.sprite?.active) {
                wanted.delete(key);
                continue;
            }
            destroyRecord(record);
            this._records.delete(key);
        }

        for (const [key, spec] of wanted) {
            if (!scene.textures?.exists?.(spec.key)) continue;
            const layerConfig = spec.layer === 'edge'
                ? (roadsideConfig.edgeLayer || {})
                : (roadsideConfig.layers?.[spec.layer] || {});
            const displaySize = Math.max(1, Number(layerConfig.displaySize) || 128);
            const displayWidth = Math.max(1, Number(layerConfig.displayWidth) || displaySize);
            const displayHeight = Math.max(1, Number(layerConfig.displayHeight) || displaySize);
            const originX = Math.max(0, Math.min(1, Number(layerConfig.originX) || 0.5));
            const originY = Math.max(0, Math.min(1, Number(layerConfig.originY) || 0.875));
            const sprite = scene.add.image(spec.x, spec.y, spec.key);
            sprite.setOrigin(originX, originY);
            sprite.setDisplaySize(displayWidth, displayHeight);
            sprite.setAlpha(Math.max(0, Math.min(1, Number(layerConfig.alpha) || 0.96)));
            const depthOffset = Number(layerConfig.depthOffset) || 0;
            const groundDepth = WORLD_RENDER_LAYERS[layerConfig.groundLayer]
                ?? WORLD_RENDER_LAYERS.ROAD_DECAL;
            sprite.setDepth(layerConfig.depthMode === 'ground'
                ? groundDepth + depthOffset
                : spec.y + depthOffset);
            sprite._isRoadsideDecoration = true;
            sprite._roadsideProfile = spec.profile;
            sprite._roadsideLayer = spec.layer;
            this._records.set(key, { sprite, signature: spec.signature });
        }
    },

    /**
     * 昼夜、天气与营业状态只驱动纯视觉重建，不写入道路、建筑或存档。
     * 昼夜/降雨切换即时响应；营业状态按世界时间低频采样，避免逐帧遍历道路。
     */
    updateDynamic({ daylight = 1, rainState = null, worldTimeMs = 0 } = {}) {
        const payload = this._lastSyncPayload;
        if (!payload?.scene || payload.scene !== this._scene) return;

        const nightThreshold = Math.max(0, Math.min(1,
            Number(roadsideConfig.dynamic?.nightDaylightThreshold) || 0.12));
        const isNight = Number(daylight) <= nightThreshold;
        const rainActive = rainState?.active === true;
        const rainIntensityId = rainActive ? (rainState?.intensityId || 'light') : null;
        let nextActivitySignature = this._dynamicState.activitySignature;
        const now = Math.max(0, Number(worldTimeMs) || 0);
        if (now >= this._nextActivityRefreshAt) {
            nextActivitySignature = activitySignature(payload.buildings);
            this._nextActivityRefreshAt = now + Math.max(250,
                Number(roadsideConfig.dynamic?.activityRefreshMs) || 1000);
        }

        const changed = isNight !== this._dynamicState.isNight
            || rainActive !== this._dynamicState.rainActive
            || rainIntensityId !== this._dynamicState.rainIntensityId
            || nextActivitySignature !== this._dynamicState.activitySignature;
        if (!changed) return;
        this._dynamicState = {
            isNight,
            rainActive,
            rainIntensityId,
            activitySignature: nextActivitySignature,
        };
        this.requestSync(payload);
    },
};
