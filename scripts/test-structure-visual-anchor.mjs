import fs from 'node:fs';
import pngjs from 'pngjs';
import {
    fitOpaqueGroundFootprint,
    footOffsetFromOpaqueBottom,
    scanOpaqueGroundContact,
    visualOffsetXFromOpaqueContact,
} from '../src/world/structure-visual-anchor.js';

const { PNG } = pngjs;

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

check('贴图最低行即接地点时回退到显示高度一半',
    footOffsetFromOpaqueBottom(294, 967, 966) === 147);
const researchOffset = footOffsetFromOpaqueBottom(308, 1093, 1078);
check('底部14px透明留白自动从脚底偏移中扣除',
    Math.abs(researchOffset - 150.0567) < 0.01,
    researchOffset.toFixed(3));
check('不同原图尺寸按显示高度等比例换算',
    footOffsetFromOpaqueBottom(296, 1170, 1169) === 148);

check('水平居中的接地点不产生视觉 X 偏移',
    visualOffsetXFromOpaqueContact(288, 100, 49.5) === 0);

function scanAsset(file) {
    const png = PNG.sync.read(fs.readFileSync(new URL(file, import.meta.url)));
    const measured = scanOpaqueGroundContact(
        png.width,
        png.height,
        (x, y) => png.data[(y * png.width + x) * 4 + 3]
    );
    return {
        ...measured,
        offsetX: visualOffsetXFromOpaqueContact(288, png.width, measured.contactX),
    };
}

function fitAsset(file, displayWidth, displayHeight) {
    const png = PNG.sync.read(fs.readFileSync(new URL(file, import.meta.url)));
    return fitOpaqueGroundFootprint(
        png.width,
        png.height,
        (x, y) => png.data[(y * png.width + x) * 4 + 3],
        displayWidth,
        displayHeight,
        { nominalWidth: 256, nominalHeight: 128 }
    );
}

const shootingRange = scanAsset('../assets/terrain/shooting_range.png');
check('合格版靶场最低接地点水平居中',
    Math.abs(shootingRange.offsetX) < 0.2,
    shootingRange.offsetX.toFixed(2));

const barracks = scanAsset('../assets/terrain/barracks.png');
check('合格版军营最低接地点水平居中',
    Math.abs(barracks.offsetX) < 1.5,
    barracks.offsetX.toFixed(2));

const warehouseFit = fitAsset('../assets/terrain/warehouse.png', 288, 308);
check('仓库像素拟合保持接近标准256×128 footprint',
    warehouseFit.collisionWidth > 260
    && warehouseFit.collisionWidth < 270
    && warehouseFit.collisionHeight > 128
    && warehouseFit.collisionHeight < 136
    && warehouseFit.groundAngleDeg > 26
    && warehouseFit.groundAngleDeg < 27
    && warehouseFit.centerX === 0,
    `${warehouseFit.collisionWidth.toFixed(2)}×${warehouseFit.collisionHeight.toFixed(2)} / ${warehouseFit.groundAngleDeg.toFixed(3)}°`);

const shootingFit = fitAsset('../assets/terrain/shooting_range.png', 272, 217);
check('合格版靶场匹配26.565°与256×128占地',
    shootingFit.collisionWidth > 253
    && shootingFit.collisionWidth < 256
    && shootingFit.collisionHeight > 126
    && shootingFit.collisionHeight < 129
    && Math.abs(shootingFit.groundAngleDeg - 26.565) < 0.01
    && shootingFit.centerX === 0
    && Math.abs(shootingFit.visualOffsetX) < 1.5,
    `${shootingFit.collisionWidth.toFixed(2)}×${shootingFit.collisionHeight.toFixed(2)} / ${shootingFit.groundAngleDeg.toFixed(3)}° / offsetX ${shootingFit.visualOffsetX.toFixed(2)}`);

const barracksFit = fitAsset('../assets/terrain/barracks.png', 275, 231);
check('合格版军营匹配26.565°与256×128占地',
    barracksFit.collisionWidth > 254
    && barracksFit.collisionWidth < 257
    && barracksFit.collisionHeight > 127
    && barracksFit.collisionHeight < 129
    && Math.abs(barracksFit.groundAngleDeg - 26.565) < 0.01
    && barracksFit.centerX === 0
    && Math.abs(barracksFit.visualOffsetX) < 1.5,
    `${barracksFit.collisionWidth.toFixed(2)}×${barracksFit.collisionHeight.toFixed(2)} / ${barracksFit.groundAngleDeg.toFixed(3)}° / offsetX ${barracksFit.visualOffsetX.toFixed(2)}`);

const mineFit = fitAsset('../assets/terrain/mine.png', 277, 217);
check('合格版矿场匹配26.565°与256×128占地',
    mineFit.collisionWidth > 253
    && mineFit.collisionWidth < 256
    && mineFit.collisionHeight > 126
    && mineFit.collisionHeight < 129
    && Math.abs(mineFit.groundAngleDeg - 26.565) < 0.01
    && Math.abs(mineFit.visualOffsetX) < 1.5,
    `${mineFit.collisionWidth.toFixed(2)}×${mineFit.collisionHeight.toFixed(2)} / ${mineFit.groundAngleDeg.toFixed(3)}° / offsetX ${mineFit.visualOffsetX.toFixed(2)}`);

const thatchFit = fitAsset('../assets/terrain/thatch_hut.png', 275, 225);
check('合格版茅草屋匹配26.565°与256×128占地',
    thatchFit.collisionWidth > 253
    && thatchFit.collisionWidth < 256
    && thatchFit.collisionHeight > 126
    && thatchFit.collisionHeight < 129
    && Math.abs(thatchFit.groundAngleDeg - 26.565) < 0.01
    && Math.abs(thatchFit.visualOffsetX) < 1.5,
    `${thatchFit.collisionWidth.toFixed(2)}×${thatchFit.collisionHeight.toFixed(2)} / ${thatchFit.groundAngleDeg.toFixed(3)}° / offsetX ${thatchFit.visualOffsetX.toFixed(2)}`);

check('建筑阴影接地区保留真实 alpha 下包络而非只返回标准四边形',
    Array.isArray(thatchFit.contactPolygon)
    && JSON.stringify(thatchFit.contactPolygon) !== JSON.stringify(thatchFit.localVertices),
    `${thatchFit.contactPolygon?.length ?? 0} 点`);
check('真实 alpha 下包络的最低接地点仍锁在逻辑脚点',
    Math.abs(Math.max(...thatchFit.contactPolygon.map((point) => point.y))) < 0.01);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
