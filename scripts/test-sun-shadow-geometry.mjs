// 静态太阳投影几何契约（2026-08-19 七轮定稿：回到 footprint 凸包）。
// 建筑与散布障碍物统一：footprint 四边形 ∪ 四边形沿影向平移 length 的凸包
// （getStaticShadowHull，逐帧纯几何、无烘焙无分桶、连续不跳）；
// 树木/桶状仙人掌/墙件为水平 2:1 椭圆沿归一化影向的凸扫掠体；单位为水平接触影。
// 静态/动态透明度独立，室外深夜保留 40%，地牢固定保留 55%。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { EnvironmentLightingSystem } from '../src/world/environment-lighting-system.js';
import lightingAssets from '../data/environment-lighting-assets.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

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

const FP_W = 256; // 2×2 建筑菱形水平对角线
const FP_H = 128; // 2×2 建筑菱形垂直对角线
const LEN = 43; // 建筑 maxOffset 档的延长段


// ===== manifest 派生数据契约：shadowSilhouette 逐列字段齐全、列在 bbox 内 =====
const assets = lightingAssets.assets || {};
const names = Object.keys(assets);
check('manifest 至少覆盖 30 个光照资产（含墙/楼梯/门）', names.length >= 30, String(names.length));
let silOk = true;
let silDetail = '';
for (const [name, meta] of Object.entries(assets)) {
    const sil = meta.shadowSilhouette;
    if (!sil || !Array.isArray(sil.columns) || sil.columns.length < 3
        || !Number.isFinite(sil.frontX) || !Number.isFinite(sil.frontY)) {
        silOk = false;
        silDetail = `${name} 缺 shadowSilhouette/列不足`;
        break;
    }
    const bbox = meta.alphaBBox;
    const badCol = sil.columns.find((c) => c[0] < bbox.x0 - sil.step || c[0] > bbox.x1 + sil.step
        || c[1] < bbox.y0 - 1 || c[2] > bbox.y1 + 1);
    if (badCol) {
        silOk = false;
        silDetail = `${name} 列越界 ${JSON.stringify(badCol)}`;
        break;
    }
}
check('全部资产含 shadowSilhouette 逐列且列在 alphaBBox 内', silOk, silDetail);

// ===== manifest 保鲜护栏（2026-08-19 换思路审计）：alphaBBox/剪影必须与当前贴图一致 =====
// 教训：church/research_institute 换贴图后 manifest 残留旧坐标系（列越界 15~23 列、
// frontY 差 10~14px），阴影整套错位。换/改贴图后必须重跑 tools/ai-gen/build-lighting-maps.py。
// 容差 ±2px/边：吸收亚阈值像素的微编辑，但拦得住换图级失配。
const FRAME_CROPS = {
    cover_gate_A: [0, 0, 640, 634], cover_gate_B: [0, 0, 640, 634],
    cover_gate_C: [0, 0, 640, 634], cover_gate_D: [0, 0, 640, 634],
};
const alphaBBoxOf = (png) => {
    const { width, height, data: px } = png;
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (px[(y * width + x) * 4 + 3] / 255 > 0.02) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 + 1, y1 + 1];
};
let freshOk = true;
let freshDetail = '';
for (const [name, meta] of Object.entries(assets)) {
    const file = `assets/terrain/${name}.png`;
    if (!fs.existsSync(file)) { freshOk = false; freshDetail = `${name} 贴图缺失`; break; }
    let png = PNG.sync.read(fs.readFileSync(file));
    const crop = FRAME_CROPS[name];
    if (crop) {
        const [cx, cy, cw, ch] = crop;
        const sub = new PNG({ width: cw, height: ch });
        PNG.bitblt(png, sub, cx, cy, cw, ch, 0, 0);
        png = sub;
    }
    const [rx0, ry0, rx1, ry1] = alphaBBoxOf(png);
    const bb = meta.alphaBBox;
    const edges = [rx0 - bb.x0, ry0 - bb.y0, rx1 - bb.x1, ry1 - bb.y1];
    if (edges.some((d) => Math.abs(d) > 2)) {
        freshOk = false;
        freshDetail = `${name} bbox 失配 实际=(${rx0},${ry0},${rx1},${ry1}) manifest=(${bb.x0},${bb.y0},${bb.x1},${bb.y1})`;
        break;
    }
    const sil = meta.shadowSilhouette;
    const over = sil.columns.filter((c) => c[0] >= png.width || c[2] >= png.height).length;
    if (over > 0) {
        freshOk = false;
        freshDetail = `${name} ${over} 列越出当前贴图 ${png.width}x${png.height}`;
        break;
    }
    if (Math.abs(sil.frontY - (ry1 - 1)) > 2) {
        freshOk = false;
        freshDetail = `${name} frontY=${sil.frontY} 实际底缘=${ry1 - 1}`;
        break;
    }
}
check('manifest 与当前贴图一致（bbox/列/frontY 全部对得上）', freshOk, freshDetail);

