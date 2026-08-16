#!/usr/bin/env node
/* 仓鼠小屋门口“两坨矿”实机核实（2026-08-16）：
 * - 进 scene8；在无矿区（基地旁 900,2148）放小屋 → 等矿工出门 → 扫门口 ±160px 实体
 * - 在簇区（2050,1400）再放一个小屋 → 同样扫描
 * - 输出门口区域的能源节点/能源掉落清单（区分：放置时已有 vs 矿工出门后新增）
 * 用法：node tools/cdp-hut-door-ore.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9395;
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

console.log('门口矿点核实:', JSON.stringify(await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const realImport = (sub) => performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes(sub));
  const hutMod = await import(realImport('/src/world/hamster-hut-system.js?'));
  const HamsterHut = hutMod.HamsterHut;
  const HamsterHutSystem = hutMod.HamsterHutSystem;
  const scanDoor = (hx, hy) => {
    const out = [];
    for (const e of window.Game.entities.values()) {
      if (!e || !e.active) continue;
      const d = Math.hypot(e.x - hx, e.y - hy);
      if (d > 170) continue;
      const kind = e._isEnergyNode ? 'energy_node'
        : (e.itemData && e.itemData.category === 'energy') ? 'energy_drop'
        : (e._isHamsterHut ? 'hut' : (e._isHamsterMiner ? 'miner' : (e._isDefenseStructure ? 'structure' : e.name || e.id)));
      out.push({ kind, pos: [Math.round(e.x), Math.round(e.y)], dist: Math.round(d) });
    }
    return out;
  };
  const run = (hx, hy, id) => {
    // 放小屋前门口区域快照
    const before = scanDoor(hx, hy + 42);
    const hut = new HamsterHut(hx, hy, { id });
    window.Game.entities.set(id, hut);
    HamsterHutSystem.huts.push(hut);
    return { before };
  };
  const baseHut = run(900, 2148, 'probe_hut_base');
  await sleep(1500); // 等初始矿工生成并出门
  const baseHutAfter = scanDoor(900, 2148 + 42);
  await sleep(2500);
  const baseHutLate = scanDoor(900, 2148 + 42);
  const clusterHut = run(2050, 1400, 'probe_hut_cluster');
  const clusterBefore = clusterHut.before;
  await sleep(1500);
  const clusterAfter = scanDoor(2050, 1400 + 42);
  await sleep(2500);
  const clusterLate = scanDoor(2050, 1400 + 42);
  const summarize = (before, after) => {
    const nodes = arr => arr.filter(x => x.kind === 'energy_node').length;
    const drops = arr => arr.filter(x => x.kind === 'energy_drop').length;
    return {
      nodesBefore: nodes(before), dropsBefore: drops(before),
      nodesAfter: nodes(after), dropsAfter: drops(after),
      doorEntities: after.filter(x => x.kind !== 'hut'),
    };
  };
  return {
    基地旁小屋: {
      ...summarize(baseHut.before, baseHutAfter),
      '出门后1.5s门口实体': baseHutAfter,
      '出门后4s门口实体': baseHutLate,
    },
    簇区小屋: {
      ...summarize(clusterBefore, clusterAfter),
      '放小屋前门口实体': clusterBefore,
      '出门后1.5s门口实体': clusterAfter,
      '出门后4s门口实体': clusterLate,
    },
  };
})()`), null, 2));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
