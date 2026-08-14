#!/usr/bin/env node
/* 露娜 AI 状态机实机探针（2026-08-14）：走真实 PartySystem.updateCombat 决策流程，
   验证 静止→idle / 移动→walk/run / 施法→spell / 近战威胁→flee(run) 状态切换。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9340;
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
await send('Runtime.enable');

console.log('boot:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(1500);
  const ps = window.Game.PartySystem;
  if (!ps.getMember('mage_luna')) ps.addCompanion('mage_luna');
  return 'ready';
})()`));

const reset = `(() => {
  const { entities, player, PartySystem } = window.Game;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e._faction === 'enemy') entities.delete(k);
  }
  const luna = PartySystem.getMember('mage_luna');
  player.x = 600; player.y = 620; player._facingDir = 'right';
  luna.x = 600 - 150; luna.y = 620 + 34;
  luna.target = null; luna._tacticalTarget = null;
  luna.vx = 0; luna.vy = 0; luna.isMoving = false;
  luna._animState = 'idle'; luna._castState = 'idle'; luna._frozenForCast = false;
  luna.data.mp = luna.data.maxMp;
  luna._fireballCooldown = 0; luna._iceSpikeCooldown = 0; luna._lightningStrikeCooldown = 0; luna._castCooldown = 0;
  return true;
})()`;

const sampleStates = async (frames, intervalMs) => {
    const out = [];
    for (let i = 0; i < frames; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        out.push(await ev(`(() => {
          const luna = window.Game.PartySystem.getMember('mage_luna');
          return { anim: luna._animState, cast: luna._castState };
        })()`));
    }
    return out;
};

console.log('\\n=== A. 静止跟随 → 期望最终 idle ===');
await ev(reset);
let states = await sampleStates(12, 250);
console.log(states.map(s => `${s.anim}/${s.cast}`).join('  '));
console.log(states.at(-1).anim === 'idle' ? 'PASS A: 静止后 idle' : `FAIL A: 静止后仍是 ${states.at(-1).anim}`);

console.log('\\n=== B. 玩家远移 → 期望 run→walk→idle ===');
await ev(`(() => { window.Game.player.x += 600; return true; })()`);
states = await sampleStates(20, 250);
console.log(states.map(s => `${s.anim}/${s.cast}`).join('  '));
console.log(`B: 出现run=${states.some(s => s.anim === 'run')} 最终=${states.at(-1).anim}`);

console.log('\\n=== C. 注入敌人 → 期望 cast→spell（页面内采样） ===');
await ev(reset);
const cResult = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { entities, PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  luna.x = 640; luna.y = 620;
  window.__probeEnemy = {
    id: 'state_probe_enemy', active: true, hittable: true,
    x: 900, y: 620, vx: 0, vy: 0,
    hp: 400, maxHp: 400, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('state_probe_enemy', window.__probeEnemy);
  const ai = PartySystem._aiInstances['mage_luna'];
  // 手动触发一次真实 _tryCast（等价于决策 cast 分支），验证施法锁定期 spell 动画持续
  luna.target = window.__probeEnemy;
  const before = { cast: luna._castState, anim: luna._animState, timer: luna._castTimer, frozen: luna._frozenForCast };
  ai._tryCast('fireball', window.__probeEnemy);
  const after = { cast: luna._castState, anim: luna._animState, timer: luna._castTimer, frozen: luna._frozenForCast };
  const spr = window.__phaserScene._companionSprites['mage_luna'];
  const samples = [];
  for (let i = 0; i < 14; i++) {
    await sleep(70);
    samples.push({ anim: luna._animState, cast: luna._castState,
                   timer: luna._castTimer, frozen: luna._frozenForCast,
                   sprAnim: spr && spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
                   sprFrame: spr ? spr.frame.name : null });
  }
  return { before, after, samples, mp: luna.data.mp, fbCd: luna._fireballCooldown };
})()`);
console.log(`before=${JSON.stringify(cResult.before)} after=${JSON.stringify(cResult.after)}`);
console.log(cResult.samples.map(s => `${s.anim}/${s.cast}/${s.timer}/${s.frozen}/${s.sprAnim || '-'}/${s.sprFrame}`).join('  '));
const sawSpell = cResult.after.cast === 'casting' && cResult.after.anim === 'spell' && cResult.after.frozen === true
    && cResult.after.timer > 0
    && cResult.samples.some(s => (s.sprAnim || '').includes('spell'));
console.log(`C: mp=${cResult.mp} fbCd=${Math.round(cResult.fbCd)}`);
console.log(sawSpell ? 'PASS C: 施法 spell' : 'FAIL C: 未施法');

console.log('\\n=== D. 近战威胁贴脸 → 期望 flee(run) ===');
await ev(`(() => {
  const { entities, PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const en = window.__probeEnemy || entities.get('state_probe_enemy');
  if (en) { en.x = luna.x + 80; en.y = luna.y; }
  return true;
})()`);
states = await sampleStates(8, 250);
console.log(states.map(s => `${s.anim}/${s.cast}`).join('  '));
console.log(states.some(s => s.anim === 'run') ? 'PASS D: flee run' : 'FAIL D: 未 flee');

console.log('\\n=== E. 渲染层 spell 动画直接验证（不受 headless 掉帧影响） ===');
const eResult = await ev(`(() => {
  const s = window.__phaserScene;
  const luna = window.Game.PartySystem.getMember('mage_luna');
  // 清理敌人，手动设施法状态 → 同步一次渲染层
  const { entities } = window.Game;
  entities.delete('state_probe_enemy');
  luna._castState = 'casting';
  luna._frozenForCast = true;
  luna._animState = 'spell';
  luna.vx = 0; luna.vy = 0; luna.isMoving = false;
  s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  const playing = spr.anims.isPlaying ? spr.anims.currentAnim.key : null;
  const texExists = s.textures.exists('companion_mage_luna_spell');
  const animExists = s.anims.exists('companion_mage_luna_spell');
  const cfgSpell = !!(luna.animations && luna.animations.spell);
  // 清回 idle
  luna._castState = 'idle'; luna._frozenForCast = false; luna._animState = 'idle';
  s._syncCompanionSprites(window.Game);
  const idleFrame = spr.frame.name;
  const idleTex = spr.texture.key;
  return { playing, texExists, animExists, cfgSpell, idleFrame, idleTex };
})()`);
console.log(JSON.stringify(eResult));
const passE = eResult.texExists && eResult.animExists && eResult.cfgSpell && eResult.playing === 'companion_mage_luna_spell'
    && eResult.idleTex === 'companion_mage_luna_idle';
console.log(passE ? 'PASS E: 渲染层 spell 播放 + idle 停帧' : 'FAIL E: 渲染层问题');

await ev(`(() => { const { entities } = window.Game; entities.delete('state_probe_enemy'); return true; })()`);
await cleanup(0);
