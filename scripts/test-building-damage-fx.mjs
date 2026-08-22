import {
    buildingDamageFlameCount,
    isBuildingDamageFxTarget,
} from '../src/effects/building-damage-fx.js';
import {
    buildingSinkCropHeight,
    buildingSinkFootprintProjection,
    buildingSinkGroundLine,
    buildingSinkOcclusionPolygon,
} from '../src/effects/building-sink-geometry.js';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function check(name, condition) {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}`);
    }
}

const building = { _isDefenseStructure: true, hp: 100, maxHp: 100 };
check('满血无火焰', buildingDamageFlameCount(building) === 0);
building.hp = 71;
check('高于70%无火焰', buildingDamageFlameCount(building) === 0);
building.hp = 70;
check('70%生命生成2团火焰', buildingDamageFlameCount(building) === 2);
building.hp = 50;
check('50%生命生成5团火焰', buildingDamageFlameCount(building) === 5);
building.hp = 30;
check('30%生命生成8团火焰', buildingDamageFlameCount(building) === 8);
building.hp = 10;
check('低于30%保持8团火焰', buildingDamageFlameCount(building) === 8);

check('普通建筑允许受损特效', isBuildingDamageFxTarget(building));
check('墙体明确排除', !isBuildingDamageFxTarget({ ...building, _isDefenseCover: true }));
check('门明确排除', !isBuildingDamageFxTarget({ ...building, _isCoverGate: true }));

const oneCell = {
    x: 500,
    y: 800,
    collisionShape: 'iso_rect',
    collisionIsoHalfU: 64 / Math.SQRT2,
    collisionIsoHalfV: 64 / Math.SQRT2,
    colliderOffsetX: 0,
    colliderOffsetY: 0,
};
check('沉陷默认回退保持实体原位置，不自动推向 footprint 前缘',
    buildingSinkGroundLine(oneCell) === 800);
check('沉陷主贴图接缝取当前不透明内容底边',
    buildingSinkGroundLine(oneCell, {
        _sinkBaseY: 700,
        originY: 0.5,
    }, {
        displayH: 200,
        bottomOffset: 190,
    }) === 790);
oneCell.sinkGroundMode = 'footprint-front';
check('显式配置时仍可使用 footprint 镜头侧前顶点',
    buildingSinkGroundLine(oneCell) === 832);
const frontAnchored = {
    ...oneCell,
    y: 1000,
    collisionIsoHalfU: 128 / Math.SQRT2,
    collisionIsoHalfV: 128 / Math.SQRT2,
    colliderOffsetY: -64,
};
check('显式 footprint 模式下2×2前顶点锚定保持实体前缘',
    buildingSinkGroundLine(frontAnchored) === 1000);
const fitted = {
    x: 100,
    y: 200,
    sinkGroundMode: 'footprint-front',
    _pixelFootprintLocal: [
        { key: 'back', x: 0, y: -80 },
        { key: 'right', x: 90, y: -40 },
        { key: 'front', x: 4, y: 12 },
        { key: 'left', x: -88, y: -38 },
    ],
};
check('显式 footprint 模式支持异形像素前缘',
    buildingSinkGroundLine(fitted) === 212);
const projection = buildingSinkFootprintProjection(oneCell);
check('沉陷遮盖面积直接读取1×1 footprint的128×64投影',
    projection.bounds.maxX - projection.bounds.minX === 128
    && projection.bounds.maxY - projection.bounds.minY === 64
    && projection.center.x === oneCell.x
    && projection.center.y === oneCell.y);
const undergroundMask = buildingSinkOcclusionPolygon(projection, 2000);
check('贴图地下遮罩沿footprint左前右折线向下延伸，不是水平直线',
    undergroundMask.length === 5
    && undergroundMask[0].x === 436
    && undergroundMask[1].x === 500
    && undergroundMask[1].y === 832
    && undergroundMask[2].x === 564
    && undergroundMask[3].y === 2000
    && undergroundMask[4].y === 2000);
const wideUndergroundMask = buildingSinkOcclusionPolygon(projection, 2000, {
    minX: 400,
    maxX: 600,
});
check('footprint前缘按原斜率延伸到贴图左右视觉边界',
    wideUndergroundMask.length === 7
    && wideUndergroundMask[0].x === 400
    && wideUndergroundMask[0].y === 782
    && wideUndergroundMask[4].x === 600
    && wideUndergroundMask[4].y === 782
    && wideUndergroundMask[5].x === 600
    && wideUndergroundMask[6].x === 400);
check('crop 高度随下沉量收缩并钉在统一接缝',
    buildingSinkCropHeight({
        groundY: 100,
        spriteBaseY: 50,
        displayH: 100,
        originY: 0.5,
        frameH: 100,
        bottomTexel: 90,
        sinkPx: 0,
    }) === 90
    && buildingSinkCropHeight({
        groundY: 100,
        spriteBaseY: 50,
        displayH: 100,
        originY: 0.5,
        frameH: 100,
        bottomTexel: 90,
        sinkPx: 50,
    }) === 50);

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sinkSource = read('src/effects/building-sink.js');
const dustSource = read('src/effects/particle-effects.js');
const factorySource = read('src/utils/effect-factory.js');
const playerUpdateSource = read('src/entities/player/update.js');
check('建筑下沉保持原始depth，接缝遮盖层固定在建筑之上',
    /s\._sinkBaseDepth = Number\(s\.depth\)/.test(sinkSource)
    && /sprite\.setDepth\(sprite\._sinkBaseDepth\)/.test(sinkSource)
    && /this\._maskDepth = Math\.max\(maxDepth, this\._faceDepth\) \+ 0\.8/.test(sinkSource));
check('接缝使用footprint多边形遮盖并在建筑消失后延迟淡出',
    /this\.settleDuration = 700/.test(sinkSource)
    && /_drawSeamOccluder\(sinkP, settleP\)/.test(sinkSource)
    && /g\.fillPoints\(scaleSinkPolygon/.test(sinkSource));
check('贴图本体使用Phaser4 WebGL反向Mask按footprint前缘消失',
    /buildingSinkOcclusionPolygon\([\s\S]{0,120}this\._visualBounds/.test(sinkSource)
    && /list\.addMask\(graphics, true, scene\.cameras\.main, 'world'\)/.test(sinkSource)
    && /if \(this\._polygonMaskActive\)/.test(sinkSource)
    && /无 WebGL Mask Filter 时才使用旧矩形裁剪兜底/.test(sinkSource));
check('地下Mask覆盖全部子精灵联合宽度并留6px余量',
    /this\._visualBounds = \{ minX: minX - 6, maxX: maxX \+ 6 \}/.test(sinkSource)
    && /this\._visualBounds/.test(sinkSource)
    && /this\._clipPolygon = polygon\.map/.test(sinkSource));
check('建筑烟尘复用玩家奔跑同款EffectFactory入口',
    /EffectFactory\.createDustEffect\(/.test(sinkSource)
    && /EffectFactory\.createDustEffect\(this\.x \+ offsetX, this\.y \+ offsetY - 5, dInt\)/.test(playerUpdateSource)
    && !/_updateDust\(dt\)/.test(sinkSource));
check('DustEffect新增可选放大参数且默认1倍不改变玩家效果',
    /constructor\(x, y, intensity, options = \{\}\)/.test(dustSource)
    && /this\.visualScale = Math\.max\(0\.1, Number\(options\.scale\) \|\| 1\)/.test(dustSource)
    && /this\.lifeMultiplier = Math\.max\(0\.1, Number\(options\.lifeMul\) \|\| 1\)/.test(dustSource)
    && /createDustEffect\(x, y, intensity, options = \{\}\)/.test(factorySource)
    && /e\.reset\(x, y, intensity, options\)/.test(factorySource));
check('建筑按footprint面积将奔跑烟尘放大1.65至2.6倍',
    /Math\.max\(1\.65, Math\.min\(2\.6, Math\.sqrt\(projectedArea\) \/ 82\)\)/.test(sinkSource)
    && /lifeMul: 1\.5/.test(sinkSource)
    && /depth: this\._maskDepth \+ 0\.2/.test(sinkSource)
    && /for \(let count = 0; count < 2; count\+\+\)/.test(sinkSource));
const recycleSources = [
    read('src/world/building-system.js'),
    read('src/world/hamster-hut-system.js'),
    read('src/world/hamster-barracks-system.js'),
    read('src/world/producer-building-system.js'),
    read('src/world/defense-system.js'),
];
check('主动回收/出售统一进入 BuildingSinkEffect.start 动画',
    recycleSources.every((source) => /new BuildingSinkEffect\([^)]+\)\.start\(\)/.test(source)));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
