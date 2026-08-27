import populationEconomyConfig from '../../data/population-economy.json';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { ONE_CELL_BUILDING_FOOT } from './building-footprint.js';
import { EnergyNodeSystem } from './energy-node-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { TavernEconomySystem } from './tavern-economy-system.js';
import { TechnologySystem } from './technology-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { isoFootprintsOverlap } from '../physics/iso-footprint.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function config() {
    return populationEconomyConfig.deep_drill || {};
}

function energyNodeFootprint(node) {
    return {
        active: node?.active !== false,
        x: Number(node?.x) || 0,
        y: Number(node?.y) || 0,
        collisionShape: 'iso_rect',
        collisionWidth: ONE_CELL_BUILDING_FOOT.w,
        collisionHeight: ONE_CELL_BUILDING_FOOT.d,
        collisionIsoHalfU: ONE_CELL_BUILDING_FOOT.halfU,
        collisionIsoHalfV: ONE_CELL_BUILDING_FOOT.halfV,
        colliderOffsetX: 0,
        colliderOffsetY: 0,
    };
}

function activeEnergyNodes() {
    return (EnergyNodeSystem.nodes || []).filter((node) =>
        node?.active !== false && !node._depleted && Number(node.hp) > 0
    );
}

/** 深钻井建造门禁：标准建筑 footprint 与任意活矿脉的 1x1 footprint 有真实面积重叠即可。 */
export function hasEnergyVeinFootprintOverlap(buildingFootprint) {
    if (!buildingFootprint) return false;
    return activeEnergyNodes().some((node) =>
        isoFootprintsOverlap(buildingFootprint, energyNodeFootprint(node))
    );
}

export const DeepDrillSystem = {
    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'deep_drill') return;
        building._allowsEnergyNodeOverlap = true;
        building._deepDrillTickMs = Math.max(0, Number(saved.deepDrillTickMs) || 0);
        building._deepDrillRemainder = Math.max(0, Number(saved.deepDrillRemainder) || 0);
        building._deepDrillMinedTotal = Math.max(0, Number(saved.deepDrillMinedTotal) || 0);
        building._deepDrillLastMined = 0;
        building._energyGatherRatio = 1;
    },

    unregisterBuilding(building) {
        if (building?._economyType !== 'deep_drill') return;
        building._economyWorking = false;
        building._deepDrillLastMined = 0;
    },

    getRange(_building) {
        return Math.max(0, Number(config().miningRange) || 600);
    },

    getNodesInRange(building) {
        if (!building) return [];
        const range = this.getRange(building);
        return activeEnergyNodes()
            .filter((node) => Math.hypot(node.x - building.x, node.y - building.y) <= range)
            .sort((a, b) => Math.hypot(a.x - building.x, a.y - building.y)
                - Math.hypot(b.x - building.x, b.y - building.y));
    },

    getOutputMultiplier(building) {
        return Math.max(0,
            WorkshopEconomySystem.getEfficiencyMultiplier(building)
            * TavernEconomySystem.getPlaneOutputMultiplier('deep_drill')
            * getProductionResourceMul()
        );
    },

    isDeepVeinUnlocked() {
        return TechnologySystem.isUnlocked('mechanic', 'deep_vein_mining');
    },

    getSnapshot(building) {
        const cfg = config();
        const workforce = PopulationEconomySystem.getWorkerSnapshot(building) || {
            assigned: 0, slots: 0, laborEfficiency: 1,
        };
        const staffCapacity = Math.max(0, workforce.slots);
        const staffedCount = clamp(Math.floor(Number(workforce.assigned) || 0), 0, staffCapacity);
        const perWorker = Math.max(0, Number(cfg.energyPerWorkerPerSecond) || 12);
        const rawExtractionPerSecond = staffedCount * perWorker
            * Math.max(0, Number(workforce.laborEfficiency) || 0);
        const outputMultiplier = this.getOutputMultiplier(building);
        const nodes = this.getNodesInRange(building);
        const deepVeinUnlocked = this.isDeepVeinUnlocked();
        const usingDeepVein = deepVeinUnlocked && nodes.length === 0;
        const hasExtractableSource = nodes.length > 0 || deepVeinUnlocked;
        const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
        const warehouseFull = !!EnergyManager?.isFull?.();
        const actualEnergyPerSecond = hasWarehouse && !warehouseFull && hasExtractableSource
            ? rawExtractionPerSecond * outputMultiplier
            : 0;
        return {
            range: this.getRange(building),
            staffCapacity,
            staffedCount,
            laborEfficiency: Math.max(0, Number(workforce.laborEfficiency) || 0),
            configuredExtractionPerSecond: staffCapacity * perWorker,
            rawExtractionPerSecond,
            outputMultiplier,
            actualEnergyPerSecond,
            nodeCount: nodes.length,
            remainingEnergy: nodes.reduce((sum, node) => sum + Math.max(0, Number(node.hp) || 0), 0),
            target: nodes[0] || null,
            deepVeinUnlocked,
            usingDeepVein,
            hasExtractableSource,
            hasWarehouse,
            warehouseFull,
            lastMined: Math.max(0, Number(building?._deepDrillLastMined) || 0),
            totalMined: Math.max(0, Number(building?._deepDrillMinedTotal) || 0),
        };
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'deep_drill' || !building.active || building.hp <= 0) return;
        const snapshot = this.getSnapshot(building);
        const canMine = snapshot.rawExtractionPerSecond > 0
            && snapshot.outputMultiplier > 0
            && snapshot.hasExtractableSource
            && snapshot.hasWarehouse
            && !snapshot.warehouseFull;
        building._economyWorking = canMine;
        if (!canMine) {
            building._deepDrillTickMs = 0;
            return;
        }

        const tickMs = Math.max(100, Number(config().miningTickMs) || 1000);
        building._deepDrillTickMs = Math.max(0, Number(building._deepDrillTickMs) || 0)
            + Math.max(0, Number(dt) || 0);
        if (building._deepDrillTickMs < tickMs) return;
        const elapsedMs = building._deepDrillTickMs;
        building._deepDrillTickMs = 0;
        const exactRaw = Math.max(0, Number(building._deepDrillRemainder) || 0)
            + snapshot.rawExtractionPerSecond * elapsedMs / 1000;
        let rawBudget = Math.floor(exactRaw);
        building._deepDrillRemainder = exactRaw - rawBudget;
        if (rawBudget <= 0) return;

        const energyBefore = Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0);
        building._energyGatherRatio = snapshot.outputMultiplier;
        for (const node of this.getNodesInRange(building)) {
            if (rawBudget <= 0 || EnergyManager?.isFull?.()) break;
            const dealt = typeof node.takeDamage === 'function'
                ? node.takeDamage(rawBudget, building, 'physical', false)
                : 0;
            rawBudget -= Math.max(0, Number(dealt) || 0);
        }
        if (rawBudget > 0
            && this.isDeepVeinUnlocked()
            && this.getNodesInRange(building).length === 0
            && !EnergyManager?.isFull?.()) {
            EnergyManager.depositEnergy(Math.floor(rawBudget * snapshot.outputMultiplier));
        }
        const mined = Math.max(0,
            (Number(EnergyManager?.getEnergy?.()) || 0) - energyBefore
        );
        building._deepDrillLastMined = mined;
        building._deepDrillMinedTotal = Math.max(0,
            Number(building._deepDrillMinedTotal) || 0) + mined;
    },
};
