#!/usr/bin/env node
/* 世界-122 基地菱形房 上夹角截图（供 GLM 视觉分析涂层叠加问题） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9251;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-corner-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
// 等 CDP 就绪（about:blank 轻量加载，必成功），再导航到游戏页
let ver = null;
for (let i = 0; i < 40; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        ver = (await r.json()).Browser;
        break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
}
console.log('edge version:', ver);

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
let page = null;
for (let i = 0; i < 30; i++) {
    try {
        const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        page = l.find((x) => x.type === 'page');
        if (page) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
}
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
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
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
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

const entered = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    const out = { sceneBefore: SM.currentScene };
    if (SM.currentScene !== 'scene8') {
        try { await SM.switchScene('scene8', p, 'explore'); } catch (e) { out.err = String(e && e.stack || e); }
    }
    await new Promise((r) => setTimeout(r, 900));
    out.scene = SM.currentScene;
    return out;
})()`);
console.log('entered:', JSON.stringify(entered));

// 玩家挪到上夹角附近并居中镜头，等相机稳定后截图
const cam = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const DefMod = await import(pick('world/defense-system.js'));
    const b = DefMod.DEFENSE_CONFIG.base;
    const room = DefMod.DEFENSE_CONFIG.room;
    const top = { x: b.x, y: b.y - room.ry };
    const p = window.Game.player;
    // 玩家挪到角点正下方（房间内），相机跟随玩家后手动微调对齐角点
    p.x = b.x + 40;
    p.y = b.y - room.ry + 160;
    Camera.x = top.x;
    Camera.y = top.y;
    await new Promise((r) => setTimeout(r, 400));
    Camera.x = top.x;
    Camera.y = top.y;
    return { camX: Camera.x, camY: Camera.y, top };
})()`);
console.log('camera:', JSON.stringify(cam));
await new Promise((r) => setTimeout(r, 700));
// 检查上角附近两张掩体的 Phaser sprite 深度与纹理
const sprCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const DefMod = await import(pick('world/defense-system.js'));
    const b = DefMod.DEFENSE_CONFIG.base;
    const room = DefMod.DEFENSE_CONFIG.room;
    const top = { x: b.x, y: b.y - room.ry };
    const scene = window.__phaserScene;
    const coverEntities = [...window.Game.entities.values()]
        .filter((e) => e._isDefenseStructure && e._faceLine && Math.hypot(e.x - top.x, e.y - top.y) < 260);
    const covers = coverEntities.map((e) => {
            const data = scene && scene._neutralSprites ? scene._neutralSprites.get(e) : null;
            const spr = data ? data.sprite : null;
            return {
                id: e.id, orient: e.orient,
                faceDepth: e._faceDepth,
                sprDepth: spr ? spr.depth : null,
                tex: spr ? spr.texture.key : null,
                hasSprite: !!spr,
                sprX: spr ? Math.round(spr.x) : null,
                sprY: spr ? Math.round(spr.y) : null,
                dispW: spr ? Math.round(spr.displayWidth) : null,
                dispH: spr ? Math.round(spr.displayHeight) : null,
            };
        }).sort((a, b2) => a.faceDepth - b2.faceDepth);
    const boxes = [];
    if (scene && scene._neutralSprites) {
        for (const e of coverEntities) {
            const data = scene._neutralSprites.get(e);
            if (data && data.sprite) {
                const s = data.sprite;
                boxes.push({
                    id: e.id,
                    x: Math.round(s.x), y: Math.round(s.y),
                    w: Math.round(s.displayWidth), h: Math.round(s.displayHeight),
                    depth: s.depth,
                    tex: s.texture.key,
                });
            }
        }
    }
    return { hasScene: !!scene, neutralSize: scene && scene._neutralSprites ? scene._neutralSprites.size : -1, covers, boxes };
})()`);
console.log('sprite check:', JSON.stringify(sprCheck));
await shot('base_upper_corner_full');

// 近景：把相机推到上顶点 + 偏移，放大看转角
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const DefMod = await import(pick('world/defense-system.js'));
    const b = DefMod.DEFENSE_CONFIG.base;
    const room = DefMod.DEFENSE_CONFIG.room;
    Camera.x = b.x;
    Camera.y = b.y - room.ry - 100;
    return true;
})()`);
await new Promise((r) => setTimeout(r, 500));
await shot('base_upper_corner_zoom');

console.log('--- errors ---');
console.log(errs.slice(0, 10).join('\n') || '(none)');
edge.kill();
process.exit(0);
