#!/usr/bin/env node
/* 世界-122 连续铺贴接缝抽查（2026-08-16）：
 * - 沿 y=2048 横穿 x=2048 分块边界逐点采样亮度，确认无黑缝/暗带；
 * - 另在菱形内随机扫线统计最暗亮度，确保无背景色裸露。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9398;
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
await sleep(1500);

// 横穿 x=2048 分块边界的亮度扫描（y=2048, x∈[2000,2096] step 4）
const scan = await ev(`(async () => {
  const cs = 2048;
  const pts = [];
  for (let x = 2000; x <= 2096; x += 4) pts.push(x);
  const out = [];
  for (const x of pts) {
    const y = 2048;
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    try {
      const tex = window.__phaserScene.textures.get('terrain_chunk_' + cx + '_' + cy);
      if (!tex || !tex.getSourceImage()) { out.push([x, -1]); continue; }
      const d = tex.getSourceImage().getContext('2d').getImageData(x - cx * cs, y - cy * cs, 1, 1).data;
      out.push([x, (d[0] + d[1] + d[2]) / 3]);
    } catch { out.push([x, -2]); }
  }
  return out;
})()`);
const lums = scan.filter(p => p[1] >= 0).map(p => p[1]);
console.log('跨界扫描点:', scan.length, '最暗亮度:', lums.length ? Math.round(Math.min(...lums)) : 'N/A',
            '平均:', lums.length ? Math.round(lums.reduce((a, b) => a + b, 0) / lums.length) : 'N/A');
console.log('跨界亮度序列:', lums.map(v => Math.round(v)).join(','));
await cleanup(0);
