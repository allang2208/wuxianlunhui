#!/usr/bin/env node
/* 微探针：探针生成的 MinerZombie 为什么不吃伤害 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9399;
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
const page = await (async () => {
    for (let i = 0; i < 8; i++) {
        try { const t = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('localhost:5173')); if (t) return t; } catch {}
        await new Promise(r => setTimeout(r, 1000));
    }
})();
if (!page) { console.error('no page'); await cleanup(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
await send('Runtime.enable');
await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(1500);
  return 'ready';
})()`);

const out = await ev(`(async () => {
  const G = window.Game; const p = G.player;
  const q = (performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js')) || '').replace(/^.*\\/src\\/world\\/scene-manager\\.js/, '');
  const { MinerZombie } = await import('/src/entities/enemy-types.js' + q);
  const z = new MinerZombie(p.x + 100, p.y);
  z.id = 'probe_z';
  G.entities.set(z.id, z);
  const before = z.hp ?? z.data?.hp;
  const r = z.takeDamage(10, p, 'magic', false);
  const after = z.hp ?? z.data?.hp;
  return JSON.stringify({
    active: z.active, hittable: z.hittable, faction: z._faction,
    hpField: z.hp, dataHp: z.data && z.data.hp,
    takeDamageRet: r, before, after,
  });
})()`);
console.log(out);
await cleanup(0);
