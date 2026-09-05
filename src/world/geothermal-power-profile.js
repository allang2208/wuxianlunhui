import upgrades from '../../data/building-upgrades.json';
import population from '../../data/population-economy.json';

/** 前台、后台及面板共用本栋等级公式；不读取全局场景或修改存档。 */
export function getGeothermalPowerProfile(modules = {}, assignedWorkers = 0) {
    const definitions = upgrades.geothermal_power_plant_economy.modules;
    const value = (id) => {
        const spec = definitions[id];
        const level = Math.max(0, Math.min(spec.maxLevel, Math.floor(Number(modules[id]) || 0)));
        return spec.base + spec.per * level;
    };
    const cycleMs = Math.max(100, value('geothermal_closed_loop'));
    const energyPerCycle = value('geothermal_deep_exchanger');
    const conversionRate = Math.max(0, Math.min(1, value('geothermal_heat_recovery')));
    const staffCapacity = Math.floor(value('geothermal_maintenance_staff'));
    const staffedCount = Math.max(0, Math.min(staffCapacity, Math.floor(Number(assignedWorkers) || 0)));
    const workerEfficiencyShare = population.geothermal_power_plant.workerEfficiencyShare;
    const staffFactor = Math.min(1, staffedCount * workerEfficiencyShare);
    return { cycleMs, energyPerCycle, conversionRate, staffCapacity, staffedCount,
        workerEfficiencyShare, staffFactor,
        configuredEnergyPerSecond: energyPerCycle * conversionRate * 1000 / cycleMs };
}
