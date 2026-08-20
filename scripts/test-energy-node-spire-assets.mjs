/**
 * 尖塔能量矿接入回归：
 * - 仅保留四种 AI 尖塔晶簇及其枯竭态；
 * - 显示尺寸为尖塔放大版的 50%；
 * - 节点不参与实体碰撞、寻路障碍或怪物避让；
 * - 矿工仍使用独立 gatherRadius 接近采集。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configSrc = fs.readFileSync(path.join(ROOT, 'src/config/energy-config.js'), 'utf8');
const textureSrc = fs.readFileSync(path.join(ROOT, 'src/world/energy-node-textures.js'), 'utf8');
const nodeSrc = fs.readFileSync(path.join(ROOT, 'src/world/energy-node-system.js'), 'utf8');
const moveSrc = fs.readFileSync(path.join(ROOT, 'src/systems/movement-system.js'), 'utf8');
const minerSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-miner-ai.js'), 'utf8');

let fail = 0;
function check(name, condition, detail = '') {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!condition) fail++;
}

const names = fs.readdirSync(path.join(ROOT, 'assets/terrain'));
const normal = names.filter((name) => /^energy_node_v3_\d+\.png$/.test(name)).sort();
const depleted = names.filter((name) => /^energy_node_depleted_v3_\d+\.png$/.test(name)).sort();
check('仅保留四种正常态尖塔贴图',
    normal.join(',') === 'energy_node_v3_1.png,energy_node_v3_2.png,energy_node_v3_3.png,energy_node_v3_4.png');
check('四种枯竭态贴图完整',
    depleted.join(',') === 'energy_node_depleted_v3_1.png,energy_node_depleted_v3_2.png,energy_node_depleted_v3_3.png,energy_node_depleted_v3_4.png');
for (const name of [...normal, ...depleted]) {
    const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain', name)));
    let opaque = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 16) opaque++;
    check(`${name} 是有效透明 PNG`, opaque > 0 && opaque < png.width * png.height);
}

check('节点池缩为四种、尖塔显示尺寸缩小 50%',
    /ENERGY_NODE_V3_COUNT = 4/.test(textureSrc)
    && /nodeSize: 84/.test(configSrc)
    && /nodeSpacing: 115/.test(configSrc));
check('节点取消物理碰撞，保留独立采集半径',
    /nodeRadius: 0/.test(configSrc)
    && /gatherRadius: 45/.test(configSrc)
    && /this\.noCollision = true/.test(nodeSrc)
    && /this\.collider\.radius = 0/.test(nodeSrc)
    && /this\.gatherRadius = cfg\.gatherRadius/.test(nodeSrc));
check('寻路和怪物避让不再把能源矿当障碍',
    /pathFinder\.setEntityCircleObstacles\(\[\]\)/.test(nodeSrc)
    && /e\.noCollision/.test(moveSrc));
check('矿工以 gatherRadius 而非物理半径决定采集范围',
    /node\.gatherRadius \?\? node\.groundRadius \?\? 45/.test(minerSrc)
    && /const physicalNodeR = node\.noCollision \? 0/.test(minerSrc));

console.log(`\n结果: ${14 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
