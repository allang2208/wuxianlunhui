#!/usr/bin/env node
/* 路线 B 拼接验证：v-v / h-h 同向、v-h 转角 + 房间全景。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9236;
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
await new Promise((r) => setTimeout(r, 1500));

// 房间全景
await evalJs(`(async () => { window.Game.player.x = 900; window.Game.player.y = 2048; return true; })()`);
await new Promise((r) => setTimeout(r, 900));
await shot('room_renderB_full');

// 三种拼接（空旷区摆好，相机对准）
const info = await evalJs(`(async () => {
    const G = window.Game;
    let du = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!du) du = '/src/world/defense-system.js';
    const dc = await import(du);
    for (const id of ['s1','s2','s3','s4','s5','s6']) { const e = G.entities.get(id); if (e) { e.active = false; G.entities.delete(id); } }
    // v-v：两段 v 端到端（步长 B-A = 176,-55）
    const vv1 = new dc.DefenseCover(1600, 2200, { grade: 'D', orient: 'v', id: 's1' });
    const vv2 = new dc.DefenseCover(1600 + 176, 2200 - 55, { grade: 'D', orient: 'v', id: 's2' });
    G.entities.set('s1', vv1); G.entities.set('s2', vv2);
    // h-h：两段 h 端到端（h 步长 176,+55）
    const hh1 = new dc.DefenseCover(1600, 1900, { grade: 'D', orient: 'h', id: 's3' });
    const hh2 = new dc.DefenseCover(1600 + 176, 1900 + 55, { grade: 'D', orient: 'h', id: 's4' });
    G.entities.set('s3', hh1); G.entities.set('s4', hh2);
    // v-h 转角：v 右端接 h 右端（房间 B 角形态）
    const vh1 = new dc.DefenseCover(1600, 1600, { grade: 'D', orient: 'v', id: 's5' });
    const vh2 = new dc.DefenseCover(1600 + 176, 1600 - 55 + 176, { grade: 'D', orient: 'h', id: 's6' });
    G.entities.set('s5', vh1); G.entities.set('s6', vh2);
    await new Promise(r => setTimeout(r, 500));
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    if (scene && scene.cameras && scene.cameras.main) {
        scene.cameras.main.setZoom(1.0);
        scene.cameras.main.centerOn(1700, 1950);
    }
    return {
        vv: { a: [vv1.x, vv1.y], b: [vv2.x, vv2.y], aFace: vv1._faceLine, bFace: vv2._faceLine },
        hh: { a: [hh1.x, hh1.y], b: [hh2.x, hh2.y], aFace: hh1._faceLine, bFace: hh2._faceLine },
        vh: { v: [vh1.x, vh1.y], h: [vh2.x, vh2.y], vFace: vh1._faceLine, hFace: vh2._faceLine },
    };
})()`);
console.log(JSON.stringify(info, null, 2));
await new Promise((r) => setTimeout(r, 900));
await shot('join3_overview');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
