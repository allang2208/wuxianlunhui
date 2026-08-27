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
import { routeBakeryPlantTributes } from './bakery-tribute-routing.js';
import {
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function isFoodProcessor(building) {
    return building?._economyType === 'bakery'
        || building?._economyType === 'chain_restaurant';
}

function processorConfig(building) {
    return populationEconomyConfig[building?._economyType] || {};
}

function processorLabel(building) {
    return building?._economyType === 'chain_restaurant' ? '连锁餐馆' : '面包屋';
}

function processorModuleId(building, bakeryId, restaurantId) {
    return building?._economyType === 'chain_restaurant' ? restaurantId : bakeryId;
}

function structureServiceRadius(structure, configuredRadius, fallbackRadius) {
    const footprintRadius = Math.max(
        0,
        Number(structure?.radius) || 0,
        (Number(structure?.collisionWidth) || 0) / 2,
        (Number(structure?.collisionHeight) || 0) / 2
    );
    return Math.max(
        footprintRadius + 24,
        Math.max(0, Number(configuredRadius) || 0) || fallbackRadius
    );
}

function isWithinServiceRange(job, structure, radius) {
    if (!job || !structure) return false;
    return Math.hypot(
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
    return {
        phase: 'idle',
        x: Number(building?.x) || 0,
        y: Number(building?.y) || 0,
        targetWarehouseId: null,
        cargoFood: 0,
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
    const phase = [
        'idle', 'to_pickup', 'to_bakery', 'processing', 'waiting_deposit', 'to_deposit',
    ].includes(saved.phase) ? saved.phase : 'idle';
    return {
        ...base,
        phase,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : base.x,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : base.y,
        targetWarehouseId: saved.targetWarehouseId ?? null,
        cargoFood: Math.max(0, Math.floor(Number(saved.cargoFood) || 0)),
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
 * 面包屋/连锁餐馆离散生产真源。岗位只是一条挂在建筑上的经济记录，不进入
 * Game.entities、物理、战斗或独立存档；Sprite 只读取这条记录的位置和阶段。
 */
export const BakeryEconomySystem = {
    _bakeries: new Set(),

    initializeBuilding(building, saved = {}) {
        if (!isFoodProcessor(building)) return;
        const isRestaurant = building._economyType === 'chain_restaurant';
        building.modules = { ...((isRestaurant
            ? saved.chainRestaurantModules
            : saved.bakeryModules) || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        const savedUpgrade = isRestaurant ? saved.chainRestaurantUpgrade : saved.bakeryUpgrade;
        building._bakeryUpgrade = savedUpgrade ? {
            moduleId: savedUpgrade.moduleId,
            totalMs: Math.max(1, Number(savedUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(savedUpgrade.remainMs) || 0),
        } : null;
        building._bakeryJob = normalizeJob(building,
            isRestaurant ? saved.chainRestaurantJob : saved.bakeryJob);
        building._bakeryOutputRemainder = Math.max(0,
            Number(isRestaurant
                ? saved.chainRestaurantOutputRemainder
                : saved.bakeryOutputRemainder) || 0);
        building._bakeryPendingTributeIds = !isRestaurant
            && Array.isArray(saved.bakeryPendingTributeIds)
            ? saved.bakeryPendingTributeIds.filter((id) => typeof id === 'string')
            : [];
        this._bakeries.add(building);
    },

    reset() {
        this._bakeries.clear();
    },

    unregisterBuilding(building, { preserve = false } = {}) {
        this._bakeries.delete(building);
        if (preserve || !isFoodProcessor(building)) return;
        const job = building._bakeryJob;
        const recover = Math.max(0, Math.floor(Number(job?.cargoFood) || 0))
            + Math.max(0, Math.floor(Number(job?.pendingFood) || 0));
        if (recover > 0) EnergyManager.queueFoodForStorage(recover);
        if (job) {
            job.cargoFood = 0;
            job.pendingFood = 0;
        }
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
        if (!isFoodProcessor(building)) return { ok: false, reason: '该建筑不是粮食加工建筑' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._bakeryUpgrade) {
            return { ok: false, reason: `已有${processorLabel(building)}项目正在升级` };
        }
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._bakeryUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getProcessTimeMs(building) {
        return Math.max(100, moduleValue(
            building,
            processorModuleId(building, 'bakery_quick_cooking', 'restaurant_central_kitchen'),
            Number(processorConfig(building).baseProcessTimeMs) || 10000
        ));
    },

    getOutputMultiplier(building) {
        return Math.max(1, moduleValue(
            building,
            processorModuleId(building, 'bakery_gourmet', 'restaurant_signature_menu'),
            Number(processorConfig(building).baseOutputMultiplier) || 5
        ));
    },

    getInputFood(building) {
        return Math.max(1, Math.floor(moduleValue(
            building,
            processorModuleId(building, '', 'restaurant_bulk_supply'),
            Number(processorConfig(building).inputFoodPerBatch) || 50
        )));
    },

    getPlantTributeChance(building) {
        if (building?._economyType !== 'bakery') return 0;
        return clamp(moduleValue(building, 'bakery_ingredient_processing', 0.01), 0, 1);
    },

    getMoveSpeed(building) {
        const base = Math.max(1, Number(processorConfig(building).baseMoveSpeed) || 80);
        return base * Math.max(0.01, moduleValue(
            building,
            processorModuleId(building, 'bakery_quick_steps', 'restaurant_express_delivery'),
            1
        ));
    },

    getRoadState(building) {
        const warehouses = EnergyManager.getWarehouses();
        const roadInfo = BuildingRoadSystem.getBuildingRoadInfo(building);
        const warehouseSignature = warehouses.map((warehouse) => warehouse.id || `${warehouse.x},${warehouse.y}`)
            .sort().join('|');
        const signature = `${roadInfo.topologyRevision}:${roadInfo.wallRevision}:${warehouseSignature}`;
        if (building?._bakeryRoadCache?.signature === signature) return building._bakeryRoadCache;
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
            building._bakeryRoadCache = state;
            building._bakeryRoadConnected = state.roadConnected;
        }
        return state;
    },

    _selectReachableWarehouse(building, predicate) {
        return this.getRoadState(building).reachable
            .find(({ building: warehouse }) => predicate(warehouse))?.building || null;
    },

    getSnapshot(building) {
        const job = building?._bakeryJob || defaultJob(building);
        const isRestaurant = building?._economyType === 'chain_restaurant';
        const roadState = this.getRoadState(building);
        const phaseText = {
            idle: '等待仓库粮食',
            to_pickup: '前往仓库取粮',
            to_bakery: isRestaurant ? '携带食材返回餐馆' : '携带食材返回面包屋',
            processing: isRestaurant ? '中央厨房加工中' : '加工烘焙中',
            waiting_deposit: '等待仓库空位',
            to_deposit: '运送成品回仓库',
        }[job.phase] || '待命';
        const progress = job.phase === 'processing' && job.processTotalMs > 0
            ? clamp(1 - job.processRemainMs / job.processTotalMs, 0, 1)
            : (job.phaseTotalMs > 0
                ? clamp(1 - job.phaseRemainMs / job.phaseTotalMs, 0, 1)
                : 0);
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier(building?._economyType);
        const inputFood = this.getInputFood(building);
        return {
            status: roadState.roadConnected ? phaseText : '需要道路连接',
            phase: job.phase,
            progress,
            inputFood,
            processTimeMs: this.getProcessTimeMs(building),
            outputMultiplier: this.getOutputMultiplier(building),
            tavernMultiplier,
            outputFood: Math.floor(inputFood
                * this.getOutputMultiplier(building) * tavernMultiplier),
            plantTributeChance: this.getPlantTributeChance(building),
            moveSpeed: this.getMoveSpeed(building),
            cargoFood: job.cargoFood,
            pendingFood: job.pendingFood,
            completedBatches: job.completedBatches,
            pendingTributes: building?._bakeryPendingTributeIds?.length || 0,
            roadConnected: roadState.roadConnected,
            blockReason: roadState.roadConnected ? '' : 'road_disconnected',
            connectedWarehouseCount: roadState.connectedWarehouseCount,
            roadDistance: roadState.roadDistance,
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._bakeryUpgrade;
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
        building._bakeryUpgrade = null;
    },

    _flushPendingTributes(building) {
        const pending = building._bakeryPendingTributeIds || [];
        if (!pending.length) return;
        const routed = routeBakeryPlantTributes(pending);
        building._bakeryPendingTributeIds = routed.remainingIds;
    },

    _rollPlantTribute(building) {
        if (building?._economyType !== 'bakery') return;
        if (Math.random() >= this.getPlantTributeChance(building)) return;
        const ids = processorConfig(building).plantTributeItemIds || [];
        if (!ids.length) return;
        building._bakeryPendingTributeIds.push(ids[Math.floor(Math.random() * ids.length)]);
        this._flushPendingTributes(building);
    },

    _warehousePoint(warehouse) {
        return resolveCivilianVisualPosition(warehouse?.x || 0, warehouse?.y || 0, { structures: [] });
    },

    _bakeryPoint(building) {
        return resolveCivilianVisualPosition(building?.x || 0, building?.y || 0, { structures: [] });
    },

    _warehouseServiceRadius(building, warehouse) {
        return structureServiceRadius(
            warehouse,
            processorConfig(building).warehouseServiceRadius,
            180
        );
    },

    _bakeryServiceRadius(building) {
        const config = processorConfig(building);
        return structureServiceRadius(building,
            config.restaurantServiceRadius ?? config.bakeryServiceRadius, 200);
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
        const job = building?._bakeryJob;
        const network = roadState?.network;
        if (!job || !network) return null;
        const [i, j] = blockCellOf(job.x, job.y);
        const currentKey = `${i},${j}`;
        if (!network.byKey.has(currentKey)) return null;
        const destination = phase === 'to_bakery' ? building : warehouse;
        if (!destination) return null;
        return shortestRoadRoute(
            network,
            [currentKey],
            BuildingRoadSystem.getBuildingRoadAccessKeys(destination)
        );
    },

    _buildMoveRoute(building, phase, warehouse, roadState, { fromCurrent = false } = {}) {
        if (fromCurrent) {
            const currentRoute = this._routeFromCurrent(building, phase, warehouse, roadState);
            if (currentRoute?.length) return currentRoute;
        }
        const cached = roadState?.reachable
            ?.find((entry) => entry.building === warehouse)?.route;
        if (!cached?.length) return null;
        return phase === 'to_bakery' ? [...cached].reverse() : [...cached];
    },

    _beginMove(building, phase, warehouse, {
        roadState = null,
        fromCurrent = false,
    } = {}) {
        const job = building._bakeryJob;
        const currentRoadState = roadState || this.getRoadState(building);
        const route = this._buildMoveRoute(
            building,
            phase,
            warehouse,
            currentRoadState,
            { fromCurrent }
        );
        this._clearMoveRoute(job);
        const grace = Math.max(0, Number(processorConfig(building).moveGraceMs) || 5000);
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
                const node = route[index];
                const candidate = Math.hypot(node.x - job.x, node.y - job.y);
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
        job._roadRouteSignature = currentRoadState.signature;
        job._roadRoutePhase = phase;
        job._roadRouteWarehouseId = warehouse?.id ?? null;
        const duration = distance / Math.max(1, this.getMoveSpeed(building)) * 1000;
        job.phaseTotalMs = duration + grace;
        job.phaseRemainMs = duration + grace;
        return true;
    },

    _ensureMoveRoute(building, phase, warehouse, roadState) {
        const job = building?._bakeryJob;
        if (!job) return false;
        const warehouseId = warehouse?.id ?? null;
        const reusable = job._roadRoute?.length > 0
            && job._roadRouteSignature === roadState?.signature
            && job._roadRoutePhase === phase
            && (phase === 'to_bakery' || job._roadRouteWarehouseId === warehouseId);
        if (reusable) return true;
        return this._beginMove(building, phase, warehouse, {
            roadState,
            fromCurrent: true,
        });
    },

    _move(building, target, dt, { serviceStructure = null, serviceRadius = 0 } = {}) {
        const job = building._bakeryJob;
        const route = job._roadRoute || [];
        const routeIndex = Math.max(0, Math.floor(Number(job._roadRouteIndex) || 0));
        if (routeIndex >= route.length
            && isWithinServiceRange(job, serviceStructure, serviceRadius)) {
            job.phaseRemainMs = 0;
            return true;
        }
        const labor = PopulationEconomySystem.getLaborEfficiency();
        const speed = this.getMoveSpeed(building) * labor;
        const waypoint = route[routeIndex] || target;
        const dx = waypoint.x - job.x;
        const dy = waypoint.y - job.y;
        const distance = Math.hypot(dx, dy);
        const arrival = Math.max(2, Number(processorConfig(building).arrivalDistance) || 18);
        const waypointArrival = routeIndex < route.length ? Math.min(arrival, 6) : arrival;
        if (distance <= waypointArrival) {
            job.x = waypoint.x;
            job.y = waypoint.y;
            if (routeIndex < route.length) {
                const nextRouteIndex = routeIndex + 1;
                job._roadRouteIndex = nextRouteIndex;
                if (nextRouteIndex >= route.length
                    && isWithinServiceRange(job, serviceStructure, serviceRadius)) {
                    job.phaseRemainMs = 0;
                    return true;
                }
                return false;
            }
            job.phaseRemainMs = 0;
            return true;
        }
        const elapsed = Math.max(0, Number(dt) || 0) * labor;
        const step = Math.min(distance, Math.max(0, speed * elapsed / 1000));
        if (step <= 0) return false;
        const rawX = job.x + dx / distance * step;
        const rawY = job.y + dy / distance * step;
        // 面包师无视建筑与普通障碍，只保留 WallSystem 的墙/门段碰撞。
        const resolved = sweepCivilianVisualMove(job, rawX, rawY, { structures: [] });
        job.x = resolved.x;
        job.y = resolved.y;
        job.phaseRemainMs = Math.max(0, job.phaseRemainMs - elapsed);
        if (routeIndex >= route.length
            && isWithinServiceRange(job, serviceStructure, serviceRadius)) {
            job.phaseRemainMs = 0;
            return true;
        }
        if (routeIndex >= route.length
            && Math.hypot(target.x - job.x, target.y - job.y) <= arrival) return true;
        // 仍有道路航点时禁止用超时跳过路线，避免隔墙扣粮或交货；只有道路路线已经
        // 消费完、旧档脚点却未落入服务半径时，才保留原有宽限兜底。
        if (routeIndex < route.length) return false;
        return job.phaseRemainMs <= 0;
    },

    _beginPickup(building) {
        const job = building._bakeryJob;
        const input = this.getInputFood(building);
        const warehouse = this._selectReachableWarehouse(building, (entry) =>
            Math.max(0, Math.floor(Number(entry.storedFood) || 0)) >= input);
        if (!warehouse) {
            job.phase = 'idle';
            job.targetWarehouseId = null;
            this._clearMoveRoute(job);
            return;
        }
        this._beginMove(building, 'to_pickup', warehouse);
    },

    _takeInput(building, warehouse) {
        const job = building._bakeryJob;
        const input = this.getInputFood(building);
        if (!EnergyManager.deductFoodFromWarehouse(warehouse, input)) {
            job.phase = 'idle';
            job.targetWarehouseId = null;
            this._clearMoveRoute(job);
            return;
        }
        job.cargoFood = input;
        this._beginMove(building, 'to_bakery', warehouse);
    },

    _beginDeposit(building) {
        const job = building._bakeryJob;
        const warehouse = this._selectReachableWarehouse(building, (entry) =>
            EnergyManager.getWarehouseFreeCapacity(entry) >= EnergyManager.getWarehouseFoodFactor(entry));
        if (!warehouse) {
            job.phase = 'waiting_deposit';
            job.targetWarehouseId = null;
            this._clearMoveRoute(job);
            return;
        }
        this._beginMove(building, 'to_deposit', warehouse);
    },

    updateBuilding(building, dt) {
        if (!isFoodProcessor(building) || !building.active) return;
        this._updateUpgrade(building, dt);
        this._flushPendingTributes(building);
        const roadState = this.getRoadState(building);
        if (!roadState.roadConnected) return;
        if (Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)) <= 0) return;
        const job = building._bakeryJob;
        if (job.phase === 'idle') {
            this._beginPickup(building);
            return;
        }
        if (job.phase === 'to_pickup') {
            const warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            const reachable = roadState.reachable.some((entry) => entry.building === warehouse);
            if (!warehouse || !reachable) {
                const input = this.getInputFood(building);
                const replacement = this._selectReachableWarehouse(building, (entry) =>
                    Math.max(0, Math.floor(Number(entry.storedFood) || 0)) >= input);
                if (!replacement) {
                    job.phase = 'idle';
                    job.targetWarehouseId = null;
                    this._clearMoveRoute(job);
                    return;
                }
                this._beginMove(building, 'to_pickup', replacement, {
                    roadState,
                    fromCurrent: true,
                });
                return;
            }
            if (!this._ensureMoveRoute(building, 'to_pickup', warehouse, roadState)) return;
            if (this._move(building, this._warehousePoint(warehouse), dt, {
                serviceStructure: warehouse,
                serviceRadius: this._warehouseServiceRadius(building, warehouse),
            })) this._takeInput(building, warehouse);
            return;
        }
        if (job.phase === 'to_bakery') {
            const sourceWarehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!this._ensureMoveRoute(building, 'to_bakery', sourceWarehouse, roadState)) return;
            if (this._move(building, this._bakeryPoint(building), dt, {
                serviceStructure: building,
                serviceRadius: this._bakeryServiceRadius(building),
            })) {
                job.phase = 'processing';
                job.processTotalMs = this.getProcessTimeMs(building);
                const workshopMultiplier = WorkshopEconomySystem.getEfficiencyMultiplier(building);
                job.processRemainMs = Math.max(0,
                    job.processTotalMs - job.offlineProgressMs * workshopMultiplier);
                job.offlineProgressMs = 0;
                job.phaseRemainMs = 0;
                job.phaseTotalMs = 0;
                this._clearMoveRoute(job);
            }
            return;
        }
        if (job.phase === 'processing') {
            const efficiency = PopulationEconomySystem.getLaborEfficiency()
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
            job.processRemainMs -= Math.max(0, Number(dt) || 0) * efficiency;
            if (job.processRemainMs > 0) return;
            const consumedFood = Math.max(1,
                Math.floor(Number(job.cargoFood) || this.getInputFood(building)));
            const exactOutput = building._bakeryOutputRemainder
                + consumedFood
                    * this.getOutputMultiplier(building)
                    * TavernEconomySystem.getPlaneOutputMultiplier(building._economyType)
                    * getProductionResourceMul();
            job.pendingFood = Math.max(1, Math.floor(exactOutput));
            building._bakeryOutputRemainder = exactOutput - job.pendingFood;
            job.cargoFood = 0;
            this._rollPlantTribute(building);
            this._beginDeposit(building);
            return;
        }
        if (job.phase === 'waiting_deposit') {
            this._beginDeposit(building);
            return;
        }
        if (job.phase === 'to_deposit') {
            const warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            const reachable = roadState.reachable.some((entry) => entry.building === warehouse);
            if (!warehouse || !reachable) {
                const replacement = this._selectReachableWarehouse(building, (entry) =>
                    EnergyManager.getWarehouseFreeCapacity(entry)
                        >= EnergyManager.getWarehouseFoodFactor(entry));
                if (!replacement) {
                    job.phase = 'waiting_deposit';
                    job.targetWarehouseId = null;
                    this._clearMoveRoute(job);
                    return;
                }
                this._beginMove(building, 'to_deposit', replacement, {
                    roadState,
                    fromCurrent: true,
                });
                return;
            }
            if (!this._ensureMoveRoute(building, 'to_deposit', warehouse, roadState)) return;
            if (!this._move(building, this._warehousePoint(warehouse), dt, {
                serviceStructure: warehouse,
                serviceRadius: this._warehouseServiceRadius(building, warehouse),
            })) return;
            const stored = EnergyManager.depositFoodToWarehouse(warehouse, job.pendingFood);
            job.pendingFood = Math.max(0, job.pendingFood - stored);
            if (job.pendingFood > 0) {
                job.phase = 'waiting_deposit';
                job.targetWarehouseId = null;
                this._clearMoveRoute(job);
                return;
            }
            job.completedBatches++;
            job.phase = 'idle';
            job.targetWarehouseId = null;
            job.phaseRemainMs = 0;
            job.phaseTotalMs = 0;
            this._clearMoveRoute(job);
        }
    },
};
