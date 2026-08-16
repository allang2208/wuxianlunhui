#!/usr/bin/env node
/**
 * 世界-122 扩展审计（2026-08-16）：6144×4096 + 分块惰性地板 + 大能源点簇 + 树距。
 * 验证：
 *  A. 场景尺寸 / Renderer.terrainChunks 注册；
 *  B. 相机附近分块被惰性烘焙（sprite 数量、纹理存在）；
 *  C. 能源点簇状分布（数量 ≈ 54、每点距最近簇心 ≤ spread+50）；
 *  D. 散布树最小间距 ≥ 140（配置 minDist 150）；
 *  E. 刷怪点距基地 < alertRange（6200）；
 *  F. 相机移动到远端块 → 新块烘焙、常驻块数有界。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WATCHDOG = setTimeout(() => { console.error('[watchdog] 超时退出'); process.exit(9); }, 150000);
WATCHDOG.unref?.();
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9317;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-expand-audit-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1200,800', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--mute-audio', '--disable-background-timer-throttling',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
edge.on('error', (e) => { console.error('edge spawn error:', e.message); process.exit(3); });
async function waitFor(fn, t = 30000, s = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > t) return null;
        await new Promise((r) => setTimeout(r, s));
    }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const page = await waitFor(async () => {
    const l = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return l && l.find((x) => x.type === 'page');
});
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'log') {
        const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200);
        if (txt.includes('[scene8]') || txt.includes('[floor-chunk]')) logs.push(txt);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
    }
};
const logs = [];
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 800));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8:', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await Promise.race([
        sm.switchScene('scene8', window.Game.player),
        new Promise((r) => setTimeout(() => r('SWITCH_TIMEOUT'), 60000)),
    ]);
    return { scene: sm.currentScene };
})()`));

console.log('wait chunks bake...');
await new Promise((r) => setTimeout(r, 4000));

const audit = await evalJs(`(async () => {
    const out = {};
    // A. 场景尺寸 + 分块注册
    const cfg = (await import('/src/config/config.js')).CONFIG;
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    out.size = [cfg.WORLD_WIDTH, cfg.WORLD_HEIGHT];
    out.chunks = Renderer.terrainChunks ? { chunkSize: Renderer.terrainChunks.chunkSize, mapW: Renderer.terrainChunks.mapW, mapH: Renderer.terrainChunks.mapH } : null;
    // B. 分块烘焙
    const gs = window.__phaserScene;
    const baked = gs ? [] : 'NO_PHASER(无法验证渲染分块)';
    if (gs && gs._terrainChunkSprites) {
        for (const [key, sp] of gs._terrainChunkSprites) {
            baked.push({ key, x: Math.round(sp.x), y: Math.round(sp.y), tex: !!sp.texture });
        }
    }
    out.baked = baked;
    // C. 能源点簇
    const nodes = [];
    for (const e of window.Game.entities.values()) {
        if (e && e._isEnergyNode) nodes.push({ x: e.x, y: e.y });
    }
    const clusters = (await import('/src/config/energy-config.js')).ENERGY_CONFIG.clusters;
    const nearest = nodes.map((n) => Math.min(...clusters.map((c) => Math.hypot(n.x - c.x, n.y - c.y))));
    out.energy = { count: nodes.length, clusters: clusters.length, maxDistToCluster: Math.round(Math.max(...nearest)) };
    // D. 树距
    const trees = (window.WallSystem && window.WallSystem.trees) || [];
    let minTreeDist = Infinity;
    for (let i = 0; i < trees.length; i++) {
        for (let j = i + 1; j < trees.length; j++) {
            const d = Math.hypot(trees[i].x - trees[j].x, trees[i].y - trees[j].y);
            if (d < minTreeDist) minTreeDist = d;
        }
    }
    out.trees = { count: trees.length, minDist: Math.round(minTreeDist) };
    // E. 刷怪点距基地 vs alertRange
    const ds = (window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem).DefenseSystem
        || (window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem);
    const alert = ds && ds._spawnPtsHint === undefined ? null : null;
    const DEF = (await import('/src/world/defense-system.js')).DEFENSE_CONFIG;
    out.spawn = DEF.spawnPoints.map((p) => Math.round(Math.hypot(p.x - 900, p.y - 2048)));
    out.alertRange = DEF.spawn.alertRange;
    return out;
})()`);
console.log(JSON.stringify(audit, null, 1));

// F. 相机移到远端块（传送玩家到东侧），等分块烘焙后看常驻块数是否收敛
const far = await evalJs(`(async () => {
    window.Game.player.x = 5400; window.Game.player.y = 2048;
    await new Promise((r) => setTimeout(r, 5000));
    const gs = window.__phaserScene;
    const keys = gs && gs._terrainChunkSprites ? [...gs._terrainChunkSprites.keys()] : ['NO_PHASER'];
    return { count: keys.length, keys };
})()`);
console.log('far chunk after move:', JSON.stringify(far, null, 1));

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
console.log('--- scene8/floor logs ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
edge.kill();
clearTimeout(WATCHDOG);
console.log('done');
