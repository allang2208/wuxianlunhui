#!/usr/bin/env node
/* 复现沼泽地牢 WebGL 崩溃：真实 GPU 无头加载 → 进沼泽竞技场 → 截图 + 收集 console 错误 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9297;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-swamp-webgl-'));
// 不开 --disable-gpu：真实 GPU 路径
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'about:blank',
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
const logs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled') {
        const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
        if (m.params.type === 'error' || /webgl|shader|context/i.test(txt)) logs.push(`[${m.params.type}] ${txt}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved:', `${OUT_DIR}/${name}.png`);
}
function pickExpr() {
    return `(name) => {
        const withT = performance.getEntriesByType('resource').find((u) => u.name.includes('/src/' + name) && u.name.includes('?t='));
        return withT ? withT.name : performance.getEntriesByType('resource').find((u) => u.name.includes('/src/' + name))?.name || null;
    }`;
}
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173/' });
await new Promise((r) => setTimeout(r, 2500));
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }
console.log('ready, webgl:', await evalJs(`(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? gl.getParameter(gl.RENDERER) : 'no-webgl';
})()`));

const r = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const { SceneManager } = await import(pick('world/scene-manager.js'));
    const { CONFIG } = await import(pick('config/config.js'));
    const Game = window.Game;
    const player = Game.player;
    if (player && player.iceWallSystem && typeof player.iceWallSystem.breakdown === 'function') player.iceWallSystem.breakdown();
    Game.entities.clear();
    Game.entities.set('player', player);
    if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
    CONFIG.WORLD_WIDTH = 2048; CONFIG.WORLD_HEIGHT = 2048;
    player.x = 1024; player.y = 1024;
    DungeonMapSystem.init('scene7', player, 'swamp');
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    if (node) { DungeonMapSystem.currentNodeId = node.id; await DungeonMapSystem._enterNode(node); }
    await new Promise((r) => setTimeout(r, 1800));
    return { node: node ? node.type : null };
})()`);
console.log('arena:', JSON.stringify(r));
await shot('swamp_webgl_arena');
// 放大通道1（门 ~2103,1230 / 2938,1713 → 中段 ~2520,1470）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 2520; p.y = 1470;
    Camera.x = 2520; Camera.y = 1470;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('swamp_corridor1');
// 放大通道2
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 4584; p.y = 2662;
    Camera.x = 4584; Camera.y = 2662;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('swamp_corridor2');

// 定位通道直墙件，检查相邻墙段沿走廊轴的间隙
const gapProbe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const pieces = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        pieces.push({
            x: Math.round(p.x), y: Math.round(p.y), sx: p.scaleX, sy: p.scaleY,
            A: [Math.round(seg[0].x), Math.round(seg[0].y)],
            B: [Math.round(seg[1].x), Math.round(seg[1].y)],
        });
    }
    return pieces;
})()`);
console.log('corridor wall pieces:', JSON.stringify(gapProbe));
fs.writeFileSync(path.join(OUT_DIR, 'swamp_corridor_pieces.json'), JSON.stringify(gapProbe));
// 截图后检查 canvas 是否还在渲染（非全黑）
const px = await evalJs(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return { noCanvas: true };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { ctxLost: gl ? gl.isContextLost() : 'no-gl', w: c.width, h: c.height };
})()`);
console.log('canvas state:', JSON.stringify(px));
console.log('logs:', JSON.stringify(logs.slice(0, 12), null, 1));
edge.kill();
process.exit(0);
