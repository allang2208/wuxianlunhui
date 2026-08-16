#!/usr/bin/env node
/* 能源簇调位实机验证（2026-08-16）：
 * - 进 scene8 → 统计节点总数 / 旧簇位(2000,1300)附近 / 新簇位(3000,1500)附近
 * - 常见建屋区(2050,1400)放小屋 → 门口 170px 内应 0 矿点
 * - 距基地/出生点最近矿点距离（应显著变大）
 * 用法：node tools/cdp-cluster-move-check.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9399;
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

console.log('调位验证:', JSON.stringify(await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const realImport = (sub) => performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes(sub));
  const hutMod = await import(realImport('/src/world/hamster-hut-system.js?'));
  const HamsterHut = hutMod.HamsterHut;
  const HamsterHutSystem = hutMod.HamsterHutSystem;
  const nodes = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode && e.active);
  const nearOld = nodes.filter(n => Math.hypot(n.x - 2000, n.y - 1300) < 500).length;
  const nearNew = nodes.filter(n => Math.hypot(n.x - 3000, n.y - 1500) < 500).length;
  const nearest = (x, y) => {
    let best = Infinity;
    for (const n of nodes) best = Math.min(best, Math.hypot(n.x - x, n.y - y));
    return Math.round(best);
  };
  // 常见建屋区 (2050,1400) 放小屋 → 门口扫描
  const hut = new HamsterHut(2050, 1400, { id: 'probe_hut_oldspot' });
  window.Game.entities.set('probe_hut_oldspot', hut);
  HamsterHutSystem.huts.push(hut);
  await sleep(1500);
  const doorOre = Array.from(window.Game.entities.values())
    .filter(e => e && e.active && (e._isEnergyNode || (e.itemData && e.itemData.category === 'energy')))
    .filter(e => Math.hypot(e.x - 2050, e.y - 1442) < 170).length;
  return {
    totalNodes: nodes.length,
    'nearOld(2000,1300)±500': nearOld,
    'nearNew(3000,1500)±500': nearNew,
    'nearestToSpawn(760,2048)': nearest(760, 2048),
    'nearestToOldBuildSpot(2050,1400)': nearest(2050, 1400),
    doorOreAtOldBuildSpot: doorOre,
  };
})()`), null, 2));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
