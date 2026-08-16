#!/usr/bin/env node
/* 能源节点堆积/叠图核实（2026-08-16）：
 * - 进 scene8 → 快照节点 → 回主神空间 → 再进 scene8 → 快照
 * - 检查：总数是否翻倍（重复生成）、是否存在坐标重叠（<40px 的节点对）
 * 用法：node tools/cdp-node-accumulate.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9407;
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

const switchScene = (id) => ev(`(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  const { SceneManager } = await import(u);
  await SceneManager.switchScene('${id}', window.Game.player, 'explore');
  return true;
})()`);
const waitDefense = async () => {
    for (let i = 0; i < 20; i++) {
        await sleep(800);
        const ok = await ev(`(async () => {
          const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
          const { DefenseSystem } = await import(u);
          return DefenseSystem.active ? true : null;
        })()`);
        if (ok) return true;
    }
    return false;
};
const snapshot = () => ev(`(() => {
  const nodes = Array.from(window.Game.entities.values())
    .filter(e => e && e._isEnergyNode && e.active)
    .map(e => [Math.round(e.x), Math.round(e.y)]);
  // 找重叠对（<40px）
  const stacked = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]) < 40) {
        stacked.push([nodes[i], nodes[j]]);
      }
    }
  }
  return { total: nodes.length, stacked };
})()`);

await switchScene('scene8');
await waitDefense();
await sleep(500);
const first = await snapshot();
console.log('第1次进 scene8:', JSON.stringify(first));

await switchScene('main');
await sleep(2000);
await switchScene('scene8');
await waitDefense();
await sleep(500);
const second = await snapshot();
console.log('第2次进 scene8:', JSON.stringify(second));

// 模拟旧会话残留：注入 5 个假能源节点 → 重新触发 setup → 应只剩 54 且无残留
const cleanCheck = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 5; i++) {
    window.Game.entities.set('stale_node_' + i, {
      id: 'stale_node_' + i, active: true, _isEnergyNode: true,
      x: 1156 + i * 30, y: 2176, hp: 3000, maxHp: 3000,
      groundRadius: 45, update() {},
    });
  }
  const before = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode).length;
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/energy-node-system.js?'));
  const { EnergyNodeSystem } = await import(u);
  EnergyNodeSystem.setup();
  await sleep(800);
  const after = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode);
  const nearGate = after.filter(e => Math.hypot(e.x - 1156, e.y - 2176) < 200).length;
  return { staleInjected: 5, totalBefore: before, totalAfter: after.length, nearGate };
})()`);
console.log('防御清理:', JSON.stringify(cleanCheck));

// 运行时防叠图自愈：同位置 3 节点 → sweepStacked 只留 1
const sweepCheck = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 3; i++) {
    window.Game.entities.set('stack_' + i, {
      id: 'stack_' + i, active: true, _isEnergyNode: true,
      x: 1324, y: 2110, hp: 3000 + i * 100, maxHp: 3000 + i * 100,
      groundRadius: 45, update() {},
    });
  }
  const before = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode && Math.round(e.x) === 1324 && Math.round(e.y) === 2110).length;
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/energy-node-system.js?'));
  const { EnergyNodeSystem } = await import(u);
  const removed = EnergyNodeSystem.sweepStacked();
  const after = Array.from(window.Game.entities.values()).filter(e => e && e._isEnergyNode && Math.round(e.x) === 1324 && Math.round(e.y) === 2110).length;
  return { stackedBefore: before, removed, remainingAt1324_2110: after };
})()`);
console.log('防叠图自愈:', JSON.stringify(sweepCheck));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
