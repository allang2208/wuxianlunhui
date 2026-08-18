/** 世界-122 建筑 footprint 回归：墙1×1、普通建筑2×2、基地4×4。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    ONE_CELL_BUILDING_FOOT,
    TWO_BY_TWO_BUILDING_FOOT,
    FOUR_BY_FOUR_BASE_FOOT,
    applyBuildingFootprint,
} = await import('../src/world/building-footprint.js');
const { Entity } = await import('../src/entities/entity.js');
const { setupStructureDepth } = await import('../src/world/structure-depth.js');
const {
    isoFootprintsOverlap,
    pointInIsoFootprint,
    resolveCircleFromIsoFootprint,
} = await import('../src/physics/iso-footprint.js');
const { default: producerCfg } = await import('../data/producer-buildings.json');

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

check('墙体单格 footprint 保持 128×64',
    ONE_CELL_BUILDING_FOOT.w === 128
    && ONE_CELL_BUILDING_FOOT.d === 64
    && ONE_CELL_BUILDING_FOOT.collisionRadius === 64);

const sample = {};
applyBuildingFootprint(sample, 2);
check('普通建筑统一写入2×2矩形碰撞',
    sample._isTwoByTwoBuilding === true
    && sample._buildingFootprintCells === 2
    && sample.collisionShape === 'iso_rect'
    && sample.collisionWidth === 256
    && sample.collisionHeight === 128
    && sample.collisionRadius === 128
    && sample.colliderOffsetX === 0
    && sample.colliderOffsetY === -64);
const runtimeSample = new Entity(100, 200);
applyBuildingFootprint(runtimeSample, 2);
runtimeSample.rebuildCollider();
setupStructureDepth(runtimeSample);
check('运行时Collider与遮挡线同步读取2×2 footprint',
    runtimeSample.groundRadius === 128
    && runtimeSample.collider.radius === 128
    && runtimeSample.collider.y === 136
    && runtimeSample._faceLine[0].x === -28
    && runtimeSample._faceLine[1].x === 228
    && runtimeSample._faceLines.length === 2
    && runtimeSample._structureDepthHalfWidth === 128);
check('地面旋转矩形排除AABB空角并保留地板轴内点',
    !pointInIsoFootprint(220, 196, runtimeSample)
    && pointInIsoFootprint(160, 166, runtimeSample));
const adjacent = new Entity(228, 264);
applyBuildingFootprint(adjacent, 2);
adjacent.rebuildCollider();
const overlapping = new Entity(227, 263);
applyBuildingFootprint(overlapping, 2);
overlapping.rebuildCollider();
check('2×2建筑沿地面轴可无缝贴边且内缩1px判重叠',
    !isoFootprintsOverlap(runtimeSample, adjacent)
    && isoFootprintsOverlap(runtimeSample, overlapping));
const push = resolveCircleFromIsoFootprint(runtimeSample.collider.x, runtimeSample.collider.y, 20, runtimeSample);
check('单位位于建筑内部时按最近地面边推出', push && Math.hypot(push.x, push.y) > 20);
const baseSample = {};
applyBuildingFootprint(baseSample, 4);
check('基地统一写入4×4矩形碰撞',
    FOUR_BY_FOUR_BASE_FOOT.w === 512
    && FOUR_BY_FOUR_BASE_FOOT.d === 256
    && FOUR_BY_FOUR_BASE_FOOT.collisionRadius === 256
    && baseSample._isFourByFourBuilding === true
    && baseSample.collisionWidth === 512
    && baseSample.collisionHeight === 256);

const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const hutSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-hut-system.js'), 'utf8');
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');

check('防御塔、射击台与基地应用2×2/4×4碰撞',
    (defenseSrc.match(/applyBuildingFootprint\(this, 2\)/g) || []).length >= 2
    && /applyBuildingFootprint\(this, 4\)/.test(defenseSrc));
check('方块墙与门同样使用地面旋转矩形',
    /this\.collisionShape = 'iso_rect'/.test(defenseSrc)
    && /applyIsoFootprintFromSegment\(this, this\._faceLine\[0\], this\._faceLine\[1\]/.test(defenseSrc)
    && /thick: 26/.test(defenseSrc));
check('矿场、军营和配置建筑实体应用2×2碰撞',
    /applyBuildingFootprint\(this, 2\)/.test(hutSrc)
    && /applyBuildingFootprint\(this, 2\)/.test(barracksSrc)
    && /applyBuildingFootprint\(this, 2\)/.test(producerSrc));
check('放大建筑遮挡线改为读取footprint而非贴图宽度',
    /setupStructureDepth\(this\)/.test(hutSrc)
    && /setupStructureDepth\(this\)/.test(barracksSrc)
    && /setupStructureDepth\(this\)/.test(producerSrc)
    && /setupStructureDepth\(this\)/.test(defenseSrc));
check('所有非墙门陷阱建筑统一吸附2×2格网并走完整footprint判定',
    /function isTwoByTwoBuildItem\(item\)/.test(buildingSrc)
    && /return this\._snapBuildingGrid\(x, y, 2\)/.test(buildingSrc)
    && /return this\._canPlaceBuildingFootprint\(x, y\)/.test(buildingSrc));
check('2×2建筑边界与清障半径共用 footprint 真源',
    /TWO_BY_TWO_BUILDING_FOOT\.w/.test(buildingSrc)
    && /TWO_BY_TWO_BUILDING_FOOT\.clearRadius/.test(buildingSrc));
check('预览与实体共用塔、射击台、方块墙视觉参数',
    /DEFENSE_TOWER_VISUAL\.base\.w/.test(buildingSrc)
    && /FIRING_PLATFORM_VISUAL\.w/.test(buildingSrc)
    && /BLOCK_VISUAL\.w/.test(buildingSrc));
check('防御塔恢复放大前视觉尺寸但继续保留2×2 footprint',
    /base: \{ w: 170, h: 262, footOffsetY: 131 \}/.test(defenseSrc)
    && /w: 137,[\s\S]{0,80}h: 86/.test(defenseSrc)
    && /pivotWorldY: 235/.test(defenseSrc)
    && /applyBuildingFootprint\(this, 2\)/.test(defenseSrc));

const producerEntries = Object.values(producerCfg).filter((cfg) => cfg && typeof cfg === 'object' && cfg.id);
check('配置建筑碰撞和贴图统一为2×2尺度',
    producerEntries.length > 0 && producerEntries.every((cfg) =>
        cfg.radius === TWO_BY_TWO_BUILDING_FOOT.collisionRadius
        && cfg.displayW >= 288
        && cfg.displayH >= 294));

const research = producerCfg.research_institute;
const pngPath = path.join(ROOT, 'assets/terrain/research_institute.png');
const png = fs.readFileSync(pngPath);
const pngW = png.readUInt32BE(16);
const pngH = png.readUInt32BE(20);
check('研究院正式贴图已裁边并接入',
    research.assetPending !== true
    && research.displayW === 288
    && research.displayH === 308
    && research.footOffsetY === 154
    && pngW === 1024
    && pngH === 1093,
    `${pngW}×${pngH}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