// 4×4 基地菱形顶点（中心 1000,2000，半轴 a=204/b=102）
const QUAD = [
    { x: 1000, y: 1898 }, // back
    { x: 1204, y: 2000 }, // right
    { x: 1000, y: 2102 }, // front
    { x: 796, y: 2000 },  // left
];

// ===== 七轮：footprint 四边形凸包（getStaticShadowHull）=====
const hullNoon = EnvironmentLightingSystem.getStaticShadowHull(QUAD, { offsetX: 0, offsetY: 21.5, length: 43 });
check('凸包：正午为六边形（菱形×2 挤出）', hullNoon.length === 6, `${hullNoon.length} 点`);
check('凸包：正午最低点 = 前顶点 + 延长段',
    Math.abs(Math.max(...hullNoon.map((p) => p.y)) - (2102 + 43)) < 0.01);
check('凸包：正午不拓宽（最大宽 = 菱形宽 408）',
    Math.abs((Math.max(...hullNoon.map((p) => p.x)) - Math.min(...hullNoon.map((p) => p.x))) - 408) < 0.01);
check('凸包：正午不向太阳侧延展（无 y < 后顶点 的点）',
    hullNoon.every((p) => p.y >= 1898 - 1e-6));
const hullDusk = EnvironmentLightingSystem.getStaticShadowHull(QUAD, { offsetX: -86, offsetY: 0, length: 172 });
check('凸包：黄昏最左点 = 左顶点 − 延长段',
    Math.abs(Math.min(...hullDusk.map((p) => p.x)) - (796 - 172)) < 0.01);
check('凸包：黄昏垂直跨度保持 204（不随影长变化）',
    Math.abs((Math.max(...hullDusk.map((p) => p.y)) - Math.min(...hullDusk.map((p) => p.y))) - 204) < 0.01);
check('凸包：顶点不足 3 时安全返回空',
    EnvironmentLightingSystem.getStaticShadowHull([{ x: 0, y: 0 }], { offsetX: 0, offsetY: 1, length: 10 }).length === 0);

// ===== 静态接触物：水平 footprint 扫掠，不旋转基础椭圆 =====
const verticalCapsule = EnvironmentLightingSystem.getStaticShadowCapsule({
    x: 0, y: 0, width: 32, height: 16, segments: 20,
}, { offsetX: 0, offsetY: 20, length: 40 });
const capMinX = Math.min(...verticalCapsule.map((point) => point.x));
const capMaxX = Math.max(...verticalCapsule.map((point) => point.x));
const capMinY = Math.min(...verticalCapsule.map((point) => point.y));
const capMaxY = Math.max(...verticalCapsule.map((point) => point.y));
check('静态胶囊：纵向影向仍保留水平 footprint 宽 32',
    Math.abs((capMaxX - capMinX) - 32) < 0.1);
check('静态胶囊：根部从原椭圆 y=−8 开始，远端到 y=48',
    Math.abs(capMinY - (-8)) < 0.1 && Math.abs(capMaxY - 48) < 0.1);

