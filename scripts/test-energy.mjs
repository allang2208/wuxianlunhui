// 能源系统单测：EnergyManager 背包堆叠 + 采集换算（世界-122，2026-08-14）
// 运行：node --import ./scripts/register-json-loader.mjs scripts/test-energy.mjs
await import('./register-json-loader.mjs');
const { EnergyManager, ENERGY_ITEM } = await import('../src/systems/energy-manager.js');
const { ENERGY_CONFIG } = await import('../src/config/energy-config.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else { failed++; console.log(`FAIL  ${name}`); }
}

// 独立背包引用（每次用例重建，避免污染）
function freshBackpack(maxSlots = 10) {
    const bp = [];
    EnergyManager.setBackpackRef(bp);
    EnergyManager.setMaxBackpackSlots(maxSlots);
    return bp;
}

console.log('[test-energy] EnergyManager 背包堆叠');
{
    const bp = freshBackpack();
    check('空背包 getEnergy=0', EnergyManager.getEnergy() === 0);
    check('addEnergy 100', EnergyManager.addEnergy(100) && EnergyManager.getEnergy() === 100);
    check('再 add 50 合并同堆', EnergyManager.addEnergy(50) && bp.length === 1 && bp[0].stack === 150);
    check('物品字段（普通/999 上限）', bp[0].category === 'energy' && bp[0].rarity === 'common' && bp[0].maxStack === 999);
}

console.log('[test-energy] 999 堆叠分堆');
{
    const bp = freshBackpack();
    EnergyManager.addEnergy(999);
    check('第一堆满 999', EnergyManager.addEnergy(1) && bp.length === 2 && bp[0].stack === 999 && bp[1].stack === 1);
    check('总数 1000', EnergyManager.getEnergy() === 1000);
}

console.log('[test-energy] 跨堆叠扣除');
{
    const bp = freshBackpack();
    EnergyManager.addEnergy(1200); // 999 + 201 两堆
    check('扣 300 成功', EnergyManager.deductEnergy(300) && EnergyManager.getEnergy() === 900);
    check('不足拦截（扣 9999）', EnergyManager.deductEnergy(9999) === false && EnergyManager.getEnergy() === 900);
    check('扣空移除堆', EnergyManager.deductEnergy(900) && EnergyManager.getEnergy() === 0 && bp.length === 0);
}

console.log('[test-energy] 背包满拦截');
{
    const bp = freshBackpack(2);
    bp.push({ slot: 0, name: '占位A', category: 'misc', stack: 1 });
    bp.push({ slot: 1, name: '占位B', category: 'misc', stack: 1 });
    check('满背包新增被拒', EnergyManager.addEnergy(10) === false && EnergyManager.getEnergy() === 0);
    bp.push({ slot: 2, name: '能源', category: 'energy', stack: 10, maxStack: 999 });
    check('已有堆叠未满可继续合并', EnergyManager.addEnergy(5) && EnergyManager.getEnergy() === 15 && bp[2].stack === 15);
}

console.log('[test-energy] mergeEnergy');
{
    const bp = freshBackpack();
    check('merge 普通物品', EnergyManager.mergeEnergy({ category: 'energy', stack: 42 }) && EnergyManager.getEnergy() === 42);
    check('merge 非能源拒绝', EnergyManager.mergeEnergy({ category: 'gold', stack: 42 }) === false && EnergyManager.getEnergy() === 42);
}

console.log('[test-energy] 采集换算（造成伤害 × 50% 向下取整）');
{
    const ratio = ENERGY_CONFIG.gatherRatio;
    const calc = (dmg) => Math.floor(dmg * ratio);
    check('ratio=0.5', ratio === 0.5);
    check('100 伤害 → 50', calc(100) === 50);
    check('奇数向下取整（101→50）', calc(101) === 50);
    check('1 伤害 → 0', calc(1) === 0);
    check('物品模板最大堆叠 999', ENERGY_ITEM.maxStack === 999 && ENERGY_ITEM.rarity === 'common');
}

console.log(`[test-energy] ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
