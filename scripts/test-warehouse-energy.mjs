/** 世界-122 仓库建筑与能源真值回归。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import producerCfg from '../data/producer-buildings.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

const cfg = producerCfg.warehouse;
check('仓库配置：500金币、5000容量、2×2建筑',
    cfg?.currency === 'gold' && cfg.cost === 500 && cfg.storageCapacity === 5000
    && cfg.radius === 128 && cfg.workshopType === 'warehouse');

const png = fs.readFileSync(path.join(ROOT, 'assets/terrain/warehouse.png'));
check('仓库正式贴图已裁边接入',
    png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1094);

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const energySrc = fs.readFileSync(path.join(ROOT, 'src/systems/energy-manager.js'), 'utf8');
const nodeSrc = fs.readFileSync(path.join(ROOT, 'src/world/energy-node-system.js'), 'utf8');
const companionSrc = fs.readFileSync(path.join(ROOT, 'src/entities/companion.js'), 'utf8');
const companionAiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/companion-ai.js'), 'utf8');
const minerAiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-miner-ai.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(ROOT, 'src/game.js'), 'utf8');
const equipSrc = fs.readFileSync(path.join(ROOT, 'src/ui/equip-manager.js'), 'utf8');
const saveSrc = fs.readFileSync(path.join(ROOT, 'src/ui/game-ui-manager.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');

check('BootScene加载仓库贴图', /warehouse', 'assets\/terrain\/warehouse\.png'/.test(bootSrc));
check('仓库建造货币由配置驱动为金币',
    /currency: pc\.currency === 'gold' \? 'gold' : 'energy'/.test(buildingSrc));
check('仓库实体注册/销毁/场景离场接入EnergyManager',
    /EnergyManager\.registerWarehouse\(this, cfg\.storageCapacity \?\? 5000\)/.test(producerSrc)
    && /EnergyManager\.unregisterWarehouse\(this\)/.test(producerSrc)
    && /unregisterWarehouse\(b, \{ preserve: true \}\)/.test(producerSrc));
check('仓库面板显示本仓和全部仓库聚合',
    /pbWarehouseOwn/.test(producerSrc)
    && /pbWarehouseTotal/.test(producerSrc)
    && /EnergyManager\.getCapacity\(\)/.test(producerSrc)
    && /EnergyManager\.getWarehouseCount\(\)/.test(producerSrc));
check('能源管理已从背包堆迁移为多仓库聚合',
    /this\._warehouses = new Map\(\)/.test(energySrc)
    && /getWarehouses\(\)/.test(energySrc)
    && /getCapacity\(\)/.test(energySrc)
    && /depositEnergy\(amount\)/.test(energySrc)
    && !/_findEnergyItems\(\)/.test(energySrc));
check('矿点命中直接入仓，满仓时不消耗矿点',
    /directToWarehouse/.test(nodeSrc)
    && /EnergyManager\.isFull\(\)/.test(nodeSrc)
    && /EnergyManager\.depositEnergy\(energy\)/.test(nodeSrc));
check('玩家队友采矿不再写背包，满仓切待命',
    /EnergyManager\.depositEnergy\(amount\)/.test(companionSrc)
    && !/ENERGY_ITEM/.test(companionAiSrc)
    && /_stopGatherForFullStorage\(\)/.test(companionAiSrc)
    && /c\._command = \{ mode: 'hold'/.test(companionAiSrc));
check('仓鼠矿工满仓返回小屋待命',
    /_phase = 'storage_return'/.test(minerAiSrc)
    && /_phase = 'storage_wait'/.test(minerAiSrc)
    && /仓库已满，返回小屋待命/.test(minerAiSrc));
check('旧地面能源拾取也直接入仓',
    /EnergyManager\.depositEnergy\(amount\)/.test(gameSrc)
    && /item\.category === 'energy' && EnergyManager/.test(equipSrc)
    && /EnergyManager\.mergeEnergy\(item\)/.test(equipSrc));
check('仓库能源写入世界122存档并恢复',
    /energyStorage: EnergyManager\.serializeStorage\(\)/.test(saveSrc)
    && /EnergyManager\.restoreStorage\(data\.world122\?\.energyStorage\)/.test(saveSrc));
check('满仓时出售/回收先检查容量，胜利奖励显示实际入库量',
    /EnergyManager\.canStore\(info\.refund\)/.test(buildingSrc)
    && /EnergyManager\.canStore\(refund\)/.test(producerSrc)
    && /energyAdded = EnergyManager\.depositEnergy/.test(defenseSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
