// 队员指挥轮盘指令纯函数单测（2026-08-14）
// 运行：node --import ./scripts/register-json-loader.mjs scripts/test-command.mjs
await import('./register-json-loader.mjs');
const {
    isCommandActive, pickPatrolPoint, pickNearestNode,
} = await import('../src/ai/companion-ai-decision.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else { failed++; console.log(`FAIL  ${name}`); }
}

console.log('[test-command] 指令激活判定');
{
    check('follow 不激活', isCommandActive({ mode: 'follow' }) === false);
    check('无指令不激活', isCommandActive(null) === false);
    check('gather 激活', isCommandActive({ mode: 'gather' }) === true);
    check('hold 激活', isCommandActive({ mode: 'hold' }) === true);
    check('patrol 激活', isCommandActive({ mode: 'patrol' }) === true);
    check('aggressive 激活', isCommandActive({ mode: 'aggressive' }) === true);
}

console.log('[test-command] 巡逻点选择');
{
    const center = { x: 2000, y: 2000 };
    const seed = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    let okRange = true;
    for (let i = 0; i < 50; i++) {
        const p = pickPatrolPoint({ center, radius: 1200, bounds: { w: 4096, h: 4096 }, rand: seed });
        if (Math.hypot(p.x - center.x, p.y - center.y) > 1200 + 1e-6) { okRange = false; break; }
    }
    check('50 个采样点全部在 1200px 圆内', okRange);
    // 边界钳制：中心贴角落时不出世界
    let okBounds = true;
    for (let i = 0; i < 200; i++) {
        const p = pickPatrolPoint({ center: { x: 0, y: 0 }, radius: 1200, bounds: { w: 4096, h: 4096 }, rand: seed });
        if (p.x < 40 || p.y < 40 || p.x > 4056 || p.y > 4056) { okBounds = false; break; }
    }
    check('角落中心采样全部钳制在边界内', okBounds);
}

console.log('[test-command] 最近资源点选择');
{
    const ref = { x: 100, y: 100 };
    const nodes = [
        { x: 500, y: 500, active: true, _depleted: false },
        { x: 200, y: 200, active: true, _depleted: false },
        { x: 50, y: 120, active: false, _depleted: false },   // 失效不选
        { x: 60, y: 90, active: true, _depleted: true },      // 枯竭不选
    ];
    check('选最近有效点', pickNearestNode(nodes, ref) === nodes[1]);
    check('空列表返回 null', pickNearestNode([], ref) === null);
    check('全枯竭返回 null', pickNearestNode([nodes[2], nodes[3]], ref) === null);
}

console.log(`[test-command] ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
