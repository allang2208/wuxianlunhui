#!/usr/bin/env node
/* 仙人掌/散布障碍阴影复验（2026-08-19 唯一性审计后续）：
 * 场景中手摆 双臂/单臂/多节/桶状仙人掌各一（_scatter 件走 _placeIsoPiece 注册），
 * 冻结 09:00 截图，确认 hull+剪影路径复活且贴合。
 * 用法（安全入口）：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-shadow-cactus-check.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9259;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise((r) => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise((r) => setTimeout(r, 700)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080',
    '--no-first-run', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 7000));

const fetchJson = async (u) => (await fetch(u)).json();
let page = null;
for (let i = 0; i < 40; i++) {
    try { const l = await fetchJson(`${CDP}/json/list`); page = l.find((t) => t.type === 'page' && t.url.includes('5173')); if (page) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
}
if (!page) { console.error('no page'); await cleanup(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (file) => {
    const d = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${file}`, Buffer.from(d.result.data, 'base64'));
    console.log('shot:', file);
};

let entered = 'timeout';
for (let attempt = 0; attempt < 4 && !String(entered).startsWith('in'); attempt++) {
    entered = await ev(`(async () => {
      for (let i = 0; i < 90; i++) {
        if (window.Game && window.Game.player && window.__phaserScene) return 'in:' + (window.SceneManager?.currentScene || '?');
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') { b.click(); }
        await new Promise((r) => setTimeout(r, 500));
      }
      return 'timeout';
    })()`).catch(() => 'eval-lost');
    if (!String(entered).startsWith('in')) await new Promise((r) => setTimeout(r, 3000));
}
console.log('enter:', entered);
if (!String(entered).startsWith('in')) { await cleanup(1); }

console.log('spawn:', await ev(`(async () => {
  if (!window.Game || !window.Game.player) return 'no-player';
  for (let i = 0; i < 40; i++) {
    if (window.EnvironmentLightingSystem) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const { WallSystem } = await import('/src/world/wall-system.js');
  const scene = window.__phaserScene;
  const p = window.Game.player;
  const texs = ['obstacle_cactus_saguaro2arm', 'obstacle_cactus_saguaro1arm', 'obstacle_cactus_cholla', 'obstacle_cactus_barrel'];
  const made = [];
  texs.forEach((tex, i) => {
    try {
      const piece = { tex, x: p.x - 300 + i * 200, y: p.y - 180, scaleX: 1, scaleY: 1, flipX: false, _scatter: true };
      WallSystem.isoVisuals.push(piece);
      WallSystem._placeIsoPiece(scene, piece);
      made.push(tex);
    } catch (e) { made.push(tex + ':ERR:' + String(e.message || e)); }
  });
  window.__auditVantage = { x: p.x, y: p.y - 100 };
  return JSON.stringify(made);
})()`));
await new Promise((r) => setTimeout(r, 1500));

await ev(`window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.125 }); 'sun'`);
await ev(`(() => { const v = window.__auditVantage; window.Game.player.x = v.x; window.Game.player.y = v.y; return 1; })()`);
await new Promise((r) => setTimeout(r, 600));
await shot('_cactus_check_0900.png');

// 在册形态普查：每个仙人掌件是 hull（剪影）还是胶囊椭圆 job
const census = await ev(`JSON.stringify((() => {
  const scene = window.__phaserScene;
  const out = [];
  for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
    const tex = data.sourceSprite?.texture?.key || '';
    if (!tex.includes('cactus')) continue;
    out.push({ tex, hull: !!data.hull, pts: data._polyState?.points?.length ?? 0 });
  }
  return out;
})())`);
console.log('cactus census:', census);
await cleanup(0);
