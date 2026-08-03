/**
 * 墙体碰撞空间网格差分测试（2026-08-03）
 *
 * WallSystem 新增空间加速（_getCollisionGrid）后，canMoveTo/blocked/_nearestBlockingSeg/resolve
 * 走网格近邻查询。本测试用同一份随机场景分别跑"线性版"与"网格版"，断言逐项完全一致——
 * 网格是候选超集 + 相同谓词，任何结果差异都说明查询覆盖漏件或语义偏差。
 *
 * 用法：node scripts/test-collision-grid.mjs（已自注册 JSON loader）
 */
await import('./register-json-loader.mjs');

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WallSystem } = await import(pathToFileURL(path.join(ROOT, 'src/world/wall-system.js')).href);

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; }
    else {
        failed++;
        console.error(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
    }
}

// 确定性伪随机（LCG），保证失败可复现
let seed = 0xC0FFEE;
function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return seed / 0x7FFFFFFF;
}
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const R = () => rand() * 2200 - 1100;

function randomScenario() {
    const walls = [];
    const nWalls = randInt(0, 60);
    for (let i = 0; i < nWalls; i++) {
        walls.push({ x: R(), y: R(), w: randInt(10, 400), h: randInt(10, 400) });
    }
    const segs = [];
    const nSegs = randInt(0, 45);
    for (let i = 0; i < nSegs; i++) {
        const s = { x1: R(), y1: R(), x2: R(), y2: R() };
        // 约 15% 缺 halfThick（radius + undefined = NaN，永不阻挡——必须与线性一致）
        if (rand() < 0.85) s.halfThick = randInt(2, 24);
        segs.push(s);
    }
    const trees = [];
    const nTrees = randInt(0, 30);
    for (let i = 0; i < nTrees; i++) {
        const tr = randInt(12, 140);
        // 约 30% 缺 collisionRadius（回退 radius*0.6）
        trees.push({ x: R(), y: R(), radius: tr, collisionRadius: rand() < 0.7 ? tr * 0.6 : undefined });
    }
    return { walls, segs, trees };
}

function install(scenario) {
    WallSystem.walls = scenario.walls;
    WallSystem.isoSegments = scenario.segs;
    WallSystem.trees = scenario.trees;
}

/** 一次性生成查询参数（两轮对比必须跑同一批，不能边生成边比） */
function genQueries(count) {
    const qs = [];
    for (let i = 0; i < count; i++) {
        const x = R(), y = R(), r = randInt(4, 55);
        const nx = x + R() * 0.4, ny = y + R() * 0.4;
        const x2 = x + R() * 0.8, y2 = y + R() * 0.8;
        qs.push({ x, y, r, nx, ny, x2, y2 });
    }
    return qs;
}

/** 跑一批查询，返回序列化结果（数值精确 toPrecision，段按对象身份 → 数组下标） */
function runQueries(scenario, queries) {
    install(scenario);
    return queries.map(({ x, y, r, nx, ny, x2, y2 }, i) => {
        const parts = [];
        parts.push(`C${WallSystem.canMoveTo(x, y, r)}`);
        parts.push(`B${WallSystem.blocked(x, y, x2, y2)}`);
        parts.push(`BZ${WallSystem.blocked(x, y, x, y)}`); // 零长射线
        const nn = WallSystem._nearestBlockingSeg(x, y, r);
        parts.push(`N${nn === null ? -1 : scenario.segs.indexOf(nn)}`);
        const res = WallSystem.resolve(x, y, nx, ny, r);
        parts.push(`R${res.x.toPrecision(10)},${res.y.toPrecision(10)}`);
        if (i === 0 && scenario.walls.length && scenario.segs.length) {
            const ignore = { rects: new Set([scenario.walls[0]]), segs: new Set([scenario.segs[0]]) };
            parts.push(`I${WallSystem.blocked(x, y, x2, y2, ignore)}`);
        }
        return parts.join('|');
    }).join('|');
}

// ========== 1. 差分：线性 vs 网格（多场景 × 多查询） ==========
console.log('[1] 差分：线性 vs 空间网格');
let diffFail = 0;
for (let s = 0; s < 12; s++) {
    seed = 0xC0FFEE + s * 7919;
    const scenario = randomScenario();
    const queries = genQueries(250);

    WallSystem._collisionAccel = false;
    const linear = runQueries(scenario, queries);

    WallSystem._collisionAccel = true;
    const grid = runQueries(scenario, queries);

    if (linear !== grid) {
        diffFail++;
        console.error(`  \u2717 场景 ${s} 结果不一致`);
        // 找第一个差异点
        const la = linear.split('|'), ga = grid.split('|');
        for (let i = 0; i < Math.min(la.length, ga.length); i++) {
            if (la[i] !== ga[i]) {
                console.error(`    首个差异 @${i}: 线性=${la[i]} 网格=${ga[i]}`);
                break;
            }
        }
    }
}
check('12 个随机场景（各 250 查询）线性/网格完全一致', diffFail === 0, `diffFail=${diffFail}`);

