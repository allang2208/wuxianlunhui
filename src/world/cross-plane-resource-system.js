import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import producerBuildings from '../../data/producer-buildings.json';
import buildingUpgrades from '../../data/building-upgrades.json';
import populationEconomy from '../../data/population-economy.json';
import { isInfiniteResourcesEnabled } from '../config/dev-cheats.js';

const PROTOCOL_ID = 'warehouse_cross_plane';
const PROTOCOL = buildingUpgrades.warehouse_logistics?.modules?.[PROTOCOL_ID] || {};
let snapshotProvider = () => ({});

const currentSceneId = () => (typeof window !== 'undefined' ? window.SceneManager?.currentScene : null);
const amount = (value) => Math.max(0, Math.floor(Number(value) || 0));

function isWarehouse(structure) {
    return structure?.kind === 'producer'
        && Number(structure.hp ?? 1) > 0
        && producerBuildings[structure.cfgKey]?.workshopType === 'warehouse';
}

function remoteWarehouses() {
    const current = currentSceneId();
    const snapshots = snapshotProvider?.() || {};
    const result = [];
    for (const [sceneId, snapshot] of Object.entries(snapshots)) {
        if (!snapshot || sceneId === current) continue;
        for (const structure of snapshot.structures || []) {
            if (isWarehouse(structure)) result.push(structure);
        }
    }
    return result;
}

function protocolLevel(warehouse) {
    return Math.max(0, Math.min(
        Math.floor(Number(PROTOCOL.maxLevel) || 10),
        Math.floor(Number(warehouse?.warehouseModules?.[PROTOCOL_ID]) || 0)
    ));
}

