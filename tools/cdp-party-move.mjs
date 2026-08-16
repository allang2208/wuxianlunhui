#!/usr/bin/env node
/* 左键移动指令实机探针（2026-08-16）：
 * - 选中露娜+伊莉丝 → 真实左键点击世界某点 → 验证：
 *   ① 选中被清空 ② 两人 _command.mode='move' 且 point≈点击世界坐标
 *   ③ 两人向目标点移动
 * - 墙内目标 → _nearestWalkable 返回可达点，队员走到该可达点
 * 用法：node tools/cdp-party-move.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9379;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 600)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });
edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
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
    } catch (err) { console.log('boot retry', err.message.slice(0, 80)); await sleep(2000); }
}
if (bootOk !== 'ready') { console.error('boot failed'); await cleanup(1); }

console.log('左键移动:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  for (const id of ['mage_luna', 'warrior_bruno']) {
    if (PartySystem.getMember(id)) PartySystem.removeCompanion(id);
  }
  PartySystem._roster = {};
  PartySystem.addCompanion('mage_luna');
  PartySystem.addCompanion('warrior_bruno');
  let t0 = Date.now();
  while ((!PartySystem._aiInstances['mage_luna'] || !PartySystem._aiInstances['warrior_bruno']) && Date.now() - t0 < 5000) await sleep(100);
  const p = window.Game.player;
  const ids = ['mage_luna', 'warrior_bruno'];
  for (const id of ids) {
    const m = PartySystem.getMember(id);
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m._basicAtkCd = 0;
    m.x = p.x - 100; m.y = p.y;
    const ai = PartySystem._aiInstances[id];
    if (ai) { ai._initPos = true; ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._gatherPhase = 'work'; ai._patrolTarget = null; }
  }
  PartySystem.setSelected(ids);
  window.__auditBlocker = setInterval(() => {
    for (const [k, e] of Array.from(window.Game.entities.entries())) {
      if (e && e._faction === 'enemy' && !e._auditEnemy) window.Game.entities.delete(k);
    }
  }, 250);
  // 目标世界点（玩家右前方 260px，主城可走）
  const target = { x: p.x + 260, y: p.y + 20 };
  const sc = window.Game.Renderer ? (window.Game.Renderer.worldToScreen ? window.Game.Renderer.worldToScreen(target.x, target.y) : null) : null;
  if (!sc) return { error: 'no screenToWorld' };
  // 真实左键：mousemove 设定 Input.mouse.x/y → mousedown 置 leftPressed
  // （派发目标用 document.body：window 没有 .closest，input.js 会抛错）
  document.body.dispatchEvent(new MouseEvent('mousemove', { clientX: sc.x, clientY: sc.y, bubbles: true }));
  document.body.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: sc.x, clientY: sc.y, bubbles: true, cancelable: true, view: window }));
  await sleep(700);
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  const afterClick = {
    selected: PartySystem.selectedIds,
    lunaCmd: luna._command, eliseCmd: elise._command,
  };
  // 采样移动
  const startL = { x: luna.x, y: luna.y }, startE = { x: elise.x, y: elise.y };
  const out = [];
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    out.push({
      luna: [Math.round(luna.x), Math.round(luna.y)],
      elise: [Math.round(elise.x), Math.round(elise.y)],
      lunaDist: Math.round(Math.hypot(luna.x - target.x, luna.y - target.y)),
      eliseDist: Math.round(Math.hypot(elise.x - target.x, elise.y - target.y)),
    });
  }
  clearInterval(window.__auditBlocker);
  return {
    afterClick,
    clickWorld: { x: Math.round(target.x), y: Math.round(target.y) },
    start: { luna: [Math.round(startL.x), Math.round(startL.y)], elise: [Math.round(startE.x), Math.round(startE.y)] },
    end: out[out.length - 1],
    lunaMoved: Math.hypot(luna.x - startL.x, luna.y - startL.y) > 20,
    eliseMoved: Math.hypot(elise.x - startE.x, elise.y - startE.y) > 20,
    minLunaDist: Math.min(...out.map(s => s.lunaDist)),
    minEliseDist: Math.min(...out.map(s => s.eliseDist)),
  };
})()`));

console.log('墙内目标最近可达点:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const p = window.Game.player;
  const WallSystem = window.Game.WallSystem;
  // 找一个 canMoveTo=false 的墙点（扫玩家周边）
  let wall = null;
  for (let dx = -600; dx <= 600 && !wall; dx += 40) {
    for (let dy = -400; dy <= 400; dy += 40) {
      const wx = p.x + dx, wy = p.y + dy;
      if (!WallSystem.canMoveTo(wx, wy, 20)) { wall = { x: wx, y: wy }; break; }
    }
  }
  if (!wall) return { error: 'no wall found' };
  const near = ai._nearestWalkable(wall);
  const reachable = WallSystem.canMoveTo(near.x, near.y, 20);
  const distToWall = Math.round(Math.hypot(near.x - wall.x, near.y - wall.y));
  // 下达 move 到墙点，采样确认走向可达点
  elise._command = null; elise._tacticalTarget = null; elise.target = null;
  elise._frozenForCast = false; elise._castState = 'idle';
  elise.x = p.x - 80; elise.y = p.y;
  ai._initPos = true; ai._meleeAtkTimer = 0; ai._defendPhase = null;
  PartySystem.setSelected(['warrior_bruno']);
  // move 指令不在轮盘 5 指令表（左键专用），走 setCommand 同 game.js 一致
  PartySystem.setCommand(['warrior_bruno'], 'move', wall);
  const out = [];
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    out.push([Math.round(elise.x), Math.round(elise.y)]);
  }
  const finalPos = out[out.length - 1];
  return {
    wall, near, reachable, distToWall,
    cmd: elise._command && elise._command.mode,
    moved: Math.hypot(elise.x - (p.x - 80), elise.y - p.y) > 20,
    finalPos,
    finalReachable: WallSystem.canMoveTo(finalPos[0], finalPos[1], 20),
  };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
