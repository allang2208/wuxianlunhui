#!/usr/bin/env node
/* 世界-122 菱形地块像素抽查（2026-08-16）：
 * - 进 scene8 后直接从已烘焙的 terrain_chunk_* 画布采样像素：
 *   菱形内应为沼泽地砖色（非黑），菱形外应为纯黑；
 * - 先验初始视野（基地左侧），再把玩家移到右侧触发右半边分块烘焙再验；
 * 用法：node tools/cdp-scene8-diamond-check.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9394;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 600)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });
edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
let page = null;
for (let i = 0; i < 8 && !page; i++) {
    try { page = (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')); } catch {}
    if (!page) await new Promise(r => setTimeout(r, 1000));
}
if (!page) { console.error('no page'); await cleanup(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');

let bootOk = null;
for (let attempt = 0; attempt < 3 && bootOk !== 'ready'; attempt++) {
    try {
        bootOk = await ev(`(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          let t0 = Date.now();
          while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
          if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
          t0 = Date.now();
          while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
          await sleep(1500);
          return 'ready';
        })()`);
    } catch (err) { console.log('boot retry', err.message.slice(0, 80)); await sleep(2000); }
}
if (bootOk !== 'ready') { console.error('boot failed'); await cleanup(1); }

await ev(`(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  const { SceneManager } = await import(u);
  await SceneManager.switchScene('scene8', window.Game.player, 'explore');
  return true;
})()`);
let ready = null;
for (let i = 0; i < 20; i++) {
    await sleep(800);
    ready = await ev(`(async () => {
      const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
      const { DefenseSystem } = await import(u);
      return DefenseSystem.active ? true : null;
    })()`);
    if (ready) break;
}
await sleep(1200);

// 采样：world -> 已烘焙分块画布像素 [r,g,b]
const sample = async (label, x, y) => {
    const px = await ev(`(async () => {
      try {
        const cs = 2048;
        const cx = Math.floor(${x} / cs), cy = Math.floor(${y} / cs);
        const tex = window.__phaserScene.textures.get('terrain_chunk_' + cx + '_' + cy);
        if (!tex || !tex.getSourceImage()) return null;
        const c = tex.getSourceImage();
        const g = c.getContext('2d');
        const d = g.getImageData(${x} - cx * cs, ${y} - cy * cs, 1, 1).data;
        return [d[0], d[1], d[2]];
      } catch (e) { return ['ERR', String(e && e.message || e).slice(0, 60)]; }
    })()`).catch(() => ['NO_RESPONSE']);
    const inside = px && !(px[0] < 12 && px[1] < 12 && px[2] < 12);
    console.log(`  ${label.padEnd(22)} (${x},${y}) -> ${Array.isArray(px) ? 'rgb(' + px.join(',') + ')' : String(px)}  ${Array.isArray(px) && px[0] !== 'ERR' ? (inside ? '地板' : '纯黑(区外)') : ''}`);
    return px;
};

console.log('== 初始视野（基地左侧）==');
// 菱形参数：cx=3072 cy=2048 rx=3072 ry=2048（x=760 处菱形内 y∈[1541,2555]）
await sample('x=760 区外上', 760, 1400);
await sample('x=760 菱形内', 760, 2000);
await sample('x=760 区外下', 760, 2600);
await sample('x=1500 区外上', 1500, 500);
await sample('x=3072 中心', 3072, 2048);
await sample('x=4000 菱形内', 4000, 2048);

console.log('== 相机右移触发右半边分块烘焙 ==');
await ev(`(() => { window.Game.player.x = 4700; window.Game.player.y = 2048; return true; })()`).catch(() => null);
await sleep(8000);
await sample('x=6000 菱形内', 6000, 2048);
await sample('x=6000 区外上', 6000, 1400);
await sample('x=5200 菱形内', 5200, 1800);
await sample('x=5200 区外下', 5200, 2900);

await cleanup(0);
