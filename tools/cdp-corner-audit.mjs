#!/usr/bin/env node
/* 上夹角（TL∩TR）图层/叠合审计（2026-08-08）：
 *  - 采集 TL/TR 边靠近顶点的掩体件几何、depthBias、faceDepth、贴图
 *  - 顶点处画红/蓝标记（face 端点）
 *  - 截上夹角全景 + 顶点放大
 * 用法：node tools/cdp-corner-audit.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9273;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-corner-audit-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

for (let i = 0; i < 40; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        console.log('edge version:', (await r.json()).Browser);
        break;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
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
function sceneExpr() {
    return `window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null)`;
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

// 相机对准上夹角（玩家放顶点下方），等稳定
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 900; p.y = 1900;
    Camera.x = 900; Camera.y = 1900;
    await new Promise((r) => setTimeout(r, 600));
    Camera.x = 900; Camera.y = 1900;
    await new Promise((r) => setTimeout(r, 600));
    return true;
})()`);

// 画标记：face 端点红（A）/蓝（B），实体中心黄
await evalJs(`(() => {
    const scene = ${sceneExpr()};
    if (!scene) return false;
    if (scene._cornerGfx) scene._cornerGfx.destroy();
    const g = scene.add.graphics();
    scene._cornerGfx = g;
    g.setDepth(99999);
    let i = 0;
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine || e._faceLine.length !== 2) continue;
        const near = Math.abs(e.x - 900) < 180 && Math.abs(e.y - 1792) < 130;
        if (!near) continue;
        g.fillStyle(0xff0000, 1); g.fillRect(e._faceLine[0].x - 3, e._faceLine[0].y - 3, 6, 6);
        g.fillStyle(0x0000ff, 1); g.fillRect(e._faceLine[1].x - 3, e._faceLine[1].y - 3, 6, 6);
        g.fillStyle(0xffff00, 1); g.fillRect(e.x - 3, e.y - 3, 6, 6);
        i++;
    }
    return i;
})()`);
await new Promise((r) => setTimeout(r, 150));

// 采集 TL/TR 顶点附近件的几何与 depth
const info = await evalJs(`(() => {
    const scene = ${sceneExpr()};
    const cam = scene ? scene.cameras.main : null;
    const out = { cam: null, items: [] };
    if (!cam) return out;
    out.cam = { scrollX: Math.round(cam.scrollX * 10) / 10, scrollY: Math.round(cam.scrollY * 10) / 10, w: cam.width, h: cam.height };
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine || e._faceLine.length !== 2) continue;
        const near = Math.abs(e.x - 900) < 220 && Math.abs(e.y - 1792) < 160;
        if (!near) continue;
        const data = scene._neutralSprites ? scene._neutralSprites.get(e) : null;
        const spr = data ? data.sprite : null;
        out.items.push({
            id: e.id, orient: e.orient, tex: spr ? spr.texture.key : null,
            x: e.x, y: e.y, faceDepth: e._faceDepth, depthBias: e._depthBias ?? e.depthBias ?? null,
            sprDepth: spr ? spr.depth : null,
            face: e._faceLine.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        });
    }
    return out;
})()`);
console.log('corner info:', JSON.stringify(info, null, 1));

await shot('corner_audit_markers');
// 去掉标记，截干净图
await evalJs(`(() => {
    const scene = ${sceneExpr()};
    if (scene && scene._cornerGfx) { scene._cornerGfx.destroy(); scene._cornerGfx = null; }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 150));
await shot('corner_audit_clean');

// A/B 图层顺序测试：修改 e._faceDepth（每帧深度同步读它），让 TR(h) 盖 TL(v)
await evalJs(`(() => {
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine) continue;
        if (Math.abs(e.x - 900) < 220 && Math.abs(e.y - 1792) < 160) {
            if (e.orient === 'v') e._faceDepth -= 1;
            else e._faceDepth += 1;
        }
    }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 300));
await shot('corner_audit_layer_B');
// 恢复原 depth（重新读 _faceDepth 原始值：max(face y)+12 + bias）
await evalJs(`(() => {
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine) continue;
        if (Math.abs(e.x - 900) < 220 && Math.abs(e.y - 1792) < 160) {
            const base = Math.max(e._faceLine[0].y, e._faceLine[1].y) + 12;
            e._faceDepth = e.orient === 'v' ? base + 0.5 : base;
        }
    }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 300));
await shot('corner_audit_layer_A_restore');

// 高倍放大顶点（setZoom 3），去掉标记后的干净图
await evalJs(`(() => {
    const scene = ${sceneExpr()};
    if (scene) { scene.cameras.main.setZoom(3); scene.cameras.main.centerOn(900, 1792); }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 300));
await shot('corner_audit_zoom3');
await evalJs(`(() => {
    const scene = ${sceneExpr()};
    if (scene) scene.cameras.main.setZoom(1);
    return true;
})()`);
// 顶点放大（相机 y 靠近顶点）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 900; p.y = 1792;
    Camera.x = 900; Camera.y = 1792;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
const info2 = await evalJs(`(() => {
    const scene = ${sceneExpr()};
    const cam = scene ? scene.cameras.main : null;
    return cam ? { scrollX: Math.round(cam.scrollX * 10) / 10, scrollY: Math.round(cam.scrollY * 10) / 10 } : null;
})()`);
await shot('corner_audit_vertex_zoom');
console.log('vertex zoom cam:', JSON.stringify(info2));

console.log('errs:', errs.slice(0, 5));
edge.kill();
process.exit(0);
