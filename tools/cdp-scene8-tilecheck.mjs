#!/usr/bin/env node
/* 世界-122 地砖池实机抽查（2026-08-16）：
 * - 进 scene8 → 确认 yellowmud_new1 贴图已注册；
 * - 在菱形内网格采样已烘焙分块画布像素，统计绿砖/黄砖/黑区占比；
 * 用法：node tools/cdp-scene8-tilecheck.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9396;
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

const tex = await ev(`(() => ({
  yellow: window.__phaserScene.textures.exists('yellowmud_new1'),
  swamp: window.__phaserScene.textures.exists('swampbrick_new1'),
}))()`);
console.log('贴图注册:', tex);

// 在菱形内（cx=3072,cy=2048,rx=3072,ry=2048）网格采样 7x5 点
const stats = await ev(`(async () => {
  const cs = 2048;
  const pts = [];
  for (let iy = 0; iy < 5; iy++) {
    for (let ix = 0; ix < 7; ix++) {
      const x = 400 + ix * 780, y = 500 + iy * 760;
      if (Math.abs(x - 3072) / 3072 + Math.abs(y - 2048) / 2048 > 1) continue;
      pts.push([x, y]);
    }
  }
  const out = [];
  for (const [x, y] of pts) {
    try {
      const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
      const tex = window.__phaserScene.textures.get('terrain_chunk_' + cx + '_' + cy);
      if (!tex || !tex.getSourceImage()) { out.push([x, y, 'nb']); continue; }
      const c = tex.getSourceImage();
      const d = c.getContext('2d').getImageData(x - cx * cs, y - cy * cs, 1, 1).data;
      out.push([x, y, d[0], d[1], d[2]]);
    } catch { out.push([x, y, 'err']); }
  }
  return out;
})()`);
let green = 0, yellow = 0, black = 0, other = 0;
for (const p of stats) {
    if (p.length === 3) { other++; continue; }
    const [x, y, r, g, b] = p;
    if (r < 12 && g < 12 && b < 12) black++;
    else if (g > r + 20 && g > b + 20) green++;
    else if (r > 110 && g > 70 && b < 90) yellow++;
    else other++;
}
console.log(`采样 ${stats.length} 点：绿砖 ${green} / 黄砖 ${yellow} / 黑区 ${black} / 其他 ${other}`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.join('tools', 'verify-shots'), { recursive: true });
fs.writeFileSync(path.join('tools', 'verify-shots', 'scene8_yellowmud_v1.png'), Buffer.from(shot.result.data, 'base64'));
console.log('saved tools/verify-shots/scene8_yellowmud_v1.png');
await cleanup(0);
