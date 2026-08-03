/**
 * 寻路性能基准 + 回归门槛（2026-08-03）
 *
 * 背景：V0.377 全量审计发现冷路径 findPath 约 10ms（_buildGrid 占 92%），
 * 刷怪瞬间 15 只怪同帧冷寻路可达 50~115ms 主线程卡顿。本次优化落地：
 *  1. 静态格子结果记忆化（_getCellData 合并单趟查询 + 跨寻路复用）
 *  2. 每帧寻路预算（PATH_DEFERRED 哨兵，超预算下帧重试）
 *  3. 不可达负缓存（短 TTL）+ 出口路径短缓存
 *  4. 首寻路 0~250ms 随机错峰
 *
 * 用法：node tools/pathfinding-bench.mjs
 * 回归断言（宽松阈值，防机器差异误报；若优化被回退会明显超限）：
 *  - 单次冷路径 < 50ms
 *  - 15 怪同帧冷寻路批量 < 90ms（优化前精英房实测 106ms）
 *  - 缓存命中 < 5ms
 */

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1) JSON 导入钩子（源码按 Vite 约定裸导 .json）
await import('../scripts/register-json-loader.mjs');
// 2) src/game.js 桩（Phaser 链无法在 Node 加载）
register(pathToFileURL(path.join(ROOT, 'tools/pathfinding-hooks.mjs')).href, pathToFileURL(ROOT + path.sep).href);

const { WallSystem } = await import(pathToFileURL(path.join(ROOT, 'src/world/wall-system.js')).href);
const { pathFinder, PATH_DEFERRED } = await import(pathToFileURL(path.join(ROOT, 'src/ai/pathfinder.js')).href);
const { regionIndex } = await import(pathToFileURL(path.join(ROOT, 'src/ai/region-index.js')).href);

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  \u2713 ${name}`); }
    else { failed++; console.error(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`); }
}

/** 合成菱形战斗房：四边 = isoSegments（瓦片 140px 一段）+ 阶梯矩形墙块（每 30px 一块 36×20） */
function buildRoom(rx, ry) {
    const walls = [];
    const segs = [];
    const addEdge = (x1, y1, x2, y2) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        for (let d = 0; d < len - 60; d += 132) {
            segs.push({
                x1: x1 + ux * d, y1: y1 + uy * d,
                x2: x1 + ux * Math.min(d + 140, len), y2: y1 + uy * Math.min(d + 140, len),
                halfThick: 5
            });
        }
        for (let d = 15; d < len - 15; d += 30) {
            const px = x1 + ux * d, py = y1 + uy * d;
            walls.push({ x: px - 18, y: py - 10, w: 36, h: 20, height: 60, noVisual: true, _iso: true });
        }
    };
    addEdge(0, -ry, rx, 0);
    addEdge(rx, 0, 0, ry);
    addEdge(0, ry, -rx, 0);
    addEdge(-rx, 0, 0, -ry);
    segs.splice(3, 1); // 开一个门洞保证可达
    return { walls, segs };
}

function setup(rx, ry) {
    const { walls, segs } = buildRoom(rx, ry);
    WallSystem.walls = walls;
    WallSystem.isoSegments = segs;
    WallSystem.trees = [
        { x: rx * 0.3, y: -ry * 0.2, radius: 70, collisionRadius: 42 },
        { x: -rx * 0.25, y: ry * 0.2, radius: 80, collisionRadius: 48 },
    ];
    pathFinder.invalidateCache();
    regionIndex.markDirty();
    return { walls, segs };
}

