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
check('靶场按底部接地前顶点自动左移约42px，与2×2 footprint前顶点对齐',
    shootingRange.offsetX < -40 && shootingRange.offsetX > -44,
    shootingRange.offsetX.toFixed(2));

const barracks = scanAsset('../assets/terrain/barracks.png');
check('军营按底部接地前顶点自动左移约31px，与2×2 footprint前顶点对齐',
    barracks.offsetX < -29 && barracks.offsetX > -33,
    barracks.offsetX.toFixed(2));

const warehouseFit = fitAsset('../assets/terrain/warehouse.png', 288, 308);
check('仓库像素拟合保持接近标准256×128 footprint',
    warehouseFit.collisionWidth > 260
    && warehouseFit.collisionWidth < 275
    && warehouseFit.collisionHeight > 125
    && warehouseFit.collisionHeight < 135
    && Math.abs(warehouseFit.centerX) < 10,
    `${warehouseFit.collisionWidth.toFixed(2)}×${warehouseFit.collisionHeight.toFixed(2)} / centerX ${warehouseFit.centerX.toFixed(2)}`);

const shootingFit = fitAsset('../assets/terrain/shooting_range.png', 288, 272);
check('靶场自动识别更深的接地底座并左移碰撞中心',
    shootingFit.collisionWidth > 265
    && shootingFit.collisionWidth < 282
    && shootingFit.collisionHeight > 160
    && shootingFit.collisionHeight < 176
    && shootingFit.centerX < -30,
    `${shootingFit.collisionWidth.toFixed(2)}×${shootingFit.collisionHeight.toFixed(2)} / centerX ${shootingFit.centerX.toFixed(2)}`);

const barracksFit = fitAsset('../assets/terrain/barracks.png', 288, 230);
check('军营自动识别底座展开高度并拟合宽深',
    barracksFit.collisionWidth > 255
    && barracksFit.collisionWidth < 270
    && barracksFit.collisionHeight > 140
    && barracksFit.collisionHeight < 158
    && barracksFit.centerX < -15,
    `${barracksFit.collisionWidth.toFixed(2)}×${barracksFit.collisionHeight.toFixed(2)} / centerX ${barracksFit.centerX.toFixed(2)}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
