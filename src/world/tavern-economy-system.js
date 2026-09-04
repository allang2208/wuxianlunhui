import populationEconomyConfig from '../../data/population-economy.json';
import { EnergyManager } from '../systems/energy-manager.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { blockCellOf } from './gate4-grid.js';
import { shortestRoadRoute } from './road-connectivity.js';
import {
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const TARGET_ECONOMY_TYPES = new Set([
    'windmill', 'bakery', 'desert_cookhouse', 'frost_smokehouse', 'chain_restaurant', 'cheese_farm',
    'miner_camp', 'deep_drill', 'steam_power_plant', 'oil_power_plant', 'wind_power_plant', 'solar_power_plant', 'planar_resonator',
    'cannery', 'trading_company',
    'bank', 'royal_mint', 'grand_mall',
    'research', 'weather_forecast', 'advanced_research',
]);

function tavernConfig() {
    return populationEconomyConfig.tavern || {};
}

function moduleValue(building, moduleId, fallback = 0) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return fallback;
    const level = clamp(Math.floor(Number(building?.modules?.[moduleId]) || 0), 0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0)));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function serviceRadius(structure, configured, fallback) {
    const footprint = Math.max(0, Number(structure?.radius) || 0,
        (Number(structure?.collisionWidth) || 0) / 2,
        (Number(structure?.collisionHeight) || 0) / 2);
    return Math.max(footprint + 24, Math.max(0, Number(configured) || 0) || fallback);
}

function withinServiceRange(job, structure, radius) {
    return !!job && !!structure && Math.hypot(
        (Number(job.x) || 0) - (Number(structure.x) || 0),
        (Number(job.y) || 0) - (Number(structure.y) || 0)
    ) <= radius;
}

function defaultJob(building) {
    return {
        phase: 'idle',
        x: Number(building?.x) || 0,
        y: Number(building?.y) || 0,
        targetWarehouseId: null,
        cargoFood: 0,
        serviceRemainMs: 0,
        serviceTotalMs: 0,
        phaseRemainMs: 0,
        phaseTotalMs: 0,
        completedBatches: 0,
    };
}

function normalizeJob(building, saved) {
    const base = defaultJob(building);
    if (!saved || typeof saved !== 'object') return base;
    const phase = ['idle', 'to_pickup', 'to_tavern', 'serving'].includes(saved.phase)
        ? saved.phase : 'idle';
    return {
        ...base,
        phase,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : base.x,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : base.y,
        targetWarehouseId: saved.targetWarehouseId ?? null,
        cargoFood: Math.max(0, Math.floor(Number(saved.cargoFood) || 0)),
        serviceRemainMs: Math.max(0, Number(saved.serviceRemainMs) || 0),
        serviceTotalMs: Math.max(0, Number(saved.serviceTotalMs) || 0),
        phaseRemainMs: Math.max(0, Number(saved.phaseRemainMs) || 0),
        phaseTotalMs: Math.max(0, Number(saved.phaseTotalMs) || 0),
        completedBatches: Math.max(0, Math.floor(Number(saved.completedBatches) || 0)),
    };
}

/**
 * 酒馆经济真源。酒保任务是纯数据状态机；Sprite 只投影任务，不进入实体、物理、
 * 战斗、通用 AI 或独立存档。全位面增效只在 serving 阶段按最强有效酒馆取值。
 */