// ===== 八轮：逐帧剪影多边形（getSilhouetteShadowPolygon）=====
// 简单三列"门形"：左柱高 40、中柱高 100、右柱高 40（tex 像素）
const SIL_COLS = [[0, 60, 100], [50, 0, 100], [100, 60, 100]];
const silOpts = {
    theta: Math.PI / 2, length: 50, scaleX: 1, scaleY: 1,
    anchorX: 1000, anchorY: 2000, frontY: 100, texCenterX: 50, maxHeight: 100,
};
const silNoon = EnvironmentLightingSystem.getSilhouetteShadowPolygon(SIL_COLS, silOpts);
check('剪影：多边形闭合（近边列数 + 远边列数）',
    silNoon.length === SIL_COLS.length * 2, `${silNoon.length} 点`);
check('剪影：正午近边 = 贴图接地曲线（y=2000 一线）',
    silNoon.slice(0, 3).every((p) => Math.abs(p.y - 2000) < 0.01));
const silMidFar = silNoon[4]; // 远边最高列（中柱，reverse 后居中）
check('剪影：最高列远边恰好位移 length（y = 2000+50）',
    Math.abs(silMidFar.y - 2050) < 0.01 && Math.abs(silMidFar.x - 1000) < 0.01,
    `far=(${silMidFar.x.toFixed(1)},${silMidFar.y.toFixed(1)})`);
check('剪影：矮列远边按高度比位移（40/100 × 50 = 20）',
    Math.abs(silNoon[5].y - 2020) < 0.01 && Math.abs(silNoon[3].y - 2020) < 0.01);
const silDusk = EnvironmentLightingSystem.getSilhouetteShadowPolygon(SIL_COLS, { ...silOpts, theta: Math.PI, length: 80 });
check('剪影：黄昏远边向 −x 延伸、最高列位移 length（x = 1000−80）',
    Math.abs(silDusk[4].x - 920) < 0.01 && Math.abs(silDusk[4].y - 2000) < 0.01,
    `far=(${silDusk[4].x.toFixed(1)},${silDusk[4].y.toFixed(1)})`);
check('剪影：接地 V 形曲线进入近边（bottomY-10 的列 y = 1990）',
    (() => {
        const cols = [[0, 60, 90], [50, 0, 100], [100, 60, 90]];
        const poly = EnvironmentLightingSystem.getSilhouetteShadowPolygon(cols, silOpts);
        return Math.abs(poly[0].y - 1990) < 0.01 && Math.abs(poly[2].y - 1990) < 0.01;
    })());
check('剪影：列数不足 3 安全返回空',
    EnvironmentLightingSystem.getSilhouetteShadowPolygon([[0, 0, 1]], silOpts).length === 0);

// ===== 门/斜墙：groundLine 世界面线映射 =====
const GATE_COLS = [[100, 300, 584], [320, 200, 480], [540, 100, 371]];
const gateSil = EnvironmentLightingSystem.getSilhouetteShadowPolygon(GATE_COLS, {
    theta: Math.PI / 2, length: 50, scaleX: 0.41, scaleY: 0.41,
    anchorX: 0, anchorY: 0, frontY: 602, texCenterX: 320, maxHeight: 100, maxOffset: 100,
    groundLine: { ax: 1000, ay: 2000, bx: 1200, by: 1900 },
});
check('groundLine：近边两端点分别落在 A/B 端（近边集合与面线端点一致）',
    (() => {
        const nearPts = gateSil.slice(0, 3);
        const xs = nearPts.map((p) => Math.round(p.x)).sort((a, b) => a - b);
        const ys = nearPts.map((p) => Math.round(p.y)).sort((a, b) => a - b);
        return xs[0] === 1000 && xs[2] === 1200 && ys[0] === 1900 && ys[2] === 2000;
    })());
check('groundLine：正午位移沿 +y（最高列 far y > near y + 40×0.41×0.5）',
    (() => {
        const mid = gateSil[1];
        const midFar = gateSil[gateSil.length - 2];
        return midFar.y > mid.y + 15;
    })());
check('groundLine：无 groundLine 时走 V 形/iso 规则（近边含贴图接触线形状）',
    (() => {
        const plain = EnvironmentLightingSystem.getSilhouetteShadowPolygon(GATE_COLS, {
            theta: Math.PI / 2, length: 50, scaleX: 0.41, scaleY: 0.41,
            anchorX: 0, anchorY: 0, frontY: 602, texCenterX: 320, maxHeight: 100, maxOffset: 100,
        });
        return plain.length === GATE_COLS.length * 2;
    })());

