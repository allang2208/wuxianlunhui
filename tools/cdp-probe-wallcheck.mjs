#!/usr/bin/env node
/* 探测门洞位置被 _canPlace 拒绝的原因（WallSystem vs 掩体重叠）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9230;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 7000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 25000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
await send('Runtime.enable');
let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise(r => setTimeout(r, 500));
}
for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) u = '/src/world/scene-manager.js';
        try { const { SceneManager } = await import(u); window.__sm = SceneManager; return SceneManager.currentScene || null; } catch { return null; }
    })()`).catch(() => null);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
}
await evalJs(`(async () => { await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);
const res = await evalJs(`(async () => {
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/building-system.js?'));
    if (!u) u = '/src/world/building-system.js';
    const bm = await import(u);
    const WS = window.WallSystem;
    const points = [
        { x: 1166, y: 2134 },
        { x: 1166, y: 2140 },
        { x: 1150, y: 2140 },
        { x: 1180, y: 2130 },
        { x: 1100, y: 2180 },
    ];
    const out = [];
    for (const p of points) {
        const inBounds = p.x >= 20 && p.y >= 20 && p.x <= (bm.CONFIG ? bm.CONFIG.WORLD_WIDTH - 20 : 1e9) && p.y <= (bm.CONFIG ? bm.CONFIG.WORLD_HEIGHT - 20 : 1e9);
        let wsOk = true;
        if (WS && typeof WS.canMoveTo === 'function') wsOk = WS.canMoveTo(p.x, p.y, 28);
        const bs = bm.BuildingSystem;
        bs._placing = { item: bm.BUILD_ITEMS.find(i => i.id === 'cover_D_v'), mirror: false };
        const foot = bm.COVER_FOOT ? bm.COVER_FOOT.v : { w: 46, d: 300 };
        const r = bs._coverRect(p.x, p.y, foot.w, foot.d);
        const blockers = [];
        for (const e of window.Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            const ew = e.collisionWidth || 46;
            const ed = e.collisionHeight || 300;
            if (bs._rectsOverlap(r, bs._coverRect(e.x, e.y, ew, ed))) {
                blockers.push({ id: e.id, x: e.x, y: Math.round(e.y), orient: e.orient || '-', w: ew, d: ed });
            }
        }
        const canPlace = bs._canPlace(p.x, p.y);
        bs._placing = null;
        out.push({ x: p.x, y: p.y, inBounds, wsOk, canPlace, blockers, wallCount: WS && WS.isoVisuals ? WS.isoVisuals.length : -1 });
    }
    return out;
})()`);
console.log(JSON.stringify(res, null, 2));
ws.close(); edge.kill();
