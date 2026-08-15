#!/usr/bin/env node
/** 世界-122 随机 100 棵树观察（2026-08-15）：
 * scene8 全图随机散布 5 变体等距树（编辑器口径缩放 obstacleH/geo.h，0.9~1.1 抖动、随机镜像），
 * canMoveTo + 最小间距防叠放，避开基地房/玩家/能源点/刷怪点；随后多角度截图。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9322;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-scatter-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); await r.json(); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const l = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const page = l.find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
function send(method, params = {}) { return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
}
await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 90; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 700));
}
if (!ready) { console.error('not ready\n' + errs.join('\n')); edge.kill(); process.exit(2); }
await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`);
// 渲染就绪：等场景内容 sprite 出现
await evalJs(`(async () => {
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const scene = window.__phaserScene;
        if (!scene) continue;
        let n = 0;
        scene.children.list.forEach((c) => { if (c && c.active && c.visible && c.type === 'Image') n++; });
        if (n > 5) return n;
    }
    return -1;
})()`);

// 散布 100 棵
console.log(JSON.stringify(await evalJs(`(async () => {
    const WallSystem = (await import('/src/world/wall-system.js')).WallSystem;
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    const p = window.Game.player;

    // 能源点坐标（排除带）
    let nodePos = [];
    try {
        const cfgMod = await import('/src/config/energy-config.js');
        const cfg = cfgMod.ENERGY_CONFIG || cfgMod.default || {};
        nodePos = cfg.positions || (cfg.nodes || []).map((n) => ({ x: n.x, y: n.y }));
    } catch (e) { /* 拿不到就扫描实体 */ }
    if (!nodePos.length) {
        for (const e of window.Game.entities.values()) {
            if (e && String(e.id || '').includes('energy')) nodePos.push({ x: e.x, y: e.y });
        }
    }
    const spawnPts = [
        { x: 3936, y: 600 }, { x: 3936, y: 1350 }, { x: 3936, y: 2048 }, { x: 3936, y: 2746 },
        { x: 3936, y: 3496 }, { x: 3736, y: 900 }, { x: 3736, y: 3196 },
    ];
    const keys = ['tall', 'bushy', 'twin', 'wind', 'tiered'];
    const pieces = [];
    let rejected = 0;
    let guard = 0;
    while (pieces.length < 100 && guard++ < 3000) {
        const x = 150 + Math.random() * (3946 - 150);
        const y = 250 + Math.random() * (3900 - 250);
        // 基地房（菱形房外扩 80）排除
        if (x > 308 && x < 1492 && y > 1712 && y < 2384) { rejected++; continue; }
        // 玩家/能源点/刷怪点排除带
        if (Math.hypot(x - p.x, y - p.y) < 160) { rejected++; continue; }
        if (nodePos.some((n) => Math.hypot(x - n.x, y - n.y) < 140)) { rejected++; continue; }
        if (spawnPts.some((n) => Math.hypot(x - n.x, y - n.y) < 130)) { rejected++; continue; }
        // 树间最小间距（允许适度重叠成林）
        if (pieces.some((q) => Math.hypot(x - q.x, y - q.y) < 95)) { rejected++; continue; }
        const k = keys[Math.floor(Math.random() * keys.length)];
        const tex = 'obstacle_tree_' + k;
        const geo = WallSystem._geoForTex ? WallSystem._geoForTex(tex) : null;
        if (!geo) { rejected++; continue; }
        const s = ((geo.obstacleH ?? 240) / geo.h) * (0.9 + Math.random() * 0.2);
        // 碰撞占位检查（foot 半径近似）
        const fr = Math.max(24, (geo.foot ? geo.foot.w / 2 : 40) * s);
        if (typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(x, y, fr)) { rejected++; continue; }
        pieces.push({ tex, x, y, scaleX: s, scaleY: s, flipX: Math.random() < 0.5 });
    }
    for (const pc of pieces) WallSystem.isoVisuals.push(pc);
    if (typeof WallSystem.rebuildIsoCollision === 'function') WallSystem.rebuildIsoCollision();
    WallSystem._syncWallsToPhaser();
    // 相机停跟随，防截图漂移
    const scene = window.__phaserScene;
    const cam = scene && scene.cameras.main;
    if (cam && cam.stopFollow) cam.stopFollow();
    // 彻底停相机回写（SKILL 相机锁定验证法：scene._updateCamera 每帧会把相机拉回玩家）
    if (scene && typeof scene._updateCamera === 'function') scene._updateCamera = () => {};
    return { placed: pieces.length, rejected, nodePosCount: nodePos.length };
})()`)));

// 多角度截图
async function view(name, x, y, zoom) {
    await evalJs(`(async () => {
        const cam = window.__phaserScene.cameras.main;
        cam.centerOn(${x}, ${y}); cam.setZoom(${zoom});
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    await shot(name);
}
await view('scatter-overview', 2048, 2048, 0.45);  // 全图总览
await view('scatter-base', 900, 2048, 1.0);        // 基地区
await view('scatter-field', 2048, 2048, 1.0);      // 中场
await view('scatter-spawn', 3736, 2048, 1.0);      // 右端刷怪区

console.log('errs:', errs.join(' | ') || '(none)');
ws.close();
edge.kill();
console.log('done');