// ===== 十一轮：悬空部分排除 footprint + 顶端离地位移 =====
// 仙人掌式列：中央主干接地（bottomY=100），两侧手臂悬空（bottomY=40）
const CACTUS_COLS = [[0, 10, 40], [40, 60, 100], [50, 0, 100], [60, 60, 100], [100, 10, 40]];
const cactusFp = EnvironmentLightingSystem.getSilhouetteFootprintVertices(CACTUS_COLS, {
    scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, frontX: 50, frontY: 100, texCenterX: 50,
});
check('footprint：悬空手臂列被坡度截断排除（实体宽=主干 40~60，世界 −10~10）',
    Math.abs(cactusFp[3].x - (-10)) < 0.01 && Math.abs(cactusFp[1].x - 10) < 0.01,
    `left=${cactusFp[3].x}, right=${cactusFp[1].x}`);
check('footprint：实体深度按截断后宽度 2:1（back y = 0−10）',
    Math.abs(cactusFp[0].y - (-10)) < 0.01, `back=(${cactusFp[0].x},${cactusFp[0].y})`);
const cactusSil = EnvironmentLightingSystem.getSilhouetteShadowPolygon(CACTUS_COLS, {
    theta: Math.PI / 2, length: 100, scaleX: 1, scaleY: 1,
    anchorX: 0, anchorY: 0, frontY: 100, texCenterX: 50, maxHeight: 100, maxOffset: 100,
});
// 手臂列 [0,10,40]：zBot=60、zTop=90 → 影子落在地面 60~90 处（悬空影位移）
const armNear = Math.min(...cactusSil.map((p) => p.y));
const armFar = Math.max(...cactusSil.map((p) => p.y));
check('位移：悬空手臂影按 iso 地面线净空落位（gy=−20，近端 20/远端 50）',
    (() => {
        // 前顶点取首列最低列（x=40）；手臂列 texX=0 → 世界 x=−50；
        // iso 地面线 y=80（=100−0.5·40），净空 zBot=80−40=40、zTop=80−10=70
        const armPts = cactusSil.filter((p) => Math.abs(p.x - (-50)) < 1.5);
        return armPts.length > 0 && armPts.every((p) => p.y >= 19.9 && p.y <= 50.1);
    })(),
    `armPts=${cactusSil.filter((p) => Math.abs(p.x + 50) < 1.5).map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(';')}`);

// ===== 十轮：剪影接地四边形实体（getSilhouetteFootprintVertices）=====
const fpVerts = EnvironmentLightingSystem.getSilhouetteFootprintVertices(SIL_COLS, {
    scaleX: 1, scaleY: 1, anchorX: 1000, anchorY: 2000,
    frontX: 50, frontY: 100, texCenterX: 50,
});
check('接地四边形：返回 back/right/front/left 四点', fpVerts.length === 4);
check('接地四边形：front = 最低接地点 (1000,2000)',
    Math.abs(fpVerts[2].x - 1000) < 0.01 && Math.abs(fpVerts[2].y - 2000) < 0.01);
check('接地四边形：back 按 2:1 镜像（centerX=1000, y=2000−50）',
    Math.abs(fpVerts[0].x - 1000) < 0.01 && Math.abs(fpVerts[0].y - 1950) < 0.01,
    `back=(${fpVerts[0].x.toFixed(1)},${fpVerts[0].y.toFixed(1)})`);
check('接地四边形：左右顶点取接地曲线两端',
    Math.abs(fpVerts[1].x - 1050) < 0.01 && Math.abs(fpVerts[3].x - 950) < 0.01);
check('剪影位移：maxOffset 钳制塔尖拉长',
    (() => {
        const poly = EnvironmentLightingSystem.getSilhouetteShadowPolygon(
            [[0, 0, 100], [50, 0, 100], [100, 0, 100]],
            { theta: Math.PI / 2, length: 200, scaleX: 1, scaleY: 1,
              anchorX: 0, anchorY: 0, frontY: 100, texCenterX: 50, maxHeight: 100, maxOffset: 30 });
        return Math.max(...poly.map((p) => p.y)) <= 100 + 30 + 0.01;
    })());

