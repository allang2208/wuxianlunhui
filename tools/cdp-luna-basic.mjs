#!/usr/bin/env node
/* 露娜普通攻击 + 法术内置 CD + idle 朝向验证（2026-08-15） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9337;
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

console.log('法术内置CD:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  luna.data.matk = 100; // 模拟装备法杖后的魔攻，便于验证伤害
  const fake = {
    id: 'cd_enemy', active: true, hittable: true,
    x: luna.x + 300, y: luna.y, vx: 0, vy: 0,
    hp: 500, maxHp: 500, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('cd_enemy', fake);
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  luna._castCooldown = 0;
  luna._fireballCooldown = 0; luna._iceSpikeCooldown = 0; luna._lightningStrikeCooldown = 0;
  // 等露娜施法（法术优先），采样内置 CD
  await sleep(1000);
  const cdAfterCast = luna._castCooldown;
  const cdAfter1s = cdAfterCast;
  await sleep(500);
  const cdAfter1_5s = luna._castCooldown;
  entities.delete('cd_enemy');
  return {
    castCooldownSet: cdAfterCast > 0 && cdAfterCast <= 2000 && cdAfter1_5s < cdAfterCast,
    cdAfterCast: Math.round(cdAfterCast),
    cdAfter1_5s: Math.round(cdAfter1_5s),
    cdDecreasing: cdAfter1_5s < cdAfter1s,
    lastAction: ai ? ai._lastAction : null,
  };
})()`));

console.log('普通攻击:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  luna.data.matk = 100;
  luna._castState = 'idle'; luna._frozenForCast = false; luna._castTimer = 0;
  luna._basic = null; luna.vx = 0; luna.vy = 0; luna._tacticalTarget = null;
  // 塞满法术 CD（含内置 CD）→ 只剩普通攻击可用
  luna._fireballCooldown = 99999; luna._iceSpikeCooldown = 99999;
  luna._lightningStrikeCooldown = 99999; luna._castCooldown = 99999;
  const fake = {
    id: 'basic_enemy', active: true, hittable: true,
    x: luna.x + 400, y: luna.y, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('basic_enemy', fake);
  const hpBefore = fake.hp;
  const matk = luna.data.matk || 0;
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  await sleep(1500);
  const basicFired = !!(luna._basic && luna._basic.active);
  const basicGone = !luna._basic && (hpBefore - fake.hp > 0);
  const dmg = hpBefore - fake.hp;
  const expected = Math.max(1, Math.floor(matk * 0.2));
  const ai2 = ai;
  entities.delete('basic_enemy');
  return {
    matk,
    expectedDmg: expected,
    actualDmg: dmg,
    dmgOk: dmg === expected,
    basicFiredOrHit: basicFired || basicGone,
    basicAtkCd: Math.round(ai2._basicAtkCd),
    lastAction: ai2 ? ai2._lastAction : null,
  };
})()`));

console.log('普通攻击诊断:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  const fake = {
    id: 'basic_diag', active: true, hittable: true,
    x: luna.x + 300, y: luna.y, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('basic_diag', fake);
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  luna.data.matk = 100; // 便于验证伤害公式
  ai._basicAtkCd = 0;
  ai._tryBasicAttack(fake);
  const s0 = { basic: luna._basic ? { x: Math.round(luna._basic.x), y: Math.round(luna._basic.y), dist: Math.round(luna._basic.dist) } : null, hp: fake.hp };
  await sleep(700);
  const s1 = { basic: luna._basic ? { x: Math.round(luna._basic.x), y: Math.round(luna._basic.y), dist: Math.round(luna._basic.dist) } : null, hp: fake.hp };
  entities.delete('basic_diag');
  return {
    matk: luna.data.matk,
    s0,
    s1,
    dmg: 1000 - s1.hp,
    expected: Math.floor(100 * 0.2),
  };
})()`));

console.log('idle朝向目标:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const s = window.__phaserScene;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna._lastAction = 'idle';
  luna.vx = 0; luna.vy = 0;
  luna.x = 640; luna.y = 620;
  const fake = {
    id: 'face_enemy', active: true, hittable: true,
    x: luna.x + 200, y: luna.y, vx: 0, vy: 0,
    hp: 300, maxHp: 300, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('face_enemy', fake);
  await sleep(400);
  if (!s._companionSprites['mage_luna']) s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const faceRight = !spr.flipX;
  // 敌人移到左侧 → idle 应转向左
  fake.x = luna.x - 200;
  await sleep(400);
  const faceLeft = !!spr.flipX;
  entities.delete('face_enemy');
  return {
    targetRightFaceRight: faceRight,
    targetLeftFaceLeft: faceLeft,
  };
})()`));

await cleanup(0);
