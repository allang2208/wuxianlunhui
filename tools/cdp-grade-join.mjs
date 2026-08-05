#!/usr/bin/env node
/* 各 grade 端到端拼接自洽验证：同 grade v 墙吸附后端点重合、落点可放。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9235;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
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
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
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
await new Promise((r) => setTimeout(r, 1200));

const result = await evalJs(`(async () => {
    const G = window.Game;
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/building-system.js?'));
    if (!u) u = '/src/world/building-system.js';
    const bm = await import(u);
    let du = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!du) du = '/src/world/defense-system.js';
    const dc = await import(du);
    const BS = bm.BuildingSystem;
    if (BS.active) BS.close();
    const out = [];
    for (const g of 'FEDCBA') {
        const ax = 1700 + out.length * 120;
        const anchor = new dc.DefenseCover(ax, 2150, { grade: g, orient: 'v', id: 'join_probe_' + g });
        G.entities.set('join_probe_' + g, anchor);
        const item = bm.BUILD_ITEMS.find(i => i.id === 'cover_' + g + '_v');
        BS._selectItem(item);
        const face = dc.COVER_FACE[g].v;
        // 目标：新件 L 端贴锚 R 端（端到端），中心 = 锚中心 + (B-A)
        const targetX = anchor.x + face.B.x - face.A.x;
        const targetY = anchor.y + face.B.y - face.A.y;
        const snap = BS._snapPosition(targetX, targetY);
        // 用 snapped 位置构造新墙，验证端点重合
        let endGap = null;
        if (snap) {
            const b2 = new dc.DefenseCover(snap.x, snap.y, { grade: g, orient: 'v', id: 'join_probe2_' + g });
            const aR = anchor._faceLine[1];
            const bL = b2._faceLine[0];
            endGap = Math.hypot(aR.x - bL.x, aR.y - bL.y);
            G.entities.delete('join_probe2_' + g);
        }
        out.push({
            grade: g,
            face: { A: face.A, B: face.B, step: [face.B.x - face.A.x, face.B.y - face.A.y] },
            snapped: snap ? { x: Math.round(snap.x), y: Math.round(snap.y), same: snap.same } : null,
            placeable: snap ? BS._canPlace(snap.x, snap.y) : false,
            endGap: endGap === null ? null : Math.round(endGap * 10) / 10,
        });
        BS._cancelPlacement();
        G.entities.delete('join_probe_' + g);
    }
    return out;
})()`);
console.log(JSON.stringify(result, null, 2));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
