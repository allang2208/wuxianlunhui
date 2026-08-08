#!/usr/bin/env node
/* 诊断吸附左右不对称：新件在既有 v 墙左/右端外接，检查 snap/canPlace/重叠。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9238;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
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
  try {
    const G = window.Game;
    let du = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!du) du = '/src/world/defense-system.js';
    const dc = await import(du);
    let bu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/building-system.js?'));
    if (!bu) bu = '/src/world/building-system.js';
    const bm = await import(bu);
    const BS = bm.BuildingSystem;
    if (BS.active) BS.close();
    const dbg = {
        hasCOVER_FACE: !!dc.COVER_FACE,
        keys: dc.COVER_FACE ? Object.keys(dc.COVER_FACE) : null,
        D: dc.COVER_FACE ? (dc.COVER_FACE.D ? JSON.stringify(dc.COVER_FACE.D).slice(0, 120) : 'undefined') : 'n/a',
    };
    // 用房间现有 v 墙（右门柱）测左/右外接吸附
    let w = null;
    for (const e of G.entities.values()) {
        if (e && e.orient === 'v' && Math.abs(e.x - 1300) < 5) { w = e; break; }
    }
    if (!w) return { error: 'no anchor v wall' };
    const fA = w._faceLine && w._faceLine[0] || { x: w.x - 88, y: w.y - 25 };
    const fB = w._faceLine && w._faceLine[1] || { x: w.x + 88, y: w.y - 112 };
    const face = { A: { x: fA.x - w.x, y: fA.y - w.y }, B: { x: fB.x - w.x, y: fB.y - w.y } };
    const out = [];
    // 左外接：新件 R 端贴锚 L 端 → 新件中心 = 锚.x + L.x - R.x
    const leftTarget = { x: w.x + face.A.x - face.B.x, y: w.y + face.A.y - face.B.y };
    // 右外接：新件 L 端贴锚 R 端 → 新件中心 = 锚.x + R.x - L.x
    const rightTarget = { x: w.x + face.B.x - face.A.x, y: w.y + face.B.y - face.A.y };
    const item = bm.BUILD_ITEMS.find(i => i.id === 'cover_D_v');
    BS._selectItem(item);
    for (const [tag, t] of [['left', leftTarget], ['right', rightTarget]]) {
        const snap = BS._snapPosition(t.x, t.y);
        out.push({
            side: tag,
            target: { x: Math.round(t.x), y: Math.round(t.y) },
            snapped: snap ? { x: Math.round(snap.x), y: Math.round(snap.y), same: snap.same } : null,
            placeable: snap ? BS._canPlace(snap.x, snap.y) : false,
        });
    }
    // 镜像后同样测
    BS._placing.mirror = true;
    const effH = (bm.COVER_SNAP && bm.COVER_SNAP.D && bm.COVER_SNAP.D.h)
        ? bm.COVER_SNAP.D.h : { A: { x: -88, y: -112 }, B: { x: 88, y: -25 } };
    const leftTargetM = { x: w.x + effH.A.x - effH.B.x, y: w.y + effH.A.y - effH.B.y };
    const rightTargetM = { x: w.x + effH.B.x - effH.A.x, y: w.y + effH.B.y - effH.A.y };
    for (const [tag, t] of [['leftM', leftTargetM], ['rightM', rightTargetM]]) {
        const snap = BS._snapPosition(t.x, t.y);
        out.push({
            side: tag,
            target: { x: Math.round(t.x), y: Math.round(t.y) },
            snapped: snap ? { x: Math.round(snap.x), y: Math.round(snap.y), same: snap.same } : null,
            placeable: snap ? BS._canPlace(snap.x, snap.y) : false,
        });
    }
    BS._cancelPlacement();
    w.removeFromCollision();
    w.active = false;
    G.entities.delete('snap_anchor');
    return { dbg, anchor: { x: w.x, y: w.y, faceLine: w._faceLine, halfThick: w._coverHalfThick, cw: w.collisionWidth, ch: w.collisionHeight, offY: w.colliderOffsetY }, out };
  } catch (err) {
    return { error: String(err && err.stack || err) };
  }
})()`);
console.log(JSON.stringify(result, null, 2));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
