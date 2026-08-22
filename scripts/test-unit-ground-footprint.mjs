import { resolveUnitGroundFootprint } from '../src/world/unit-ground-footprint.js';

let failures = 0;
function check(name, condition) {
    if (condition) console.log(`  ✓ ${name}`);
    else {
        failures++;
        console.error(`  ✗ ${name}`);
    }
}

const rectangularNpc = {
    x: 100,
    y: 200,
    collisionShape: 'rect',
    collisionWidth: 69,
    collisionHeight: 177,
    collider: { x: 98.5, y: 186.5, radius: 16 },
    groundRadius: 16,
};
const npcFootprint = resolveUnitGroundFootprint(rectangularNpc, 10);
check('NPC 躯干矩形不污染地面 footprint',
    npcFootprint.x === 98.5
    && npcFootprint.y === 186.5
    && npcFootprint.width === 32
    && npcFootprint.height === 16);

const interpolatedFriendly = resolveUnitGroundFootprint(rectangularNpc, 10, { x: 120, y: 220 });
check('友军视觉脚点只覆盖中心、不覆盖 Collider 半径',
    interpolatedFriendly.x === 120
    && interpolatedFriendly.y === 220
    && interpolatedFriendly.radius === 16
    && interpolatedFriendly.width === 32
    && interpolatedFriendly.height === 16);

const fallback = resolveUnitGroundFootprint({ x: 4, y: 8 }, 12);
check('无 Collider 实体安全回退指定半径',
    fallback.x === 4 && fallback.y === 8
    && fallback.width === 24 && fallback.height === 12);

console.log(`\n结果: ${failures ? `${failures} 失败` : '全部通过'}`);
process.exit(failures ? 1 : 0);
