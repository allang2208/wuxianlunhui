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

// 显示尺寸一律读建筑配置真源（2026-08-21/22 资产重裁后同步过一轮配置）
const producerCfg = JSON.parse(fs.readFileSync(new URL('../data/producer-buildings.json', import.meta.url), 'utf8'));
const barracksCfg = JSON.parse(fs.readFileSync(new URL('../data/hamster-barracks-building.json', import.meta.url), 'utf8'));
const minerCampCfg = JSON.parse(fs.readFileSync(new URL('../data/hamster-miner-camp-building.json', import.meta.url), 'utf8'));

// 接地点水平偏移：运行时由 resolveStructureGroundFit 的 visualOffsetX 自动补偿，
// 这里只锁"偏移有限且在补偿合理范围"，不再要求资产零偏移。
const shootingRange = scanAsset('../assets/terrain/shooting_range.png');
check('靶场接地点水平偏移在渲染补偿范围内',
    Number.isFinite(shootingRange.offsetX) && Math.abs(shootingRange.offsetX) < 25,
    shootingRange.offsetX.toFixed(2));

const barracks = scanAsset('../assets/terrain/barracks.png');
check('军营接地点水平偏移在渲染补偿范围内',
    Number.isFinite(barracks.offsetX) && Math.abs(barracks.offsetX) < 25,
    barracks.offsetX.toFixed(2));

// 视觉 footprint 只服务接地预览/结构阴影（逻辑碰撞仍走 2×2 iso_rect），
// 因此锁定结构不变量：围绕逻辑脚点居中、等距角在 26~31° 带内、占地贴近 256×128 nominal。
function checkVisualFit(name, fit) {
    check(`${name}视觉 footprint 拟合结构不变量（居中/等距角/贴近 nominal 占地）`,
        fit.centerX === 0
        && fit.collisionWidth > 220 && fit.collisionWidth < 270
        && fit.collisionHeight > 105 && fit.collisionHeight < 155
        && fit.groundAngleDeg > 26 && fit.groundAngleDeg < 31
        && Number.isFinite(fit.visualOffsetX) && Math.abs(fit.visualOffsetX) < 25,
        `${fit.collisionWidth.toFixed(2)}×${fit.collisionHeight.toFixed(2)} / ${fit.groundAngleDeg.toFixed(3)}° / offsetX ${fit.visualOffsetX.toFixed(2)}`);
}

checkVisualFit('仓库', fitAsset('../assets/terrain/warehouse.png',
    producerCfg.warehouse.displayW, producerCfg.warehouse.displayH));
checkVisualFit('靶场', fitAsset('../assets/terrain/shooting_range.png',
    producerCfg.shooting_range.displayW, producerCfg.shooting_range.displayH));
checkVisualFit('军营', fitAsset('../assets/terrain/barracks.png',
    barracksCfg.displayW, barracksCfg.displayH));
checkVisualFit('矿场', fitAsset('../assets/terrain/mine.png',
    minerCampCfg.displayW, minerCampCfg.displayH));
const thatchFit = fitAsset('../assets/terrain/thatch_hut.png',
    producerCfg.thatch_hut.displayW, producerCfg.thatch_hut.displayH);
checkVisualFit('茅草屋', thatchFit);

check('建筑阴影接地区保留真实 alpha 下包络而非只返回标准四边形',
    Array.isArray(thatchFit.contactPolygon)
    && JSON.stringify(thatchFit.contactPolygon) !== JSON.stringify(thatchFit.localVertices),
    `${thatchFit.contactPolygon?.length ?? 0} 点`);
check('真实 alpha 下包络的最低接地点仍锁在逻辑脚点',
    Math.abs(Math.max(...thatchFit.contactPolygon.map((point) => point.y))) < 0.01);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
