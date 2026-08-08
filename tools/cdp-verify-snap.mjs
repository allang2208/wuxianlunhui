#!/usr/bin/env node
/* 验证：1) 入口门柱底边对齐（doorAlignY）；2) 建筑面板掩体端点吸附 + 防重叠。
 * 用法：node tools/cdp-verify-snap.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9229;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return await r.json(); }
    finally { clearTimeout(t); }
}
async function waitFor(fn, timeoutMs = 25000, step = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > timeoutMs) return null;
        await new Promise((r) => setTimeout(r, step));
    }
}

const page = await waitFor(async () => {
    const list = await fetchJson(`${CDP}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
}, 25000);
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
        errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
};
const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
};

await send('Runtime.enable');
await send('Page.enable');

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise((r) => setTimeout(r, 500));
}
console.log('started:', started);

let sm = null;
for (let i = 0; i < 50; i++) {
    sm = await evalJs(`(async () => {
        let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) u = '/src/world/scene-manager.js';
        let SceneManager = null;
        try { ({ SceneManager } = await import(u)); } catch { return null; }
        window.__sm = SceneManager;
        return SceneManager.currentScene || null;
    })()`).catch(() => null);
    if (sm) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return window.__sm.currentScene;
})()`));

// ---- 1) 布局数据 + 入口对齐检查 ----
const layout = await evalJs(`(async () => {
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!u) u = '/src/world/defense-system.js';
    const m = await import(u);
    const covers = [];
    for (const e of window.Game.entities.values()) {
        if (e && e.grade !== undefined) covers.push({ x: Math.round(e.x), y: Math.round(e.y), orient: e.orient, id: e.id });
    }
    return { covers: covers.length, doorAlignY: m.DEFENSE_CONFIG.room.doorAlignY, base: m.DEFENSE_CONFIG.base };
})()`);
console.log('layout:', JSON.stringify(layout));

// 传送玩家到入口并截图
await evalJs(`(async () => {
    const p = window.Game.player;
    p.x = 1156; p.y = 2176;
    return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
await shot('entrance_after_align');

// ---- 2) 建筑面板吸附验证 ----
const snapTest = await evalJs(`(async () => {
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/building-system.js?'));
    if (!u) u = '/src/world/building-system.js';
    const bm = await import(u);
    const BS = bm.BuildingSystem;
    // 关闭可能开着的面板，重新打开
    if (BS.active) BS.close();
    BS.open();
    const results = {};
    // 1) 正常延续：取 RB 边最靠 R 顶点的 v 掩体（t≈50），从它的 R 端向外接一段
    let anchor = null;
    for (const e of window.Game.entities.values()) {
        if (e && e.orient === 'v' && e.x > 1300 && e.x < 1400) { anchor = e; break; }
    }
    if (!anchor) { results.error = 't=50 anchor not found'; return results; }
    const off = bm.COVER_SNAP ? bm.COVER_SNAP.v : null;
    if (!off) { results.error = 'COVER_SNAP missing'; return results; }
    const item = bm.BUILD_ITEMS.find(i => i.id === 'cover_D_v');
    if (!item) { results.error = 'cover_D_v item missing'; return results; }
    BS._selectItem(item);
    const ax = anchor.x, ay = anchor.y;
    const targetX = ax + 104 + 105;
    const targetY = ay - 137 + 33;
    const snap = BS._snapPosition(targetX, targetY);
    results.continuation = {
        anchor: { x: ax, y: ay },
        target: { x: Math.round(targetX), y: Math.round(targetY) },
        snapped: snap ? { x: Math.round(snap.x), y: Math.round(snap.y) } : null,
        canPlaceSnapped: snap ? BS._canPlace(snap.x, snap.y) : false,
    };
    // 2) 重叠位置应被拒绝
    results.overlapRejected = !BS._canPlace(ax, ay);
    // 3) 门洞内自由放置（不吸附）应可放置（门可被堵上）
    results.doorGapCanPlace = BS._canPlace(1166, 2134);
    BS._cancelPlacement();
    BS.close();
    return results;
})()`);
console.log('snapTest:', JSON.stringify(snapTest, null, 2));

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
