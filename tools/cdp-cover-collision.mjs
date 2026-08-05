#!/usr/bin/env node
/* 验证掩体碰撞：怪物移动/投射物被墙段阻挡（WallSystem.isoSegments 注册）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9237;
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
await new Promise((r) => setTimeout(r, 1500));

const result = await evalJs(`(async () => {
    const G = window.Game;
    const WS = window.WallSystem;
    let du = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!du) du = '/src/world/defense-system.js';
    const dc = await import(du);
    // 空旷处放一段 v 墙（face 线段注册）
    const w = new dc.DefenseCover(1700, 2100, { grade: 'D', orient: 'v', id: 'col_wall' });
    G.entities.set('col_wall', w);
    const segCount = WS.isoSegments.length;
    const mySeg = !!w._coverSeg && WS.isoSegments.includes(w._coverSeg);
    const foot = { w: w.collisionWidth, h: w.collisionHeight, offY: w.colliderOffsetY };
    // WallSystem.blocked 测试：从墙一侧向另一侧穿过墙段，应被 blocked
    const f = w._faceLine;
    const mx = (f[0].x + f[1].x) / 2;
    const my = (f[0].y + f[1].y) / 2;
    const blocked = WS.blocked(mx - 80, my, mx + 80, my, null);
    const blockedFar = WS.blocked(mx + 100, my, mx + 300, my, null); // 不穿墙
    // 怪物体积碰撞：rect 覆盖范围
    const rect = {
        minX: w.x - w.collisionWidth / 2, maxX: w.x + w.collisionWidth / 2,
        minY: w.y + w.colliderOffsetY - w.collisionHeight / 2, maxY: w.y + w.colliderOffsetY + w.collisionHeight / 2,
    };
    // 清理
    w.removeFromCollision();
    w.active = false;
    G.entities.delete('col_wall');
    return { segCount, mySeg, foot, blocked, blockedFar, rect };
})()`);
console.log(JSON.stringify(result, null, 2));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
