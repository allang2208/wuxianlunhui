#!/usr/bin/env node
/* 伊莉丝采集指令实机探针（2026-08-16）：
 * - 新招募伊莉丝 + 注入假能源点 → 下 gather 指令（指令点=能源点附近）
 * - 验证：走过去、进近战范围挥砍（anim=attack / node.hp 下降 / 攻击冷却节奏）
 * 用法：node tools/cdp-elise-gather.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9355;
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
await new Promise((r) => setTimeout(r, 9000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
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
    } catch (err) {
        console.log('boot retry', attempt, err.message.slice(0, 80));
        await sleep(2000);
    }
}
console.log('boot:', bootOk);
if (bootOk !== 'ready') { console.error('boot failed'); await cleanup(1); }

console.log('准备:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  if (PartySystem.getMember('mage_luna')) PartySystem.removeCompanion('mage_luna');
  if (PartySystem.getMember('warrior_bruno')) PartySystem.removeCompanion('warrior_bruno');
  PartySystem._roster = {};
  PartySystem.addCompanion('warrior_bruno');
  const elise = PartySystem.getMember('warrior_bruno');
  // 清敌人/旧节点
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && (e._faction === 'enemy' || e._isEnergyNode)) window.Game.entities.delete(k);
  }
  const p = window.Game.player;
  // 能源点放在玩家右前方 ~260px（主城可走区域）
  const nx = p.x + 260, ny = p.y + 10;
  const node = {
    id: 'test_energy_node', active: true, _isEnergyNode: true, _depleted: false,
    x: nx, y: ny, hp: 3000, maxHp: 3000, groundRadius: 24, bodyHeight: 130,
    _faction: 'neutral', immovable: true,
    takeDamage(d) { this.hp -= d; return d; },
    update() {},
  };
  window.Game.entities.set('test_energy_node', node);
  elise.x = p.x - 100; elise.y = p.y;
  elise._command = null; elise._tacticalTarget = null; elise.target = null;
  elise._frozenForCast = false; elise._castState = 'idle'; elise._basicAtkCd = 0;
  const ai = PartySystem._aiInstances['warrior_bruno'];
  if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._gatherPhase = 'work'; ai._patrolTarget = null; }
  return { player: [Math.round(p.x), Math.round(p.y)], node: [nx, ny], elise: [Math.round(elise.x), Math.round(elise.y)], aiRole: elise.aiConfig && elise.aiConfig.role };
})()`));

console.log('下 gather 指令:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  const p = window.Game.player;
  PartySystem.setSelected(['warrior_bruno']);
  const w = window.Game.CompanionCommandWheel;
  w._resolveTargets(false);
  w._worldPoint = { x: p.x + 260, y: p.y + 10 };
  const n = w._execute('gather');
  const elise = PartySystem.getMember('warrior_bruno');
  return { n, cmd: elise._command && elise._command.mode, point: elise._command && elise._command.point };
})()`));

console.log('采样 6s:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const node = window.Game.entities.get('test_energy_node');
  const out = [];
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    out.push({
      anim: elise._animState, last: elise._lastAction,
      pos: [Math.round(elise.x), Math.round(elise.y)],
      distToNode: Math.round(Math.hypot(elise.x - node.x, elise.y - node.y)),
      nodeHp: node.hp, atkCd: Math.round(elise._basicAtkCd || 0),
      frozen: elise._frozenForCast,
    });
  }
  window.Game.entities.delete('test_energy_node');
  const approached = out.some(s => s.distToNode < 120);
  const attacked = out.some(s => s.anim === 'attack' || s.atkCd > 0);
  return {
    approached, attacked,
    minDist: Math.min(...out.map(s => s.distToNode)),
    hpDelta: 3000 - node.hp,
    attackFrames: out.filter(s => s.anim === 'attack').length,
    samples: out.filter((_, i) => i % 6 === 0),
  };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);

await cleanup(0);