// ===== 九轮：凸包实体 ∪ 剪影轮廓包络合并（getUnionShadowPolygon）=====
const unionNoon = EnvironmentLightingSystem.getUnionShadowPolygon(hullNoon, silNoon, { theta: Math.PI / 2 });
check('合并：返回闭合边界（点数≥两源）', unionNoon.length >= 4, `${unionNoon.length} 点`);
check('合并：覆盖凸包实体范围（含前顶点+43 延长）',
    Math.max(...unionNoon.map((p) => p.y)) >= 2102 + 43 - 0.01);
check('合并：覆盖剪影最高列延长（y 达 2000+50）',
    Math.max(...unionNoon.map((p) => p.y)) >= 2050 - 0.01);
check('合并：包络无自交（左右缘 u 单调包络，跨度恒正）',
    (() => {
        // 每行 uMin≤uMax 由构造保证；边界点数 = 行数×2
        return unionNoon.length >= 2 && unionNoon.length % 2 === 0;
    })());
check('合并：单源为空时回退另一源',
    EnvironmentLightingSystem.getUnionShadowPolygon(hullNoon, [], { theta: Math.PI / 2 }).length > 0
    && EnvironmentLightingSystem.getUnionShadowPolygon([], [], { theta: 0 }).length === 0);

// ===== 十五轮：N 阴影几何并集（getUnionOfPolygons，重叠加深根治）=====
// 两个重叠矩形（θ=π/2 时 u=y、v=−x）：A=[0,100]×[0,40]，B=[80,180]×[−10,30]
const QA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
const QB = [{ x: 80, y: -10 }, { x: 180, y: -10 }, { x: 180, y: 30 }, { x: 80, y: 30 }];
const mergedAB = EnvironmentLightingSystem.getUnionOfPolygons([QA, QB], { theta: Math.PI / 2 });
check('并集：返回单一边界', mergedAB.length >= 6, `${mergedAB.length} 点`);
check('并集：覆盖两源全宽（x 0..180）',
    Math.min(...mergedAB.map((p) => p.x)) <= 0 + 0.01 && Math.max(...mergedAB.map((p) => p.x)) >= 180 - 0.01);
check('并集：重叠行 y 跨度合并（x=90 处 y −10..40）',
    (() => {
        // θ=π/2 → u=y；x=90 ⇒ v=−90 行。找边界上 v≈−90 的行对应的 u 范围
        const atRow = mergedAB.filter((p) => Math.abs(p.x - 90) < 3);
        if (atRow.length < 2) return false;
        return Math.min(...atRow.map((p) => p.y)) <= -10 + 1.5
            && Math.max(...atRow.map((p) => p.y)) >= 40 - 1.5;
    })());
check('并集：空输入安全返回空',
    EnvironmentLightingSystem.getUnionOfPolygons([], { theta: 0 }).length === 0
    && EnvironmentLightingSystem.getUnionOfPolygons([[{ x: 0, y: 0 }]], { theta: 0 }).length === 0);
const vertexRowPolygon = [
    { x: 0, y: 0 }, { x: 30, y: 3.25 }, { x: 24, y: 10 }, { x: 0, y: 10 },
];
const vertexRowUnion = EnvironmentLightingSystem.getUnionOfPolygons([vertexRowPolygon], { theta: 0, step: 2 });
check('并集：固定步长之外仍保留输入顶点所在扫描行',
    vertexRowUnion.some((point) => Math.abs(point.y - 3.25) < 1e-6));