function bench(label, rx, ry) {
    const { walls, segs } = setup(rx, ry);
    const radius = 16;
    const start = { x: -rx * 0.35, y: -ry * 0.25 };
    const end = { x: rx * 0.35, y: ry * 0.25 };

    // 1) 冷路径（清缓存后第一只怪）
    pathFinder.invalidateCache();
    pathFinder.beginFrame();
    let t0 = performance.now();
    const p1 = pathFinder.findPath(start.x, start.y, end.x, end.y, radius);
    const cold = performance.now() - t0;

    // 2) 缓存命中
    t0 = performance.now();
    const p2 = pathFinder.findPath(start.x, start.y, end.x, end.y, radius);
    const warm = performance.now() - t0;

    // 3) 15 只怪同帧各自冷寻路（模拟刷怪后集体 chase，起点互不相同）
    pathFinder.invalidateCache();
    pathFinder.beginFrame();
    t0 = performance.now();
    let paths = 0, deferred = 0;
    for (let i = 0; i < 15; i++) {
        const sx = -rx * 0.45 + (i % 5) * rx * 0.2;
        const sy = -ry * 0.45 + Math.floor(i / 5) * ry * 0.2;
        const r = pathFinder.findPath(sx, sy, end.x, end.y, radius);
        if (r === PATH_DEFERRED) deferred++;
        else if (r) paths++;
    }
    const fifteen = performance.now() - t0;
    // 帧预算下首批未完成的应在随后几帧补跑完成（memo 已热，单条成本低）
    const remaining = Array.from({ length: 15 }, (_, i) => i);
    const frameTimes = [];
    let catchup = 0;
    while (remaining.length > 0 && frameTimes.length < 5) {
        pathFinder.beginFrame();
        const t1 = performance.now();
        const still = [];
        for (const i of remaining) {
            const sx = -rx * 0.45 + (i % 5) * rx * 0.2;
            const sy = -ry * 0.45 + Math.floor(i / 5) * ry * 0.2;
            const r = pathFinder.findPath(sx, sy, end.x, end.y, radius);
            if (r && r !== PATH_DEFERRED) catchup++;
            else still.push(i);
        }
        remaining.length = 0;
        remaining.push(...still);
        frameTimes.push(performance.now() - t1);
    }
    const maxCatchupFrame = Math.max(...frameTimes);

    // 4) 不可达：A* 失败 + findPathToExit（负缓存前/后各测一次）
    const outside = { x: rx + 300, y: ry + 300 };
    pathFinder.invalidateCache();
    pathFinder.beginFrame();
    t0 = performance.now();
    const ex1 = pathFinder.findPath(start.x, start.y, outside.x, outside.y, radius);
    const exitFirst = performance.now() - t0;
    t0 = performance.now();
    const ex2 = pathFinder.findPath(start.x, start.y, outside.x, outside.y, radius);
    const exitRepeat = performance.now() - t0;

    // 5) 半径隔离正确性（memo 契约 = 格子中心采样，与 _buildGrid 一致）：
    // 找一颗树附近 86~100px 的格子中心——r=16 可走（d>70+16），r=30 阻挡（d<70+30）。
    // 必须在加冰墙前测，避免冰墙矩形误挡探针。
    const tree = WallSystem.trees[0];
    let probe = null;
    probeLoop:
    for (let gx = Math.floor(tree.x / 40) - 3; gx <= Math.floor(tree.x / 40) + 3; gx++) {
        for (let gy = Math.floor(tree.y / 40) - 1; gy <= Math.floor(tree.y / 40) + 4; gy++) {
            const cx = gx * 40 + 20, cy = gy * 40 + 20;
            const d = Math.hypot(cx - tree.x, cy - tree.y);
            if (d > 86 && d < 100) { probe = { x: cx, y: cy }; break probeLoop; }
        }
    }
    const cd16 = probe ? pathFinder._getCellData(probe.x, probe.y, 16) : null;
    const cd30 = probe ? pathFinder._getCellData(probe.x, probe.y, 30) : null;
    const cd16Again = probe ? pathFinder._getCellData(probe.x, probe.y, 16) : null;

    // 6) 冰墙增删：加 10 段后 resolve 单次开销（移动碰撞热路径）
    for (let i = 0; i < 10; i++) {
        WallSystem.isoSegments.push({ x1: -100 + i * 40, y1: -40, x2: -60 + i * 40, y2: 40, halfThick: 5 });
        for (let d = 15; d < 75; d += 30) {
            WallSystem.walls.push({ x: -100 + i * 40 + d - 18, y: -30, w: 36, h: 20, height: 60, noVisual: true, _iso: true });
        }
    }
    const reps = 2000;
    t0 = performance.now();
    for (let i = 0; i < reps; i++) WallSystem.resolve(start.x, start.y, start.x + 20, start.y + 8, radius);
    const resolveUs = (performance.now() - t0) / reps * 1000;

    console.log(`\n[${label}] walls=${walls.length} segs=${segs.length} trees=2`);
    console.log(`  cold path          : ${cold.toFixed(2)} ms  (path len=${p1 ? p1.length : 'null'})`);
    console.log(`  warm (cache hit)   : ${warm.toFixed(2)} ms`);
    console.log(`  15 怪同帧冷寻路     : ${fifteen.toFixed(1)} ms (实算 ${paths}，预算推迟 ${deferred}/15)`);
    console.log(`  后续补跑(≤5帧)     : ${catchup}/15 完成, 单帧最高 ${maxCatchupFrame.toFixed(1)} ms`);
    console.log(`  不可达 首次/重复    : ${exitFirst.toFixed(2)} / ${exitRepeat.toFixed(3)} ms`);
    console.log(`  resolve/次(+10冰墙) : ${resolveUs.toFixed(2)} us`);
    console.log(`  半径隔离 16/30/16   : ${cd16 ? cd16.blocked : 'N/A'}/${cd30 ? cd30.blocked : 'N/A'}/${cd16Again ? cd16Again.blocked : 'N/A'} (期望 false/true/false)`);

    check(`${label} 单次冷路径 < 50ms`, cold < 50, cold.toFixed(2));
    check(`${label} 缓存命中 < 5ms`, warm < 5, warm.toFixed(2));
    check(`${label} 15 怪同帧批量 < 90ms`, fifteen < 90, fifteen.toFixed(1));
    check(`${label} 帧预算推迟后 ≤5 帧内全部补跑`, catchup === 15, `catchup=${catchup}`);
    check(`${label} 补跑单帧成本 < 50ms（无长卡顿）`, maxCatchupFrame < 50, maxCatchupFrame.toFixed(1));
    check(`${label} 首批路径完成数 + 推迟数 = 15`, paths + deferred === 15, `${paths}+${deferred}`);
    check(`${label} 不可达重复查询 < 5ms（负缓存生效）`, exitRepeat < 5, exitRepeat.toFixed(3));
    check(`${label} 不可达两次都判 null（ex1=${ex1 === null}, ex2=${ex2 === null}）`, ex1 === null && ex2 === null);
    check(`${label} 半径隔离：r16 可走 r30 阻挡且互不污染`, probe !== null && cd16.blocked === false && cd30.blocked === true && cd16Again.blocked === false,
        `${probe ? cd16.blocked + '/' + cd30.blocked + '/' + cd16Again.blocked : '探针未找到'}`);
}

console.log('寻路性能基准 + 回归（合成战斗房，真实源码）');
bench('普通战斗房', 512, 512);
bench('精英战斗房', 896, 896);
bench('Boss战斗房', 1024, 1024);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
