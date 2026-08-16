#!/usr/bin/env node
/* 仓鼠小屋放置是否生成矿 实机核实（2026-08-16）：
 * - 进世界-122（scene8）→ 记录能源节点快照（数量+位置）
 * - 按 building-system._place 同路径放置小屋（基地旁 / 最近簇旁）
 * - 放置后再快照：数量/位置应完全一致（不生成新矿）
 * - 输出小屋与最近节点的距离，判断“附近有矿”是否只是既有簇位置巧合
 * 用法：node tools/cdp-hut-ore-check.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9387;
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

console.log('进世界-122:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  const { SceneManager } = await import(u);
  try { await SceneManager.switchScene('scene8', window.Game.player, 'explore'); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
})()`));

let sceneReady = null;
for (let i = 0; i < 20; i++) {
    await sleep(800);
    sceneReady = await ev(`(async () => {
      const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
      const { DefenseSystem } = await import(u);
      return { active: DefenseSystem.active, nodes: window.Game.entities && Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode).length };
    })()`);
    if (sceneReady && sceneReady.active) break;
}
console.log('scene8 ready:', JSON.stringify(sceneReady));

console.log('核实结果:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const realImport = (sub) => performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes(sub));
  const { EnergyNodeSystem } = await import(realImport('/src/world/energy-node-system.js?'));
  const { HamsterHut } = await import(realImport('/src/world/hamster-hut-system.js?'));
  const hutSystemUrl = realImport('/src/world/hamster-hut-system.js?');
  const hutSys = await import(hutSystemUrl);
  const HamsterHutSystem = hutSys.HamsterHutSystem;
  const p = window.Game.player;
  const snapshot = () => Array.from(window.Game.entities.values())
    .filter(e => e && e._isEnergyNode && e.active)
    .map(e => ({ x: Math.round(e.x), y: Math.round(e.y) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const before = snapshot();
  const placeHut = (x, y, id) => {
    const hut = new HamsterHut(x, y, { id });
    window.Game.entities.set(id, hut);
    HamsterHutSystem.huts.push(hut);
    return hut;
  };
  // 放置1：玩家/基地附近（基地核心在 900,2048）
  placeHut(900, 2148, 'probe_hut_base');
  // 放置2：最近簇 (2000,1300) 旁边
  placeHut(2050, 1400, 'probe_hut_cluster');
  await sleep(1500);
  const after = snapshot();
  const newNodes = after.filter((n, i) => !before[i] || before[i].x !== n.x || before[i].y !== n.y);
  const nearestToHut = (hx, hy) => {
    let best = Infinity;
    for (const n of after) best = Math.min(best, Math.hypot(n.x - hx, n.y - hy));
    return Math.round(best);
  };
  return {
    nodeCountBefore: before.length,
    nodeCountAfter: after.length,
    sameCount: before.length === after.length,
    newOrMoved: newNodes.length,
    nearestNodeToBaseHut: nearestToHut(900, 2148),
    nearestNodeToClusterHut: nearestToHut(2050, 1400),
    sampleNodes: after.slice(0, 5),
  };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
