#!/usr/bin/env node
/* 实机检查端到端拼接（吸附摆放）的底边连续性。用法：node tools/cdp-join-check.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9234;
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
await new Promise((r) => setTimeout(r, 1200));

const info = await evalJs(`(async () => {
    const G = window.Game;
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!u) u = '/src/world/defense-system.js';
    const dc = await import(u);
    // 清残留
    for (const id of ['joinA', 'joinB']) { const e = G.entities.get(id); if (e) { e.active = false; G.entities.delete(id); } }
    // 空旷处两段 v 墙：A 固定，B 用吸附步长（端到端 + 8px 回退）
    const a = new dc.DefenseCover(1700, 2100, { grade: 'D', orient: 'v', id: 'joinA' });
    G.entities.set('joinA', a);
    const step = 209, dy = -104;
    const ln = Math.hypot(step, dy);
    const back = 8;
    const b = new dc.DefenseCover(
        1700 + step - step / ln * back,
        2100 + dy - dy / ln * back,
        { grade: 'D', orient: 'v', id: 'joinB' }
    );
    G.entities.set('joinB', b);
    await new Promise(r => setTimeout(r, 600));
    const sa = scene && scene._neutralSprites ? scene._neutralSprites.get(a) : null;
    const sb = scene && scene._neutralSprites ? scene._neutralSprites.get(b) : null;
    return {
        a: { x: a.x, y: Math.round(a.y), face: a._faceLine.map(p => [Math.round(p.x), Math.round(p.y)]) },
        b: { x: Math.round(b.x), y: Math.round(b.y), face: b._faceLine.map(p => [Math.round(p.x), Math.round(p.y)]) },
        joinGap: {
            aRight: a._faceLine[1], bLeft: b._faceLine[0],
            dist: Math.hypot(a._faceLine[1].x - b._faceLine[0].x, a._faceLine[1].y - b._faceLine[0].y),
        },
        sprites: { a: !!sa, b: !!sb },
    };
})()`);
console.log('join info:', JSON.stringify(info, null, 2));

// 玩家移到拼接区，相机对准（直接设 scroll + zoom，绕开玩家跟随误差）
await evalJs(`(async () => {
    const p = window.Game.player;
    p.x = 1800; p.y = 1965;
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    if (scene && scene.cameras && scene.cameras.main) {
        const cam = scene.cameras.main;
        cam.setZoom(1.6);
        cam.centerOn(1800, 1965);
    }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 1000));
await shot('join_live');
// 再截一张更近的（拼接口）
await evalJs(`(async () => {
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    if (scene && scene.cameras && scene.cameras.main) {
        scene.cameras.main.setZoom(2.4);
        scene.cameras.main.centerOn(1800, 1965);
    }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 800));
await shot('join_live_zoom');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
