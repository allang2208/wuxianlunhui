#!/usr/bin/env node
/* 双墙阴影重叠实测（2026-08-19 用户报：两墙并排阴影中间仍加深）：
 * 两块方块墙沿 e2 负向相邻（影向垂直于墙排），晨/昏两相截图，供离线亮度分析。
 * 用法（安全入口）：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-shadow-wall-overlap.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9258;
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
  const { DefenseCover } = await import('/src/world/defense-system.js');
  const p = window.Game.player;
  const made = [];
  // A/B 隔 1 格对角（步进 (128,−64)），黄昏长影在中间空地交叠；C 远处单影对照
  const ax = p.x + 200, ay = p.y - 200;
  const A = new DefenseCover(ax, ay, { id: 'ov_A', block: true, grade: 'C', orient: 'v' });
  const B = new DefenseCover(ax + 128, ay - 64, { id: 'ov_B', block: true, grade: 'C', orient: 'v' });
  const C = new DefenseCover(ax + 500, ay + 150, { id: 'ov_C', block: true, grade: 'C', orient: 'v' });
  for (const e of [A, B, C]) { window.Game.entities.set(e.id, e); made.push(e.id); }
  window.__ovVantage = { x: ax + 150, y: ay + 60 };
  return JSON.stringify(made);
})()`));
await new Promise((r) => setTimeout(r, 2000));

for (const ph of [0.125, 0.438]) {
    await ev(`(async () => {
      for (let i = 0; i < 40; i++) {
        if (window.EnvironmentLightingSystem && window.Game && window.Game.player) return 'ok';
        await new Promise((r) => setTimeout(r, 500));
      }
      return 'not-ready';
    })()`);
    await ev(`window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: ${ph} }); 'p'`);
    await ev(`(() => { const v = window.__ovVantage; window.Game.player.x = v.x; window.Game.player.y = v.y; return 1; })()`);
    await new Promise((r) => setTimeout(r, 500));
    await shot(`_walloverlap_p${String(ph).replace('.', '_')}.png`);
    // 导出两墙阴影多边形（供离线几何核对重叠区）
    const dump = await ev(`JSON.stringify((() => {
      const scene = window.__phaserScene;
      const out = [];
      for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
        const eid = String(data.entity?.id || '');
        if (!eid.startsWith('ov_')) continue;
        out.push({ id: eid, pts: data._polyState?.points || null });
      }
      return out;
    })())`);
    fs.writeFileSync(`${OUT_DIR}/_walloverlap_${String(ph).replace('.', '_')}.json`, dump);
    console.log('phase', ph, 'dumped', JSON.parse(dump).length, 'shadows');
    // 决定性排查：两墙周边世界矩形内所有可见对象（谁在这里叠加变深）
    const stack = await ev(`JSON.stringify((() => {
      const scene = window.__phaserScene;
      const A = window.Game.entities.get('ov_A');
      const B = window.Game.entities.get('ov_B');
      if (!A || !B) return { err: 'no walls' };
      const minX = Math.min(A.x, B.x) - 220, maxX = Math.max(A.x, B.x) + 220;
      const minY = Math.min(A.y, B.y) - 260, maxY = Math.max(A.y, B.y) + 220;
      const hits = [];
      scene.children.list.forEach((o) => {
        if (!o || !o.visible || !o.alpha) return;
        const ox = o.x; const oy = o.y;
        if (typeof ox !== 'number') return;
        // Graphics 没有 x/y 语义，单独收
        if (o.type === 'Graphics') {
          hits.push({ type: 'Graphics', depth: o.depth, alpha: +o.alpha.toFixed(3),
            isShadowLayer: o === scene._structureShadowLayer });
          return;
        }
        if (ox < minX || ox > maxX || oy < minY || oy > maxY) return;
        hits.push({ type: o.type, tex: o.texture?.key || '', x: Math.round(ox), y: Math.round(oy),
          alpha: +o.alpha.toFixed(3), depth: +(+o.depth).toFixed(2), dw: Math.round(o.displayWidth || 0), dh: Math.round(o.displayHeight || 0) });
      });
      return { hits: hits.filter((h) => h.alpha > 0.02), shadowJobs: (scene._structureShadowJobs || [])
        .filter((j) => j.cx > minX - 300 && j.cx < maxX + 300 && j.cy > minY - 300 && j.cy < maxY + 300)
        .map((j) => ({ cx: Math.round(j.cx), cy: Math.round(j.cy), pts: j.hull.length, op: +j.opacity.toFixed(3) })) };
    })())`);
    console.log(`phase ${ph} stack:`, stack);
}
await cleanup(0);
