import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BuildingRoadSystem,
    buildingRoadLayout,
} from '../src/world/building-road-system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(name, condition) {
    if (condition) {
        passed++;
        console.log(`✓ ${name}`);
    } else {
        failed++;
        console.error(`✗ ${name}`);
    }
}

function pngSize(file) {
    const buf = fs.readFileSync(file);
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
    };
}

function fakeSprite() {
    return {
        active: true,
        setOrigin() { return this; },
        setDisplaySize() { return this; },
        setDepth() { return this; },
        setAlpha() { return this; },
        destroy() { this.active = false; },
    };
}

const scene = { add: { sprite: fakeSprite } };
const anchor = { x: 4232, y: 4176 };
const layout = buildingRoadLayout(anchor.x, anchor.y);
check('2×2建筑外围布局固定为4×4共16格', layout.reservationCells.length === 16);
check('中央建筑占4格', layout.buildingCells.length === 4);
check('外围道路占12格', layout.roadCells.length === 12);
check('16格坐标无重复', new Set(layout.reservationCells.map((cell) => cell.key)).size === 16);
check('道路帧稳定落在0..3', layout.roadCells.every((cell) => cell.frame >= 0 && cell.frame <= 3));

BuildingRoadSystem.reset();
const first = { id: 'road_owner_a', ...anchor };
const overlap = { id: 'road_owner_overlap', x: anchor.x + 128, y: anchor.y + 64 };
const separate = { id: 'road_owner_separate', x: anchor.x + 256, y: anchor.y + 128 };
check('首个建筑可登记4×4道路占地', BuildingRoadSystem.attach(first, { scene }) === true);
check('登记后生成12个道路精灵', BuildingRoadSystem._roadTiles.size === 12);
check('登记后保留16格预约', BuildingRoadSystem._cellOwners.size === 16);
check('重叠4×4预约会被拒绝', BuildingRoadSystem.attach(overlap, { scene }) === false);
check('相邻不重叠4×4预约可登记', BuildingRoadSystem.attach(separate, { scene }) === true);
check('拆除建筑同步释放预约', first._removeBuildingRoads() === true);
check('拆除后另一建筑预约仍保留', BuildingRoadSystem._owners.size === 1);
BuildingRoadSystem.reset();

const asset = path.join(ROOT, 'assets', 'terrain', 'building_road_tiles.png');
const size = pngSize(asset);
check('道路精灵表已入库', fs.existsSync(asset));
check('道路精灵表为4帧128×64', size?.width === 512 && size?.height === 64);

const boot = fs.readFileSync(path.join(ROOT, 'src', 'phaser', 'scenes', 'BootScene.js'), 'utf8');
const building = fs.readFileSync(path.join(ROOT, 'src', 'world', 'building-system.js'), 'utf8');
const snapshot = fs.readFileSync(path.join(ROOT, 'src', 'world', 'world122-snapshot.js'), 'utf8');
const sink = fs.readFileSync(path.join(ROOT, 'src', 'effects', 'building-sink.js'), 'utf8');
check('BootScene注册4帧道路精灵表',
    boot.includes("this.load.spritesheet('building_road_tiles'")
    && boot.includes('frameWidth: 128')
    && boot.includes('frameHeight: 64'));
check('建筑放置逐格计算4×4状态',
    building.includes('_buildingRoadPlacementStatus(x, y)')
    && building.includes('layout.reservationCells'));
check('外围12格预览按格显示红绿状态',
    building.includes('_updateRoadPreview(x, y, status')
    && building.includes('valid ? 0x9dff9d : 0xff5555'));
check('建造完成自动登记道路环',
    building.includes('BuildingRoadSystem.attach(placedEntity)'));
check('快照恢复重建道路环',
    snapshot.includes('BuildingRoadSystem.attach(tower, { allowOverlap: true })')
    && snapshot.includes('BuildingRoadSystem.attach(producer, { allowOverlap: true })'));
check('建筑沉陷时释放道路环',
    sink.includes("typeof e._removeBuildingRoads === 'function'"));

console.log(`\nWorld-122 building roads: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
