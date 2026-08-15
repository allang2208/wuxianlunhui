#!/usr/bin/env node
/* 露娜动画循环验证（2026-08-12）：
   - walk 循环 [7,31]（首尾 2.3% 差异，站立帧 = 循环起点 7）
   - run 起步 [0,18] 播一次 → 循环 [19,31]
   用真实键盘事件（Shift+W）驱动移动/冲刺，避免 headless 下状态被游戏重置。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9330;
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
  await sleep(1500);
  return 'ready';
})()`));

console.log('动画注册:', await ev(`(async () => {
  const s = window.__phaserScene;
  const luna = window.Game.PartySystem.getMember('mage_luna');
  if (!luna) window.Game.PartySystem.addCompanion('mage_luna');
  return {
    walkAnim: s.anims.exists('companion_mage_luna_walk'),
    walkFrameCount: s.anims.get('companion_mage_luna_walk') ? s.anims.get('companion_mage_luna_walk').frames.length : null,
    walkFirstFrame: s.anims.get('companion_mage_luna_walk') ? s.anims.get('companion_mage_luna_walk').frames[0].textureFrame : null,
    walkLastFrame: s.anims.get('companion_mage_luna_walk') ? s.anims.get('companion_mage_luna_walk').frames.at(-1).textureFrame : null,
    runStart: s.anims.exists('companion_mage_luna_run_start'),
    runStartFrames: s.anims.exists('companion_mage_luna_run_start') ? s.anims.get('companion_mage_luna_run_start').frames.length : null,
    runLoop: s.anims.exists('companion_mage_luna_run'),
    runLoopFrames: s.anims.exists('companion_mage_luna_run') ? s.anims.get('companion_mage_luna_run').frames.length : null,
  };
})()`));

// 清理场景敌人，避免干扰 AI 状态
await ev(`(async () => {
  const { entities } = window.Game;
  let n = 0;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e._faction === 'enemy') { entities.delete(k); n++; }
  }
  return n;
})()`);

console.log('AI idle(站立=奔跑首帧):', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const s = window.__phaserScene;
  const p = window.Game.player;
  const luna = window.Game.PartySystem.getMember('mage_luna');
  p.x = 600; p.y = 620;
  luna.target = null;
  luna._tacticalTarget = null;
  luna.vx = 0; luna.vy = 0; luna.isMoving = false;
  luna._animState = 'idle'; // 渲染层直接验证：idle 停帧 = 奔跑首帧
  s._syncCompanionSprites(window.Game);
  const spr = s._companionSprites['mage_luna'];
  return {
    frame: spr.frame.name,
    texKey: spr.texture.key,
    playing: spr.anims.isPlaying,
    animState: luna._animState,
    idleKeyData: spr.getData('companionIdleKey'),
    idleFrameData: spr.getData('companionIdleFrame'),
    display: { w: Math.round(spr.displayWidth), h: Math.round(spr.displayHeight) },
  };
})()`));

console.log('AI follow→walk 循环:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const s = window.__phaserScene;
  const p = window.Game.player;
  const luna = window.Game.PartySystem.getMember('mage_luna');
  luna._tacticalTarget = null;
  luna.target = null;
  luna.x = p.x - 100; luna.y = p.y; // 靠近跟随点，小幅移动触发 walk
  p.x += 80; // 玩家小幅移动 → 露娜跟随（距离 < runDist 260 → walk 而非 run）
  const spr = s._companionSprites['mage_luna'];
  const frames = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 200));
    frames.push(spr.frame.name);
  }
  const anim = spr.anims.isPlaying ? spr.anims.currentAnim.key : null;
  let wrapped = false;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i - 1] - frames[i] > 20) { wrapped = true; break; }
  }
  return { anim, frames, wrapped, animState: luna._animState };
})()`));

console.log('AI cast→spell:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { entities, PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  // 删除场景其它敌人（避免目标干扰；headless 测试环境）
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  window.__aiEnemy = {
    id: 'anim_test_enemy', active: true, hittable: true,
    x: 900, y: 620, vx: 0, vy: 0,
    hp: 400, maxHp: 400, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; }, update() {},
  };
  entities.set('anim_test_enemy', window.__aiEnemy);
  const animSeen = []; const castSeen = [];
  for (let i = 0; i < 7; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (luna._animState) animSeen.push(luna._animState);
    castSeen.push(luna._castState);
  }
  const spr = window.__phaserScene._companionSprites['mage_luna'];
  // 直接验证 _tryCast 的施法动画状态（避免采样窗口错过 650ms 施法期）
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  let manual = null;
  if (ai && typeof ai._tryCast === 'function') {
    luna.data.mp = luna.data.maxMp;
    ai._tryCast('fireball', window.__aiEnemy);
    manual = {
      castState: luna._castState,
      animState: luna._animState,
      frozen: luna._frozenForCast,
      fireActive: !!luna._fireballActive,
    };
  }
  const res = {
    animState: luna._animState,
    animSeen: Array.from(new Set(animSeen)),
    castSeen: Array.from(new Set(castSeen)),
    anim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null,
    castState: luna._castState,
    fireballActive: luna._fireballActive,
    fireball: luna._fireball ? { active: luna._fireball.active, launched: luna._fireball.launched, flyActive: luna._fireball.flyActive } : null,
    fireballCooldown: luna._fireballCooldown,
    castCooldown: luna._castCooldown,
    mp: luna.data.mp,
    enemyHpDelta: 400 - window.__aiEnemy.hp,
    target: luna.target ? luna.target.id : null,
    manualCast: manual,
  };
  entities.delete('anim_test_enemy');
  delete window.__aiEnemy;
  return res;
})()`));

console.log('AI flee→run 循环(归一化):', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const s = window.__phaserScene;
  const { entities, PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  luna.x = 640; luna.y = 620;
  window.__aiEnemy2 = {
    id: 'anim_test_enemy2', active: true, hittable: true,
    x: luna.x + 60, y: luna.y, vx: 0, vy: 0,
    hp: 400, maxHp: 400, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; },
    // 每帧把威胁拉回露娜身边 → 持续 flee（否则撤退到安全距离就切回 walk）
    update() { this.x = window.Game.PartySystem.getMember('mage_luna').x + 50; this.y = window.Game.PartySystem.getMember('mage_luna').y; },
  };
  entities.set('anim_test_enemy2', window.__aiEnemy2);
  const spr = s._companionSprites['mage_luna'];
  await new Promise(r => setTimeout(r, 800)); // 等 flee 开始
  const samples = [];
  const centroidOf = () => {
    const fr = spr.frame;
    const src = spr.texture.getSourceImage();
    const cv = document.createElement('canvas');
    cv.width = fr.width; cv.height = fr.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, fr.width, fr.height);
    const data = ctx.getImageData(0, 0, fr.width, fr.height).data;
    let sx = 0, cnt = 0;
    for (let i = 3; i < data.length; i += 8) {
      if (data[i] > 40) { sx += (i / 4) % fr.width; cnt++; }
    }
    return cnt ? +(sx / cnt).toFixed(1) : null;
  };
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 150));
    samples.push({ frame: spr.frame.name, cx: centroidOf(), anim: spr.anims.isPlaying ? spr.anims.currentAnim.key : null });
  }
  entities.delete('anim_test_enemy2');
  delete window.__aiEnemy2;
  const cxs = samples.filter(x => x.cx !== null).map(x => x.cx);
  return {
    animState: luna._animState,
    samples,
    centroidSpan: cxs.length ? +(Math.max(...cxs) - Math.min(...cxs)).toFixed(1) : null,
  };
})()`));

await cleanup(0);
