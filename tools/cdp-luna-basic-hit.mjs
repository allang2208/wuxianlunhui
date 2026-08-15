#!/usr/bin/env node
/* 露娜普通攻击光球碰撞诊断（2026-08-15）：
   多个怪物排在光球路径上，验证光球是否能命中路径上第一个怪物。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9338;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

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

edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');

console.log('boot:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(1200);
  if (!window.Game.PartySystem.getMember('mage_luna')) window.Game.PartySystem.addCompanion('mage_luna');
  return 'ready';
})()`));

console.log('路径碰撞:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.matk = 25;
  luna._castState = 'idle'; luna._frozenForCast = false; luna._castTimer = 0;
  // 两个怪物排在同一直线上：近怪 300px、远怪 500px
  const mk = (id, x) => ({
    id, active: true, hittable: true,
    x, y: 620, vx: 0, vy: 0,
    hp: 500, maxHp: 500, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  });
  const near = mk('hit_near', 940);
  const far = mk('hit_far', 1140);
  entities.set('hit_near', near);
  entities.set('hit_far', far);
  luna.target = far; // 锁定远怪 → 光球路径会穿过近怪
  ai._basicAtkCd = 0;
  luna._basic = null;
  ai._tryBasicAttack(far);
  const nearHp0 = near.hp;
  const farHp0 = far.hp;
  await sleep(1500);
  const res = {
    nearHpDelta: nearHp0 - near.hp,
    farHpDelta: farHp0 - far.hp,
    nearHit: nearHp0 - near.hp > 0,
    farHit: farHp0 - far.hp > 0,
  };
  entities.delete('hit_near');
  entities.delete('hit_far');
  luna._basic = null;
  return res;
})()`));

await cleanup(0);
