import populationEconomyConfig from '../../data/population-economy.json';
import { blockCellOf } from './gate4-grid.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { shortestRoadRoute } from './road-connectivity.js';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';

function residentConfig() {
    return populationEconomyConfig.house?.residentVisual || {};
}

function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function rangeValue(range, fallback, seed = Math.random()) {
    const [min, max] = Array.isArray(range) ? range : [fallback, fallback];
    return (Number(min) || fallback) + ((Number(max) || fallback) - (Number(min) || fallback)) * seed;
}

function stableBuildingKey(building) {
    return building?.id || `${building?.cfgKey || 'house'}:${Math.round(building?.x || 0)}:${Math.round(building?.y || 0)}`;
}

function setState(worker, state) {
    const definition = worker.visual?.animations?.[state];
    const key = `worker_${worker.visual?.id}_${state}`;
    if (!definition || !worker.sprite?.active || !worker.sprite.scene?.anims?.exists(key)) return false;
    worker.state = state;
    // 五套装扮只持有各自动画定义；显示尺寸与脚点来自房屋居民总配置。
    applyCivilianAnimSize(worker.sprite, { ...residentConfig(), ...worker.visual }, state);
    worker.sprite.play(key, true);
    return true;
}

function destroyWorker(worker) {
    if (!worker) return;
    fadeOutAndDestroyCivilian(worker);
}

function roadKeyAt(worker, network) {
    if (!worker || !network) return null;
    const [i, j] = blockCellOf(
        worker.x - (Number(worker.laneX) || 0),
        worker.y - (Number(worker.laneY) || 0)
    );
    const key = `${i},${j}`;
    return network.byKey.has(key) ? key : null;
}

