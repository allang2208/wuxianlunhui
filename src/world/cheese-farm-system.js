import populationEconomyConfig from '../../data/population-economy.json';
import { EnergyManager } from '../systems/energy-manager.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { TavernEconomySystem } from './tavern-economy-system.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { blockCellOf } from './gate4-grid.js';
import { shortestRoadRoute } from './road-connectivity.js';
import { resolveCivilianVisualPosition, sweepCivilianVisualMove } from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function farmConfig() {
    return populationEconomyConfig.cheese_farm || {};
}

function farmWorkerPoint(building) {
    const cfg = farmConfig();
    const source = cfg.cowVisual?.sourceCanvas || {};
    const point = Array.isArray(cfg.workerServicePoint) ? cfg.workerServicePoint : null;
    if (!point || !Number(source.width) || !Number(source.height)) {
        return { x: Number(building?.x) || 0, y: Number(building?.y) || 0 };
    }
    const displayW = Math.max(1, Number(building?._cfg?.displayW) || 512);
    const displayH = Math.max(1, Number(building?._cfg?.displayH) || 293);
    const spriteCenterY = (Number(building?.y) || 0)
        - (Number(building?._cfg?.footOffsetY) || 0);
    return {
        x: (Number(building?.x) || 0) + (Number(point[0]) / Number(source.width) - 0.5) * displayW,
        y: spriteCenterY + (Number(point[1]) / Number(source.height) - 0.5) * displayH,
    };
}

function structureServiceRadius(structure, configuredRadius, fallbackRadius) {
    const footprintRadius = Math.max(
        0,
        Number(structure?.radius) || 0,
        (Number(structure?.collisionWidth) || 0) / 2,
        (Number(structure?.collisionHeight) || 0) / 2
    );
    return Math.max(footprintRadius + 24, Math.max(0, Number(configuredRadius) || 0) || fallbackRadius);
}

function isWithinServiceRange(job, structure, radius) {
    return !!job && !!structure && Math.hypot(
        (Number(job.x) || 0) - (Number(structure.x) || 0),
        (Number(job.y) || 0) - (Number(structure.y) || 0)
    ) <= radius;
}