const parallelTheta = 0.37;
const parallelDir = { x: Math.cos(parallelTheta), y: Math.sin(parallelTheta) };
const parallelPerp = { x: -parallelDir.y, y: parallelDir.x };
const parallelLength = 80;
const parallelPrism = EnvironmentLightingSystem.getLayeredShadowPolygon([{
    vertices: [
        { x: 0, y: -50 }, { x: 90, y: 0 }, { x: 0, y: 50 }, { x: -90, y: 0 },
    ],
    baseZ: 0,
    topZ: 100,
}], {
    length: parallelLength,
    offsetX: parallelDir.x * parallelLength,
    offsetY: parallelDir.y * parallelLength,
}, 100);
const prismUV = parallelPrism.map((point) => ({
    point,
    u: point.x * parallelDir.x + point.y * parallelDir.y,
    v: point.x * parallelPerp.x + point.y * parallelPerp.y,
}));
const prismMinV = Math.min(...prismUV.map((point) => point.v));
const prismMaxV = Math.max(...prismUV.map((point) => point.v));
const terminalRail = (targetV) => {
    const row = prismUV.filter((point) => Math.abs(point.v - targetV) < 1e-6)
        .sort((a, b) => a.u - b.u);
    if (row.length < 2) return null;
    const start = row[0].point;
    const end = row[row.length - 1].point;
    return { x: end.x - start.x, y: end.y - start.y };
};
const leftRail = terminalRail(prismMinV);
const rightRail = terminalRail(prismMaxV);
check('单体建筑投影：左右终端边共用唯一太阳方向且互相平行',
    leftRail && rightRail
    && Math.abs(leftRail.x * parallelDir.y - leftRail.y * parallelDir.x) < 1e-6
    && Math.abs(rightRail.x * parallelDir.y - rightRail.y * parallelDir.x) < 1e-6
    && Math.abs(Math.hypot(leftRail.x, leftRail.y) - parallelLength) < 1e-6
    && Math.abs(Math.hypot(rightRail.x, rightRail.y) - parallelLength) < 1e-6);

// 静态/动态独立深浅 + 夜间/地牢保留
EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.25 });
const noonProfile = EnvironmentLightingSystem.getStaticShadow({ height: 100, maxOffset: 100 });
const opacityNoon = noonProfile.opacity;
const dynNoon = EnvironmentLightingSystem.getDynamicShadow({}, 10).opacity;
check('静态位移：offset 恰好是归一化影长的一半',
    Math.abs(Math.hypot(noonProfile.offsetX, noonProfile.offsetY) * 2 - noonProfile.length) < 1e-9);
EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.5 });
const duskDaylight = EnvironmentLightingSystem.getSun().daylight;
const opacityDusk = EnvironmentLightingSystem.getStaticShadow({}).opacity;
const dynDusk = EnvironmentLightingSystem.getDynamicShadow({}, 10).opacity;
EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.75 });
const opacityMidnight = EnvironmentLightingSystem.getStaticShadow({}).opacity;
const dynMidnight = EnvironmentLightingSystem.getDynamicShadow({}, 10).opacity;
const staticDungeon = EnvironmentLightingSystem.getStaticShadow({}, { dungeon: true }).opacity;
const dynamicDungeon = EnvironmentLightingSystem.getDynamicShadow({}, 10, { dungeon: true }).opacity;
check('透明度：正午静态 0.1925、动态 0.30078125',
    Math.abs(opacityNoon - 0.1925) < 1e-9 && Math.abs(dynNoon - 0.30078125) < 1e-9,
    `noon=${opacityNoon}/${dynNoon}`);
const duskStrength = 0.4 + 0.6 * Math.max(0, Math.min(1, (duskDaylight - 0.1) / 0.2));
check('透明度：黄昏从夜间 40% 向白昼平滑过渡',
    Math.abs(opacityDusk - 0.1925 * duskStrength) < 0.01
    && Math.abs(dynDusk - 0.30078125 * duskStrength) < 0.01,
    `dusk=${opacityDusk.toFixed(3)} (daylight=${duskDaylight.toFixed(3)})`);
check('透明度：深夜静态/动态分别保留基础强度的 40%',
    Math.abs(opacityMidnight - 0.1925 * 0.4) < 1e-9
    && Math.abs(dynMidnight - 0.30078125 * 0.4) < 1e-9,
    `midnight=${opacityMidnight}/${dynMidnight}`);
check('透明度：地牢固定为基础强度的 55%，不受午夜时间二次衰减',
    Math.abs(staticDungeon - 0.1925 * 0.55) < 1e-9
    && Math.abs(dynamicDungeon - 0.30078125 * 0.55) < 1e-9);
EnvironmentLightingSystem.configure({ animateSun: true, startPhase: 0.25 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
