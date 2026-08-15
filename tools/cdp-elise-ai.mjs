#!/usr/bin/env node
/* 伊莉丝（warrior_bruno）近战 AI 实机探针（2026-08-15）：
   - 招募伊莉丝 → 放一个假敌人 → 采样 5s：animState/target/meleeAtkTimer/defendPhase/敌人体力变化
   - 判定是否正常近战攻击（攻击动画触发 + 命中掉血 + 攻击间隔） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9334;
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

await send('Runtime.enable');
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
        const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        if (/error|Error|elise/i.test(txt)) console.log('[page]', txt.slice(0, 200));
    }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        console.log('[page-exc]', (d.exception?.description || d.text || '').slice(0, 300));
    }
};

console.log('boot:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(1500);
  return 'ready: ' + document.title + ' / hasGame=' + !!window.Game + ' / scene=' + (window.__phaserScene ? 'y' : 'n');
})()`));

console.log('招募+初始:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  if (!PartySystem.getMember('warrior_bruno')) PartySystem.addCompanion('warrior_bruno');
  const elise = PartySystem.getMember('warrior_bruno');
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  elise.x = 620; elise.y = 660;
  elise.data.hp = elise.data.maxHp;
  elise._frozenForCast = false;
  elise._castState = 'idle';
  await sleep(1000);
  return {
    name: elise.name,
    role: elise.aiConfig && elise.aiConfig.role,
    aiRegistered: !!PartySystem._aiFactories['warrior_bruno'],
    aiInstance: !!PartySystem._aiInstances['warrior_bruno'],
    pos: { x: Math.round(elise.x), y: Math.round(elise.y) },
    animState: elise._animState,
    lastAction: elise._lastAction,
    atk: elise.data.atk,
    skills: Object.keys(elise.skills || {}),
  };
})()`));

console.log('近战攻击 5s 采样:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const elise = PartySystem.getMember('warrior_bruno');
  const p = window.Game.player;
  // 清掉其它敌人避免干扰
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== elise && e._faction === 'enemy') entities.delete(k);
  }
  elise.target = null;
  elise._tacticalTarget = null;
  elise.x = 640; elise.y = 620;
  const fake = {
    id: 'elise_test_enemy', active: true, hittable: true,
    x: 800, y: 620, vx: 0, vy: 0,
    hp: 2000, maxHp: 2000,
    groundRadius: 20, bodyHeight: 130, attackRange: 70,
    attacks: { melee: {} },
    _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; },
    update() {},
  };
  entities.set('elise_test_enemy', fake);
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const samples = [];
  const hp0 = fake.hp;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    samples.push({
      t: i,
      anim: elise._animState,
      last: elise._lastAction,
      atkTimer: ai ? Math.round(ai._meleeAtkTimer || 0) : null,
      atkCd: Math.round(elise._basicAtkCd || 0),
      defPhase: ai ? (ai._defendPhase || null) : null,
      frozen: elise._frozenForCast,
      target: elise.target ? elise.target.id : null,
      dist: Math.round(Math.hypot(elise.x - fake.x, elise.y - fake.y)),
      hp: fake.hp,
    });
  }
  const attacks = samples.filter(s => s.anim === 'attack').length;
  const defends = samples.filter(s => s.anim === 'defend').length;
  entities.delete('elise_test_enemy');
  return {
    hp0, hpNow: fake.hp, hpDelta: hp0 - fake.hp,
    attackFrames: attacks, defendFrames: defends,
    sawMeleeTimer: samples.some(s => s.atkTimer > 0),
    sawAttackState: attacks > 0,
    samples: samples.filter((_, i) => i % 5 === 0),
  };
})()`));

console.log('渲染层动画核对:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const ps = window.__phaserScene;
  const elise = PartySystem.getMember('warrior_bruno');
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== elise && e._faction === 'enemy') entities.delete(k);
  }
  elise.target = null;
  elise._tacticalTarget = null;
  elise.x = 640; elise.y = 620;
  elise._meleeAtkTimer = 0; elise._basicAtkCd = 0;
  const fake = {
    id: 'elise_render_enemy', active: true, hittable: true,
    x: 800, y: 620, vx: 0, vy: 0,
    hp: 2000, maxHp: 2000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('elise_render_enemy', fake);
  const out = [];
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const spr = ps._companionSprites['warrior_bruno'];
    if (!spr) continue;
    out.push({
      anim: elise._animState,
      sprAnim: spr.anims.currentAnim ? spr.anims.currentAnim.key : null,
      sprTex: spr.texture.key,
      sprFrame: spr.frame.name,
      playing: spr.anims.isPlaying,
    });
  }
  entities.delete('elise_render_enemy');
  return out.filter((_, i) => i % 4 === 0);
})()`));

console.log('远程敌/移动敌场景:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== elise && e._faction === 'enemy') entities.delete(k);
  }
  elise.target = null;
  elise.x = 640; elise.y = 620;
  elise._meleeAtkTimer = 0; elise._basicAtkCd = 0;
  ai._defendCd = 0; ai._defendPhase = null; elise._frozenForCast = false;
  // 远程敌（600 射程）在 300px 内 → 应触发防御；同时放一个近战靶子测攻击
  const ranged = {
    id: 'elise_ranged', active: true, hittable: true,
    x: 900, y: 620, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 600, attack: { type: 'ranged' }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  const melee = {
    id: 'elise_melee_target', active: true, hittable: true,
    x: 790, y: 620, vx: 0, vy: 0,
    hp: 2000, maxHp: 2000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('elise_ranged', ranged);
  entities.set('elise_melee_target', melee);
  const samples = [];
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    samples.push({ anim: elise._animState, defPhase: ai._defendPhase || null, defCd: Math.round(ai._defendCd || 0), hp: melee.hp });
  }
  entities.delete('elise_ranged');
  entities.delete('elise_melee_target');
  const attackN = samples.filter(s => s.anim === 'attack').length;
  const defendN = samples.filter(s => s.anim === 'defend').length;
  const idleN = samples.filter(s => s.anim === 'idle').length;
  return {
    attackFrames: attackN, defendFrames: defendN, idleFrames: idleN,
    meleeHpDelta: 2000 - melee.hp,
    firstDefend: samples.findIndex(s => s.anim === 'defend'),
    samples: samples.filter((_, i) => i % 10 === 0),
  };
})()`));

console.log('奔跑状态机（idle→run 起步完整→循环 11~23 帧）:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const ps = window.__phaserScene;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const p = window.Game.player;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== elise && e._faction === 'enemy') entities.delete(k);
  }
  elise.target = null;
  elise._tacticalTarget = null;
  ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0;
  elise._frozenForCast = false; elise._animState = 'idle';
  // 让伊莉丝远离玩家并给一个远处的战术目标 → 应进入 run
  p.x = 400; p.y = 600;
  elise.x = 900; elise.y = 600; // 距玩家 ~500px → follow 用 run 归队
  const out = [];
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const spr = ps._companionSprites['warrior_bruno'];
    out.push({
      anim: elise._animState,
      sprAnim: spr && spr.anims.currentAnim ? spr.anims.currentAnim.key : null,
      sprFrame: spr ? spr.frame.name : null,
      playing: spr ? spr.anims.isPlaying : null,
      speed: Math.round(Math.hypot(elise.vx, elise.vy)),
    });
  }
  elise._tacticalTarget = null;
  return out.filter((_, i) => i % 4 === 0);
})()`));

console.log('风车（whirlwind）实机:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const ps = window.__phaserScene;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const p = window.Game.player;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== elise && e._faction === 'enemy') entities.delete(k);
  }
  // 重置状态：清掉防御/攻击/风车，技能 CD 归零
  elise.target = null;
  elise._tacticalTarget = null;
  elise._frozenForCast = false; elise._animState = 'idle';
  ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0;
  ai._whirlwindCd = 0; ai._whirlwindHitSet = null; ai._whirlwindTimer = 0;
  elise.x = 700; elise.y = 620;
  const mkFake = (id, x, y) => ({
    id, active: true, hittable: true, x, y, vx: 0, vy: 0,
    hp: 500, maxHp: 500, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    collider: {
      isGroundTarget: true, radius: 20, x, y,
      intersectsGroundCircle(cx, cy, r) {
        const dx = this.x - cx, dy = this.y - cy;
        const rr = this.radius + r;
        return dx * dx + dy * dy <= rr * rr;
      },
    },
    takeDamage(dmg) { this.hp -= dmg; },
    applyKnockback() {}, applyStun() {}, update() {},
  });
  const fake1 = mkFake('ww1', elise.x + 110, elise.y);
  const fake2 = mkFake('ww2', elise.x - 110, elise.y);
  const fake3 = mkFake('ww3', elise.x, elise.y + 90);
  entities.set('ww1', fake1); entities.set('ww2', fake2);
  entities.set('ww3', fake3);
  const en = Array.from(entities.values()).filter(e => e && e._faction === 'enemy');
  const diag = {
    enemyCount: en.length,
    defend: ai._shouldDefend(en),
    whirlwind: ai._shouldWhirlwind(en),
    lastAction: elise._lastAction,
    castState: elise._castState,
    frozen: elise._frozenForCast,
    command: elise._command ? elise._command.mode : null,
    wwCd: ai._whirlwindCd,
    defCd: ai._defendCd,
    defPhase: ai._defendPhase,
  };
  // 手动驱动一次决策，确认 _tickWarrior 是否可达、防御/风车是否会被发起
  let manual = null;
  try {
    ai._tickWarrior(Array.from(entities.values()), p);
    manual = {
      animState: elise._animState,
      defPhase: ai._defendPhase,
      wmSet: !!ai._whirlwindHitSet,
      lastAction: elise._lastAction,
    };
  } catch (err) {
    manual = { error: String(err && err.message || err) };
  }
  const hp0 = [fake1.hp, fake2.hp, fake3.hp];
  const samples = [];
  await sleep(200); // 等 AI 决策 tick
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const spr = ps._companionSprites['warrior_bruno'];
    samples.push({
      anim: elise._animState,
      sprAnim: spr && spr.anims.currentAnim ? spr.anims.currentAnim.key : null,
      wmTimer: Math.round(ai._whirlwindTimer || 0),
      wmCd: Math.round(ai._whirlwindCd || 0),
      hits: ai._whirlwindHits || 0,
    });
  }
  entities.delete('ww1'); entities.delete('ww2'); entities.delete('ww3');
  const hpDeltas = [fake1.hp, fake2.hp, fake3.hp].map((h, i) => hp0[i] - h);
  return {
    diag,
    manual,
    sawWindmill: samples.some(s => s.anim === 'windmill'),
    windmillFrames: samples.filter(s => s.anim === 'windmill').length,
    playedAnim: samples.find(s => s.sprAnim && s.sprAnim.includes('windmill'))?.sprAnim || null,
    hpDeltas,
    totalDamage: hpDeltas.reduce((a, b) => a + b, 0),
    whirlwindCdAfter: Math.round(ai._whirlwindCd || 0),
    samples: samples.filter((_, i) => i % 6 === 0),
  };
})()`));

await cleanup(0);
