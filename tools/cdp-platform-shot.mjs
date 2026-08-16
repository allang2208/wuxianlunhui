#!/usr/bin/env node
/* 截图平台区域：直接用 Phaser 相机 getWorldPoint 换算平台屏幕位置 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9327;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fp4-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); await r.json(); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
}
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
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function shot(name, clip) {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: clip || undefined });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8:', await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
    const { SceneManager } = await import(u);
    await SceneManager.switchScene('scene8', window.Game.player, 'explore');
    return true;
})()`));

let st = null;
for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    st = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
        if (!u) return null;
        const { DefenseSystem } = await import(u);
        return { active: DefenseSystem ? DefenseSystem.active : null, count: (DefenseSystem && DefenseSystem.platforms || []).length, hasScene: !!window.__phaserScene };
    })()`);
    if (st && st.active && st.count >= 1 && st.hasScene) break;
}
console.log('STATE:', JSON.stringify(st));

// 玩家移动到平台旁边（相机跟随玩家 → 平台入画）
await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const player = window.Game.player;
    player.x = p.x - 260;  // 平台西侧（房内）
    player.y = p.y - 30;
    const cam = (await import('/src/world/camera.js')).Camera;
    cam.follow(player);
    cam.x = player.x; cam.y = player.y;
    await new Promise(r => setTimeout(r, 1500));
    return { px: Math.round(player.x), py: Math.round(player.y) };
})()`);
console.log('player moved');

// 用 Phaser 相机算平台屏幕坐标（直接设 scrollX/Y 绕过帧循环覆盖，立即截图）
const scr = await evalJs(`(async () => {
    const scene = window.__phaserScene;
    const cam = scene.cameras.main;
    let plat = null;
    for (const [e, data] of (scene._neutralSprites || new Map()).entries()) {
        if (e && e._isFiringPlatform && data && data.sprite) plat = data.sprite;
    }
    if (!plat) return null;
    // 直接设置相机 scroll（zoom 0.7，视口 1896×988）：让平台在画面中心
    cam.setScroll(plat.x - 1896 / 2 / 0.7, plat.y - 988 / 2 / 0.7);
    await new Promise(r => setTimeout(r, 300));
    const p = cam.getWorldPoint(plat.x, plat.y);
    return {
        platWorld: { x: Math.round(plat.x), y: Math.round(plat.y) },
        screen: { x: Math.round(p.x), y: Math.round(p.y) },
        zoom: cam.zoom,
        camScroll: { x: Math.round(cam.scrollX), y: Math.round(cam.scrollY) },
        canvasW: scene.game.canvas.width,
        canvasH: scene.game.canvas.height,
    };
})()`);
console.log('SCREEN:', JSON.stringify(scr));

if (scr) {
    // 截图平台周围 500×450 区域
    const clip = {
        x: Math.max(0, scr.screen.x - 250),
        y: Math.max(0, scr.screen.y - 300),
        width: 500, height: 450, scale: 1,
    };
    await shot('platform-v2c', clip);
    // 全屏
    await shot('platform-v2-full', null);
}

edge.kill();
console.log('done');
