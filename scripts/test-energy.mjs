// 世界-122 仓库能源聚合测试
await import('./register-json-loader.mjs');
const { EnergyManager, ENERGY_ITEM } = await import('../src/systems/energy-manager.js');
const { ENERGY_CONFIG } = await import('../src/config/energy-config.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else { failed++; console.log(`FAIL  ${name}`); }
}

function freshStorage(count = 1, capacity = 5000) {
    EnergyManager.resetWarehouses();
    EnergyManager.restoreStorage({ total: 0 });
    const warehouses = [];
    for (let i = 0; i < count; i++) {
        const w = { id: `warehouse_${i}`, active: true, storedEnergy: 0 };
        EnergyManager.registerWarehouse(w, capacity);
        warehouses.push(w);
    }
    return warehouses;
}

console.log('[test-energy] 单仓库容量');
{
    const [w] = freshStorage();
    check('初始总量0/容量5000', EnergyManager.getEnergy() === 0 && EnergyManager.getCapacity() === 5000);
    check('存入1200', EnergyManager.addEnergy(1200) && w.storedEnergy === 1200);
    check('扣除300', EnergyManager.deductEnergy(300) && EnergyManager.getEnergy() === 900);
    check('不足扣除不改变存量', !EnergyManager.deductEnergy(9999) && EnergyManager.getEnergy() === 900);
}

console.log('[test-energy] 多仓库聚合');
{
    const [a, b] = freshStorage(2);
    check('两仓总容量10000', EnergyManager.getCapacity() === 10000 && EnergyManager.getWarehouseCount() === 2);
    check('跨仓存入7000', EnergyManager.addEnergy(7000)
        && a.storedEnergy === 5000 && b.storedEnergy === 2000 && EnergyManager.getEnergy() === 7000);
    check('跨仓扣除2500', EnergyManager.deductEnergy(2500)
        && EnergyManager.getEnergy() === 4500 && b.storedEnergy === 0);
}

console.log('[test-energy] 满仓与部分入库');
{
    const [w] = freshStorage();
    check('实际入库量封顶5000', EnergyManager.depositEnergy(5200) === 5000 && w.storedEnergy === 5000);
    check('满仓判定', EnergyManager.isFull() && EnergyManager.getFreeCapacity() === 0);
    check('满仓继续入库为0', EnergyManager.depositEnergy(10) === 0);
}

console.log('[test-energy] 旧背包迁移与待入库');
{
    EnergyManager.resetWarehouses();
    EnergyManager.restoreStorage({ total: 0 });
    const bp = [
        { slot: 0, category: 'energy', stack: 1200 },
        { slot: 1, category: 'misc', stack: 1 },
    ];
    EnergyManager.setBackpackRef(bp);
    check('旧能源从背包移除', bp.length === 1 && bp[0].category === 'misc');
    const w = { id: 'migrate_wh', active: true };
    EnergyManager.registerWarehouse(w, 5000);
    check('建仓后待入库能源自动装入', w.storedEnergy === 1200 && EnergyManager.getEnergy() === 1200);
}

console.log('[test-energy] 存档恢复');
{
    freshStorage(2);
    EnergyManager.addEnergy(6500);
    const snapshot = EnergyManager.serializeStorage();
    EnergyManager.deductEnergy(6500);
    EnergyManager.restoreStorage(snapshot);
    check('恢复总能源6500', EnergyManager.getEnergy() === 6500);
}

console.log('[test-energy] 采集换算与旧物品兼容');
{
    const ratio = ENERGY_CONFIG.gatherRatio;
    check('100伤害→100能源（gatherRatio 1.0，2026-08-22 口径）', Math.floor(100 * ratio) === 100);
    check('ENERGY_ITEM仅保留旧存档兼容', ENERGY_ITEM.category === 'energy' && ENERGY_ITEM.maxStack === 999);
}

console.log(`[test-energy] ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
