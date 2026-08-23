#!/usr/bin/env node
/* 微探针：直接调用 MovementSystem._computeMoveDirection 验证 _spawnEgress 分支 */
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

const out = await ev(`(async () => {
  const smUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js'));
  const q = smUrl.replace(/^.*\\/src\\/world\\/scene-manager\\.js/, '');
  const { HamsterExplorer } = await import('/src/entities/hamster-explorer.js' + q);
  const { MovementSystem } = await import('/src/systems/movement-system.js' + q);
  const p = window.Game.player;
  const e = new HamsterExplorer(p.x + 120, p.y);
  e.id = 'probe_x';
  window.Game.entities.set(e.id, e);
  e._command = { mode: 'explore' };
  e._spawnEgress = { x: 100, y: 100 };
  e._tacticalTarget = { x: p.x + 2000, y: p.y };
  const md = MovementSystem._computeMoveDirection(e, window.Game.entities);
  return JSON.stringify({
    hasAi: !!e.ai, aiRole: e.ai && e.ai.role, chargeStraight: !!(e.ai && e.ai.chargeStraight),
    groundRadius: e.groundRadius,
    egress: e._spawnEgress,
    moveData: md ? { dx: Math.round(md.dx), dy: Math.round(md.dy), dist: Math.round(md.dist) } : null,
    expectEgress: { dx: 100 - Math.round(e.x), dy: 100 - Math.round(e.y) },
  });
})()`);
console.log(out);
await cleanup(0);
