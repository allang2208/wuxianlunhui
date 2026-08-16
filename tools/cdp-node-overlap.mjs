#!/usr/bin/env node
/* 能源簇节点贴图重叠核实（2026-08-16）：
 * - 进 scene8 → 计算全部节点两两距离
 * - 统计 <100px（84px 贴图 + 透视必然视觉重叠）和 <120px 的对数
 * 用法：node tools/cdp-node-overlap.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9415;
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
const pageExceptions = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        pageExceptions.push((d.exception?.description || d.text || '').slice(0, 500));
    }
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
await sleep(500);

console.log('重叠统计:', JSON.stringify(await ev(`(() => {
  const nodes = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode && e.active)
    .map(e => ({ x: e.x, y: e.y, size: e.spriteCfg ? e.spriteCfg.size : 84 }));
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      pairs.push({ a: nodes[i], b: nodes[j], d: Math.round(d) });
    }
  }
  const under90 = pairs.filter(p => p.d < 90);
  const under110 = pairs.filter(p => p.d < 110);
  const under130 = pairs.filter(p => p.d < 130);
  // 各簇内重叠对数（按 3000,1500 / 3600,900 / 3600,3200 / 4900,2048 分组）
  const clusterOf = (x, y) => {
    if (Math.hypot(x - 3000, y - 1500) < 400) return 'A(3000,1500)';
    if (Math.hypot(x - 3600, y - 900) < 400) return 'B(3600,900)';
    if (Math.hypot(x - 3600, y - 3200) < 400) return 'C(3600,3200)';
    if (Math.hypot(x - 4900, y - 2048) < 400) return 'D(4900,2048)';
    return '?';
  };
  const perCluster = {};
  for (const p of under110) {
    const k = clusterOf(p.a.x, p.a.y);
    perCluster[k] = (perCluster[k] || 0) + 1;
  }
  return {
    totalNodes: nodes.length,
    '重叠对<90px': under90.length,
    '重叠对<110px': under110.length,
    '重叠对<130px': under130.length,
    perClusterUnder110: perCluster,
    closestPairs: pairs.sort((a, b) => a.d - b.d).slice(0, 8).map(p => ({ d: p.d, a: [Math.round(p.a.x), Math.round(p.a.y)], b: [Math.round(p.b.x), Math.round(p.b.y)] })),
  };
})()`), null, 2));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
