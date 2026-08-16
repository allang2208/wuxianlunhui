#!/usr/bin/env node
/* 伊莉丝指令执行专项探针（2026-08-16）：
 * - 新招募伊莉丝：patrol/hold 是否执行（逻辑坐标 + 精灵坐标双看）
 * - 档案恢复（解散再招募）：aiConfig 是否丢失 → 渲染层 aiMode 是否变 false → 命令“看不见执行”
 * - 战斗状态锁死：攻击/防御/风车/施法中下命令是否被 _frozenForCast/_defendPhase 卡住
 * 用法：node tools/cdp-elise-command.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9351;
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

/** 页面内公共：重置伊莉丝/露娜状态、清敌人、发指令 */
const RESET = `(async () => {
  const { PartySystem } = window.Game;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const ids = ['mage_luna', 'warrior_bruno'];
  for (const id of ids) {
    const m = PartySystem.getMember(id);
    if (!m) continue;
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
    m.x = 650; m.y = 660;
    const ai = PartySystem._aiInstances[id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._whirlwindHitSet = null; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
  }
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  return true;
})`;

async function sample(id, label, frames = 25) {
    return ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const { PartySystem } = window.Game;
      const m = PartySystem.getMember('${id}');
      const ai = PartySystem._aiInstances['${id}'];
      const ps = window.__phaserScene;
      const spr = ps._companionSprites['${id}'];
      const start = { lx: m.x, ly: m.y, sx: spr ? spr.x : null, sy: spr ? spr.y : null };
      const out = [];
      for (let i = 0; i < ${frames}; i++) {
        await sleep(100);
        out.push({
          anim: m._animState, last: m._lastAction,
          lp: [Math.round(m.x), Math.round(m.y)],
          sp: spr ? [Math.round(spr.x), Math.round(spr.y)] : null,
          frozen: m._frozenForCast, cast: m._castState,
          defPhase: m._defendPhase || null, atkTimer: ai ? Math.round(ai._meleeAtkTimer || 0) : null,
          tt: m._tacticalTarget ? [Math.round(m._tacticalTarget.x), Math.round(m._tacticalTarget.y)] : null,
        });
      }
      return {
        label: '${label}',
        start, end: out[out.length - 1],
        logicalMoved: Math.abs(m.x - start.lx) > 5 || Math.abs(m.y - start.ly) > 5,
        spriteMoved: spr ? (Math.abs(spr.x - start.sx) > 5 || Math.abs(spr.y - start.sy) > 5) : null,
        samples: out.filter((_, i) => i % 5 === 0),
      };
    })()`);
}

console.log('A. 新招募伊莉丝:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  if (PartySystem.getMember('mage_luna')) PartySystem.removeCompanion('mage_luna');
  if (PartySystem.getMember('warrior_bruno')) PartySystem.removeCompanion('warrior_bruno');
  // 清档案确保“新招募”
  PartySystem._roster = {};
  const ok = PartySystem.addCompanion('warrior_bruno');
  const elise = PartySystem.getMember('warrior_bruno');
  return { ok, aiConfig: elise.aiConfig ? elise.aiConfig.role : null, name: elise.name };
})()`));
await ev(`(async () => { await ${RESET}; await new Promise(r => setTimeout(r, 500)); return true; })()`);
await ev(`(() => { const { PartySystem } = window.Game; PartySystem.setSelected(['warrior_bruno']); const w = window.Game.CompanionCommandWheel; w._resolveTargets(false); w._worldPoint = { x: 600, y: 500 }; return { n: w._execute('patrol'), ids: [...w._targetIds] }; })()`);
console.log('A1. 新招募 patrol:', JSON.stringify(await sample('warrior_bruno', 'fresh patrol')));

console.log('B. 档案恢复伊莉丝:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  PartySystem.removeCompanion('warrior_bruno');
  PartySystem.addCompanion('warrior_bruno');
  const elise = PartySystem.getMember('warrior_bruno');
  return { aiConfig: elise.aiConfig ? elise.aiConfig.role : null, roster: !!PartySystem._roster['warrior_bruno'] };
})()`));
await ev(`(async () => { await ${RESET}; await new Promise(r => setTimeout(r, 500)); return true; })()`);
await ev(`(() => { const { PartySystem } = window.Game; PartySystem.setSelected(['warrior_bruno']); const w = window.Game.CompanionCommandWheel; w._resolveTargets(false); w._worldPoint = { x: 600, y: 500 }; return { n: w._execute('patrol'), ids: [...w._targetIds] }; })()`);
console.log('B1. 档案恢复 patrol:', JSON.stringify(await sample('warrior_bruno', 'restored patrol')));

console.log('B2. 档案恢复后状态:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const ps = window.__phaserScene;
  const spr = ps && ps._companionSprites['warrior_bruno'];
  return {
    hasGame: !!window.Game,
    aiInstance: !!ai,
    aiRole: ai ? ai.cfg.role : null,
    aiConfigOnMember: !!elise.aiConfig,
    spriteExists: !!spr,
    cmd: elise._command && elise._command.mode,
    pos: [Math.round(elise.x), Math.round(elise.y)],
    spritePos: spr ? [Math.round(spr.x), Math.round(spr.y)] : null,
  };
})()`));

console.log('C. 战斗锁死检查:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  // 恢复新招募（带 aiConfig）
  PartySystem.removeCompanion('warrior_bruno');
  PartySystem._roster = {};
  PartySystem.addCompanion('warrior_bruno');
  const elise = PartySystem.getMember('warrior_bruno');
  elise.x = 650; elise.y = 660; elise._command = null; elise._tacticalTarget = null; elise.target = null;
  const ai = PartySystem._aiInstances['warrior_bruno'];
  if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._whirlwindHitSet = null; }
  // 放 4 个贴脸敌人逼出防御/攻击
  for (let i = 0; i < 4; i++) {
    window.Game.entities.set('elise_t' + i, { id: 'elise_t' + i, active: true, x: 700 + i * 10, y: 640, vx: 0, vy: 0, hp: 99999, maxHp: 99999, groundRadius: 20, bodyHeight: 130, attackRange: 70, attacks: { melee: {} }, _faction: 'enemy', takeDamage(d) { this.hp -= d; }, update() {} });
  }
  await sleep(1500);
  const inBattle = { anim: elise._animState, frozen: elise._frozenForCast, defPhase: elise._defendPhase || null, atkTimer: ai ? Math.round(ai._meleeAtkTimer || 0) : null, cast: elise._castState };
  // 战斗中下待命（应立刻打断）
  PartySystem.setSelected(['warrior_bruno']);
  const w = window.Game.CompanionCommandWheel;
  w._resolveTargets(false);
  w._worldPoint = { x: 600, y: 500 };
  w._execute('hold');
  const out = [];
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    out.push({ anim: elise._animState, frozen: elise._frozenForCast, defPhase: elise._defendPhase || null, atkTimer: ai ? Math.round(ai._meleeAtkTimer || 0) : null, tt: elise._tacticalTarget ? 1 : 0, pos: [Math.round(elise.x), Math.round(elise.y)] });
  }
  for (let i = 0; i < 4; i++) window.Game.entities.delete('elise_t' + i);
  return { inBattle, cmd: elise._command && elise._command.mode, samples: out.filter((_, i) => i % 4 === 0) };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);

await cleanup(0);
