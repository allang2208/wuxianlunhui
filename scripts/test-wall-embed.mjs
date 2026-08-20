/**
 * test-wall-embed.mjs — 嵌墙投射物"只出不进"判定测试（V0.313）
 * 运行：node --import ./scripts/register-json-loader.mjs scripts/test-wall-embed.mjs
 *
 * 场景（iso 面线 + 矩形墙两种嵌墙形态）：
 *   1. 嵌墙朝射手侧（房内）发射 → 存活（贴墙开火修复目标）
 *   2. 嵌墙背向（往墙外钻）发射 → 首帧销毁（不能穿墙）
 *   3. 离墙正常射击撞墙 → 撞线销毁（原物理不变）
 *   4. 嵌墙放行后撞上第二面墙 → 销毁（放行只对嵌墙那一面有效）
 *   5. 矩形墙内出膛：朝射手侧越出 → 存活；从另一侧钻出 → 销毁
 *   6. 无嵌墙正常子弹：无嵌墙记录，飞行不受影响
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WallSystem } = await import('../src/world/wall-system.js');
const { projectileWallContext } = await import('../src/combat/elevated-ranged.js');

// Projectile 类：剥 import 后注入桩执行（damage-pipeline 链会拉进 Phaser，node 下不可直接 import）
const projSrc = fs.readFileSync(path.join(ROOT, 'src/combat/projectile.js'), 'utf-8')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('import '))
    .join('\n')
    .replace('export { Projectile };', '');
const Projectile = new Function(
    'WallSystem', 'DamagePipeline', 'segmentIntersectsCapsule', 'segmentHitsTorso',
    'ELEVATION', 'PERSPECTIVE_SCALE_Y', 'SpatialPartitionSystem', 'projectileWallContext',
    projSrc + '\nreturn Projectile;'
)(
    WallSystem,
    { applyHit() {} },
    () => false, () => false,
    { FLYING: 1 }, 0.5,
    { queryRadius: () => [] },
    projectileWallContext
);

let passed = 0, failed = 0;
const ok = (cond, msg) => {
    if (cond) { passed++; console.log('  ✓', msg); }
    else { failed++; console.error('  ✗', msg); }
};

// 场景墙：iso 面线 x=100（y0~400，含阶梯碰撞块）+ 远处 iso 面线 x=300(y0~140) + 矩形墙 (300,150,20,100)
function setupWalls() {
    WallSystem.walls = [
        { x: 300, y: 150, w: 20, h: 100, height: 60 },
        // iso 阶梯碰撞块（沿 x=100 面线每 30px 一块，与生产环境同构）
        { x: 82, y: 100, w: 36, h: 20, height: 60, noVisual: true, _iso: true },
        { x: 82, y: 130, w: 36, h: 20, height: 60, noVisual: true, _iso: true },
        { x: 82, y: 160, w: 36, h: 20, height: 60, noVisual: true, _iso: true },
        { x: 82, y: 190, w: 36, h: 20, height: 60, noVisual: true, _iso: true },
        { x: 82, y: 220, w: 36, h: 20, height: 60, noVisual: true, _iso: true },
    ];
    WallSystem.trees = [];
    WallSystem.isoSegments = [
        { x1: 100, y1: 0, x2: 100, y2: 400, halfThick: 10 },
        { x1: 300, y1: 0, x2: 300, y2: 140, halfThick: 10 },
    ];
}

function makeBullet(x, y, angle, source) {
    const p = new Projectile(x, y, angle, 1000, 5000, 6, 10, false, source, new Map(), null);
    p._embeddedWalls = WallSystem.detectEmbeddedWalls(x, y, source);
    return p;
}
function step(p, frames = 10) {
    for (let i = 0; i < frames && p.active; i++) p.update(16.7);
    return p.active;
}

const shooter = { x: 150, y: 200 };

// 1. 嵌墙朝射手侧（房内）发射 → 存活
{
    setupWalls();
    const p = makeBullet(80, 200, 0, shooter); // 出膛点在面线另一侧，朝 +x（射手侧）
    ok(p._embeddedWalls && p._embeddedWalls.segs.length === 1, '嵌墙检测：iso 面线被识别');
    ok(step(p, 10), '嵌墙朝房内发射存活');
}

// 2. 嵌墙背向（往墙外钻）发射 → 首帧销毁
{
    setupWalls();
    const p = makeBullet(80, 200, Math.PI, shooter); // 朝 -x（背向射手）
    ok(!step(p, 3), '嵌墙背向钻透首帧销毁');
}

// 3. 离墙正常射击撞墙 → 撞线销毁
{
    setupWalls();
    const p = makeBullet(400, 200, Math.PI, shooter); // 远处朝墙打
    ok(!step(p, 40), '离墙朝墙射击撞线销毁');
}

// 4. 嵌墙放行后撞上第二面墙 → 销毁
{
    setupWalls();
    const p = makeBullet(80, 200, 0, shooter);
    ok(!step(p, 40), '嵌墙放行后撞第二面墙销毁');
}

// 5. 矩形墙内出膛
{
    setupWalls();
    const inRectShooter = { x: 400, y: 200 }; // 射手在矩形右侧
    const p1 = makeBullet(310, 200, 0, inRectShooter);  // 朝 +x（射手侧）越出
    ok(p1._embeddedWalls && p1._embeddedWalls.rects.length === 1, '嵌墙检测：矩形墙被识别');
    ok(step(p1, 10), '矩形墙内朝射手侧越出存活');
    const p2 = makeBullet(310, 200, Math.PI, inRectShooter); // 朝 -x（另一侧）钻出
    ok(!step(p2, 5), '矩形墙内从另一侧钻出销毁');
}

// 6. 无嵌墙正常子弹（射手与出膛点间无任何墙）
{
    setupWalls();
    const p = makeBullet(150, 400, Math.PI / 2, shooter); // 正下方发射，路径不穿任何墙
    ok(p._embeddedWalls === null, '无嵌墙时无嵌墙记录');
    ok(step(p, 10), '正常子弹飞行不受影响');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