export const HouseResidentVisualSystem = {
    _records: new Map(),

    _residentCount(building) {
        const counts = residentConfig().countsByLevel || {};
        return Math.max(0, Math.floor(Number(counts[building?._economyLevel || 1]) || 0));
    },

    _roadContext(building, record) {
        const cfg = residentConfig();
        const base = BuildingRoadSystem.getBuildingRoadInfo(building);
        const detectionRadius = Math.max(0, Number(cfg.roadDetectionRadius) || 420);
        const signature = [
            base.topologyRevision,
            base.wallRevision,
            Math.round(Number(building?.x) || 0),
            Math.round(Number(building?.y) || 0),
            detectionRadius,
        ].join(':');
        if (record.roadContext?.signature === signature) return record.roadContext;

        const entries = [];
        for (const cell of base.network.byKey.values()) {
            const distance = Math.hypot(
                cell.x - (Number(building?.x) || 0),
                cell.y - (Number(building?.y) || 0)
            );
            if (distance <= detectionRadius) entries.push({ ...cell, distance });
        }
        entries.sort((a, b) => a.distance - b.distance);
        const maxCandidates = Math.max(1, Math.floor(Number(cfg.maxRoadEntryCandidates) || 16));
        const candidateEntries = entries.slice(0, maxCandidates);
        record.roadContext = {
            signature,
            network: base.network,
            topologyRevision: base.topologyRevision,
            wallRevision: base.wallRevision,
            entries: candidateEntries,
            allowedComponentIds: new Set(candidateEntries
                .map((cell) => base.network.componentByKey.get(cell.key))
                .filter((id) => id !== undefined)),
        };
        return record.roadContext;
    },

    _createWorker(building, slot, roadContext) {
        const cfg = residentConfig();
        const skins = cfg.skins || [];
        if (!skins.length) return null;
        const seed = hashString(`${stableBuildingKey(building)}:${slot}`);
        const visual = skins[seed % skins.length];
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const idleKey = `worker_${visual.id}_idle`;
        if (!scene?.add?.sprite || !scene.textures?.exists(idleKey) || !scene.anims?.exists(idleKey)) return null;

        const spawnAngle = ((seed % 360) / 180) * Math.PI;
        const spawnDistance = rangeValue(
            cfg.localSpawnDistance,
            170,
            ((seed >>> 6) % 1000) / 1000
        );
        const verticalScale = Math.max(0.1, Number(cfg.localVerticalScale) || 0.62);
        const start = resolveCivilianVisualPosition(
            (Number(building?.x) || 0) + Math.cos(spawnAngle) * spawnDistance,
            (Number(building?.y) || 0) + Math.sin(spawnAngle) * spawnDistance * verticalScale
        );
        const jitter = Math.max(0, Number(cfg.laneJitter) || 0);
        const laneAngle = ((((seed >>> 3) + 137) % 360) / 180) * Math.PI;
        const roadLaneX = Math.cos(laneAngle) * jitter;
        const roadLaneY = Math.sin(laneAngle) * jitter * 0.5;
        const sprite = scene.add.sprite(start.x, start.y, idleKey, 0);
        sprite.setOrigin(0.5, Number(cfg.originY) || 0.92);
        sprite.setDisplaySize(Number(cfg.displaySize) || 96, Number(cfg.displaySize) || 96);
        const worker = registerCivilianVisual({
            building,
            slot,
            visual,
            sprite,
            x: start.x,
            y: start.y,
            laneX: 0,
            laneY: 0,
            roadLaneX,
            roadLaneY,
            state: 'idle',
            mode: 'local_idle',
            idleRemainMs: rangeValue(cfg.idleDurationMs, 3000, ((seed >>> 8) % 1000) / 1000),
            moveSpeed: rangeValue(cfg.moveSpeed, 34, ((seed >>> 16) % 1000) / 1000),
            targetX: null,
            targetY: null,
            localMoveRemainMs: 0,
            roadSeekCooldownMs: rangeValue(
                cfg.roadSeekDelayMs,
                800,
                ((seed >>> 20) % 1000) / 1000
            ),
            roadSeekAttempt: 0,
            roadSeekStuckMs: 0,
            roadSeekBestDistance: Number.POSITIVE_INFINITY,
            roadEntryKey: null,
            roadComponentId: null,
            route: null,
            routeIndex: 0,
            topologySignature: roadContext.signature,
        }, 'house_resident');
        setState(worker, 'idle');
        return worker;
    },

    _planLocalWalk(worker) {
        const cfg = residentConfig();
        const radius = Math.max(48, Number(cfg.localActivityRadius) || 220);
        const verticalScale = Math.max(0.1, Number(cfg.localVerticalScale) || 0.62);
        const angle = Math.random() * Math.PI * 2;
        const distance = radius * (0.45 + Math.random() * 0.55);
        const target = resolveCivilianVisualPosition(
            (Number(worker.building?.x) || 0) + Math.cos(angle) * distance,
            (Number(worker.building?.y) || 0) + Math.sin(angle) * distance * verticalScale
        );
        worker.laneX = 0;
        worker.laneY = 0;
        worker.targetX = target.x;
        worker.targetY = target.y;
        worker.mode = 'local_walking';
        worker.route = null;
        worker.routeIndex = 0;
        const travelMs = Math.hypot(target.x - worker.x, target.y - worker.y)
            / Math.max(1, worker.moveSpeed) * 1000;
        worker.localMoveRemainMs = travelMs
            + Math.max(0, Number(cfg.localMoveGraceMs) || 3500);
        setState(worker, 'walking');
        return true;
    },

    _beginRoadSeek(worker, roadContext) {
        if (!roadContext.entries.length) return false;
        const index = (worker.slot + worker.roadSeekAttempt) % roadContext.entries.length;
        const entry = roadContext.entries[index];
        worker.roadSeekAttempt++;
        worker.roadEntryKey = entry.key;
        worker.targetX = entry.x;
        worker.targetY = entry.y;
        worker.mode = 'to_road';
        worker.route = null;
        worker.routeIndex = 0;
        worker.laneX = 0;
        worker.laneY = 0;
        worker.roadSeekStuckMs = 0;
        worker.roadSeekBestDistance = Math.hypot(entry.x - worker.x, entry.y - worker.y);
        setState(worker, 'walking');
        return true;
    },

    _bindToRoad(worker, roadContext) {
        const entry = roadContext.network.byKey.get(worker.roadEntryKey);
        const componentId = entry ? roadContext.network.componentByKey.get(entry.key) : undefined;
        if (!entry || componentId === undefined || !roadContext.allowedComponentIds.has(componentId)) return false;
        worker.laneX = worker.roadLaneX;
        worker.laneY = worker.roadLaneY;
        worker.x = entry.x + worker.laneX;
        worker.y = entry.y + worker.laneY;
        worker.sprite.setPosition(worker.x, worker.y);
        worker.roadComponentId = componentId;
        worker.mode = 'road_idle';
        worker.targetX = null;
        worker.targetY = null;
        worker.route = null;
        worker.routeIndex = 0;
        worker.idleRemainMs = rangeValue(residentConfig().idleDurationMs, 3000);
        worker.roadSeekAttempt = 0;
        setState(worker, 'idle');
        return true;
    },

    _planRoadRoute(worker, roadContext) {
        const componentId = worker.roadComponentId;
        const cellKeys = roadContext.network.components.get(componentId) || [];
        if (!cellKeys.length || !roadContext.allowedComponentIds.has(componentId)) {
            this._leaveRoad(worker, roadContext);
            return false;
        }
        const currentKey = roadKeyAt(worker, roadContext.network) || worker.roadEntryKey;
        if (!currentKey || roadContext.network.componentByKey.get(currentKey) !== componentId) {
            this._leaveRoad(worker, roadContext);
            return false;
        }
        let targetKey = cellKeys[Math.floor(Math.random() * cellKeys.length)];
        if (cellKeys.length > 1 && targetKey === currentKey) {
            targetKey = cellKeys[(cellKeys.indexOf(targetKey) + 1) % cellKeys.length];
        }
        const route = shortestRoadRoute(roadContext.network, [currentKey], [targetKey]);
        if (!route || route.length < 2) {
            worker.route = null;
            worker.routeIndex = 0;
            worker.idleRemainMs = rangeValue(residentConfig().idleDurationMs, 3000);
            worker.mode = 'road_idle';
            setState(worker, 'idle');
            return false;
        }
        worker.route = route;
        worker.routeIndex = 1;
        worker.mode = 'road_walking';
        setState(worker, 'walking');
        return true;
    },

    _moveToward(worker, targetX, targetY, dt, arrivalDistance = 3) {
        const dx = targetX - worker.x;
        const dy = targetY - worker.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= arrivalDistance) return true;
        const step = Math.max(0, worker.moveSpeed * Math.max(0, Number(dt) || 0) / 1000);
        if (distance > 0 && step > 0) {
            const ratio = Math.min(1, step / distance);
            const resolved = sweepCivilianVisualMove(
                worker,
                worker.x + dx * ratio,
                worker.y + dy * ratio
            );
            worker.x = resolved.x;
            worker.y = resolved.y;
        }
        worker.sprite.setFlipX(dx < 0);
        worker.sprite.setPosition(worker.x, worker.y);
        return Math.hypot(targetX - worker.x, targetY - worker.y) <= arrivalDistance;
    },

    _leaveRoad(worker, roadContext) {
        worker.mode = 'local_idle';
        worker.laneX = 0;
        worker.laneY = 0;
        worker.roadComponentId = null;
        worker.roadEntryKey = null;
        worker.route = null;
        worker.routeIndex = 0;
        worker.targetX = null;
        worker.targetY = null;
        worker.idleRemainMs = 0;
        worker.roadSeekCooldownMs = 0;
        worker.topologySignature = roadContext.signature;
        setState(worker, 'idle');
    },

    _syncRoadTopology(worker, roadContext) {
        if (worker.topologySignature === roadContext.signature) return;
        worker.topologySignature = roadContext.signature;
        worker.route = null;
        worker.routeIndex = 0;
        if (worker.mode === 'road_idle' || worker.mode === 'road_walking') {
            const currentKey = roadKeyAt(worker, roadContext.network);
            const componentId = currentKey
                ? roadContext.network.componentByKey.get(currentKey)
                : undefined;
            if (componentId !== undefined && roadContext.allowedComponentIds.has(componentId)) {
                worker.roadEntryKey = currentKey;
                worker.roadComponentId = componentId;
                worker.mode = 'road_idle';
                worker.idleRemainMs = 0;
                setState(worker, 'idle');
                return;
            }
            this._leaveRoad(worker, roadContext);
            return;
        }
        if (worker.mode === 'to_road') {
            worker.mode = 'local_idle';
            worker.targetX = null;
            worker.targetY = null;
            worker.roadEntryKey = null;
            worker.roadSeekCooldownMs = 0;
            setState(worker, 'idle');
        }
    },

    _updateWorker(worker, dt, roadContext) {
        if (!worker?.sprite?.active) return;
        const cfg = residentConfig();
        const elapsed = Math.max(0, Number(dt) || 0);
        this._syncRoadTopology(worker, roadContext);
        worker.roadSeekCooldownMs = Math.max(0, worker.roadSeekCooldownMs - elapsed);

        if ((worker.mode === 'local_idle' || worker.mode === 'local_walking')
            && roadContext.entries.length > 0
            && worker.roadSeekCooldownMs <= 0) {
            this._beginRoadSeek(worker, roadContext);
        }

        if (worker.mode === 'local_idle') {
            worker.idleRemainMs -= elapsed;
            if (worker.idleRemainMs <= 0) this._planLocalWalk(worker);
            return;
        }

        if (worker.mode === 'local_walking') {
            worker.localMoveRemainMs -= elapsed;
            const arrived = this._moveToward(worker, worker.targetX, worker.targetY, elapsed);
            if (arrived || worker.localMoveRemainMs <= 0) {
                worker.mode = 'local_idle';
                worker.targetX = null;
                worker.targetY = null;
                worker.idleRemainMs = rangeValue(cfg.idleDurationMs, 3000);
                setState(worker, 'idle');
            }
            return;
        }

        if (worker.mode === 'to_road') {
            const entry = roadContext.network.byKey.get(worker.roadEntryKey);
            if (!entry) {
                worker.mode = 'local_idle';
                worker.roadEntryKey = null;
                worker.targetX = null;
                worker.targetY = null;
                worker.idleRemainMs = 0;
                worker.roadSeekCooldownMs = 0;
                setState(worker, 'idle');
                return;
            }
            const arrival = Math.max(3, Number(cfg.roadEntryArrivalDistance) || 10);
            if (this._moveToward(worker, entry.x, entry.y, elapsed, arrival)) {
                if (!this._bindToRoad(worker, roadContext)) this._leaveRoad(worker, roadContext);
                return;
            }
            const remaining = Math.hypot(entry.x - worker.x, entry.y - worker.y);
            if (remaining < worker.roadSeekBestDistance - 1) {
                worker.roadSeekBestDistance = remaining;
                worker.roadSeekStuckMs = 0;
            } else {
                worker.roadSeekStuckMs += elapsed;
            }
            if (worker.roadSeekStuckMs >= Math.max(500, Number(cfg.roadSeekStuckMs) || 3000)) {
                const exhausted = worker.roadSeekAttempt >= roadContext.entries.length;
                worker.mode = 'local_idle';
                worker.roadEntryKey = null;
                worker.targetX = null;
                worker.targetY = null;
                worker.idleRemainMs = rangeValue(cfg.idleDurationMs, 3000);
                worker.roadSeekCooldownMs = exhausted
                    ? Math.max(1000, Number(cfg.roadSeekFailedCooldownMs) || 6000)
                    : rangeValue(cfg.roadSeekRetryMs, 2200);
                if (exhausted) worker.roadSeekAttempt = 0;
                setState(worker, 'idle');
            }
            return;
        }

        if (worker.mode === 'road_idle') {
            worker.idleRemainMs -= elapsed;
            if (worker.idleRemainMs <= 0) this._planRoadRoute(worker, roadContext);
            return;
        }

        if (worker.mode !== 'road_walking') return;
        const waypoint = worker.route?.[worker.routeIndex];
        if (!waypoint) {
            worker.route = null;
            worker.routeIndex = 0;
            worker.mode = 'road_idle';
            worker.idleRemainMs = rangeValue(cfg.idleDurationMs, 3000);
            setState(worker, 'idle');
            return;
        }
        if (this._moveToward(
            worker,
            waypoint.x + worker.laneX,
            waypoint.y + worker.laneY,
            elapsed,
            4
        )) worker.routeIndex++;
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'housing') return;
        if (!building.active || !CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const targetCount = this._residentCount(building);
        let record = this._records.get(building);
        if (record?.workers.some((worker) => !worker?.sprite?.active)) {
            this.clearBuilding(building);
            record = null;
        }
        if (!record) {
            record = { workers: [], roadContext: null };
            this._records.set(building, record);
        }
        const roadContext = this._roadContext(building, record);
        while (record.workers.length > targetCount) destroyWorker(record.workers.pop());
        while (record.workers.length < targetCount) {
            const worker = this._createWorker(building, record.workers.length, roadContext);
            if (!worker) break;
            record.workers.push(worker);
        }
        for (const worker of record.workers) this._updateWorker(worker, dt, roadContext);
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        this._records.delete(building);
        for (const worker of record.workers) destroyWorker(worker);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
        this._records.clear();
    },
};
