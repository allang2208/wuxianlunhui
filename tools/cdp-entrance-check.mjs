#!/usr/bin/env node
/* 世界-122 入口对齐检查：进入 scene8，把玩家/相机移到入口附近截图。
 * 用法：node tools/cdp-entrance-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9228;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        return await r.json();
    } finally { clearTimeout(t); }
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
    const id = ++seq;
    pending.set(id, res);
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
        const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return null;
        const { SceneManager } = await import(u);
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

// 传送到入口附近（RB 边中点开口），让相机跟随
const info = await evalJs(`(async () => {
    const p = window.Game.player;
    if (!p) return null;
    p.x = 1156; p.y = 2176;
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam) { cam.scrollX = p.x - 960; cam.scrollY = p.y - 540; }
    return { x: p.x, y: p.y, cam: cam ? { sx: cam.scrollX, sy: cam.scrollY } : null };
})()`);
console.log('teleport:', JSON.stringify(info));
await new Promise((r) => setTimeout(r, 1500));
await shot('entrance_live_full');

// 放大：直接设置 camera zoom 并重新居中（先回到世界范围校验再截图）
await evalJs(`(async () => {
    const cam = window.__phaserScene.cameras.main;
    cam.setZoom(1.5);
    cam.centerOn(1156, 2176);
    return true;
})()`);
await new Promise((r) => setTimeout(r, 800));
await shot('entrance_live_zoom');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
