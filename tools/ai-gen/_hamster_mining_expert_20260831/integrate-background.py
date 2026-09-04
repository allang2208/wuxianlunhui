from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[3]
p = ROOT / 'src/world/world122-sim.js'
b = Path(__file__).resolve().parent/'integration-baseline'/p.name
if not b.exists(): shutil.copy2(p,b)
s = p.read_text(encoding='utf8')
s = s.replace("import { MINER_CAMP_CONFIG, getMinerEnergyPerSecond, getMinerEconomyStats } from './miner-economy.js';", "import { MINER_CAMP_CONFIG, getMinerEnergyPerSecond, getMinerEconomyStats, getMiningWorkerProfile } from './miner-economy.js';\nimport { simulateMiningGuild } from './mining-guild-simulation.js';")
for var in ('camp','structure','s'):
    s = s.replace(f'getMinerEconomyStats({var}.modules || {{}}).count',f'getMinerEconomyStats({var}.modules || {{}}, null, {var}.cfgKey).count')
s = s.replace("add(structure, 'upgrade', 'modules', MINER_CAMP_CONFIG.modules);", "add(structure, 'upgrade', 'modules', getMiningWorkerProfile(structure.cfgKey).building.modules);")
s = s.replace("if ((Number(s.carriedEnergy) || 0) > 0 && warehouseFree > 0) {", "if (s.cfgKey === 'mining_guild') {\n            simulateMiningGuild(s, nodes, elapsedMs, laborEfficiency, (amount) => {\n                // 同前台：只接收能完整入库的整数原矿；满仓留在背包中。\n                let low = 0, high = Math.max(0, Math.floor(amount));\n                while (low < high) {\n                    const mid = Math.ceil((low + high) / 2);\n                    const output = Math.floor(minerOutputRemainder + mid * minerOutputMultiplier);\n                    if (output > 0 && output <= warehouseFree) low = mid;\n                    else high = mid - 1;\n                }\n                return low > 0 ? submitRawMinerEnergy(low).rawAccepted : 0;\n            });\n            continue;\n        }\n        if ((Number(s.carriedEnergy) || 0) > 0 && warehouseFree > 0) {")
p.write_text(s,encoding='utf8')
