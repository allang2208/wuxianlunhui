/** 世界-122 生产建筑安全出口与拥堵排队回归。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    SpawnPlacement,
    circleIntersectsBuildingRect,
    isSpawnPositionFree,
} = await import('../src/world/spawn-placement.js');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const building = (x, y) => ({
    active: true,
    x,
    y,
    collisionShape: 'iso_rect',
    collisionWidth: 256,
    collisionHeight: 128,
    collisionRadius: 128,
    collisionIsoHalfU: 256 / (2 * Math.SQRT2),
    collisionIsoHalfV: 256 / (2 * Math.SQRT2),
    _isGridBuilding: true,
    _isDefenseStructure: true,
});
const wallSystem = {
    canMoveTo: () => true,
    blocked: () => false,
};

SpawnPlacement.clearReservations();
const source = building(0, 0);
const open = new Map([['source', source]]);
const first = SpawnPlacement.findAndReserve(source, {
    unitRadius: 24,
    entities: open,
    wallSystem,
    preferredTarget: { x: 1000, y: 0 },
    now: 1000,
});
check('开放区域优先选择朝集结目标方向的出口',
    first && first.side === 'right_down',
    first ? `${first.side}@${first.x},${first.y}` : 'null');
check('出生点和离场点均在来源建筑footprint之外',
    first
    && !circleIntersectsBuildingRect(first.x, first.y, 24, source)
    && !circleIntersectsBuildingRect(first.egressX, first.egressY, 24, source));

const second = SpawnPlacement.findAndReserve(source, {
    unitRadius: 24,
    entities: open,
    wallSystem,
    preferredTarget: { x: 1000, y: 0 },
    now: 1000,
});
check('短时预约阻止同帧复用同一出口点',
    second && first && (second.x !== first.x || second.y !== first.y));

SpawnPlacement.clearReservations();
const ring = new Map([['source', source]]);
for (const [i, [x, y]] of [
    [128, 64], [-128, -64], [-128, 64], [128, -64],
    [0, 128], [256, 0], [-256, 0], [0, -128],
].entries()) ring.set(`b${i}`, building(x, y));
const blocked = SpawnPlacement.findAndReserve(source, {
    unitRadius: 24,
    entities: ring,
    wallSystem,
    preferredTarget: { x: 1000, y: 0 },
    now: 2000,
});
check('3×3无缝建筑群中心建筑没有合法出口时返回null', blocked === null);
check('建筑footprint参与独立出生点校验',
    first && !isSpawnPositionFree(first.x, first.y, 24, {
        entities: ring,
        wallSystem,
        now: 2000,
        checkReservation: false,
    }));

const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');
const hutSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-hut-system.js'), 'utf8');
const movementSrc = fs.readFileSync(path.join(ROOT, 'src/systems/movement-system.js'), 'utf8');
for (const [name, src] of [['配置产兵建筑', producerSrc], ['仓鼠兵营', barracksSrc], ['仓鼠矿场', hutSrc]]) {
    check(`${name}接入统一出口槽位`, /SpawnPlacement\.findAndReserve/.test(src));
    check(`${name}出口阻塞时保持完成状态并500ms重试`,
        /_spawnBlocked/.test(src) && /SpawnPlacement\.retryMs/.test(src));
}
check('新生单位优先走离场点再恢复正常AI',
    /enemy\._spawnEgress/.test(movementSrc)
    && /unit\._spawnEgress/.test(producerSrc)
    && /unit\._spawnEgress/.test(barracksSrc)
    && /miner\._spawnEgress/.test(hutSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
