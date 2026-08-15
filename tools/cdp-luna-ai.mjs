#!/usr/bin/env node
/* 露娜 AI 实机验证（2026-08-14）：
   - 跟随：招募后露娜位于玩家附近、状态机 follow/idle
   - 施法：出现敌人后 cast（火球生成、敌人掉血、MP 消耗、不误伤玩家）
   - 撤退：近战威胁贴脸 → flee（远离威胁） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333;
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

console.log('跟随:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  if (!PartySystem.getMember('mage_luna')) PartySystem.addCompanion('mage_luna');
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  await sleep(1200);
  return {
    aiInstance: !!luna._aiInstance || !!PartySystem._aiInstances['mage_luna'],
    pos: { x: Math.round(luna.x), y: Math.round(luna.y) },
    player: { x: p.x, y: p.y },
    animState: luna._animState,
    lastAction: luna._aiInstance ? luna._aiInstance._lastAction : null,
    dist: Math.round(Math.hypot(luna.x - p.x, luna.y - p.y)),
  };
})()`));

console.log('施法:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  luna.x = 640; luna.y = 620;
  luna.data.mp = luna.data.maxMp;
  // 把场景其它敌人移远，避免抢占目标/被误伤（headless 测试环境）
  for (const [k, e] of entities) {
    if (e !== luna && e._faction === 'enemy' && e.active && e.hp > 0) {
      e.x = 3000; e.y = 3000;
      if (e.maxHp > 0) e.hp = e.maxHp;
    }
  }
  luna.target = null;
  // 假敌人（避开 Enemy.update 的 Phaser 渲染依赖；仅提供战斗字段）
  window.__aiEnemy = {
    id: 'ai_test_enemy', active: true, hittable: true,
    x: 1040, y: 620, vx: 0, vy: 0,
    hp: 300, maxHp: 300,
    groundRadius: 20, bodyHeight: 130, attackRange: 70,
    attacks: { melee: {} },
    _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; },
    update() {},
  };
  entities.set('ai_test_enemy', window.__aiEnemy);
  const hpBefore = window.__aiEnemy.hp;
  const playerHpBefore = p.data.hp;
  const mpBefore = luna.data.mp;
  await sleep(1600);
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  const res = {
    castState: luna._castState,
    animState: luna._animState,
    fireActive: !!luna._fireballActive || !!(luna._fireball && luna._fireball.active),
    fireball: luna._fireball ? { launched: luna._fireball.launched, flyActive: luna._fireball.flyActive, dist: Math.round(luna._fireball.flyDistance || 0), targetDist: Math.round(luna._fireball.targetDist || 0) } : null,
    enemyHpDelta: hpBefore - window.__aiEnemy.hp,
    mpDelta: mpBefore - luna.data.mp,
    playerHpDelta: p.data.hp - playerHpBefore,
    target: luna.target ? luna.target.id : null,
    lastAction: ai ? ai._lastAction : null,
  };
  return res;
})()`));

console.log('贴脸不逃跑(flee停用):', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const e = window.__aiEnemy;
  // 近战威胁贴脸
  e.x = luna.x + 60; e.y = luna.y;
  luna.target = null;
  const ai = luna._aiInstance || PartySystem._aiInstances['mage_luna'];
  const before = { x: luna.x, y: luna.y };
  await sleep(900);
  const after = { x: luna.x, y: luna.y };
  const distBefore = Math.hypot(before.x - e.x, before.y - e.y);
  const distAfter = Math.hypot(after.x - e.x, after.y - e.y);
  const res = {
    lastAction: ai ? ai._lastAction : null,
    animState: luna._animState,
    tacticalTarget: !!luna._tacticalTarget,
    moved: Math.round(Math.hypot(after.x - before.x, after.y - before.y)),
    distBefore: Math.round(distBefore),
    distAfter: Math.round(distAfter),
    fleeDisabled: (ai ? ai._lastAction : null) !== 'flee' && Math.abs(after.x - before.x) < 60,
  };
  // 清理
  window.Game.entities.delete('ai_test_enemy');
  delete window.__aiEnemy;
  return res;
})()`));

console.log('落点合法性+卡墙自愈:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  luna.target = null;
  luna._tacticalTarget = null;
  // 1) 当前生成点是否合法
  const legalNow = window.WallSystem && typeof window.WallSystem.canMoveTo === 'function'
    ? window.WallSystem.canMoveTo(luna.x, luna.y, 20) : null;
  // 2) 模拟卡进墙外：丢到地图外非法点，等自愈（周期 1.5s）
  luna.x = 4000; luna.y = 4000;
  if (luna._pathManager) luna._pathManager._clearPath();
  await sleep(2000);
  const legalAfter = window.WallSystem && typeof window.WallSystem.canMoveTo === 'function'
    ? window.WallSystem.canMoveTo(luna.x, luna.y, 20) : null;
  const distToPlayer = Math.round(Math.hypot(luna.x - p.x, luna.y - p.y));
  // 3) 模拟场景切换：强制重定位到玩家附近
  const SM = window.SceneManager || (window.Game && window.Game.SceneManager);
  const prevScene = SM ? SM.currentScene : null;
  if (SM) SM.currentScene = 'dungeon_test_switch';
  await sleep(400);
  const legalAfterSwitch = window.WallSystem && typeof window.WallSystem.canMoveTo === 'function'
    ? window.WallSystem.canMoveTo(luna.x, luna.y, 20) : null;
  if (SM && prevScene) SM.currentScene = prevScene;
  return {
    legalNow,
    legalAfterSelfHeal: legalAfter,
    distToPlayerAfterHeal: distToPlayer,
    legalAfterSceneSwitch: legalAfterSwitch,
  };
})()`));

console.log('卡死瞬移脱离:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  const WS = window.WallSystem;
  // 清敌人避免决策干扰；找墙内点模拟卡死（想动但被墙挡住）
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  luna.data.hp = luna.data.maxHp;
  // 动态加一段测试墙，把露娜放在墙段中央模拟卡死（想动但被墙挡住）
  const testSeg = { x1: p.x + 80, y1: p.y - 120, x2: p.x + 80, y2: p.y + 120, halfThick: 8, _aiTest: true };
  WS.isoSegments.push(testSeg);
  const wallPt = { x: p.x + 80, y: p.y };
  luna.x = wallPt.x; luna.y = wallPt.y;
  luna._tacticalTarget = { x: p.x, y: p.y };
  if (luna._pathManager) luna._pathManager._clearPath();
  const posBefore = { x: luna.x, y: luna.y };
  const legalBefore = WS.canMoveTo(luna.x, luna.y, 20);
  await sleep(2800); // 5 个采样窗口（400ms）+ 瞬移余量
  const moved = Math.hypot(luna.x - posBefore.x, luna.y - posBefore.y);
  const legalAfter = WS.canMoveTo(luna.x, luna.y, 20);
  const distToPlayer = Math.round(Math.hypot(luna.x - p.x, luna.y - p.y));
  // 清理测试墙段
  const idx = WS.isoSegments.indexOf(testSeg);
  if (idx >= 0) WS.isoSegments.splice(idx, 1);
  return {
    stuckPoint: { x: Math.round(wallPt.x), y: Math.round(wallPt.y) },
    legalBefore,
    teleported: moved > 20,
    movedPx: Math.round(moved),
    legalAfter,
    distToPlayerAfter: distToPlayer,
  };
})()`));

console.log('逃跑朝向+图层深度:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem, entities } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const p = window.Game.player;
  const ps = window.__phaserScene;
  for (const [k, e] of Array.from(entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') entities.delete(k);
  }
  luna.target = null;
  // 放一个右侧敌人（flee 已停用）→ 应面朝目标（右侧 → 面右）
  const fake = {
    id: 'flee_face_enemy', active: true, hittable: true,
    x: luna.x + 55, y: luna.y, vx: 0, vy: 0,
    hp: 300, maxHp: 300, groundRadius: 20, bodyHeight: 130,
    attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
    takeDamage(dmg) { this.hp -= dmg; },
    update() { this.x = window.Game.PartySystem.getMember('mage_luna').x + 50; this.y = window.Game.PartySystem.getMember('mage_luna').y; },
  };
  entities.set('flee_face_enemy', fake);
  await sleep(900);
  const spr = ps._companionSprites['mage_luna'];
  const faceRight = !spr.flipX;
  const diag = { lastAction: luna._lastAction, vx: Math.round(luna.vx), castState: luna._castState };
  // 深度：AI 队员按世界 Y 排序（脚底+10），不再固定 playerSprite.depth+0.5
  const footOffset = ps._getFootOffsetY(luna, spr);
  const expectedDepth = spr.y + footOffset + 10;
  entities.delete('flee_face_enemy');
  return {
    faceRightTarget: faceRight,
    diag,
    depth: spr.depth,
    expectedDepth: Math.round(expectedDepth),
    depthByY: Math.abs(spr.depth - expectedDepth) < 5,
    playerDepth: ps.playerSprite.depth,
  };
})()`));

await cleanup(0);
