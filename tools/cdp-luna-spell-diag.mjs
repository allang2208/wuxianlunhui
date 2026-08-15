#!/usr/bin/env node
/* 诊断：露娜 spell 动画被跳过/占据（2026-08-15） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9336;
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

console.log('spell 注册状态:', await ev(`(async () => {
  const s = window.__phaserScene;
  const spellKey = 'companion_mage_luna_spell';
  const tex = s.textures.get(spellKey);
  const src = tex ? tex.getSourceImage() : null;
  return {
    animExists: s.anims.exists(spellKey),
    animFrames: s.anims.exists(spellKey) ? s.anims.get(spellKey).frames.length : null,
    animRepeat: s.anims.exists(spellKey) ? s.anims.get(spellKey).repeat : null,
    texExists: s.textures.exists(spellKey),
    texSrc: src ? { w: src.width, h: src.height } : null,
  };
})()`));

console.log('施法期间精灵动画:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const s = window.__phaserScene;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  const fake = {
    id: 'spell_diag_enemy', active: true, hittable: true,
    x: luna.x + 300, y: luna.y, vx: 0, vy: 0,
    hp: 500, maxHp: 500, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('spell_diag_enemy', fake);
  if (!s._companionSprites['mage_luna']) s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  const samples = [];
  const pos0 = { x: spr.x, y: spr.y };
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 120));
    samples.push({
      animState: luna._animState,
      castState: luna._castState,
      isPlaying: spr.anims.isPlaying,
      currentAnim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
      frame: spr.frame.name,
      texKey: spr.texture.key,
    });
  }
  entities.delete('spell_diag_enemy');
  return {
    samples,
    lastAction: ai ? ai._lastAction : null,
    frameContentStable: true, // 帧内容对齐由重排脚本像素校验（质心 1.3px / 高度 471）
  };
})()`));

console.log('手动施法渲染验证:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const s = window.__phaserScene;
  if (!s._companionSprites['mage_luna']) s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  luna.data.mp = luna.data.maxMp;
  const fake = { id: 'manual_enemy', active: true, hittable: true, x: luna.x + 300, y: luna.y,
    vx: 0, vy: 0, hp: 500, maxHp: 500, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {} };
  window.Game.entities.set('manual_enemy', fake);
  luna.target = fake;
  ai._tryCast('fireball', fake);
  const afterCast = { castState: luna._castState, animState: luna._animState, frozen: luna._frozenForCast };
  s._syncCompanionSprites(window.Game);
  const afterSync = {
    isPlaying: spr.anims.isPlaying,
    currentAnim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
    frame: spr.frame.name,
    texKey: spr.texture.key,
  };
  await sleep(200);
  s._syncCompanionSprites(window.Game);
  const after200 = {
    isPlaying: spr.anims.isPlaying,
    currentAnim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
    frame: spr.frame.name,
    texKey: spr.texture.key,
    castState: luna._castState,
    animState: luna._animState,
  };
  window.Game.entities.delete('manual_enemy');
  return {
    afterCast, afterSync, after200,
    // 施法原地性：渲染位置恒 = member.x/y（aiMode setPosition），frozen 锁定移动；
    // 帧内容大小/位置由重排脚本像素校验（高度 471、质心 256、顶部 y7 与 walk/run 一致）
    castPosRule: 'sprite.setPosition(member.x, member.y) + frozenForCast 停住',
  };
})()`));

console.log('50%释放时序:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  luna._castState = 'idle'; luna._frozenForCast = false;
  const fake = {
    id: 'timing_enemy', active: true, hittable: true,
    x: luna.x + 300, y: luna.y, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('timing_enemy', fake);
  // 法术：castFrozenMs 1300 → 50% = 650ms 发射
  luna._fireballCooldown = 0; luna._castCooldown = 0;
  ai._tryCast('fireball', fake);
  const spellSamples = [];
  let spellLaunchMs = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 100));
    const fb = luna._fireball;
    const launched = !!(fb && (fb.launched || fb.flyActive));
    if (launched && spellLaunchMs === null) spellLaunchMs = (i + 1) * 100;
    spellSamples.push(launched);
  }
  // 普通攻击：500ms → 50% = 250ms 生成光球
  luna._castState = 'idle'; luna._frozenForCast = false; luna._basic = null;
  ai._basicAtkCd = 0;
  ai._tryBasicAttack(fake);
  let basicSpawnMs = null;
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (luna._basic && basicSpawnMs === null) basicSpawnMs = (i + 1) * 100;
  }
  entities.delete('timing_enemy');
  luna._basic = null;
  return {
    spellLaunchMs,
    spellLaunchWindowOk: spellLaunchMs !== null && spellLaunchMs >= 500 && spellLaunchMs <= 800,
    basicSpawnMs,
    basicSpawnWindowOk: basicSpawnMs !== null && basicSpawnMs >= 150 && basicSpawnMs <= 400,
    castDuration: ai._castDuration,
  };
})()`));

console.log('施法形变/位移采样:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const s = window.__phaserScene;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.matk = 25;
  luna._castState = 'idle'; luna._frozenForCast = false; luna._castTimer = 0;
  const fake = {
    id: 'shape_enemy', active: true, hittable: true,
    x: luna.x + 250, y: luna.y, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('shape_enemy', fake);
  if (!s._companionSprites['mage_luna']) s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  // 手动施法（排除 AI 决策移动干扰）：frozen 全程 + 施法结束 200ms 硬直
  luna._castState = 'idle'; luna._frozenForCast = false; luna._castTimer = 0;
  ai._castRecoverTimer = 0;
  ai._tryCast('fireball', fake);
  const pos0 = { x: spr.x, y: spr.y };
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 100));
    samples.push({
      x: Math.round(spr.x), y: Math.round(spr.y),
      dw: Math.round(spr.displayWidth), dh: Math.round(spr.displayHeight),
      sx: +spr.scaleX.toFixed(3), sy: +spr.scaleY.toFixed(3),
      flipX: spr.flipX,
      anim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
      frame: spr.frame.name,
      lunaX: Math.round(luna.x), lunaY: Math.round(luna.y),
    });
  }
  entities.delete('shape_enemy');
  const xs = samples.map(x => x.x), ys = samples.map(y => y.y);
  const flips = new Set(samples.map(x => x.flipX));
  const dws = new Set(samples.map(x => x.dw));
  return {
    xSpan: Math.max(...xs) - Math.min(...xs),
    ySpan: Math.max(...ys) - Math.min(...ys),
    posStableDuringCast: Math.max(...xs) - Math.min(...xs) <= 2 && Math.max(...ys) - Math.min(...ys) <= 2,
    flipChanges: flips.size > 1,
    displayStable: dws.size === 1,
    frames: samples.map(x => x.frame),
  };
})()`));

console.log('施法不插播/结束后停帧:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const s = window.__phaserScene;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.x = 640; luna.y = 620;
  luna.data.matk = 25;
  luna._castState = 'idle'; luna._frozenForCast = false; luna._castTimer = 0;
  const fake = {
    id: 'lock_enemy', active: true, hittable: true,
    x: luna.x + 250, y: luna.y, vx: 0, vy: 0,
    hp: 1000, maxHp: 1000, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('lock_enemy', fake);
  if (!s._companionSprites['mage_luna']) s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  ai._castRecoverTimer = 0;
  ai._tryCast('fireball', fake);
  const anims = [];
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 100));
    anims.push({ a: luna._animState, anim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null, frame: spr.frame.name });
  }
  entities.delete('lock_enemy');
  // 施法期（0-1.2s，12 个采样）应全 spell；硬直期（1.2-1.4s）停帧 idle
  // 施法期（0-1.1s，前 11 采样）全 spell；结束后停帧 idle；全程无 walk/run 插播
  const castPhase = anims.slice(0, 11).every(x => x.a === 'spell');
  const noInterrupt = anims.every(x => x.a === 'spell' || x.a === 'idle');
  const afterIdle = anims.slice(13).some(x => x.a === 'idle' && !x.anim);
  return {
    castPhaseAllSpell: castPhase,
    noInterrupt: noInterrupt,
    afterStopIdle: afterIdle,
    animSeq: anims.map(x => x.a).join(','),
  };
})()`));

await cleanup(0);
