/** 世界-122 建筑 footprint 回归：墙1×1、普通建筑2×2、基地4×4。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    WALL_STAIR_FOOTPRINTS,
    ONE_CELL_BUILDING_FOOT,
    TWO_BY_TWO_BUILDING_FOOT,
    FOUR_BY_FOUR_BASE_FOOT,
    applyBuildingFootprint,
    applyFittedBuildingFootprint,
    applyWallStairFootprint,
} = await import('../src/world/building-footprint.js');
const { Entity } = await import('../src/entities/entity.js');
const {
    STRUCTURE_DEPTH_OFFSET,
    setupStructureDepth,
    structureDepthRelationAtPoint,
    structureDepthSpan,
} = await import('../src/world/structure-depth.js');
const {
    isoFootprintCenter,
    isoFootprintsOverlap,
    pointInIsoFootprint,
    resolveCircleFromIsoFootprint,
} = await import('../src/physics/iso-footprint.js');
const { default: producerCfg } = await import('../data/producer-buildings.json');
const { WallSystem } = await import('../src/world/wall-system.js');

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
    && ONE_CELL_BUILDING_FOOT.collisionRadius === 64
    && ONE_CELL_BUILDING_FOOT.offY === 0);
check('标准格网公式由单格宽度和Y投影统一推导',
    TWO_BY_TWO_BUILDING_FOOT.w === ONE_CELL_BUILDING_FOOT.w * 2
    && TWO_BY_TWO_BUILDING_FOOT.d === TWO_BY_TWO_BUILDING_FOOT.w * 0.5
    && TWO_BY_TWO_BUILDING_FOOT.offY === -TWO_BY_TWO_BUILDING_FOOT.d / 2
    && FOUR_BY_FOUR_BASE_FOOT.w === ONE_CELL_BUILDING_FOOT.w * 4
    && FOUR_BY_FOUR_BASE_FOOT.d === FOUR_BY_FOUR_BASE_FOOT.w * 0.5
    && FOUR_BY_FOUR_BASE_FOOT.offY === -FOUR_BY_FOUR_BASE_FOOT.d / 2);

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

const platformFootprint = new Entity(100, 200);
applyWallStairFootprint(platformFootprint, 'e2');
check('射击台占地为单格，默认e2只描述格内坡面方向',
    platformFootprint._buildingFootprintCells === 1
    && platformFootprint._wallStairDir === 'e2'
    && platformFootprint.colliderOffsetX === 0
    && platformFootprint.colliderOffsetY === 0
    && platformFootprint.collisionIsoHalfU === WALL_STAIR_FOOTPRINTS.e2.halfU
    && platformFootprint.collisionIsoHalfV === WALL_STAIR_FOOTPRINTS.e2.halfV);
applyWallStairFootprint(platformFootprint, 'e1');
check('F镜像后的射击台保持单格并切换格内e1坡面',
    platformFootprint._wallStairDir === 'e1'
    && platformFootprint._buildingFootprintCells === 1
    && platformFootprint.colliderOffsetX === 0
    && platformFootprint.colliderOffsetY === 0
    && platformFootprint.collisionIsoHalfU === WALL_STAIR_FOOTPRINTS.e1.halfU
    && platformFootprint.collisionIsoHalfV === WALL_STAIR_FOOTPRINTS.e1.halfV);

// 真实构造顺序：Entity 的旧圆 Collider 已存在，随后才切换 footprint、注册深度、重建 Collider。
// 深度几何必须直接读取逻辑坐标 + 新 offset，不能被旧 collider 中心污染。
const constructorOrderSample = new Entity(100, 200);
applyBuildingFootprint(constructorOrderSample, 2);
setupStructureDepth(constructorOrderSample);
check('建筑构造阶段不读取尚未重建的旧Collider中心',
    constructorOrderSample.collider.y === 200
    && isoFootprintCenter(constructorOrderSample).y === 136
    && constructorOrderSample._faceDepth === 200 + STRUCTURE_DEPTH_OFFSET
    && constructorOrderSample._faceLine[0].y === 136
    && constructorOrderSample._faceLine[1].y === 136);
const localFront = structureDepthRelationAtPoint(constructorOrderSample, 40, 171);
const localBehind = structureDepthRelationAtPoint(constructorOrderSample, 40, 169);
check('建筑前后关系按当前X位置的footprint局部前缘判定',
    localFront?.frontY === 170
    && localFront.inFront === true
    && localBehind?.frontY === 170
    && localBehind.inFront === false);
const previousWindow = globalThis.window;
globalThis.window = {
    ...(previousWindow || {}),
    Game: { entities: new Map([['depth-building', constructorOrderSample]]) },
    GateFaceSegs: [],
};
const previousFaceCache = WallSystem._faceSegCache;
WallSystem._faceSegCache = [];
const correctedFront = WallSystem.junctionCorrectedDepth(40, 171, 181, 60);
const correctedBehind = WallSystem.junctionCorrectedDepth(40, 169, 500, 60);
const constructorDepthSpan = structureDepthSpan(constructorOrderSample);
check('最终图层仲裁保证局部前方在建筑上、局部后方在建筑下',
    correctedFront === constructorDepthSpan.frontDepth + 0.5
    && correctedBehind === constructorDepthSpan.frontDepth - 0.5);
WallSystem._faceSegCache = previousFaceCache;
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
applyBuildingFootprint(constructorOrderSample, 4);
check('后续调整建筑占地会自动刷新图层几何',
    constructorOrderSample._structureDepthHalfWidth === 256
    && constructorOrderSample._faceLine[0].x === -156
    && constructorOrderSample._faceLine[1].x === 356
    && constructorOrderSample._faceDepth === 200 + STRUCTURE_DEPTH_OFFSET);
constructorOrderSample.rebuildCollider();
check('重建Collider后碰撞中心与图层前缘保持同一真源',
    constructorOrderSample.collider.y === 72
    && constructorOrderSample._faceDepth === 200 + STRUCTURE_DEPTH_OFFSET);

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

const pixelFitSample = new Entity(100, 200);
applyBuildingFootprint(pixelFitSample, 2);
applyFittedBuildingFootprint(pixelFitSample, {
    centerX: -14,
    centerY: -64,
    collisionWidth: 224,
    collisionHeight: 128,
    collisionRadius: 129,
    localVertices: [
        { key: 'back', x: -28, y: -128 },
        { key: 'right', x: 98, y: -64 },
        { key: 'front', x: 0, y: 0 },
        { key: 'left', x: -126, y: -64 },
    ],
});
pixelFitSample.rebuildCollider();
setupStructureDepth(pixelFitSample);
check('像素拟合四边形同步更新Collider中心与局部前缘',
    pixelFitSample.collider.x === 86
    && pixelFitSample.collider.y === 136
    && pixelFitSample._structureFrontY === 200
    && pointInIsoFootprint(100, 199, pixelFitSample)
    && !pointInIsoFootprint(220, 136, pixelFitSample));
const pixelPush = resolveCircleFromIsoFootprint(86, 136, 20, pixelFitSample);
check('像素拟合四边形支持圆形单位精确推出',
    pixelPush && Math.hypot(pixelPush.x, pixelPush.y) > 20);
applyBuildingFootprint(pixelFitSample, 2);
check('重新应用标准格网公式会清除旧像素拟合残留',
    !pixelFitSample._pixelFootprintLocal
    && pixelFitSample.collisionWidth === 256
    && pixelFitSample.collisionHeight === 128
    && pixelFitSample.colliderOffsetX === 0
    && pixelFitSample.colliderOffsetY === -64);
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
const wallSrc = fs.readFileSync(path.join(ROOT, 'src/world/wall-system.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');

check('防御塔、射击台与基地应用2×2/单格/4×4碰撞',
    /applyBuildingFootprint\(this, 2\)/.test(defenseSrc)
    && /applyWallStairFootprint\(this, this\.dir\)/.test(defenseSrc)
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
check('动态遮挡按完整建筑footprint判定，墙门线段端点禁止外推',
    /structureDepthRelationAtPoint\(e, x, y/.test(wallSrc)
    && /Math\.max\(0, Math\.min\(1, rawT\)\)/.test(wallSrc));
check('墙、门与普通建筑共用唯一地面前缘深度公式',
    /structureDepthAtY/.test(defenseSrc)
    && /structureDepthAtY/.test(buildingSrc)
    && !/this\._depthL = A\.y \+ 12/.test(defenseSrc)
    && !/this\._depthBars = \(A\.y \+ B\.y\) \/ 2 \+ 12/.test(defenseSrc));
check('所有非墙门建筑统一吸附2×2格网并走完整footprint判定',
    /function isTwoByTwoBuildItem\(item\)/.test(buildingSrc)
    && /return this\._snapBuildingGrid\(x, y, 2\)/.test(buildingSrc)
    && /return this\._canPlaceBuildingFootprint\(x, y\)/.test(buildingSrc));
check('2×2建筑边界与清障半径共用 footprint 真源',
    /TWO_BY_TWO_BUILDING_FOOT\.w/.test(buildingSrc)
    && /TWO_BY_TWO_BUILDING_FOOT\.clearRadius/.test(buildingSrc));
check('预览与实体共用塔、射击台、方块墙视觉参数',
    /DEFENSE_TOWER_VISUAL\.base\.w/.test(buildingSrc)
    && /WALL_STAIR_VISUAL\.w/.test(buildingSrc)
    && /BLOCK_VISUAL\.w/.test(buildingSrc));
check('建筑面板楼梯图标锁定正式贴图（面板 e1_pos 常亮 / 默认 e2_pos）',
    /DEFAULT_WALL_STAIR_TEXTURE =[\s\S]{0,80}variants\.e2_pos\?\.lower\?\.texture/.test(buildingSrc)
    && /WALL_STAIR_PANEL_ICON =[\s\S]{0,80}variants\.e1_pos\?\.lower\?\.texture/.test(buildingSrc)
    && /icon: WALL_STAIR_PANEL_ICON/.test(buildingSrc));
check('楼梯吸附只忽略目标墙并跳过全部不可建候选',
    /const ignoreEntities = new Set\(\[snap\.wall\]\)/.test(buildingSrc)
    && !/const ignoreEntities = new Set\(attachedWalls\)/.test(buildingSrc)
    && /不可建造的内层墙[\s\S]{0,180}return null;/.test(buildingSrc));
check('普通建筑像素只校正视觉锚点，物理默认固定标准格网',
    /resolveStructureGroundFit/.test(gameSceneSrc)
    && /applyFittedBuildingFootprint/.test(gameSceneSrc)
    && /_getVisualOffsetX\(e, sprite\)/.test(gameSceneSrc)
    && /_ghostGroundFit\(\)/.test(buildingSrc)
    && /autoFootprint: cfg\.autoFootprint === true/.test(producerSrc)
    && /autoFootprint: false/.test(hutSrc)
    && /autoFootprint: false/.test(barracksSrc)
    && /entity\.spriteCfg\?\.autoFootprint === true/.test(gameSceneSrc)
    && /PRODUCER_BUILDINGS\[item\.id\]\?\.autoFootprint === true/.test(buildingSrc));
check('防御塔恢复放大前视觉尺寸但继续保留2×2 footprint',
    /base: \{\s*w: 170,\s*h: 262,\s*footOffsetY: 131,/.test(defenseSrc)
    && /w: 137,[\s\S]{0,80}h: 86/.test(defenseSrc)
    && /pivotWorldY: 235/.test(defenseSrc)
    && /applyBuildingFootprint\(this, 2\)/.test(defenseSrc));

const producerEntries = Object.values(producerCfg).filter((cfg) => cfg && typeof cfg === 'object' && cfg.id);
check('配置建筑碰撞统一为2×2，贴图保持同级显示尺度（守夜烛台为特例小建筑）',
    producerEntries.length > 0 && producerEntries.every((cfg) =>
        cfg.id === 'dungeon_candle' || (
            cfg.radius === TWO_BY_TWO_BUILDING_FOOT.collisionRadius
            && cfg.displayW >= 256
            && cfg.displayH > 0
            && cfg.footOffsetY > 0)));

const research = producerCfg.research_institute;
const pngPath = path.join(ROOT, 'assets/terrain/research_institute.png');
const png = fs.readFileSync(pngPath);
const pngW = png.readUInt32BE(16);
const pngH = png.readUInt32BE(20);
check('研究院抠图贴图已按 2×2 footprint 接入',
    research.assetPending !== true
    && typeof research.assetCutoutHash === 'string'
    && research.displayW === 256
    && research.displayH === 234
    && research.footOffsetY === 116
    && pngW === 873
    && pngH === 798,
    `${pngW}×${pngH}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
