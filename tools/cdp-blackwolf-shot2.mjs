#!/usr/bin/env node
/* 黑狼实机截图 v2：注入黑狼后跟踪其世界坐标 + 相机位置，截图后按坐标精确裁剪。
 * 需 vite dev server 跑在 5173。用法：node tools/cdp-blackwolf-shot2.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9241;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 700)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080',
    '--no-first-run', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 7000));

const fetchJson = async (u) => (await fetch(u)).json();
let page = null;
for (;;) {
    try { const l = await fetchJson(`${CDP}/json/list`); page = l.find(t => t.type === 'page' && t.url.includes('5173')); if (page) break; } catch {}
    await new Promise(r => setTimeout(r, 300));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const rawEval = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await rawEval(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await sleep(500);
}
console.log('started:', started);
if (!started) await cleanup(1);

await rawEval(`(async () => {
    // 主神空间已按新逻辑自带黑狼（enemy_main_black_wolf）；没有才注入探针狼
    if (window.Game.entities.get('enemy_main_black_wolf')) return 'hub';
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/entities/enemy-types.js'));
    const m = await import(urls.find(n => n.includes('.js?')) || urls[0]);
    const p = window.Game.player;
    const w = new m.BlackWolf(p.x + 200, p.y);
    window.Game.entities.set('enemy_main_black_wolf', w);
    return 'probe';
})()`).then(r => console.log('wolf source:', r));
await sleep(5000);

// 连拍 6 张（walk/bite 姿态；2026-08-16 起黑狼无飞扑），每张记录实时屏幕坐标供精确裁剪
for (let i = 0; i < 6; i++) {
    const pos = await rawEval(`(async () => {
        const camUrls = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/world/camera.js'));
        const cam = await import(camUrls.find(n => n.includes('.js?')) || camUrls[0]);
        const w = window.Game.entities.get('enemy_main_black_wolf');
        if (!w || !w.active) return null;
        return { wx: w.x, wy: w.y, camx: cam.Camera.x, camy: cam.Camera.y,
            vw: window.innerWidth, vh: window.innerHeight, state: w._animState, frame: w._animFrame };
    })()`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (pos) {
        const sx = Math.round(pos.wx - pos.camx + pos.vw / 2);
        const sy = Math.round(pos.wy - pos.camy + pos.vh / 2);
        fs.writeFileSync(`${OUT_DIR}/blackwolf_v2_${i}.png`, Buffer.from(r.result.data, 'base64'));
        fs.writeFileSync(`${OUT_DIR}/blackwolf_v2_${i}.txt`, `${sx} ${sy} ${pos.state} f${pos.frame}`);
        console.log(`shot ${i}: screen(${sx},${sy}) ${pos.state} f${pos.frame}`);
    }
    await sleep(1400);
}
await cleanup(0);