function warehouseModuleValue(warehouse, moduleId, fallback = 0) {
    const module = buildingUpgrades.warehouse_logistics?.modules?.[moduleId];
    if (!module) return fallback;
    const level = Math.max(0, Math.min(
        Math.floor(Number(module.maxLevel) || 10),
        Math.floor(Number(warehouse?.warehouseModules?.[moduleId]) || 0)
    ));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function warehouseCapacity(warehouse) {
    const levels = populationEconomy.warehouse?.levels || [];
    const level = Math.max(1, Math.floor(Number(warehouse?.economyLevel) || 1));
    const levelCfg = levels.find((entry) => Number(entry.level) === level) || levels[levels.length - 1];
    const baseCapacity = Number(levelCfg?.storageCapacity)
        || Number(producerBuildings[warehouse?.cfgKey]?.storageCapacity) || 0;
    const moduleBonus = Math.max(0, warehouseModuleValue(warehouse, 'warehouse_capacity', 0));
    return Math.max(0, Math.floor(baseCapacity + moduleBonus));
}

function warehouseFactor(warehouse, moduleId) {
    return Math.max(0.1, Math.min(1, 1 + warehouseModuleValue(warehouse, moduleId, 0)));
}

function remoteMultiplier(warehouses = remoteWarehouses()) {
    if (!warehouses.length) return 1;
    const level = warehouses.reduce((best, warehouse) => Math.max(best, protocolLevel(warehouse)), 0);
    const surcharge = Math.max(0,
        (Number(PROTOCOL.base) || 0.5) + (Number(PROTOCOL.per) || -0.05) * level);
    return 1 + surcharge;
}

function deductSnapshotResource(warehouses, field, requested) {
    let left = amount(requested);
    const total = warehouses.reduce((sum, warehouse) => sum + amount(warehouse[field]), 0);
    if (total < left) return false;
    for (let i = warehouses.length - 1; i >= 0 && left > 0; i--) {
        const stored = amount(warehouses[i][field]);
        const take = Math.min(stored, left);
        warehouses[i][field] = stored - take;
        left -= take;
    }
    return left <= 0;
}

function refundSnapshotResource(warehouses, field, requested) {
    let left = amount(requested);
    for (const warehouse of warehouses) {
        if (left <= 0) break;
        const capacity = warehouseCapacity(warehouse);
        const energyFactor = warehouseFactor(warehouse, 'warehouse_energy_density');
        const foodFactor = warehouseFactor(warehouse, 'warehouse_food_density');
        const used = amount(warehouse.storedEnergy) * energyFactor
            + amount(warehouse.storedFood) * foodFactor;
        const factor = field === 'storedFood' ? foodFactor : energyFactor;
        const put = Math.min(left, Math.floor(Math.max(0, capacity - used) / factor));
        warehouse[field] = amount(warehouse[field]) + put;
        left -= put;
    }
    return amount(requested) - left;
}

export function setCrossPlaneSnapshotProvider(provider) {
    snapshotProvider = typeof provider === 'function' ? provider : (() => ({}));
}

export const CrossPlaneResourceSystem = {
    getContext() {
        if (EnergyManager?.hasWarehouse?.()) {
            return { remote: false, multiplier: 1, protocolLevel: 0, warehouses: [] };
        }
        const warehouses = remoteWarehouses();
        if (!warehouses.length) {
            return { remote: false, multiplier: 1, protocolLevel: 0, warehouses: [] };
        }
        const level = warehouses.reduce((best, warehouse) => Math.max(best, protocolLevel(warehouse)), 0);
        return { remote: true, multiplier: remoteMultiplier(warehouses), protocolLevel: level, warehouses };
    },

    quote(cost = {}) {
        const context = this.getContext();
        const scale = (value) => amount(Number(value) * context.multiplier + 0.999999);
        return {
            gold: scale(cost.gold),
            energy: scale(cost.energy),
            food: scale(cost.food),
            timeMs: Math.max(0, Number(cost.timeMs) || 0),
            remote: context.remote,
            multiplier: context.multiplier,
            protocolLevel: context.protocolLevel,
        };
    },

    getAvailable(resource) {
        const context = this.getContext();
        if (!context.remote) {
            if (resource === 'gold') return GoldManager?.getGold?.() || 0;
            if (resource === 'food') return EnergyManager?.getFood?.() || 0;
            return EnergyManager?.getEnergy?.() || 0;
        }
        if (resource === 'gold') return GoldManager?.getGold?.() || 0;
        const field = resource === 'food' ? 'storedFood' : 'storedEnergy';
        return context.warehouses.reduce((sum, warehouse) => sum + amount(warehouse[field]), 0);
    },

    pay(cost = {}, options = {}) {
        const quoted = this.quote(cost);
        // 军事招募等强制消耗可显式关闭开发免单；报价、库存检查与实际扣除仍走同一事务。
        if (options.allowDevFree !== false && isInfiniteResourcesEnabled()) {
            return { ok: true, ...quoted, free: true };
        }
        const context = this.getContext();
        if ((GoldManager?.getGold?.() || 0) < quoted.gold) {
            return { ok: false, reason: `金币不足（需 ${quoted.gold} 金币）`, ...quoted };
        }
        if (this.getAvailable('energy') < quoted.energy) {
            return { ok: false, reason: `能源不足（需 ${quoted.energy} 能源）`, ...quoted };
        }
        if (this.getAvailable('food') < quoted.food) {
            return { ok: false, reason: `粮食不足（需 ${quoted.food} 粮食）`, ...quoted };
        }

        if (quoted.gold > 0 && !GoldManager?.deductGold?.(quoted.gold)) {
            return { ok: false, reason: `金币扣除失败（需 ${quoted.gold} 金币）`, ...quoted };
        }
        const rollbackGold = () => { if (quoted.gold > 0) GoldManager?.addGold?.(quoted.gold); };
        const deductStored = (resource, value) => {
            if (!(value > 0)) return true;
            if (!context.remote) {
                return resource === 'food'
                    ? !!EnergyManager?.deductFood?.(value)
                    : !!EnergyManager?.deductEnergy?.(value);
            }
            return deductSnapshotResource(
                context.warehouses,
                resource === 'food' ? 'storedFood' : 'storedEnergy',
                value
            );
        };
        if (!deductStored('energy', quoted.energy)) {
            rollbackGold();
            return { ok: false, reason: `能源扣除失败（需 ${quoted.energy} 能源）`, ...quoted };
        }
        if (!deductStored('food', quoted.food)) {
            if (context.remote) refundSnapshotResource(context.warehouses, 'storedEnergy', quoted.energy);
            else if (quoted.energy > 0) EnergyManager?.addEnergy?.(quoted.energy);
            rollbackGold();
            return { ok: false, reason: `粮食扣除失败（需 ${quoted.food} 粮食）`, ...quoted };
        }
        if (context.remote && quoted.energy > 0) EnergyManager?.discardPendingEnergy?.(quoted.energy);
        return { ok: true, ...quoted, source: context.remote ? 'remote' : 'local' };
    },

    refund(payment) {
        if (!payment?.ok || payment.free) return;
        if (payment.gold > 0) GoldManager?.addGold?.(payment.gold);
        if (payment.source === 'remote') {
            const context = this.getContext();
            refundSnapshotResource(context.warehouses, 'storedEnergy', payment.energy);
            refundSnapshotResource(context.warehouses, 'storedFood', payment.food);
            if (payment.energy > 0) EnergyManager?.importLegacyEnergy?.(payment.energy);
            return;
        }
        if (payment.energy > 0) EnergyManager?.addEnergy?.(payment.energy);
        if (payment.food > 0) EnergyManager?.depositFood?.(payment.food);
    },
};
