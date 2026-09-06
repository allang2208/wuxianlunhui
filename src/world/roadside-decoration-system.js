import performanceConfig from '../../data/performance-config.json';
import roadsideConfig from '../../data/roadside-decorations.json';
import { blockCellOf } from './gate4-grid.js';
import {
    RoadsideVisualIndex,
    roadsideActiveBuildings,
    roadsideActivityState,
    roadsideBuildingAccessPoint,
    roadsideBuildingFootprintGeometry,
    roadsideBuildingStableKey,
    roadsideCellKey,
    roadsideChunkKey,
    roadsideHash32,
    roadsideProfileForBuilding,
} from './roadside-visual-index.js';
import { resolveSpriteDepthProfile } from './sprite-depth-profile.js';
import { WallSystem } from './wall-system.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

const runtimeConfig = performanceConfig.roadsideDecor || {};
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

const hash32 = roadsideHash32;

function ratioOf(hash) {
    return (hash >>> 0) / 0x100000000;
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

function weightedProfile(profileWeights, hash) {
    const entries = Object.entries(profileWeights || {}).map(([profile, weight]) => ({
        profile,
        weight: Math.max(0, Number(weight) || 0),
    }));
    return weightedList(entries, hash)?.profile || 'general';
}

function weightedAsset(layerConfig, profile, hash) {
    return weightedList(
        layerConfig?.profiles?.[profile] || layerConfig?.profiles?.general || [],
        hash
    );
}

function activityDensityMultiplier(meta) {
    const multipliers = roadsideConfig.dynamic?.activityDensityMultipliers || {};
    let totalWeight = 0;
    let weighted = 0;
    for (const [state, weight] of Object.entries(meta?.activityWeights || {})) {
        const safeWeight = Math.max(0, Number(weight) || 0);
        totalWeight += safeWeight;
        const configured = Number(multipliers[state]);
        weighted += safeWeight * (Number.isFinite(configured) ? Math.max(0, configured) : 1);
    }
    return totalWeight > 0 ? weighted / totalWeight : 1;
}

function rainDensityMultiplier(intensityId) {
    const configured = Number(roadsideConfig.dynamic?.rainDensityMultipliers?.[intensityId]);
    return Number.isFinite(configured) ? Math.max(0, configured) : 1;
}

function dynamicTextureKey(key, dynamicState) {
    if (!dynamicState?.isNight) return key;
    return roadsideConfig.dynamic?.nightTextureSwaps?.[key]?.key || key;
}

function layerConfigFor(layer) {
    if (layer === 'edge') return roadsideConfig.edgeLayer || {};
    if (layer === 'site') return roadsideConfig.siteLayer || {};
    if (layer === 'margin') return roadsideConfig.marginLayer || {};
    return roadsideConfig.layers?.[layer] || {};
}

function roleDensityMultiplier(role, layer) {
    const configured = Number(
        roadsideConfig.visualIndex?.roleDensityMultipliers?.[role]?.[layer]
    );
    return Number.isFinite(configured) ? Math.max(0, configured) : 1;
}

function densityBandMultiplier(band, layer) {
    const configured = Number(
        roadsideConfig.visualIndex?.densityBandMultipliers?.[band]?.[layer]
    );
    return Number.isFinite(configured) ? Math.max(0, configured) : 1;
}

function roadFrameForRole(tile, meta) {
    const configured = roadsideConfig.visualIndex?.roadFrames?.[meta?.role];
    const frames = Array.isArray(configured) && configured.length ? configured : null;
    if (!frames) return Number(tile?.frame) || 0;
    return Number(frames[hash32(tile.i, tile.j, 0x52f1a) % frames.length]) || 0;
}

function roadDecorationSpecs(tile, meta, roadTiles, dynamicState, onlyLayers = null) {
    if (tile?.kind !== 'road' || tile.sprite?.active === false || !meta || meta.accessClear) return [];
    if (!(meta.influence > 0)) return [];
    const seed = Number(roadsideConfig.seed) || 0;
    const specs = [];
    for (const [layer, layerConfig] of Object.entries(roadsideConfig.layers || {})) {
        if (onlyLayers && !onlyLayers.has(layer)) continue;
        if (layerConfig?.enabledWhen === 'rain' && !dynamicState?.rainActive) continue;
        const exclusiveWith = layerConfig?.exclusiveWith || [];
        if (specs.some((spec) => exclusiveWith.includes(spec.layer))) continue;
        const maxDegreeValue = Number(layerConfig?.maxDecoratedRoadDegree);
        const maxDegree = Number.isFinite(maxDegreeValue) ? Math.max(0, maxDegreeValue) : 2;
        if (meta.degree > maxDegree) continue;
        let density = meta.direct
            ? Math.max(0, Number(layerConfig.frontageDensity) || 0)
            : Math.max(0, Number(layerConfig.manualUrbanDensity) || 0);
        density *= roleDensityMultiplier(meta.role, layer);
        density *= densityBandMultiplier(meta.densityBand, layer);
        if (layerConfig.activitySensitive === true) density *= activityDensityMultiplier(meta);
        if (layerConfig.enabledWhen === 'rain') {
            density *= rainDensityMultiplier(dynamicState?.rainIntensityId);
        }
        if (meta.degree <= 1) {
            density *= Math.max(0, Number(layerConfig.deadEndDensityMultiplier) || 0);
        }
        const densityHash = hash32(tile.i, tile.j,
            seed ^ (Number(layerConfig.densitySalt) || 0));
        if (ratioOf(densityHash) >= Math.min(1, density)) continue;
        const slots = layerConfig.slots || [];
        if (!slots.length) continue;
        const slot = slots[hash32(tile.i, tile.j,
            seed ^ (Number(layerConfig.slotSalt) || 0)) % slots.length];
        const profile = weightedProfile(meta.profileWeights,
            hash32(tile.i, tile.j, seed ^ 0x4f31 ^ (Number(layerConfig.assetSalt) || 0)));
        const asset = weightedAsset(layerConfig, profile,
            hash32(tile.i, tile.j, seed ^ (Number(layerConfig.assetSalt) || 0)));
        if (!asset?.key) continue;
        const x = tile.x + (Number(slot.x) || 0);
        const y = tile.y + (Number(slot.y) || 0);
        const key = dynamicTextureKey(asset.key, dynamicState);
        specs.push({
            key,
            baseKey: asset.key,
            layer,
            profile,
            role: meta.role,
            densityBand: meta.densityBand,
            x,
            y,
            order: densityHash,
            sourceType: 'road',
            sourceCellKey: meta.key,
            recordKey: `${meta.key}:${layer}`,
            chunkKey: meta.chunkKey,
            signature: `${layer}:${key}:${profile}:${meta.role}:${meta.densityBand}`
                + `:${Math.round(x)}:${Math.round(y)}`,
        });
    }

    const edgeConfig = roadsideConfig.edgeLayer;
    if ((!onlyLayers || onlyLayers.has('edge')) && edgeConfig?.enabled !== false) {
        const minDegree = Math.max(0, Number(edgeConfig.minRoadDegree) || 0);
        const maxDegreeValue = Number(edgeConfig.maxRoadDegree);
        const maxDegree = Number.isFinite(maxDegreeValue) ? Math.max(0, maxDegreeValue) : 3;
        if (meta.degree >= minDegree && meta.degree <= maxDegree) {
            const exposed = (edgeConfig.directions || []).filter((direction) =>
                roadTiles.get(roadsideCellKey(
                    tile.i + (Number(direction.di) || 0),
                    tile.j + (Number(direction.dj) || 0)
                ))?.kind !== 'road');
            if (exposed.length) {
                let density = meta.direct
                    ? Math.max(0, Number(edgeConfig.frontageDensity) || 0)
                    : Math.max(0, Number(edgeConfig.manualUrbanDensity) || 0);
                density *= roleDensityMultiplier(meta.role, 'edge');
                density *= densityBandMultiplier(meta.densityBand, 'edge');
                if (meta.degree <= 1) {
                    density *= Math.max(0, Number(edgeConfig.deadEndDensityMultiplier) || 0);
                }
                const densityHash = hash32(tile.i, tile.j,
                    seed ^ (Number(edgeConfig.densitySalt) || 0));
                if (ratioOf(densityHash) < Math.min(1, density)) {
                    const direction = exposed[hash32(tile.i, tile.j,
                        seed ^ (Number(edgeConfig.directionSalt) || 0)) % exposed.length];
                    const asset = weightedList(edgeConfig.variants?.[direction.id],
                        hash32(tile.i, tile.j, seed ^ (Number(edgeConfig.assetSalt) || 0)));
                    if (asset?.key) {
                        specs.push({
                            key: asset.key,
                            baseKey: asset.key,
                            layer: 'edge',
                            profile: meta.dominantProfile,
                            role: meta.role,
                            densityBand: meta.densityBand,
                            x: tile.x,
                            y: tile.y,
                            order: densityHash,
                            sourceType: 'road',
                            sourceCellKey: meta.key,
                            recordKey: `${meta.key}:edge`,
                            chunkKey: meta.chunkKey,
                            signature: `edge:${direction.id}:${asset.key}:${meta.role}`
                                + `:${Math.round(tile.x)}:${Math.round(tile.y)}`,
                        });
                    }
                }
            }
        }
    }
    return specs;
}

function buildingVisualContexts(buildings) {
    return buildings.map((building, index) => {
        const geometry = roadsideBuildingFootprintGeometry(building);
        return {
            building,
            geometry,
            access: roadsideBuildingAccessPoint(building, roadsideConfig),
            profile: roadsideProfileForBuilding(building, roadsideConfig),
            activity: roadsideActivityState(building),
            stableKey: roadsideBuildingStableKey(building, index),
            baseCell: blockCellOf(geometry.centerX, geometry.centerY),
        };
    });
}

function pointInsideBuildingGeometry(x, y, geometry, padding = 8) {
    const halfW = geometry.width * 0.5 + padding;
    const halfD = geometry.depth * 0.5 + padding * 0.5;
    return Math.abs(x - geometry.centerX) / Math.max(1, halfW)
        + Math.abs(y - geometry.centerY) / Math.max(1, halfD) <= 1;
}

function buildingLayerSpecs(layer, layerConfig, roadTiles, contexts, dynamicState) {
    if (layerConfig?.enabled === false) return [];
    const seed = Number(roadsideConfig.seed) || 0;
    const maxPerBuilding = Math.max(0, Math.floor(Number(layerConfig.maxPerBuilding) || 0));
    const specs = [];
    const chunkSize = Math.max(1,
        Math.floor(Number(roadsideConfig.visualIndex?.chunkSizeCells) || 8));
    for (const context of contexts) {
        const { building, geometry, access, profile, activity, stableKey, baseCell } = context;
        if (building?._cfg?.siteDressing === false || maxPerBuilding <= 0) continue;
        const [baseI, baseJ] = baseCell;
        let density = Math.max(0, Number(layerConfig.density) || 0);
        if (layerConfig.activitySensitive === true && activity === 'idle') {
            density *= Math.max(0, Number(layerConfig.idleDensityMultiplier) || 0);
        }
        const candidates = [];
        for (const [slotIndex, slot] of (layerConfig.slots || []).entries()) {
            const xDirection = building?._facingLeft === true ? -1 : 1;
            const x = geometry.centerX + (Number(slot.xRatio) || 0) * geometry.width * xDirection;
            const y = geometry.centerY + (Number(slot.yRatio) || 0) * geometry.depth;
            if (access && Math.hypot(x - access.x, y - access.y) <= access.radius) continue;
            const [cellI, cellJ] = blockCellOf(x, y);
            if (roadTiles.has(roadsideCellKey(cellI, cellJ))) continue;
            if (contexts.some((other) => other.building !== building
                && pointInsideBuildingGeometry(x, y, other.geometry))) continue;
            const densityHash = hash32(baseI + slotIndex, baseJ - slotIndex,
                seed ^ (Number(layerConfig.densitySalt) || 0));
            if (ratioOf(densityHash) >= Math.min(1, density)) continue;
            const asset = weightedAsset(layerConfig, profile,
                hash32(baseI - slotIndex, baseJ + slotIndex,
                    seed ^ (Number(layerConfig.assetSalt) || 0)));
            if (!asset?.key) continue;
            const key = dynamicTextureKey(asset.key, dynamicState);
            candidates.push({
                key,
                baseKey: asset.key,
                layer,
                profile,
                x,
                y,
                order: densityHash,
                sourceType: 'building',
                sourceBuildingKey: stableKey,
                recordKey: `${layer}:${stableKey}:${slotIndex}`,
                chunkKey: roadsideChunkKey(cellI, cellJ, chunkSize),
                signature: `${layer}:${key}:${profile}:${Math.round(x)}:${Math.round(y)}`,
            });
        }
        candidates.sort((left, right) => left.order - right.order);
        specs.push(...candidates.slice(0, maxPerBuilding));
    }
    return specs;
}

function destroySprite(sprite) {
    if (sprite && typeof sprite.destroy === 'function') sprite.destroy();
}

function viewportSignature(view, revision) {
    if (!view) return `all:${revision}`;
    return `${Math.round(Number(view.x) || 0)}:${Math.round(Number(view.y) || 0)}`
        + `:${Math.round(Number(view.width) || 0)}:${Math.round(Number(view.height) || 0)}`
        + `:${revision}`;
}

function blankStats() {
    return {
        fullRebuilds: 0,
        partialRebuilds: 0,
        rebuildCount: 0,
        lastRebuildMs: 0,
        lastIndexMs: 0,
        lastSpecBuildMs: 0,
        lastChunkBuildMs: 0,
        lastViewportSyncMs: 0,
        totalRebuildMs: 0,
        maxRebuildMs: 0,
        budgetCulled: 0,
        visibleBudgetCulled: 0,
        depthWrites: 0,
        depthSkips: 0,
    };
}

export const RoadsideDecorationSystem = {
    _scene: null,
    _records: new Map(),
    _pool: [],
    _rawSpecs: new Map(),
    _chunkSpecs: new Map(),
    _chunkBounds: new Map(),
    _visibleChunks: new Set(),
    _pendingSync: null,
    _syncScheduled: false,
    _syncGeneration: 0,
    _lastSyncPayload: null,
    _lastRoadRevision: -1,
    _lastViewportSignature: '',
    _specRevision: 0,
    _depthRevision: 0,
    _resolvedDepthSignature: '',
    _knownBuildingSignature: '',
    _knownActivitySignature: '',
    _index: new RoadsideVisualIndex(roadsideConfig),
    _dynamicState: { isNight: false, rainActive: false, rainIntensityId: null },
    _nextActivityRefreshAt: 0,
    _stats: blankStats(),

    reset() {
        this._syncGeneration = (Number(this._syncGeneration) || 0) + 1;
        for (const record of this._records.values()) destroySprite(record.sprite);
        for (const sprite of this._pool) destroySprite(sprite);
        this._records.clear();
        this._pool.length = 0;
        this._rawSpecs.clear();
        this._chunkSpecs.clear();
        this._chunkBounds.clear();
        this._visibleChunks.clear();
        this._index.reset();
        this._scene = null;
        this._pendingSync = null;
        this._syncScheduled = false;
        this._lastSyncPayload = null;
        this._lastRoadRevision = -1;
        this._lastViewportSignature = '';
        this._specRevision = 0;
        this._depthRevision = 0;
        this._resolvedDepthSignature = '';
        this._knownBuildingSignature = '';
        this._knownActivitySignature = '';
        this._dynamicState = { isNight: false, rainActive: false, rainIntensityId: null };
        this._nextActivityRefreshAt = 0;
        this._stats = blankStats();
    },

    requestSync(payload = {}) {
        const previous = this._pendingSync;
        const dirtyRoadKeys = new Set(previous?.dirtyRoadKeys || []);
        for (const key of payload.dirtyRoadKeys || []) dirtyRoadKeys.add(String(key));
        const refreshLayers = new Set(previous?.refreshLayers || []);
        for (const layer of payload.refreshLayers || []) refreshLayers.add(String(layer));
        this._pendingSync = {
            scene: Object.prototype.hasOwnProperty.call(payload, 'scene')
                ? payload.scene
                : (previous?.scene ?? this._scene),
            roadTiles: payload.roadTiles ?? previous?.roadTiles ?? this._lastSyncPayload?.roadTiles,
            buildings: payload.buildings ?? previous?.buildings ?? this._lastSyncPayload?.buildings,
            roadRevision: payload.roadRevision ?? previous?.roadRevision ?? this._lastRoadRevision,
            dirtyRoadKeys,
            refreshLayers,
            full: previous?.full === true || payload.full === true,
        };
        if (this._syncScheduled) return;
        this._syncScheduled = true;
        const scheduledGeneration = this._syncGeneration;
        const enqueue = typeof queueMicrotask === 'function'
            ? queueMicrotask
            : (callback) => Promise.resolve().then(callback);
        enqueue(() => {
            if (scheduledGeneration !== this._syncGeneration) return;
            this._syncScheduled = false;
            const pending = this._pendingSync;
            this._pendingSync = null;
            if (pending) this.sync(pending);
        });
    },

    _removeRawSpecs(predicate) {
        for (const [key, spec] of this._rawSpecs) {
            if (predicate(spec)) this._rawSpecs.delete(key);
        }
    },

    _refreshRoadSpecs(roadTiles, dirtyKeys, onlyLayers = null) {
        const dirty = new Set(dirtyKeys || []);
        if (onlyLayers) {
            this._removeRawSpecs((spec) => spec.sourceType === 'road'
                && onlyLayers.has(spec.layer)
                && (dirty.size === 0 || dirty.has(spec.sourceCellKey)));
        } else {
            this._removeRawSpecs((spec) => spec.sourceType === 'road'
                && dirty.has(spec.sourceCellKey));
        }
        for (const key of dirty) {
            const tile = roadTiles.get(key);
            const meta = this._index.get(key);
            if (!tile || !meta) continue;
            const frame = roadFrameForRole(tile, meta);
            if (tile.sprite?.active && Number(tile.sprite.frame?.name) !== frame) {
                tile.sprite.setFrame?.(frame);
            }
            for (const spec of roadDecorationSpecs(
                tile, meta, roadTiles, this._dynamicState, onlyLayers
            )) {
                this._rawSpecs.set(spec.recordKey, spec);
            }
        }
    },

    _refreshBuildingSpecs(roadTiles, buildings) {
        this._removeRawSpecs((spec) => spec.sourceType === 'building');
        const contexts = buildingVisualContexts(buildings);
        for (const spec of buildingLayerSpecs(
            'site', roadsideConfig.siteLayer, roadTiles, contexts, this._dynamicState
        )) this._rawSpecs.set(spec.recordKey, spec);
        for (const spec of buildingLayerSpecs(
            'margin', roadsideConfig.marginLayer, roadTiles, contexts, this._dynamicState
        )) this._rawSpecs.set(spec.recordKey, spec);
    },

    _rebuildChunks() {
        this._chunkSpecs.clear();
        this._chunkBounds.clear();
        const groups = new Map();
        for (const spec of this._rawSpecs.values()) {
            const budgetLayer = spec.layer === 'site' || spec.layer === 'margin'
                ? 'siteMargin' : spec.layer;
            const groupKey = `${spec.chunkKey}|${budgetLayer}`;
            let group = groups.get(groupKey);
            if (!group) {
                group = { chunkKey: spec.chunkKey, budgetLayer, specs: [] };
                groups.set(groupKey, group);
            }
            group.specs.push(spec);
        }
        let culled = 0;
        const layerLimits = runtimeConfig.chunkLayerLimits || {};
        for (const group of groups.values()) {
            group.specs.sort((left, right) => left.order - right.order
                || left.recordKey.localeCompare(right.recordKey));
            const configured = Number(layerLimits[group.budgetLayer]);
            const limit = Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : Infinity;
            const kept = group.specs.slice(0, limit);
            culled += Math.max(0, group.specs.length - kept.length);
            let chunk = this._chunkSpecs.get(group.chunkKey);
            if (!chunk) {
                chunk = [];
                this._chunkSpecs.set(group.chunkKey, chunk);
            }
            chunk.push(...kept);
            let bounds = this._chunkBounds.get(group.chunkKey);
            if (!bounds) {
                bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
                this._chunkBounds.set(group.chunkKey, bounds);
            }
            for (const spec of kept) {
                bounds.minX = Math.min(bounds.minX, spec.x - 72);
                bounds.maxX = Math.max(bounds.maxX, spec.x + 72);
                bounds.minY = Math.min(bounds.minY, spec.y - 96);
                bounds.maxY = Math.max(bounds.maxY, spec.y + 40);
            }
        }
        this._stats.budgetCulled = culled;
        this._specRevision++;
        this._lastViewportSignature = '';
    },

    sync({
        scene = null,
        roadTiles = new Map(),
        buildings = [],
        roadRevision = -1,
        dirtyRoadKeys = null,
        refreshLayers = null,
        full = false,
    } = {}) {
        if (scene !== this._scene) {
            this.reset();
            this._scene = scene;
            full = true;
        }
        if (!roadsideConfig.enabled || !scene?.add?.image) {
            for (const record of this._records.values()) destroySprite(record.sprite);
            this._records.clear();
            this._rawSpecs.clear();
            this._chunkSpecs.clear();
            return;
        }
        const startedAt = nowMs();
        const availableBuildings = roadsideActiveBuildings(buildings);
        const roadRevisionChanged = Number(roadRevision) !== Number(this._lastRoadRevision);
        const suppliedDirty = new Set(dirtyRoadKeys || []);
        full ||= this._lastSyncPayload == null || (roadRevisionChanged && suppliedDirty.size === 0);
        const indexResult = this._index.update({
            roadTiles,
            buildings: availableBuildings,
            dirtyRoadKeys: suppliedDirty,
            full,
        });
        const indexedAt = nowMs();
        const layers = new Set(refreshLayers || []);
        const roadKeys = full
            ? new Set([...roadTiles].filter(([, tile]) => tile?.kind === 'road').map(([key]) => key))
            : new Set(indexResult.dirtyKeys || []);
        if (full) {
            this._rawSpecs.clear();
            this._refreshRoadSpecs(roadTiles, roadKeys);
        } else if (roadKeys.size) {
            this._refreshRoadSpecs(roadTiles, roadKeys);
        }
        if (layers.size) {
            const allRoadKeys = new Set([...roadTiles]
                .filter(([, tile]) => tile?.kind === 'road').map(([key]) => key));
            this._refreshRoadSpecs(roadTiles, allRoadKeys, layers);
        }
        if (full || roadKeys.size || indexResult.changedBuildingIds?.size) {
            this._refreshBuildingSpecs(roadTiles, availableBuildings);
        }
        if (full || roadKeys.size || layers.size || indexResult.changedBuildingIds?.size) {
            const chunkStartedAt = nowMs();
            this._rebuildChunks();
            this._stats.lastChunkBuildMs = Math.max(0, nowMs() - chunkStartedAt);
        } else {
            this._stats.lastChunkBuildMs = 0;
        }
        const specsBuiltAt = nowMs();
        this._lastSyncPayload = { scene, roadTiles, buildings: availableBuildings, roadRevision };
        this._lastRoadRevision = Number(roadRevision);
        const elapsed = Math.max(0, nowMs() - startedAt);
        this._stats.rebuildCount++;
        if (full) this._stats.fullRebuilds++;
        else this._stats.partialRebuilds++;
        this._stats.lastRebuildMs = elapsed;
        this._stats.totalRebuildMs += elapsed;
        this._stats.maxRebuildMs = Math.max(this._stats.maxRebuildMs, elapsed);
        this._stats.lastIndexMs = Math.max(0, indexedAt - startedAt);
        this._stats.lastSpecBuildMs = Math.max(0,
            specsBuiltAt - indexedAt - this._stats.lastChunkBuildMs);
        const viewportStartedAt = nowMs();
        this.syncViewport(scene?.cameras?.main?.worldView || null, { force: true });
        this._stats.lastViewportSyncMs = Math.max(0, nowMs() - viewportStartedAt);
    },

    _releaseRecord(key, record) {
        const sprite = record?.sprite;
        this._records.delete(key);
        if (!sprite?.active) return;
        sprite.setVisible?.(false);
        sprite.setActive?.(false);
        const maxPool = Math.max(0, Math.floor(Number(runtimeConfig.maxPooledSprites) || 96));
        if (this._pool.length < maxPool) this._pool.push(sprite);
        else sprite.destroy();
        this._depthRevision++;
    },

    _acquireSprite(spec) {
        let sprite = this._pool.pop() || null;
        if (sprite?.active === false) sprite.setActive?.(true);
        if (!sprite) sprite = this._scene.add.image(spec.x, spec.y, spec.key);
        sprite.setTexture?.(spec.key);
        sprite.setPosition?.(spec.x, spec.y);
        sprite.x = spec.x;
        sprite.y = spec.y;
        sprite.setVisible?.(true);
        sprite.setActive?.(true);
        const layerConfig = layerConfigFor(spec.layer);
        const displaySize = Math.max(1, Number(layerConfig.displaySize) || 128);
        const displayWidth = Math.max(1, Number(layerConfig.displayWidth) || displaySize);
        const displayHeight = Math.max(1, Number(layerConfig.displayHeight) || displaySize);
        sprite.setOrigin?.(
            Math.max(0, Math.min(1, Number(layerConfig.originX) || 0.5)),
            Math.max(0, Math.min(1, Number(layerConfig.originY) || 0.875))
        );
        sprite.setDisplaySize?.(displayWidth, displayHeight);
        sprite.setAlpha?.(Math.max(0, Math.min(1, Number(layerConfig.alpha) || 0.96)));
        const depthOffset = Number(layerConfig.depthOffset) || 0;
        const groundDepth = WORLD_RENDER_LAYERS[layerConfig.groundLayer]
            ?? WORLD_RENDER_LAYERS.ROAD_DECAL;
        const naturalDepth = spec.y + depthOffset;
        sprite.setDepth?.(layerConfig.depthMode === 'ground'
            ? groundDepth + depthOffset : naturalDepth);
        sprite._isRoadsideDecoration = true;
        sprite._roadsideProfile = spec.profile;
        sprite._roadsideLayer = spec.layer;
        return {
            sprite,
            signature: spec.signature,
            depthMode: layerConfig.depthMode,
            naturalDepth,
            x: spec.x,
            y: spec.y,
            spec,
        };
    },

    syncViewport(worldView = null, { force = false } = {}) {
        if (!this._scene?.add?.image) return;
        const signature = viewportSignature(worldView, this._specRevision);
        if (!force && signature === this._lastViewportSignature) return;
        this._lastViewportSignature = signature;
        const padding = Math.max(0, Number(runtimeConfig.viewportPaddingPx) || 320);
        this._visibleChunks.clear();
        for (const [chunkKey, bounds] of this._chunkBounds) {
            const visible = !worldView || !(
                bounds.maxX < worldView.x - padding
                || bounds.minX > worldView.x + worldView.width + padding
                || bounds.maxY < worldView.y - padding
                || bounds.minY > worldView.y + worldView.height + padding
            );
            if (visible) this._visibleChunks.add(chunkKey);
        }
        const footSpecs = [];
        const groundSpecs = [];
        for (const chunkKey of this._visibleChunks) {
            for (const spec of this._chunkSpecs.get(chunkKey) || []) {
                if (layerConfigFor(spec.layer).depthMode === 'ground') groundSpecs.push(spec);
                else footSpecs.push(spec);
            }
        }
        const stableSort = (left, right) => left.order - right.order
            || left.recordKey.localeCompare(right.recordKey);
        footSpecs.sort(stableSort);
        groundSpecs.sort(stableSort);
        const footLimit = Math.max(0, Math.floor(Number(runtimeConfig.maxVisibleFootSprites) || 96));
        const groundLimit = Math.max(0, Math.floor(Number(runtimeConfig.maxVisibleGroundSprites) || 240));
        const selected = [...footSpecs.slice(0, footLimit), ...groundSpecs.slice(0, groundLimit)];
        this._stats.visibleBudgetCulled = Math.max(0, footSpecs.length - footLimit)
            + Math.max(0, groundSpecs.length - groundLimit);
        const wanted = new Map(selected.map((spec) => [spec.recordKey, spec]));
        for (const [key, record] of this._records) {
            const spec = wanted.get(key);
            if (spec?.signature === record.signature && record.sprite?.active) {
                wanted.delete(key);
                continue;
            }
            this._releaseRecord(key, record);
        }
        for (const [key, spec] of wanted) {
            if (!this._scene.textures?.exists?.(spec.key)) continue;
            this._records.set(key, this._acquireSprite(spec));
            this._depthRevision++;
        }
    },

    syncStructureDepths(structures = [], topologySignature = '') {
        const signature = `${topologySignature}|${WallSystem._collisionRevision || 0}|${this._depthRevision}`;
        if (signature === this._resolvedDepthSignature) return;
        this._resolvedDepthSignature = signature;
        for (const record of this._records.values()) {
            const sprite = record?.sprite;
            if (record?.depthMode !== 'foot' || !sprite?.active) continue;
            const naturalDepth = Number(record.naturalDepth) || Number(record.y) || 0;
            const profile = resolveSpriteDepthProfile(null, sprite, {
                logicalX: record.x,
                logicalFootY: record.y,
                footOffsetY: 0,
            });
            const nextDepth = WallSystem.resolveDynamicEntityDepth(
                record.x,
                record.y,
                naturalDepth,
                profile.frontRange,
                profile.sideRange,
                profile.visibleWorldBounds,
                structures
            );
            if (sprite.depth !== nextDepth) {
                sprite.setDepth(nextDepth);
                this._stats.depthWrites++;
            } else {
                this._stats.depthSkips++;
            }
        }
    },

    _applyNightTextureSwaps() {
        let changed = false;
        for (const spec of this._rawSpecs.values()) {
            const nextKey = dynamicTextureKey(spec.baseKey, this._dynamicState);
            if (nextKey === spec.key) continue;
            spec.key = nextKey;
            spec.signature = `${spec.layer}:${nextKey}:${spec.profile}`
                + `:${Math.round(spec.x)}:${Math.round(spec.y)}`;
            const record = this._records.get(spec.recordKey);
            if (record?.sprite?.active) {
                record.sprite.setTexture?.(nextKey);
                record.signature = spec.signature;
            }
            changed = true;
        }
        if (changed) this._specRevision++;
    },

    updateDynamic({ daylight = 1, rainState = null, worldTimeMs = 0, buildings = null } = {}) {
        const payload = this._lastSyncPayload;
        if (!payload?.scene || payload.scene !== this._scene) return;
        const nightThreshold = Math.max(0, Math.min(1,
            Number(roadsideConfig.dynamic?.nightDaylightThreshold) || 0.12));
        const isNight = Number(daylight) <= nightThreshold;
        const rainActive = rainState?.active === true;
        const rainIntensityId = rainActive ? (rainState?.intensityId || 'light') : null;
        const nightChanged = isNight !== this._dynamicState.isNight;
        const rainChanged = rainActive !== this._dynamicState.rainActive
            || rainIntensityId !== this._dynamicState.rainIntensityId;
        this._dynamicState.isNight = isNight;
        this._dynamicState.rainActive = rainActive;
        this._dynamicState.rainIntensityId = rainIntensityId;
        if (nightChanged) this._applyNightTextureSwaps();

        const now = Math.max(0, Number(worldTimeMs) || 0);
        let buildingChanged = false;
        let nextBuildings = payload.buildings;
        if (now >= this._nextActivityRefreshAt) {
            nextBuildings = buildings ? roadsideActiveBuildings(buildings) : payload.buildings;
            const topologyParts = [];
            const activityParts = [];
            for (const [index, building] of nextBuildings.entries()) {
                const key = roadsideBuildingStableKey(building, index);
                const access = roadsideBuildingAccessPoint(building, roadsideConfig);
                topologyParts.push(`${key}:${Math.round(building.x)}:${Math.round(building.y)}`
                    + `:${building._facingLeft === true ? 1 : 0}`
                    + `:${access ? `${Math.round(access.x)}:${Math.round(access.y)}:${Math.round(access.radius)}` : 'none'}`);
                activityParts.push(`${key}:${roadsideActivityState(building)}`);
            }
            topologyParts.sort();
            activityParts.sort();
            const topologySignature = topologyParts.join('|');
            const activitySignature = activityParts.join('|');
            buildingChanged = topologySignature !== this._knownBuildingSignature
                || activitySignature !== this._knownActivitySignature;
            this._knownBuildingSignature = topologySignature;
            this._knownActivitySignature = activitySignature;
            this._nextActivityRefreshAt = now + Math.max(250,
                Number(roadsideConfig.dynamic?.activityRefreshMs) || 1000);
        }
        if (rainChanged || buildingChanged) {
            this.requestSync({
                ...payload,
                buildings: nextBuildings,
                refreshLayers: rainChanged ? ['rain'] : [],
            });
        }
    },

    getStats() {
        let footSprites = 0;
        let groundSprites = 0;
        for (const record of this._records.values()) {
            if (record.depthMode === 'ground') groundSprites++;
            else footSprites++;
        }
        const indexStats = this._index.getStats();
        return {
            ...this._stats,
            roadCells: indexStats.roadCells,
            buildings: indexStats.buildings,
            processedCells: indexStats.processedCells,
            lastDirtyCells: indexStats.lastDirtyCells,
            buildingCandidates: indexStats.buildingCandidates,
            indexFullRebuilds: indexStats.fullRebuilds,
            indexPartialRebuilds: indexStats.partialRebuilds,
            candidateSpecs: this._rawSpecs.size,
            chunks: this._chunkSpecs.size,
            visibleChunks: this._visibleChunks.size,
            activeSprites: this._records.size,
            activeFootSprites: footSprites,
            activeGroundSprites: groundSprites,
            pooledSprites: this._pool.length,
            groundBatchMode: 'sprites',
        };
    },
};