function moduleValue(building, moduleId, fallback = 0) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return fallback;
    const level = clamp(
        Math.floor(Number(building?.modules?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
    );
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function defaultJob(building) {
    const point = farmWorkerPoint(building);
    return {
        phase: 'processing',
        x: point.x,
        y: point.y,
        targetWarehouseId: null,
        pendingFood: 0,
        processRemainMs: 0,
        processTotalMs: 0,
        phaseRemainMs: 0,
        phaseTotalMs: 0,
        completedBatches: 0,
        offlineProgressMs: 0,
    };
}

function normalizeJob(building, saved) {
    const base = defaultJob(building);
    if (!saved || typeof saved !== 'object') return base;
    const phase = ['processing', 'waiting_deposit', 'to_deposit', 'to_farm']
        .includes(saved.phase) ? saved.phase : 'processing';
    return {
        ...base,
        phase,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : base.x,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : base.y,
        targetWarehouseId: saved.targetWarehouseId ?? null,
        pendingFood: Math.max(0, Math.floor(Number(saved.pendingFood) || 0)),
        processRemainMs: Math.max(0, Number(saved.processRemainMs) || 0),
        processTotalMs: Math.max(0, Number(saved.processTotalMs) || 0),
        phaseRemainMs: Math.max(0, Number(saved.phaseRemainMs) || 0),
        phaseTotalMs: Math.max(0, Number(saved.phaseTotalMs) || 0),
        completedBatches: Math.max(0, Math.floor(Number(saved.completedBatches) || 0)),
        offlineProgressMs: Math.max(0, Number(saved.offlineProgressMs) || 0),
    };
}

/**
 * 奶酪农场的唯一经济真源。牛倌与奶牛均为纯视觉投影，不进入战斗、物理或实体存档。
 */
export const CheeseFarmSystem = {
    _farms: new Set(),

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'cheese_farm') return;
        building.modules = { ...(saved.cheeseFarmModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._cheeseFarmUpgrade = saved.cheeseFarmUpgrade ? {
            moduleId: saved.cheeseFarmUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.cheeseFarmUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.cheeseFarmUpgrade.remainMs) || 0),
        } : null;
        building._cheeseFarmJob = normalizeJob(building, saved.cheeseFarmJob);
        building._cheeseFarmOutputRemainder = Math.max(0,
            Number(saved.cheeseFarmOutputRemainder) || 0);
        this._farms.add(building);
    },

    reset() {
        this._farms.clear();
    },

    unregisterBuilding(building, { preserve = false } = {}) {
        this._farms.delete(building);
        if (preserve || building?._economyType !== 'cheese_farm') return;
        const pending = Math.max(0, Math.floor(Number(building._cheeseFarmJob?.pendingFood) || 0));
        if (pending > 0) EnergyManager.queueFoodForStorage(pending);
        if (building._cheeseFarmJob) building._cheeseFarmJob.pendingFood = 0;
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
        if (building?._economyType !== 'cheese_farm') {
            return { ok: false, reason: '该建筑不是奶酪农场' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._cheeseFarmUpgrade) return { ok: false, reason: '已有奶酪农场项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._cheeseFarmUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getProcessTimeMs(building) {
        return Math.max(1000, moduleValue(
            building,
            'cheese_maturation',
            Number(farmConfig().baseProcessTimeMs) || 20000
        ));
    },

    getFoodPerBatch(building) {
        return Math.max(1, moduleValue(
            building,
            'cheese_breed_selection',
            Number(farmConfig().baseFoodPerBatch) || 40
        ));
    },

    getCowCount(building) {
        return Math.max(1, Math.floor(moduleValue(
            building,
            'cheese_pasture_expansion',
            Number(farmConfig().baseCowCount) || 2
        )));
    },

    getMoveSpeed(building) {
        const base = Math.max(1, Number(farmConfig().baseMoveSpeed) || 80);
        return base * Math.max(0.01, moduleValue(building, 'cheese_delivery_cart', 1));
    },

    getRoadState(building) {
        const warehouses = EnergyManager.getWarehouses();
        const roadInfo = BuildingRoadSystem.getBuildingRoadInfo(building);
        const warehouseSignature = warehouses.map((warehouse) => warehouse.id || `${warehouse.x},${warehouse.y}`)
            .sort().join('|');
        const signature = `${roadInfo.topologyRevision}:${roadInfo.wallRevision}:${warehouseSignature}`;
        if (building?._cheeseFarmRoadCache?.signature === signature) return building._cheeseFarmRoadCache;
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
        if (building) {
            building._cheeseFarmRoadCache = state;
            building._cheeseFarmRoadConnected = state.roadConnected;
        }
        return state;
    },

    getSnapshot(building) {
        const job = building?._cheeseFarmJob || defaultJob(building);
        const roadState = this.getRoadState(building);
        const phaseText = {
            processing: '奶酪熟成中',
            waiting_deposit: '等待仓库空位',
            to_deposit: '抱着奶酪前往仓库',
            to_farm: '空手返回牧场',
        }[job.phase] || '待命';
        const progress = job.phase === 'processing' && job.processTotalMs > 0
            ? clamp(1 - job.processRemainMs / job.processTotalMs, 0, 1)
            : (job.phaseTotalMs > 0 ? clamp(1 - job.phaseRemainMs / job.phaseTotalMs, 0, 1) : 0);
        const cowCount = this.getCowCount(building);
        const baseCowCount = Math.max(1, Number(farmConfig().baseCowCount) || 2);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('cheese_farm');
        return {
            status: roadState.roadConnected ? phaseText : '需要道路连接',
            phase: job.phase,
            progress,
            processTimeMs: this.getProcessTimeMs(building),
            foodPerBatch: this.getFoodPerBatch(building),
            outputFood: Math.floor(this.getFoodPerBatch(building) * cowCount / baseCowCount
                * tavernMultiplier),
            cowCount,
            moveSpeed: this.getMoveSpeed(building),
            pendingFood: job.pendingFood,
            completedBatches: job.completedBatches,
            roadConnected: roadState.roadConnected,
            connectedWarehouseCount: roadState.connectedWarehouseCount,
            roadDistance: roadState.roadDistance,
            blockReason: roadState.roadConnected ? '' : 'road_disconnected',
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._cheeseFarmUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._cheeseFarmUpgrade = null;
    },

    _selectWarehouse(building) {
        return this.getRoadState(building).reachable.find(({ building: warehouse }) =>
            EnergyManager.getWarehouseFreeCapacity(warehouse)
                >= EnergyManager.getWarehouseFoodFactor(warehouse))?.building || null;
    },

    _warehousePoint(warehouse) {
        return resolveCivilianVisualPosition(warehouse?.x || 0, warehouse?.y || 0, { structures: [] });
    },

    _farmPoint(building) {
        const point = farmWorkerPoint(building);
        return resolveCivilianVisualPosition(point.x, point.y, { structures: [] });
    },

    _clearMoveRoute(job) {
        if (!job) return;
        job._roadRoute = null;
        job._roadRouteIndex = 0;
        job._roadRouteSignature = null;
        job._roadRoutePhase = null;
        job._roadRouteWarehouseId = null;
    },

    _routeFromCurrent(building, phase, warehouse, roadState) {
        const job = building?._cheeseFarmJob;
        const network = roadState?.network;
        if (!job || !network) return null;
        const [i, j] = blockCellOf(job.x, job.y);
        const currentKey = `${i},${j}`;
        if (!network.byKey.has(currentKey)) return null;
        const destination = phase === 'to_farm' ? building : warehouse;
        if (!destination) return null;
        return shortestRoadRoute(network, [currentKey], BuildingRoadSystem.getBuildingRoadAccessKeys(destination));
    },

    _buildMoveRoute(building, phase, warehouse, roadState, { fromCurrent = false } = {}) {
        if (fromCurrent) {
            const currentRoute = this._routeFromCurrent(building, phase, warehouse, roadState);
            if (currentRoute?.length) return currentRoute;
        }
        const cached = roadState?.reachable?.find((entry) => entry.building === warehouse)?.route;
        if (!cached?.length) return null;
        return phase === 'to_farm' ? [...cached].reverse() : [...cached];
    },

    _beginMove(building, phase, warehouse, roadState = this.getRoadState(building), fromCurrent = false) {
        const job = building._cheeseFarmJob;
        const route = this._buildMoveRoute(building, phase, warehouse, roadState, { fromCurrent });
        this._clearMoveRoute(job);
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
            for (let index = 0; index < route.length; index++) {
                const candidate = Math.hypot(route[index].x - job.x, route[index].y - job.y);
                if (candidate < bestDistance) {
                    bestDistance = candidate;
                    routeIndex = index;
                }
            }
        }
        let distance = 0;
        let previousX = job.x;
        let previousY = job.y;
        for (let index = routeIndex; index < route.length; index++) {
            distance += Math.hypot(route[index].x - previousX, route[index].y - previousY);
            previousX = route[index].x;
            previousY = route[index].y;
        }
        job._roadRoute = route;
        job._roadRouteIndex = routeIndex;
        job._roadRouteSignature = roadState.signature;
        job._roadRoutePhase = phase;
        job._roadRouteWarehouseId = warehouse?.id ?? null;
        const duration = distance / Math.max(1, this.getMoveSpeed(building)) * 1000;
        const grace = Math.max(0, Number(farmConfig().moveGraceMs) || 5000);
        job.phaseTotalMs = duration + grace;
        job.phaseRemainMs = duration + grace;
        return true;
    },

    _ensureMoveRoute(building, phase, warehouse, roadState) {
        const job = building?._cheeseFarmJob;
        if (!job) return false;
        const reusable = job._roadRoute?.length > 0
            && job._roadRouteSignature === roadState?.signature
            && job._roadRoutePhase === phase
            && (phase === 'to_farm' || job._roadRouteWarehouseId === (warehouse?.id ?? null));
        return reusable || this._beginMove(building, phase, warehouse, roadState, true);
    },

    _move(building, target, dt, serviceStructure, serviceRadius) {
        const job = building._cheeseFarmJob;
        const route = job._roadRoute || [];
        const routeIndex = Math.max(0, Math.floor(Number(job._roadRouteIndex) || 0));
        if (routeIndex >= route.length && isWithinServiceRange(job, serviceStructure, serviceRadius)) {
            job.phaseRemainMs = 0;
            return true;
        }
        const labor = PopulationEconomySystem.getLaborEfficiency();
        const speed = this.getMoveSpeed(building) * labor;
        const waypoint = route[routeIndex] || target;
        const dx = waypoint.x - job.x;
        const dy = waypoint.y - job.y;
        const distance = Math.hypot(dx, dy);
        const arrival = Math.max(2, Number(farmConfig().arrivalDistance) || 18);
        const waypointArrival = routeIndex < route.length ? Math.min(arrival, 6) : arrival;
        if (distance <= waypointArrival) {
            job.x = waypoint.x;
            job.y = waypoint.y;
            if (routeIndex < route.length) {
                job._roadRouteIndex = routeIndex + 1;
                return routeIndex + 1 >= route.length
                    && isWithinServiceRange(job, serviceStructure, serviceRadius);
            }
            return true;
        }
        const elapsed = Math.max(0, Number(dt) || 0) * labor;
        const step = Math.min(distance, Math.max(0, speed * elapsed / 1000));
        if (step <= 0) return false;
        const resolved = sweepCivilianVisualMove(
            job,
            job.x + dx / distance * step,
            job.y + dy / distance * step,
            { structures: [] }
        );
        job.x = resolved.x;
        job.y = resolved.y;
        job.phaseRemainMs = Math.max(0, job.phaseRemainMs - elapsed);
        if (routeIndex < route.length) return false;
        return isWithinServiceRange(job, serviceStructure, serviceRadius) || job.phaseRemainMs <= 0;
    },

    _beginProcessing(building) {
        const job = building._cheeseFarmJob;
        const point = farmWorkerPoint(building);
        job.phase = 'processing';
        job.x = point.x;
        job.y = point.y;
        job.targetWarehouseId = null;
        job.processTotalMs = this.getProcessTimeMs(building);
        job.processRemainMs = Math.max(0, job.processTotalMs - job.offlineProgressMs
            * WorkshopEconomySystem.getEfficiencyMultiplier(building));
        job.offlineProgressMs = 0;
        job.phaseRemainMs = 0;
        job.phaseTotalMs = 0;
        this._clearMoveRoute(job);
    },

    _beginDeposit(building) {
        const job = building._cheeseFarmJob;
        const warehouse = this._selectWarehouse(building);
        if (!warehouse) {
            job.phase = 'waiting_deposit';
            job.targetWarehouseId = null;
            this._clearMoveRoute(job);
            return;
        }
        this._beginMove(building, 'to_deposit', warehouse);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'cheese_farm' || !building.active) return;
        this._updateUpgrade(building, dt);
        const roadState = this.getRoadState(building);
        if (!roadState.roadConnected) return;
        if (Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)) <= 0) return;
        const job = building._cheeseFarmJob;
        if (job.phase === 'processing') {
            if (job.processTotalMs <= 0) this._beginProcessing(building);
            const efficiency = PopulationEconomySystem.getLaborEfficiency()
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
            job.processRemainMs -= Math.max(0, Number(dt) || 0) * efficiency;
            if (job.processRemainMs > 0) return;
            const baseCowCount = Math.max(1, Number(farmConfig().baseCowCount) || 2);
            const exactOutput = building._cheeseFarmOutputRemainder
                + this.getFoodPerBatch(building) * this.getCowCount(building) / baseCowCount
                    * TavernEconomySystem.getPlaneOutputMultiplier('cheese_farm')
                    * getProductionResourceMul();
            job.pendingFood = Math.max(1, Math.floor(exactOutput));
            building._cheeseFarmOutputRemainder = exactOutput - job.pendingFood;
            this._beginDeposit(building);
            return;
        }
        if (job.phase === 'waiting_deposit') {
            this._beginDeposit(building);
            return;
        }
        if (job.phase === 'to_deposit') {
            let warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!warehouse || !roadState.reachable.some((entry) => entry.building === warehouse)) {
                warehouse = this._selectWarehouse(building);
                if (!warehouse) {
                    job.phase = 'waiting_deposit';
                    job.targetWarehouseId = null;
                    this._clearMoveRoute(job);
                    return;
                }
                this._beginMove(building, 'to_deposit', warehouse, roadState, true);
                return;
            }
            if (!this._ensureMoveRoute(building, 'to_deposit', warehouse, roadState)) return;
            if (!this._move(building, this._warehousePoint(warehouse), dt, warehouse,
                structureServiceRadius(warehouse, farmConfig().warehouseServiceRadius, 180))) return;
            const stored = EnergyManager.depositFoodToWarehouse(warehouse, job.pendingFood);
            job.pendingFood = Math.max(0, job.pendingFood - stored);
            if (job.pendingFood > 0) {
                job.phase = 'waiting_deposit';
                job.targetWarehouseId = null;
                this._clearMoveRoute(job);
                return;
            }
            job.completedBatches++;
            this._beginMove(building, 'to_farm', warehouse, roadState);
            return;
        }
        if (job.phase === 'to_farm') {
            const warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!this._ensureMoveRoute(building, 'to_farm', warehouse, roadState)) return;
            if (this._move(building, this._farmPoint(building), dt, building,
                structureServiceRadius(building, farmConfig().farmServiceRadius, 280))) {
                this._beginProcessing(building);
            }
        }
    },
};
