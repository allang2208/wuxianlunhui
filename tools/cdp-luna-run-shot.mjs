#!/usr/bin/env node
/* 露娜奔跑动画游戏内截图探针（2026-08-14）：让露娜播 run，截图检查法杖是否被裁/遮挡。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9345;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT = process.argv[2] || 'C:\\Users\\allan\\AppData\\Local\\Temp\\luna-run-shots';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 800)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

fs.mkdirSync(OUT, { recursive: true });
edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
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
await send('Runtime.enable');
await send('Page.enable');

console.log('boot:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(1200);
  const ps = window.Game.PartySystem;
  if (!ps.getMember('mage_luna')) ps.addCompanion('mage_luna');
  return 'ready';
})()`));

await ev(`(() => {
  const { entities, player, PartySystem } = window.Game;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e._faction === 'enemy') entities.delete(k);
  }
  const luna = PartySystem.getMember('mage_luna');
  player.x = 600; player.y = 620; player._facingDir = 'right';
  // 露娜放玩家前方，保证在画面内；播 run 动画
  luna.x = 600 + 120; luna.y = 620;
  luna.target = null; luna._tacticalTarget = null;
  luna.vx = 0; luna.vy = 0; luna.isMoving = false;
  luna._animState = 'run'; luna._castState = 'idle'; luna._frozenForCast = false;
  const s = window.__phaserScene;
  s._syncCompanionSprites(window.Game);
  return true;
})()`);

for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 300));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) {
        fs.writeFileSync(path.join(OUT, `run_shot_${i}.png`), Buffer.from(shot.result.data, 'base64'));
        console.log(`shot ${i} saved`);
    }
}
await cleanup(0);