export const TavernEconomySystem = {
    _taverns: new Set(),

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'tavern') return;
        building.modules = { ...(saved.tavernModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0), 0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._tavernUpgrade = saved.tavernUpgrade ? {
            moduleId: saved.tavernUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.tavernUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.tavernUpgrade.remainMs) || 0),
        } : null;
        building._tavernJob = normalizeJob(building, saved.tavernJob);
        this._taverns.add(building);
    },

    reset() {
        this._taverns.clear();
    },

    unregisterBuilding(building) {
        this._taverns.delete(building);
        if (building?._economyType !== 'tavern') return;
        // 已从仓库取出的粮食不会因出售或摧毁返还。
        if (building._tavernJob) {
            building._tavernJob.cargoFood = 0;
            building._tavernJob.serviceRemainMs = 0;
            building._tavernJob.phase = 'idle';
            this._clearRoute(building._tavernJob);
        }
        building._economyWorking = false;
    },

    getModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getModuleLevel(building, moduleId)
        );
    },

    startUpgrade(building, moduleId) {
        if (building?._economyType !== 'tavern') return { ok: false, reason: '该建筑不是酒馆' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知酒馆升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (Number(module.maxLevel) || 0)) return { ok: false, reason: '酒馆升级项目已满级' };
        if (building._tavernUpgrade) return { ok: false, reason: '已有酒馆项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._tavernUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getConfiguredBonus(building) {
        return Math.max(0, moduleValue(building, 'tavern_feast_sign',
            Number(tavernConfig().baseOutputBonus) || 0.12));
    },

    getConfiguredMultiplier(building) {
        return 1 + this.getConfiguredBonus(building);
    },

    getFoodPerBatch(building) {
        return Math.max(1, Math.floor(moduleValue(building, 'tavern_cellar_rations',
            Number(tavernConfig().inputFoodPerBatch) || 120)));
    },

    getServiceTimeMs(building) {
        return Math.max(100, moduleValue(building, 'tavern_long_table',
            Number(tavernConfig().baseServiceTimeMs) || 60000));
    },

    getMoveSpeed(building) {
        const base = Math.max(1, Number(tavernConfig().baseMoveSpeed) || 80);
        return base * Math.max(0.01, moduleValue(building, 'tavern_bartender_steps', 1));
    },

    isServing(building) {
        return !!building?.active
            && Number(building?.hp ?? 1) > 0
            && Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)) > 0
            && building?._tavernJob?.phase === 'serving'
            && Number(building._tavernJob.serviceRemainMs) > 0;
    },

    getPlaneOutputMultiplier(economyType) {
        if (!TARGET_ECONOMY_TYPES.has(economyType)) return 1;
        let strongest = 0;
        for (const tavern of this._taverns) {
            if (!this.isServing(tavern)) continue;
            strongest = Math.max(strongest, this.getConfiguredBonus(tavern));
        }
        return 1 + strongest;
    },

    getRoadState(building) {
        const warehouses = EnergyManager.getWarehouses();
        const roadInfo = BuildingRoadSystem.getBuildingRoadInfo(building);
        const warehouseSignature = warehouses.map((warehouse) =>
            warehouse.id || `${warehouse.x},${warehouse.y}`).sort().join('|');
        const signature = `${roadInfo.topologyRevision}:${roadInfo.wallRevision}:${warehouseSignature}`;
        if (building?._tavernRoadCache?.signature === signature) return building._tavernRoadCache;
        const reachable = roadInfo.connected
            ? BuildingRoadSystem.getReachableBuildings(building, warehouses)
            : [];
        const state = {
            signature,
            roadConnected: reachable.length > 0,
            connectedWarehouseCount: reachable.length,
            roadDistance: reachable[0]?.distance ?? null,
            reachable,
            network: roadInfo.network,
        };
        if (building) building._tavernRoadCache = state;
        return state;
    },

    _selectWarehouse(building, predicate) {
        return this.getRoadState(building).reachable
            .find(({ building: warehouse }) => predicate(warehouse))?.building || null;
    },

    getSnapshot(building) {
        const job = building?._tavernJob || defaultJob(building);
        const assigned = Math.min(1,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)));
        const roadState = this.getRoadState(building);
        const serving = this.isServing(building);
        let blockReason = '';
        if (assigned <= 0) blockReason = 'unstaffed';
        else if (!roadState.roadConnected && !serving) blockReason = 'road_disconnected';
        else if (job.phase === 'idle') blockReason = 'food_shortage';
        const status = {
            unstaffed: '等待酒保上岗',
            road_disconnected: '需要道路连接仓库',
            food_shortage: '等待仓库食物',
        }[blockReason] || (serving ? '宴饮服务中' : '酒保运输中');
        const progress = serving && job.serviceTotalMs > 0
            ? clamp(1 - job.serviceRemainMs / job.serviceTotalMs, 0, 1)
            : (job.phaseTotalMs > 0
                ? clamp(1 - job.phaseRemainMs / job.phaseTotalMs, 0, 1) : 0);
        return {
            status,
            blockReason,
            roadConnected: roadState.roadConnected,
            connectedWarehouseCount: roadState.connectedWarehouseCount,
            roadDistance: roadState.roadDistance,
            assignedWorkers: assigned,
            workerSlots: 1,
            phase: job.phase,
            serving,
            progress,
            cargoFood: job.cargoFood,
            inputFood: this.getFoodPerBatch(building),
            configuredMultiplier: this.getConfiguredMultiplier(building),
            actualMultiplier: serving ? this.getConfiguredMultiplier(building) : 1,
            serviceTimeMs: this.getServiceTimeMs(building),
            serviceRemainMs: serving ? job.serviceRemainMs : 0,
            moveSpeed: this.getMoveSpeed(building),
            completedBatches: job.completedBatches,
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._tavernUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getModuleLevel(building, upgrade.moduleId) + 1, 0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._tavernUpgrade = null;
    },

    _clearRoute(job) {
        job._roadRoute = null;
        job._roadRouteIndex = 0;
        job._roadRouteSignature = null;
        job._roadRoutePhase = null;
        job._roadRouteWarehouseId = null;
    },

    _routeFromCurrent(job, building, phase, warehouse, roadState) {
        const network = roadState?.network;
        if (!network) return null;
        const [i, j] = blockCellOf(job.x, job.y);
        const currentKey = `${i},${j}`;
        if (!network.byKey.has(currentKey)) return null;
        const destination = phase === 'to_tavern' ? building : warehouse;
        return destination ? shortestRoadRoute(
            network,
            [currentKey],
            BuildingRoadSystem.getBuildingRoadAccessKeys(destination)
        ) : null;
    },

    _buildRoute(job, building, phase, warehouse, roadState, fromCurrent) {
        if (fromCurrent) {
            const route = this._routeFromCurrent(job, building, phase, warehouse, roadState);
            if (route?.length) return route;
        }
        const cached = roadState?.reachable?.find((entry) => entry.building === warehouse)?.route;
        if (!cached?.length) return null;
        return phase === 'to_tavern' ? [...cached].reverse() : [...cached];
    },

    _beginMove(job, building, phase, warehouse, roadState = null, fromCurrent = false) {
        const currentRoadState = roadState || this.getRoadState(building);
        const route = this._buildRoute(job, building, phase, warehouse, currentRoadState, fromCurrent);
        this._clearRoute(job);
        job.phase = phase;
        job.targetWarehouseId = warehouse?.id ?? job.targetWarehouseId;
        if (!route?.length) {
            job.phaseTotalMs = 0;
            job.phaseRemainMs = 0;
            return false;
        }
        let routeIndex = 0;
        if (!fromCurrent && route.length > 1) {
            let bestDistance = Number.POSITIVE_INFINITY;
            route.forEach((node, index) => {
                const distance = Math.hypot(node.x - job.x, node.y - job.y);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    routeIndex = index;
                }
            });
        }
        let distance = 0;
        let previousX = job.x;
        let previousY = job.y;
        for (let index = routeIndex; index < route.length; index++) {
            distance += Math.hypot(route[index].x - previousX, route[index].y - previousY);
            previousX = route[index].x;
            previousY = route[index].y;
        }
        const grace = Math.max(0, Number(tavernConfig().moveGraceMs) || 5000);
        const duration = distance / Math.max(1, this.getMoveSpeed(building)) * 1000;
        job._roadRoute = route;
        job._roadRouteIndex = routeIndex;
        job._roadRouteSignature = currentRoadState.signature;
        job._roadRoutePhase = phase;
        job._roadRouteWarehouseId = warehouse?.id ?? null;
        job.phaseTotalMs = duration + grace;
        job.phaseRemainMs = duration + grace;
        return true;
    },

    _ensureRoute(job, building, phase, warehouse, roadState) {
        const warehouseId = warehouse?.id ?? null;
        if (job._roadRoute?.length > 0
            && job._roadRouteSignature === roadState?.signature
            && job._roadRoutePhase === phase
            && (phase === 'to_tavern' || job._roadRouteWarehouseId === warehouseId)) return true;
        return this._beginMove(job, building, phase, warehouse, roadState, true);
    },

    _move(job, building, target, dt, serviceStructure, radius, laborEfficiency) {
        const route = job._roadRoute || [];
        const index = Math.max(0, Math.floor(Number(job._roadRouteIndex) || 0));
        if (index >= route.length && withinServiceRange(job, serviceStructure, radius)) return true;
        const labor = Math.max(0, Number(laborEfficiency) || 0);
        const speed = this.getMoveSpeed(building) * labor;
        const waypoint = route[index] || target;
        const dx = waypoint.x - job.x;
        const dy = waypoint.y - job.y;
        const distance = Math.hypot(dx, dy);
        const arrival = Math.max(2, Number(tavernConfig().arrivalDistance) || 40);
        const waypointArrival = index < route.length ? Math.min(arrival, 6) : arrival;
        if (distance <= waypointArrival) {
            job.x = waypoint.x;
            job.y = waypoint.y;
            if (index < route.length) {
                job._roadRouteIndex = index + 1;
                return job._roadRouteIndex >= route.length
                    && withinServiceRange(job, serviceStructure, radius);
            }
            return true;
        }
        const elapsed = Math.max(0, Number(dt) || 0) * labor;
        const step = Math.min(distance, Math.max(0, speed * Math.max(0, Number(dt) || 0) / 1000));
        if (step <= 0) return false;
        const resolved = sweepCivilianVisualMove(job,
            job.x + dx / distance * step,
            job.y + dy / distance * step,
            { structures: [] });
        job.x = resolved.x;
        job.y = resolved.y;
        job.phaseRemainMs = Math.max(0, job.phaseRemainMs - elapsed);
        if (index >= route.length && withinServiceRange(job, serviceStructure, radius)) return true;
        if (index < route.length) return false;
        return Math.hypot(target.x - job.x, target.y - job.y) <= arrival
            || job.phaseRemainMs <= 0;
    },

    _warehousePoint(warehouse) {
        return resolveCivilianVisualPosition(warehouse?.x || 0, warehouse?.y || 0, { structures: [] });
    },

    _tavernPoint(building) {
        return resolveCivilianVisualPosition(building?.x || 0, building?.y || 0, { structures: [] });
    },

    _beginPickup(job, building) {
        const input = this.getFoodPerBatch(building);
        const warehouse = this._selectWarehouse(building, (entry) =>
            Math.max(0, Math.floor(Number(entry.storedFood) || 0)) >= input);
        if (!warehouse) {
            job.phase = 'idle';
            job.targetWarehouseId = null;
            this._clearRoute(job);
            return;
        }
        this._beginMove(job, building, 'to_pickup', warehouse);
    },

    _updateJob(job, building, dt, roadState, laborEfficiency) {
        if (job.phase === 'serving') {
            job.serviceRemainMs -= Math.max(0, Number(dt) || 0);
            if (job.serviceRemainMs > 0) return;
            job.serviceRemainMs = 0;
            job.serviceTotalMs = 0;
            job.completedBatches++;
            job.phase = 'idle';
            job.targetWarehouseId = null;
            return;
        }
        if (!roadState.roadConnected) return;
        if (job.phase === 'idle') {
            this._beginPickup(job, building);
            return;
        }
        if (job.phase === 'to_pickup') {
            let warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!warehouse || !roadState.reachable.some((entry) => entry.building === warehouse)) {
                warehouse = this._selectWarehouse(building, (entry) =>
                    Math.max(0, Math.floor(Number(entry.storedFood) || 0))
                        >= this.getFoodPerBatch(building));
                if (!warehouse) return;
                this._beginMove(job, building, 'to_pickup', warehouse, roadState, true);
                return;
            }
            if (!this._ensureRoute(job, building, 'to_pickup', warehouse, roadState)) return;
            if (!this._move(job, building, this._warehousePoint(warehouse), dt, warehouse,
                serviceRadius(warehouse, tavernConfig().warehouseServiceRadius, 180),
                laborEfficiency)) return;
            const input = this.getFoodPerBatch(building);
            if (!EnergyManager.deductFoodFromWarehouse(warehouse, input)) {
                job.phase = 'idle';
                job.targetWarehouseId = null;
                this._clearRoute(job);
                return;
            }
            job.cargoFood = input;
            this._beginMove(job, building, 'to_tavern', warehouse);
            return;
        }
        if (job.phase !== 'to_tavern') return;
        const source = EnergyManager.getWarehouseById(job.targetWarehouseId);
        if (!this._ensureRoute(job, building, 'to_tavern', source, roadState)) return;
        if (!this._move(job, building, this._tavernPoint(building), dt, building,
            serviceRadius(building, tavernConfig().tavernServiceRadius, 200),
            laborEfficiency)) return;
        const point = this._tavernPoint(building);
        job.x = point.x;
        job.y = point.y;
        job.cargoFood = 0;
        job.phase = 'serving';
        job.serviceTotalMs = this.getServiceTimeMs(building);
        job.serviceRemainMs = job.serviceTotalMs;
        job.phaseRemainMs = 0;
        job.phaseTotalMs = 0;
        this._clearRoute(job);
    },

    updateBuilding(building, dt, laborEfficiency = 1) {
        if (building?._economyType !== 'tavern' || !building.active) return;
        this._updateUpgrade(building, dt);
        const assigned = Math.min(1,
            Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)));
        if (assigned <= 0) {
            building._economyWorking = false;
            return;
        }
        const roadState = this.getRoadState(building);
        this._updateJob(building._tavernJob, building, dt, roadState, laborEfficiency);
        building._economyWorking = this.isServing(building);
    },
};
