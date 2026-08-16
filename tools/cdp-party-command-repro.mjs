#!/usr/bin/env node
/* 双队友指令复现探针（2026-08-16）：
 * - 招募 露娜(mage_luna) + 伊莉丝(warrior_bruno)
 * - 分别以 CompanionPanel._memberId = null / 'mage_luna' / 'warrior_bruno' 跑 _resolveTargets
 * - 对 hold/patrol/aggressive/follow 各执行一次 _execute，采样 2s 看队友是否执行
 * - 顺带抓页面异常（updateCombat 若每帧抛错会中断指令执行）
 * 用法：node tools/cdp-party-command-repro.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9341;
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
    try {
        const list = await fetchJson(`${CDP}/json/list`);
        page = (list || []).find(t => t.type === 'page' && t.url.includes('localhost:5173'));
    } catch (err) { console.log('json/list retry:', err.message); }
    if (!page) await new Promise(r => setTimeout(r, 1000));
}
if (!page) { console.error('no page'); await cleanup(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => { console.error('ws error', e.message || e); rej(e); }; });
let seq = 0; const pending = new Map();
const pageExceptions = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        pageExceptions.push((d.exception?.description || d.text || '').slice(0, 400));
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
  return 'ready: ' + (!!window.Game.player) + ' / scene=' + (window.__phaserScene ? 'y' : 'n');
})()`));

console.log('招募+初始:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  if (!PartySystem.getMember('mage_luna')) PartySystem.addCompanion('mage_luna');
  if (!PartySystem.getMember('warrior_bruno')) PartySystem.addCompanion('warrior_bruno');
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  for (const id of ['mage_luna', 'warrior_bruno']) {
    const m = PartySystem.getMember(id);
    m.x = 650; m.y = 660;
    m.data.hp = m.data.maxHp;
    m._frozenForCast = false;
    m._castState = 'idle';
    m._command = null;
    const ai = PartySystem._aiInstances[id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; }
  }
  await sleep(1000);
  return {
    size: PartySystem.size,
    factories: Object.keys(PartySystem._aiFactories),
    instances: Object.keys(PartySystem._aiInstances),
    luna: { x: Math.round(PartySystem.getMember('mage_luna').x), y: Math.round(PartySystem.getMember('mage_luna').y) },
    elise: { x: Math.round(PartySystem.getMember('warrior_bruno').x), y: Math.round(PartySystem.getMember('warrior_bruno').y) },
  };
})()`));

console.log('resolveTargets 三态:', await ev(`(async () => {
  const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
  const out = {};
  const panel = window.Game.CompanionPanel;
  const prev = panel._memberId;
  panel._memberId = null;
  wheel._resolveTargets(false);
  out['panel=null'] = { ids: [...wheel._targetIds], label: wheel._targetLabel };
  panel._memberId = 'mage_luna';
  wheel._resolveTargets(false);
  out['panel=luna'] = { ids: [...wheel._targetIds], label: wheel._targetLabel };
  panel._memberId = 'warrior_bruno';
  wheel._resolveTargets(false);
  out['panel=elise'] = { ids: [...wheel._targetIds], label: wheel._targetLabel };
  panel._memberId = prev;
  return out;
})()`));

for (const mode of ['hold', 'patrol', 'aggressive', 'follow']) {
    console.log(`指令 ${mode}:`, await ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
      const { PartySystem } = window.Game;
      const panel = window.Game.CompanionPanel;
      const p = window.Game.player;
      p.x = 600; p.y = 620;
      const luna = PartySystem.getMember('mage_luna');
      const elise = PartySystem.getMember('warrior_bruno');
      // 重置两人状态与指令
      for (const m of [luna, elise]) {
        m._command = null; m._tacticalTarget = null; m.target = null;
        m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
        m.x = 650; m.y = 660;
        const ai = PartySystem._aiInstances[m.id];
        if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
      }
      // 清空敌人避免干扰
      for (const [k, e] of Array.from(window.Game.entities.entries())) {
        if (e && e._faction === 'enemy') window.Game.entities.delete(k);
      }
      panel._memberId = 'mage_luna'; // 选中露娜：只应命令露娜
      wheel._resolveTargets(false);
      wheel._worldPoint = { x: 600, y: 500 };
      const n = wheel._execute('${mode}');
      const after = {
        n, targetIds: [...wheel._targetIds],
        lunaCmd: luna._command, eliseCmd: elise._command,
      };
      const samples = [];
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        samples.push({
          luna: { anim: luna._animState, last: luna._lastAction, tt: luna._tacticalTarget ? [Math.round(luna._tacticalTarget.x), Math.round(luna._tacticalTarget.y)] : null, pos: [Math.round(luna.x), Math.round(luna.y)] },
          elise: { anim: elise._animState, last: elise._lastAction, tt: elise._tacticalTarget ? [Math.round(elise._tacticalTarget.x), Math.round(elise._tacticalTarget.y)] : null, pos: [Math.round(elise.x), Math.round(elise.y)] },
        });
      }
      return { after, samples: samples.filter((_, i) => i % 4 === 0), final: {
        lunaPos: [Math.round(luna.x), Math.round(luna.y)],
        elisePos: [Math.round(elise.x), Math.round(elise.y)],
        lunaCmd: luna._command, eliseCmd: elise._command,
      } };
    })()`));
}

console.log('伊莉丝单指令:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
  const { PartySystem } = window.Game;
  const panel = window.Game.CompanionPanel;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  for (const m of [luna, elise]) {
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
    m.x = 650; m.y = 660;
    const ai = PartySystem._aiInstances[m.id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
  }
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  panel._memberId = 'warrior_bruno';
  wheel._resolveTargets(false);
  wheel._worldPoint = { x: 600, y: 500 };
  const n = wheel._execute('patrol');
  const out = [];
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    out.push({ anim: elise._animState, last: elise._lastAction, pos: [Math.round(elise.x), Math.round(elise.y)], tt: elise._tacticalTarget ? [Math.round(elise._tacticalTarget.x), Math.round(elise._tacticalTarget.y)] : null });
  }
  return { n, cmd: elise._command, lunaCmd: luna._command, final: out[out.length - 1], moved: Math.abs(elise.x - 650) > 5 || Math.abs(elise.y - 660) > 5 };
})()`));

console.log('全队指令(shift):', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
  const { PartySystem } = window.Game;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  for (const m of [luna, elise]) {
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
    m.x = 650; m.y = 660;
    const ai = PartySystem._aiInstances[m.id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
  }
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  wheel._resolveTargets(true);
  wheel._worldPoint = { x: 600, y: 500 };
  const n = wheel._execute('patrol');
  const out = [];
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    out.push({ luna: [Math.round(luna.x), Math.round(luna.y)], elise: [Math.round(elise.x), Math.round(elise.y)] });
  }
  return { n, ids: [...wheel._targetIds], cmds: { luna: luna._command, elise: elise._command }, final: out[out.length - 1] };
})()`));

console.log('真实鼠标路径:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
  const { PartySystem } = window.Game;
  const panel = window.Game.CompanionPanel;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  for (const m of [luna, elise]) {
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
    m.x = 650; m.y = 660;
    const ai = PartySystem._aiInstances[m.id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
  }
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  // 1) 点组队栏伊莉丝名字（当前行为 = 打开队员面板）
  const slot = document.querySelector('.party-slot[data-companion="warrior_bruno"]');
  const slotFound = !!slot;
  if (slot) slot.click();
  await sleep(300);
  const panelOpened = !!(panel._memberId && document.getElementById('companionOverlay').style.display === 'block');
  // 2) 关闭面板
  const closeBtn = document.querySelector('#companionOverlay .companion-close');
  if (closeBtn) closeBtn.click();
  await sleep(400);
  const panelClosed = document.getElementById('companionOverlay').style.display === 'none';
  // 3) 中键按下（画布中心）
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: cx, clientY: cy, bubbles: true, cancelable: true, view: window }));
  await sleep(600);
  const wheelEl = document.querySelector('.companion-wheel');
  const wheelOpened = !!wheelEl;
  // 4) 悬停到 patrol（第 3 项，角度 90-180 之间；用 mouseenter 直接模拟）
  const items = wheelEl ? Array.from(wheelEl.querySelectorAll('.cw-item')) : [];
  const patrolItem = items.find(el => el.dataset.cmd === 'patrol');
  const hoveredBefore = wheel._hovered;
  if (patrolItem) patrolItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  const hoveredAfter = wheel._hovered;
  // 5) 松开
  window.dispatchEvent(new MouseEvent('mouseup', { button: 1, clientX: cx, clientY: cy, bubbles: true, cancelable: true, view: window }));
  await sleep(400);
  const wheelClosed = !document.querySelector('.companion-wheel');
  return {
    slotFound, panelOpened, panelClosed, wheelOpened,
    hoveredBefore, hoveredAfter, wheelClosed,
    eliseCmd: elise._command, lunaCmd: luna._command,
    elisePos: [Math.round(elise.x), Math.round(elise.y)],
    memberId: panel._memberId,
  };
})()`));

console.log('真实输入事件(CDP Input) + 有敌人:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const panel = window.Game.CompanionPanel;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  for (const m of [luna, elise]) {
    m._command = null; m._tacticalTarget = null; m.target = null;
    m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
    m.x = 650; m.y = 660;
    const ai = PartySystem._aiInstances[m.id];
    if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
  }
  // 放两个假敌人（贴近玩家）——默认状态机应进入战斗；hold/patrol 应覆盖战斗
  const fake1 = { id: 't1', active: true, x: 760, y: 620, vx: 0, vy: 0, hp: 9999, maxHp: 9999, groundRadius: 20, bodyHeight: 130, attackRange: 70, attacks: { melee: {} }, _faction: 'enemy', takeDamage(d) { this.hp -= d; }, update() {} };
  const fake2 = { id: 't2', active: true, x: 780, y: 660, vx: 0, vy: 0, hp: 9999, maxHp: 9999, groundRadius: 20, bodyHeight: 130, attackRange: 70, attacks: { melee: {} }, _faction: 'enemy', takeDamage(d) { this.hp -= d; }, update() {} };
  window.Game.entities.set('t1', fake1);
  window.Game.entities.set('t2', fake2);
  // 先确认默认战斗激活
  await sleep(1500);
  const pre = { lunaAnim: luna._animState, eliseAnim: elise._animState, fake1Hp: fake1.hp };
  // 选中伊莉丝 → hold
  panel._memberId = 'warrior_bruno';
  const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
  wheel._resolveTargets(false);
  wheel._worldPoint = { x: 600, y: 500 };
  wheel._execute('hold');
  const out = [];
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    out.push({ elise: { anim: elise._animState, last: elise._lastAction, tt: elise._tacticalTarget ? 1 : 0, pos: [Math.round(elise.x), Math.round(elise.y)] }, luna: { anim: luna._animState, pos: [Math.round(luna.x), Math.round(luna.y)] } });
  }
  window.Game.entities.delete('t1');
  window.Game.entities.delete('t2');
  return { pre, eliseCmd: elise._command, lunaCmd: luna._command, samples: out.filter((_, i) => i % 4 === 0), last: out[out.length - 1] };
})()`));

console.log('CDP 可信输入事件: 中键轮盘 hold 全流程');
{
    const r = await ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const { PartySystem } = window.Game;
      const panel = window.Game.CompanionPanel;
      const p = window.Game.player;
      p.x = 600; p.y = 620;
      const luna = PartySystem.getMember('mage_luna');
      const elise = PartySystem.getMember('warrior_bruno');
      for (const m of [luna, elise]) {
        m._command = null; m._tacticalTarget = null; m.target = null;
        m._frozenForCast = false; m._castState = 'idle'; m.vx = 0; m.vy = 0;
        m.x = 650; m.y = 660;
        const ai = PartySystem._aiInstances[m.id];
        if (ai) { ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._patrolTarget = null; ai._gatherPhase = 'work'; }
      }
      for (const [k, e] of Array.from(window.Game.entities.entries())) {
        if (e && e._faction === 'enemy') window.Game.entities.delete(k);
      }
      panel._memberId = 'mage_luna';
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
    })()`);
    const { x, y } = r;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'middle', buttons: 4, clickCount: 1 });
    await sleep(600);
    const wheelInfo = await ev(`(() => {
      const el = document.querySelector('.companion-wheel');
      if (!el) return { opened: false };
      const items = Array.from(el.querySelectorAll('.cw-item')).map(b => {
        const rr = b.getBoundingClientRect();
        return { cmd: b.dataset.cmd, cx: rr.left + rr.width / 2, cy: rr.top + rr.height / 2 };
      });
      return { opened: true, items, center: { x: ${x}, y: ${y} } };
    })()`);
    if (wheelInfo.opened) {
        const hold = wheelInfo.items.find(i => i.cmd === 'hold');
        if (hold) {
            // 分步移动鼠标触发 mouseenter
            for (let i = 1; i <= 5; i++) {
                await send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: x + (hold.cx - x) * i / 5,
                    y: y + (hold.cy - y) * i / 5,
                    button: 'none', buttons: 4,
                });
                await sleep(40);
            }
        }
    }
    const hoverBefore = await ev(`(async () => {
      const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
      return { hovered: wheel._hovered, el: !!document.querySelector('.cw-item.cw-hover') };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'middle', buttons: 0, clickCount: 1 });
    await sleep(400);
    const after = await ev(`(async () => {
      const { PartySystem } = window.Game;
      const luna = PartySystem.getMember('mage_luna');
      const elise = PartySystem.getMember('warrior_bruno');
      const closed = !document.querySelector('.companion-wheel');
      const wheel = (await import('/src/ui/companion-command-wheel.js')).CompanionCommandWheel;
      return { closed, lunaCmd: luna._command, eliseCmd: elise._command, wheelOpen: wheel._open, lunaPos: [Math.round(luna.x), Math.round(luna.y)] };
    })()`);
    console.log('  wheelInfo:', JSON.stringify(wheelInfo).slice(0, 500));
    console.log('  hoverBefore:', JSON.stringify(hoverBefore));
    console.log('  after:', JSON.stringify(after));
}

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) {
    console.log('--- 异常样例 ---');
    for (const e of pageExceptions.slice(0, 8)) console.log(e);
}

await cleanup(0);
