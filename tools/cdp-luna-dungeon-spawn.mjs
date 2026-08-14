#!/usr/bin/env node
/* 露娜地牢生成位置验证（2026-08-14）：
   进入地牢（DungeonMapSystem.init + SceneManager 切 scene7）后，
   露娜必须生成在合法可移动位置（不被墙卡住），且能跟随玩家。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9334;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

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
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('  saved', `${OUT_DIR}/${name}.png`);
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

console.log('进入地牢:', await ev(`(async () => {
  // 主实例 ExpeditionSystem.depart() 真实进入地牢（避免动态 import 平行模块坑）
  const ES = window.Game.ExpeditionSystem;
  if (!ES || typeof ES.depart !== 'function') return { err: 'no depart' };
  window.Game.player.data.mp = 9999;
  ES.selectedDungeon = 'zombie';
  ES.depart();
  return { ok: true, player: { x: window.Game.player.x, y: window.Game.player.y } };
})()`));
await sleep(1800);

console.log('露娜生成位置:', await ev(`(async () => {
  const luna = window.Game.PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  const WS = window.WallSystem;
  const pos0 = { x: luna.x, y: luna.y };
  const legal0 = WS && typeof WS.canMoveTo === 'function' ? WS.canMoveTo(luna.x, luna.y, 20) : null;
  const dist0 = Math.hypot(luna.x - p.x, luna.y - p.y);
  // 清掉地牢怪，验证无战斗时的主动跟随
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  luna.target = null;
  // 玩家移动 → 露娜应主动跟随寻找位置
  p.x += 320; p.y += 40;
  const followStart = { x: luna.x, y: luna.y };
  await new Promise(r => setTimeout(r, 1600));
  const moved = Math.hypot(luna.x - followStart.x, luna.y - followStart.y);
  const followDist = Math.hypot(luna.x - p.x, luna.y - p.y);
  const ai = luna._aiInstance || window.Game.PartySystem._aiInstances['mage_luna'];
  return {
    pos: { x: Math.round(pos0.x), y: Math.round(pos0.y) },
    player: { x: Math.round(p.x - 320), y: Math.round(p.y - 40) },
    legal: legal0,
    distToPlayer: Math.round(dist0),
    followedPlayer: Math.round(moved),
    followDistAfter: Math.round(followDist),
    animState: luna._animState,
    lastAction: ai ? ai._lastAction : null,
    tacticalTarget: luna._tacticalTarget ? { x: Math.round(luna._tacticalTarget.x), y: Math.round(luna._tacticalTarget.y) } : null,
  };
})()`));
await shot('luna_dungeon_spawn');

console.log('地牢施法:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { entities, PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  luna.data.mp = luna.data.maxMp;
  luna.x = p.x + 120; luna.y = p.y; // 拉回玩家附近再测
  const mp0 = luna.data.mp;
  const states = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (luna._animState) states.push(luna._animState);
  }
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  const enemies = [];
  for (const e of entities.values()) {
    if (e && e._faction === 'enemy' && e.active && e.hp > 0) {
      enemies.push({ id: e.id, hp: Math.round(e.hp), dist: Math.round(Math.hypot(e.x - luna.x, e.y - luna.y)) });
    }
  }
  const res = {
    target: luna.target ? luna.target.id : null,
    animSeen: Array.from(new Set(states)),
    mpDelta: Math.round(mp0 - luna.data.mp),
    lastAction: ai ? ai._lastAction : null,
    distToPlayer: Math.round(Math.hypot(luna.x - p.x, luna.y - p.y)),
    enemies,
  };
  return res;
})()`));

await cleanup(0);
