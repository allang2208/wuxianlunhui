#!/usr/bin/env node
/* 基地细节探针（2026-08-17）：输出相机变换、基地/门/墙实体，截图基地全景。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9234;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.resolve('tools/verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
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
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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

for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return false;
        const { SceneManager } = await import(u);
        window.__sm = SceneManager;
        window.__imp = (p) => {
            const url = performance.getEntriesByType('resource').map(e => e.name)
                .find(n => n.includes(p) && n.includes('?'));
            if (!url) throw new Error('module not loaded: ' + p);
            return import(url);
        };
        return !!SceneManager.currentScene;
    })()`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
}

console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return true;
})()`));
for (let i = 0; i < 40; i++) {
    const ok = await evalJs(`(async () => {
        if (window.__phaserScene && window.__phaserScene.game) return true;
        await new Promise((r) => setTimeout(r, 250));
        return false;
    })()`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 300));
}

const data = await evalJs(`(async () => {
    const game = window.__phaserScene.game || (window.__phaserScene.scene && window.__phaserScene.scene.game);
    let scene = null;
    if (game && game.scene) {
        for (const s of game.scene.getScenes(true)) {
            if (s && s._neutralSprites) { scene = s; break; }
        }
    }
    if (!scene) scene = window.__phaserScene;
    const cam = scene.cameras.main;
    const out = {
        cam: { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom, w: cam.width, h: cam.height },
        canvas: { w: scene.game.canvas ? scene.game.canvas.width : null, h: scene.game.canvas.height ? scene.game.canvas.height : null },
        ents: [],
    };
    for (const e of window.Game.entities.values()) {
        if (!e || !e._isDefenseStructure) continue;
        out.ents.push({
            name: e.name,
            x: Math.round(e.x), y: Math.round(e.y),
            tex: (e.spriteCfg || {}).idleKey,
            isGate: !!e._isCoverGate,
            faceLine: e._faceLine || null,
            state: e.state || null,
        });
    }
    out.ents.sort((a, b) => a.name.localeCompare(b.name) || a.x - b.x);
    // 相机对准基地并缩放到整圈可见
    cam.setZoom(0.9);
    cam.centerOn(4200, 4096);
    await new Promise((r) => setTimeout(r, 500));
    out.cam2 = { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom };
    return out;
})()`);
console.log('DATA:', JSON.stringify(data, null, 1));
fs.writeFileSync(path.resolve('tools/verify-shots/base_detail.json'), JSON.stringify(data, null, 1));
await shot('base_detail_live');

// 强制关门再截一张（验证关门后菱形是否无缝）
await evalJs(`(async () => {
    const ds = (await import('/src/world/defense-system.js')).DefenseSystem;
    const g = ds.gate || null;
    if (g && typeof g.close === 'function') g.close();
    return g ? g.state : 'no-gate';
})()`);
await new Promise((r) => setTimeout(r, 900));
await shot('base_detail_gate_closed');

// 回归：玩家贴到门洞 → 应自动打开；离开 → 应自动关闭
const gateTest = await evalJs(`(async () => {
    let g = null;
    for (const e of window.Game.entities.values()) {
        if (e && e._isCoverGate && e.active) { g = e; break; }
    }
    if (!g) return { err: 'no gate' };
    const s = g._gateSeg;
    const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // 法线（门外侧）
    const px = cx + nx * 45, py = cy + ny * 45;
    const before = g.state;
    window.Game.player.x = px; window.Game.player.y = py;
    await new Promise((r) => setTimeout(r, 1000));
    const atGate = g.state;
    window.Game.player.x = 9000; window.Game.player.y = 9000;
    await new Promise((r) => setTimeout(r, 1200));
    const afterLeave = g.state;
    return { before, atGate, afterLeave, pos: [Math.round(px), Math.round(py)] };
})()`);
console.log('GATE TEST:', JSON.stringify(gateTest));

ws.close();
edge.kill();