// ========== 2. 变更追踪：push/splice/整体赋值必须即时反映到网格 ==========
console.log('[2] 变更追踪（代理脏标记）');
{
    seed = 42;
    const scenario = randomScenario();
    install(scenario);
    // 找当前场景下的开放探针点（避免撞上既有障碍物导致"before"已为 false）
    const openProbe = () => {
        for (let i = 0; i < 300; i++) {
            const p = { x: R(), y: R() };
            if (WallSystem.canMoveTo(p.x, p.y, 16)) return p;
        }
        return { x: -9000, y: -9000 };
    };

    const probeA = openProbe();
    let before = WallSystem.canMoveTo(probeA.x, probeA.y, 16);

    // push 一块墙到探针位置附近
    const newWall = { x: probeA.x - 10, y: probeA.y - 10, w: 20, h: 20 };
    WallSystem.walls.push(newWall);
    const afterPush = WallSystem.canMoveTo(probeA.x, probeA.y, 16);
    check('push 新墙后 canMoveTo 立即反映', before === true && afterPush === false, `${before}->${afterPush}`);

    // splice 移除 → 恢复
    const wi = WallSystem.walls.indexOf(newWall);
    WallSystem.walls.splice(wi, 1);
    const afterSplice = WallSystem.canMoveTo(probeA.x, probeA.y, 16);
    check('splice 移除墙后恢复可走', afterSplice === true);

    // 整体赋值新墙
    WallSystem.walls = [{ x: probeA.x - 10, y: probeA.y - 10, w: 20, h: 20 }];
    check('整体赋值后 canMoveTo 反映', WallSystem.canMoveTo(probeA.x, probeA.y, 16) === false);

    // 段 push/splice
    WallSystem.isoSegments = [];
    const segProbe = openProbe();
    const beforeSeg = WallSystem.canMoveTo(segProbe.x, segProbe.y, 16);
    const newSeg = { x1: segProbe.x - 30, y1: segProbe.y, x2: segProbe.x + 30, y2: segProbe.y, halfThick: 5 };
    WallSystem.isoSegments.push(newSeg);
    const afterSeg = WallSystem.canMoveTo(segProbe.x, segProbe.y, 16);
    check('段 push 后 canMoveTo 反映', beforeSeg === true && afterSeg === false, `${beforeSeg}->${afterSeg}`);
    const si2 = WallSystem.isoSegments.indexOf(newSeg);
    WallSystem.isoSegments.splice(si2, 1);
    check('段 splice 后恢复', WallSystem.canMoveTo(segProbe.x, segProbe.y, 16) === true);

    // 树 push
    WallSystem.trees = [];
    const tProbe = openProbe();
    const beforeTree = WallSystem.canMoveTo(tProbe.x, tProbe.y, 16);
    WallSystem.trees.push({ x: tProbe.x, y: tProbe.y, radius: 40, collisionRadius: 24 });
    const afterTree = WallSystem.canMoveTo(tProbe.x, tProbe.y, 16);
    check('树 push 后 canMoveTo 反映', beforeTree === true && afterTree === false, `${beforeTree}->${afterTree}`);

    // 长度指纹兜底：整体赋值后绕过代理直接改原数组（模拟外部持有引用）
    WallSystem.walls = [{ x: probeA.x - 10, y: probeA.y - 10, w: 20, h: 20 }];
    WallSystem.canMoveTo(probeA.x, probeA.y, 16); // 建网格
    const raw = WallSystem._wallsRaw;
    raw.push({ x: 99999, y: 99999, w: 10, h: 10 }); // 绕过代理
    check('长度指纹兜底：绕过代理的 push 也被捕获重建', WallSystem.canMoveTo(99999 + 1, 99999 + 1, 2) === false);
}

// ========== 3. 空场景/边界 ==========
console.log('[3] 空场景与边界');
{
    WallSystem.walls = [];
    WallSystem.isoSegments = [];
    WallSystem.trees = [];
    check('空场景 canMoveTo=true', WallSystem.canMoveTo(0, 0, 20) === true);
    check('空场景 blocked=false', WallSystem.blocked(0, 0, 100, 100) === false);
    check('空场景 nearestBlockingSeg=null', WallSystem._nearestBlockingSeg(0, 0, 20) === null);
    check('空场景 resolve=原位置', (() => {
        const r = WallSystem.resolve(0, 0, 30, 40, 10);
        return r.x === 30 && r.y === 40;
    })());
}

// 恢复默认
WallSystem._collisionAccel = true;

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
