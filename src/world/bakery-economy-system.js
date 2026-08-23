import populationEconomyConfig from '../../data/population-economy.json';
import { EnergyManager } from '../systems/energy-manager.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TechnologySystem } from './technology-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { routeBakeryPlantTributes } from './bakery-tribute-routing.js';
import {
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function bakeryConfig() {
    return populationEconomyConfig.bakery || {};
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

function nearestWarehouse(x, y, predicate) {
    return EnergyManager.getWarehouses()
        .filter((warehouse) => predicate(warehouse))
        .sort((a, b) => Math.hypot((a.x || 0) - x, (a.y || 0) - y)
            - Math.hypot((b.x || 0) - x, (b.y || 0) - y))[0] || null;
}

/**
 * 面包屋离散生产真源。面包师只是一条挂在建筑上的经济岗位记录，不进入
 * Game.entities、物理、战斗或独立存档；Sprite 只读取这条记录的位置和阶段。
 */
export const BakeryEconomySystem = {
    _bakeries: new Set(),

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'bakery') return;
        building.modules = { ...(saved.bakeryModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._bakeryUpgrade = saved.bakeryUpgrade ? {
            moduleId: saved.bakeryUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.bakeryUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.bakeryUpgrade.remainMs) || 0),
        } : null;
        building._bakeryJob = normalizeJob(building, saved.bakeryJob);
        building._bakeryPendingTributeIds = Array.isArray(saved.bakeryPendingTributeIds)
            ? saved.bakeryPendingTributeIds.filter((id) => typeof id === 'string')
            : [];
        this._bakeries.add(building);
    },

    reset() {
        this._bakeries.clear();
    },

    unregisterBuilding(building, { preserve = false } = {}) {
        this._bakeries.delete(building);
        if (preserve || building?._economyType !== 'bakery') return;
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
        if (building?._economyType !== 'bakery') return { ok: false, reason: '该建筑不是面包屋' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        if (!TechnologySystem.isUnlocked('upgrade', moduleId)) {
            const technologyName = TechnologySystem.getUnlockRequirementLabel('upgrade', moduleId);
            return { ok: false, reason: `需要先完成科技：${technologyName || moduleId}` };
        }
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._bakeryUpgrade) return { ok: false, reason: '已有面包屋项目正在升级' };
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
            'bakery_quick_cooking',
            Number(bakeryConfig().baseProcessTimeMs) || 10000
        ));
    },

    getOutputMultiplier(building) {
        return Math.max(1, moduleValue(
            building,
            'bakery_gourmet',
            Number(bakeryConfig().baseOutputMultiplier) || 5
        ));
    },

    getPlantTributeChance(building) {
        return clamp(moduleValue(building, 'bakery_ingredient_processing', 0.01), 0, 1);
    },

    getMoveSpeed(building) {
        const base = Math.max(1, Number(bakeryConfig().baseMoveSpeed) || 80);
        return base * Math.max(0.01, moduleValue(building, 'bakery_quick_steps', 1));
    },

    getSnapshot(building) {
        const job = building?._bakeryJob || defaultJob(building);
        const cfg = bakeryConfig();
        const phaseText = {
            idle: '等待仓库粮食',
            to_pickup: '前往仓库取粮',
            to_bakery: '携带食材返回面包屋',
            processing: '加工烘焙中',
            waiting_deposit: '等待仓库空位',
            to_deposit: '运送成品回仓库',
        }[job.phase] || '待命';
        const progress = job.phase === 'processing' && job.processTotalMs > 0
            ? clamp(1 - job.processRemainMs / job.processTotalMs, 0, 1)
            : (job.phaseTotalMs > 0
                ? clamp(1 - job.phaseRemainMs / job.phaseTotalMs, 0, 1)
                : 0);
        return {
            status: phaseText,
            phase: job.phase,
            progress,
            inputFood: Math.max(1, Math.floor(Number(cfg.inputFoodPerBatch) || 50)),
            processTimeMs: this.getProcessTimeMs(building),
            outputMultiplier: this.getOutputMultiplier(building),
            outputFood: Math.floor((Number(cfg.inputFoodPerBatch) || 50) * this.getOutputMultiplier(building)),
            plantTributeChance: this.getPlantTributeChance(building),
            moveSpeed: this.getMoveSpeed(building),
            cargoFood: job.cargoFood,
            pendingFood: job.pendingFood,
            completedBatches: job.completedBatches,
            pendingTributes: building?._bakeryPendingTributeIds?.length || 0,
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
        if (Math.random() >= this.getPlantTributeChance(building)) return;
        const ids = bakeryConfig().plantTributeItemIds || [];
        if (!ids.length) return;
        building._bakeryPendingTributeIds.push(ids[Math.floor(Math.random() * ids.length)]);
        this._flushPendingTributes(building);
    },

    _warehousePoint(warehouse) {
        return resolveCivilianVisualPosition(warehouse?.x || 0, warehouse?.y || 0);
    },

    _bakeryPoint(building) {
        return resolveCivilianVisualPosition(building?.x || 0, building?.y || 0);
    },

    _warehouseServiceRadius(warehouse) {
        const config = bakeryConfig();
        return structureServiceRadius(warehouse, config.warehouseServiceRadius, 180);
    },

    _bakeryServiceRadius(building) {
        const config = bakeryConfig();
        return structureServiceRadius(building, config.bakeryServiceRadius, 200);
    },

    _beginMove(building, phase, warehouse) {
        const job = building._bakeryJob;
        const target = phase === 'to_bakery'
            ? this._bakeryPoint(building)
            : this._warehousePoint(warehouse);
        const distance = Math.hypot(target.x - job.x, target.y - job.y);
        const duration = distance / Math.max(1, this.getMoveSpeed(building)) * 1000;
        const grace = Math.max(0, Number(bakeryConfig().moveGraceMs) || 5000);
        job.phase = phase;
        job.targetWarehouseId = warehouse?.id ?? job.targetWarehouseId;
        job.phaseTotalMs = duration + grace;
        job.phaseRemainMs = duration + grace;
    },

    _move(building, target, dt, { serviceStructure = null, serviceRadius = 0 } = {}) {
        const job = building._bakeryJob;
        if (isWithinServiceRange(job, serviceStructure, serviceRadius)) {
            job.phaseRemainMs = 0;
            return true;
        }
        const labor = PopulationEconomySystem.getLaborEfficiency();
        const speed = this.getMoveSpeed(building) * labor;
        const dx = target.x - job.x;
        const dy = target.y - job.y;
        const distance = Math.hypot(dx, dy);
        const arrival = Math.max(2, Number(bakeryConfig().arrivalDistance) || 18);
        if (distance <= arrival) {
            job.x = target.x;
            job.y = target.y;
            job.phaseRemainMs = 0;
            return true;
        }
        const elapsed = Math.max(0, Number(dt) || 0) * labor;
        const step = Math.min(distance, Math.max(0, speed * elapsed / 1000));
        if (step <= 0) return false;
        const rawX = job.x + dx / distance * step;
        const rawY = job.y + dy / distance * step;
        const resolved = sweepCivilianVisualMove(job, rawX, rawY);
        job.x = resolved.x;
        job.y = resolved.y;
        job.phaseRemainMs = Math.max(0, job.phaseRemainMs - elapsed);
        if (isWithinServiceRange(job, serviceStructure, serviceRadius)) {
            job.phaseRemainMs = 0;
            return true;
        }
        if (Math.hypot(target.x - job.x, target.y - job.y) <= arrival) return true;
        // 面包师是纯视觉岗位，不具备寻路。碰撞滑行仍未抵达时允许阶段超时完成，
        // 避免密集建筑、墙体或旧存档中的零计时移动把整条生产链永久锁死。
        return job.phaseRemainMs <= 0;
    },

    _beginPickup(building) {
        const job = building._bakeryJob;
        const input = Math.max(1, Math.floor(Number(bakeryConfig().inputFoodPerBatch) || 50));
        const warehouse = nearestWarehouse(job.x, job.y, (entry) =>
            Math.max(0, Math.floor(Number(entry.storedFood) || 0)) >= input);
        if (!warehouse) {
            job.phase = 'idle';
            job.targetWarehouseId = null;
            return;
        }
        this._beginMove(building, 'to_pickup', warehouse);
    },

    _takeInput(building, warehouse) {
        const job = building._bakeryJob;
        const input = Math.max(1, Math.floor(Number(bakeryConfig().inputFoodPerBatch) || 50));
        if (!EnergyManager.deductFoodFromWarehouse(warehouse, input)) {
            job.phase = 'idle';
            job.targetWarehouseId = null;
            return;
        }
        job.cargoFood = input;
        this._beginMove(building, 'to_bakery', warehouse);
    },

    _beginDeposit(building) {
        const job = building._bakeryJob;
        const warehouse = nearestWarehouse(job.x, job.y, (entry) =>
            EnergyManager.getWarehouseFreeCapacity(entry) >= EnergyManager.getWarehouseFoodFactor(entry));
        if (!warehouse) {
            job.phase = 'waiting_deposit';
            job.targetWarehouseId = null;
            return;
        }
        this._beginMove(building, 'to_deposit', warehouse);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'bakery' || !building.active) return;
        this._updateUpgrade(building, dt);
        this._flushPendingTributes(building);
        if (Math.max(0, Math.floor(Number(building._assignedWorkers) || 0)) <= 0) return;
        const job = building._bakeryJob;
        if (job.phase === 'idle') {
            this._beginPickup(building);
            return;
        }
        if (job.phase === 'to_pickup') {
            const warehouse = EnergyManager.getWarehouseById(job.targetWarehouseId);
            if (!warehouse) {
                job.phase = 'idle';
                job.targetWarehouseId = null;
                return;
            }
            if (this._move(building, this._warehousePoint(warehouse), dt, {
                serviceStructure: warehouse,
                serviceRadius: this._warehouseServiceRadius(warehouse),
            })) this._takeInput(building, warehouse);
            return;
        }
        if (job.phase === 'to_bakery') {
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
            }
            return;
        }
        if (job.phase === 'processing') {
            const efficiency = PopulationEconomySystem.getLaborEfficiency()
                * WorkshopEconomySystem.getEfficiencyMultiplier(building);
            job.processRemainMs -= Math.max(0, Number(dt) || 0) * efficiency;
            if (job.processRemainMs > 0) return;
            job.cargoFood = 0;
            job.pendingFood = Math.max(1, Math.floor(
                (Number(bakeryConfig().inputFoodPerBatch) || 50)
                * this.getOutputMultiplier(building)
                * getProductionResourceMul()
            ));
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
            if (!warehouse) {
                job.phase = 'waiting_deposit';
                job.targetWarehouseId = null;
                return;
            }
            if (!this._move(building, this._warehousePoint(warehouse), dt, {
                serviceStructure: warehouse,
                serviceRadius: this._warehouseServiceRadius(warehouse),
            })) return;
            const stored = EnergyManager.depositFoodToWarehouse(warehouse, job.pendingFood);
            job.pendingFood = Math.max(0, job.pendingFood - stored);
            if (job.pendingFood > 0) {
                job.phase = 'waiting_deposit';
                job.targetWarehouseId = null;
                return;
            }
            job.completedBatches++;
            job.phase = 'idle';
            job.targetWarehouseId = null;
            job.phaseRemainMs = 0;
            job.phaseTotalMs = 0;
        }
    },
};
