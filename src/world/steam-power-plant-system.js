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
import { sweepCivilianVisualMove } from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function steamConfig() {
    return populationEconomyConfig.steam_power_plant || {};
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

function defaultJob(building, slot = 0) {
    return {
        slot,
        phase: 'idle',
        x: (Number(building?.x) || 0) + (slot === 0 ? -12 : 12),
        y: Number(building?.y) || 0,
        targetWarehouseId: null,
        cargoFood: 0,
        pendingEnergy: 0,
        processRemainMs: 0,
        processTotalMs: 0,
        phaseRemainMs: 0,
        phaseTotalMs: 0,
        completedBatches: 0,
        offlineProgressMs: 0,
    };
}

function normalizeJob(building, saved, slot) {
    const base = defaultJob(building, slot);
    if (!saved || typeof saved !== 'object') return base;
    const phase = [
        'idle', 'to_pickup', 'to_plant', 'processing', 'waiting_deposit', 'to_deposit',
    ].includes(saved.phase) ? saved.phase : 'idle';
    return {
        ...base,
        phase,
        x: Number.isFinite(Number(saved.x)) ? Number(saved.x) : base.x,
        y: Number.isFinite(Number(saved.y)) ? Number(saved.y) : base.y,
        targetWarehouseId: saved.targetWarehouseId ?? null,
        cargoFood: Math.max(0, Math.floor(Number(saved.cargoFood) || 0)),
        pendingEnergy: Math.max(0, Math.floor(Number(saved.pendingEnergy) || 0)),
        processRemainMs: Math.max(0, Number(saved.processRemainMs) || 0),
        processTotalMs: Math.max(0, Number(saved.processTotalMs) || 0),
        phaseRemainMs: Math.max(0, Number(saved.phaseRemainMs) || 0),
        phaseTotalMs: Math.max(0, Number(saved.phaseTotalMs) || 0),
        completedBatches: Math.max(0, Math.floor(Number(saved.completedBatches) || 0)),
        offlineProgressMs: Math.max(0, Number(saved.offlineProgressMs) || 0),
    };
}

/**
 * 蒸汽电站经济真源。每个锅炉工只有一条纯数据任务；Sprite 只是任务投影，
 * 不进入实体、物理、战斗或独立存档。道路连通结果与最短路线均按拓扑版本复用。
 */
export const SteamPowerPlantSystem = {
    _plants: new Set(),

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'steam_power_plant') return;
        building.modules = { ...(saved.steamModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0), 0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._steamUpgrade = saved.steamUpgrade ? {
            moduleId: saved.steamUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.steamUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.steamUpgrade.remainMs) || 0),
        } : null;
        const slots = Math.max(1, Math.floor(Number(steamConfig().workerSlots) || 2));
        const savedJobs = Array.isArray(saved.steamJobs) ? saved.steamJobs : [];
        building._steamJobs = Array.from({ length: slots }, (_, slot) =>
            normalizeJob(building, savedJobs[slot], slot));
        building._steamOutputRemainder = Math.max(0,
            Number(saved.steamOutputRemainder) || 0);
        this._plants.add(building);
    },

    reset() {
        this._plants.clear();
    },

    unregisterBuilding(building, { preserve = false } = {}) {
        this._plants.delete(building);
        if (preserve || building?._economyType !== 'steam_power_plant') return;
        for (const job of building._steamJobs || []) {
            if (job.cargoFood > 0) EnergyManager.queueFoodForStorage(job.cargoFood);
            if (job.pendingEnergy > 0) EnergyManager.importLegacyEnergy(job.pendingEnergy);
            job.cargoFood = 0;
            job.pendingEnergy = 0;
        }
    },

    getModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(building?._cfg, moduleId,
            this.getModuleLevel(building, moduleId));
    },

    startUpgrade(building, moduleId) {
        if (building?._economyType !== 'steam_power_plant') {
            return { ok: false, reason: '该建筑不是蒸汽电站' };
        }
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._steamUpgrade) return { ok: false, reason: '已有电站项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._steamUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getFoodPerBatch(building) {
        return Math.max(1, Math.floor(moduleValue(building, 'steam_heat_recovery',
            Number(steamConfig().inputFoodPerBatch) || 120)));
    },

    getEnergyPerBatch(building) {
        return Math.max(1, Math.floor(moduleValue(building, 'steam_turbine_output',
            Number(steamConfig().baseEnergyPerBatch) || 90)));
    },

    getProcessTimeMs(building) {
        return Math.max(100, moduleValue(building, 'steam_high_pressure_boiler',
            Number(steamConfig().baseProcessTimeMs) || 15000));
    },

    getMoveSpeed(building) {
        const base = Math.max(1, Number(steamConfig().baseMoveSpeed) || 80);
        return base * Math.max(0.01, moduleValue(building, 'steam_transport_cart', 1));
    },

    getRoadState(building) {
        const warehouses = EnergyManager.getWarehouses();
        const roadInfo = BuildingRoadSystem.getBuildingRoadInfo(building);
        const warehouseSignature = warehouses.map((warehouse) =>
            warehouse.id || `${warehouse.x},${warehouse.y}`).sort().join('|');
        const signature = `${roadInfo.topologyRevision}:${roadInfo.wallRevision}:${warehouseSignature}`;
        if (building?._steamRoadCache?.signature === signature) return building._steamRoadCache;
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
            building._steamRoadCache = state;
            // 与面包屋一致：建筑级标记只在确实存在一条通往活动仓库的连续道路时为真。
            building._steamRoadConnected = state.roadConnected;
        }
        return state;
    },

    _selectWarehouse(building, predicate) {
        return this.getRoadState(building).reachable
            .find(({ building: warehouse }) => predicate(warehouse))?.building || null;
    },

    getSnapshot(building) {
        const jobs = building?._steamJobs || [];
        const assigned = Math.min(jobs.length,
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)));
        const activeJobs = jobs.slice(0, assigned);
        const roadState = this.getRoadState(building);
        let blockReason = '';
        if (!roadState.roadConnected) blockReason = 'road_disconnected';
        else if (assigned <= 0) blockReason = 'unstaffed';
        else if (activeJobs.every((job) => job.phase === 'idle')) blockReason = 'food_shortage';
        else if (activeJobs.every((job) => job.phase === 'waiting_deposit')) blockReason = 'warehouse_full';
        const status = {
            road_disconnected: '需要道路连接',
            unstaffed: '等待锅炉工上岗',
            food_shortage: '等待仓库食物',
            warehouse_full: '等待仓库空位',
        }[blockReason] || (activeJobs.some((job) => job.phase === 'processing')
            ? '锅炉发电中' : '锅炉工运输中');
        const tavernMultiplier = TavernEconomySystem.getPlaneOutputMultiplier('steam_power_plant');
        return {
            status,
            blockReason,
            roadConnected: roadState.roadConnected,
            connectedWarehouseCount: roadState.connectedWarehouseCount,
            roadDistance: roadState.roadDistance,
            assignedWorkers: assigned,
            workerSlots: jobs.length,
            activeJobs: activeJobs.filter((job) => job.phase !== 'idle' && job.phase !== 'waiting_deposit').length,
            inputFood: this.getFoodPerBatch(building),
            energyPerBatch: this.getEnergyPerBatch(building),
            tavernMultiplier,
            actualEnergyPerBatch: this.getEnergyPerBatch(building) * tavernMultiplier,
            processTimeMs: this.getProcessTimeMs(building),
            moveSpeed: this.getMoveSpeed(building),
            cargoFood: jobs.reduce((sum, job) => sum + job.cargoFood, 0),
            pendingEnergy: jobs.reduce((sum, job) => sum + job.pendingEnergy, 0),
            completedBatches: jobs.reduce((sum, job) => sum + job.completedBatches, 0),
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._steamUpgrade;
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
        building._steamUpgrade = null;
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
        const destination = phase === 'to_plant' ? building : warehouse;
        return destination ? shortestRoadRoute(network, [currentKey],
            BuildingRoadSystem.getBuildingRoadAccessKeys(destination)) : null;
    },

    _buildRoute(job, building, phase, warehouse, roadState, fromCurrent) {
        if (fromCurrent) {
            const route = this._routeFromCurrent(job, building, phase, warehouse, roadState);
            if (route?.length) return route;
        }
        const cached = roadState?.reachable?.find((entry) => entry.building === warehouse)?.route;
        if (!cached?.length) return null;
        return phase === 'to_plant' ? [...cached].reverse() : [...cached];
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
        const grace = Math.max(0, Number(steamConfig().moveGraceMs) || 5000);
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
            && (phase === 'to_plant' || job._roadRouteWarehouseId === warehouseId)) return true;
        return this._beginMove(job, building, phase, warehouse, roadState, true);
    },

    _move(job, building, dt, serviceStructure, radius) {
        const route = job._roadRoute || [];
        const index = Math.max(0, Math.floor(Number(job._roadRouteIndex) || 0));
        // 锅炉工只能消费道路 BFS 航点。路线走完仍未进入服务半径时视为路线失效，
        // 下帧重新按当前道路拓扑求路，禁止再从路尾直线穿建筑补到中心点。
        if (!route.length || index >= route.length) {
            const arrived = index >= route.length
                && withinServiceRange(job, serviceStructure, radius);
            if (!arrived) this._clearRoute(job);
            return arrived;
        }
        const labor = PopulationEconomySystem.getLaborEfficiency();
        const speed = this.getMoveSpeed(building) * labor;
        const waypoint = route[index];
        const dx = waypoint.x - job.x;
        const dy = waypoint.y - job.y;
        const distance = Math.hypot(dx, dy);
        const arrival = Math.max(2, Number(steamConfig().arrivalDistance) || 40);
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
        return false;
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

    _beginDeposit(job, building) {
        const warehouse = this._selectWarehouse(building, (entry) =>
            EnergyManager.getWarehouseFreeCapacity(entry)
                >= EnergyManager.getWarehouseEnergyFactor(entry));
        if (!warehouse) {
            job.phase = 'waiting_deposit';
            job.targetWarehouseId = null;
            this._clearRoute(job);
            return;
        }
        this._beginMove(job, building, 'to_deposit', warehouse);
    },

    _updateJob(job, building, dt, roadState) {
        if (job.phase === 'idle') {
            this._beginPickup(job, building);
            return;
        }
        if (job.phase === 'to_pickup') {
            let warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!warehouse || !roadState.reachable.some((entry) => entry.building === warehouse)) {
                warehouse = this._selectWarehouse(building, (entry) =>
                    Math.max(0, Math.floor(Number(entry.storedFood) || 0)) >= this.getFoodPerBatch(building));
                if (!warehouse) {
                    job.phase = 'idle';
                    job.targetWarehouseId = null;
                    this._clearRoute(job);
                    return;
                }
                this._beginMove(job, building, 'to_pickup', warehouse, roadState, true);
                return;
            }
            if (!this._ensureRoute(job, building, 'to_pickup', warehouse, roadState)) return;
            if (!this._move(job, building, dt, warehouse,
                serviceRadius(warehouse, steamConfig().warehouseServiceRadius, 180))) return;
            const input = this.getFoodPerBatch(building);
            if (!EnergyManager.deductFoodFromWarehouse(warehouse, input)) {
                job.phase = 'idle';
                job.targetWarehouseId = null;
                this._clearRoute(job);
                return;
            }
            job.cargoFood = input;
            this._beginMove(job, building, 'to_plant', warehouse);
            return;
        }
        if (job.phase === 'to_plant') {
            const source = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!this._ensureRoute(job, building, 'to_plant', source, roadState)) return;
            if (!this._move(job, building, dt, building,
                serviceRadius(building, steamConfig().plantServiceRadius, 200))) return;
            // 加工时停留在电站道路接入点；不再把逻辑脚点拉回建筑中心。
            job.phase = 'processing';
            job.processTotalMs = this.getProcessTimeMs(building);
            const workshop = WorkshopEconomySystem.getEfficiencyMultiplier(building);
            job.processRemainMs = Math.max(0,
                job.processTotalMs - job.offlineProgressMs * workshop);
            job.offlineProgressMs = 0;
            job.phaseRemainMs = 0;
            job.phaseTotalMs = 0;
            this._clearRoute(job);
            return;
        }
        if (job.phase === 'processing') {
            const efficiency = PopulationEconomySystem.getLaborEfficiency()
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
            job.processRemainMs -= Math.max(0, Number(dt) || 0) * efficiency;
            if (job.processRemainMs > 0) return;
            job.cargoFood = 0;
            const exactOutput = building._steamOutputRemainder
                + this.getEnergyPerBatch(building)
                    * TavernEconomySystem.getPlaneOutputMultiplier('steam_power_plant')
                    * getProductionResourceMul();
            job.pendingEnergy = Math.max(1, Math.floor(exactOutput));
            building._steamOutputRemainder = exactOutput - job.pendingEnergy;
            this._beginDeposit(job, building);
            return;
        }
        if (job.phase === 'waiting_deposit') {
            this._beginDeposit(job, building);
            return;
        }
        if (job.phase !== 'to_deposit') return;
        let warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
        if (!warehouse || !roadState.reachable.some((entry) => entry.building === warehouse)) {
            warehouse = this._selectWarehouse(building, (entry) =>
                EnergyManager.getWarehouseFreeCapacity(entry)
                    >= EnergyManager.getWarehouseEnergyFactor(entry));
            if (!warehouse) {
                job.phase = 'waiting_deposit';
                job.targetWarehouseId = null;
                this._clearRoute(job);
                return;
            }
            this._beginMove(job, building, 'to_deposit', warehouse, roadState, true);
            return;
        }
        if (!this._ensureRoute(job, building, 'to_deposit', warehouse, roadState)) return;
        if (!this._move(job, building, dt, warehouse,
            serviceRadius(warehouse, steamConfig().warehouseServiceRadius, 180))) return;
        const stored = EnergyManager.depositEnergyToWarehouse(warehouse, job.pendingEnergy);
        job.pendingEnergy = Math.max(0, job.pendingEnergy - stored);
        if (job.pendingEnergy > 0) {
            job.phase = 'waiting_deposit';
            job.targetWarehouseId = null;
            this._clearRoute(job);
            return;
        }
        job.completedBatches++;
        job.phase = 'idle';
        job.targetWarehouseId = null;
        job.phaseRemainMs = 0;
        job.phaseTotalMs = 0;
        this._clearRoute(job);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'steam_power_plant' || !building.active) return;
        this._updateUpgrade(building, dt);
        const roadState = this.getRoadState(building);
        const assigned = Math.min(building._steamJobs?.length || 0,
            Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)));
        building._economyWorking = roadState.roadConnected && assigned > 0;
        if (!roadState.roadConnected || assigned <= 0) return;
        for (let index = 0; index < assigned; index++) {
            this._updateJob(building._steamJobs[index], building, dt, roadState);
        }
        building._economyWorking = building._steamJobs.slice(0, assigned)
            .some((job) => job.phase !== 'idle' && job.phase !== 'waiting_deposit');
    },
};
