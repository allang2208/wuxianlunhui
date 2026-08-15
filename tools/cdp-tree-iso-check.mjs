#!/usr/bin/env node
/** 等距树五变体实机验证（2026-08-15）：scene8 沿玩家北侧一字排开，走 WallSystem.isoVisuals
 * 真实渲染路径（贴图加载/显示尺寸 obstacleH/图层深度），截图供验收。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9321;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-trees-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900', '--no-first-run', '--no-default-browser-check',
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
await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 90; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 700));
}
if (!ready) {
    console.error('not ready; boot errors so far:');
    console.error(errs.join('\n') || '(none)');
    edge.kill();
    process.exit(2);
}
await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`);
// 等场景转场动画结束 + 世界渲染起来（标题卡期间画面全黑）；
// 就绪判据：GameScene 存在且场景内已有墙件/贴图 sprite（渲染循环真的跑过）
await evalJs(`(async () => {
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const scene = window.__phaserScene;
        if (!scene) continue;
        let sprites = 0;
        scene.children.list.forEach((c) => { if (c && c.active && c.visible && c.type === 'Image') sprites++; });
        if (sprites > 5) return sprites;
    }
    return -1;
})()`);

console.log(JSON.stringify(await evalJs(`(async () => {
    const WallSystem = (await import('/src/world/wall-system.js')).WallSystem;
    const p = window.Game.player;
    const keys = ['tall', 'bushy', 'twin', 'wind', 'tiered'];
    const placed = [];
    keys.forEach((k, i) => {
        const tex = 'obstacle_tree_' + k;
        const g = Object.values((WallSystem.ISO_WALL_GEO || {})).find((x) => x.tex === tex)
            || (typeof ISO_WALL_GEO !== 'undefined' ? null : null);
        const geo = (typeof window !== 'undefined' && window.WallSystem && window.WallSystem._geoForTex)
            ? window.WallSystem._geoForTex(tex) : null;
        const s = geo ? (geo.obstacleH ?? 120) / geo.h : 1;
        const piece = { tex, x: p.x - 500 + i * 260, y: p.y - 260, scaleX: s, scaleY: s };
        WallSystem.isoVisuals.push(piece);
        placed.push(piece.tex + '@' + s.toFixed(3));
    });
    WallSystem._syncWallsToPhaser();
    const cam = window.__phaserScene && window.__phaserScene.cameras.main;
    if (cam) { cam.centerOn(p.x + 20, p.y - 320); cam.setZoom(1.0); }
    return placed;
})()`)));
await new Promise((r) => setTimeout(r, 2500));
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${OUT_DIR}/trees-iso-ingame.png`, Buffer.from(r.result.data, 'base64'));
console.log('saved', `${OUT_DIR}/trees-iso-ingame.png`);
console.log('errs:', errs.join(' | ') || '(none)');
ws.close();
edge.kill();
console.log('done');
