#!/usr/bin/env node
/* 组队栏选中/多选/高亮 + 指令目标 实机探针（2026-08-16）：
 * - 点击名字 → 选中（不弹面板）+ 模型金色高亮 + 脚下光圈
 * - Shift+点击 → 多选
 * - 轮盘目标 = 选中队员（单选/多选）
 * - 点玩家槽 → 清空选中
 * 用法：node tools/cdp-party-select.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9347;
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
  return 'ready';
})()`));

console.log('准备两名队友:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  if (!PartySystem.getMember('mage_luna')) PartySystem.addCompanion('mage_luna');
  if (!PartySystem.getMember('warrior_bruno')) PartySystem.addCompanion('warrior_bruno');
  PartySystem.clearSelection();
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  for (const id of ['mage_luna', 'warrior_bruno']) {
    const m = PartySystem.getMember(id);
    m.x = 650; m.y = 660;
    m.data.hp = m.data.maxHp;
    m._frozenForCast = false; m._castState = 'idle'; m._command = null;
  }
  await sleep(800);
  return { size: PartySystem.size, selected: PartySystem.selectedIds };
})()`));

console.log('点击选中(不弹面板):', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const slot = document.querySelector('.party-slot[data-companion="mage_luna"]');
  if (slot) slot.click();
  await sleep(400);
  const ov = document.getElementById('companionOverlay');
  const ps = window.__phaserScene;
  const sprite = ps && ps._companionSprites['mage_luna'];
  return {
    selected: PartySystem.selectedIds,
    panelOpened: ov ? ov.style.display === 'block' : false,
    slotSelected: !!document.querySelector('.party-slot[data-companion="mage_luna"].party-slot--selected'),
    tint: sprite ? sprite.tintTopLeft : null,
    ringVisible: ps && ps._selectionRings['mage_luna'] ? ps._selectionRings['mage_luna'].visible : false,
  };
})()`));

console.log('Shift 多选:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const slot = document.querySelector('.party-slot[data-companion="warrior_bruno"]');
  if (slot) slot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
  await sleep(400);
  const ps = window.__phaserScene;
  return {
    selected: PartySystem.selectedIds,
    slotLuna: !!document.querySelector('.party-slot[data-companion="mage_luna"].party-slot--selected'),
    slotElise: !!document.querySelector('.party-slot[data-companion="warrior_bruno"].party-slot--selected'),
    lunaRing: ps._selectionRings['mage_luna'] ? ps._selectionRings['mage_luna'].visible : false,
    eliseRing: ps._selectionRings['warrior_bruno'] ? ps._selectionRings['warrior_bruno'].visible : false,
    eliseTint: ps._companionSprites['warrior_bruno'] ? ps._companionSprites['warrior_bruno'].tintTopLeft : null,
  };
})()`));

console.log('轮盘目标=选中(多选):', await ev(`(async () => {
  const wheel = window.Game.CompanionCommandWheel;
  const { PartySystem } = window.Game;
  wheel._resolveTargets(false);
  return { ids: [...wheel._targetIds], label: wheel._targetLabel, expected: PartySystem.selectedIds.slice().sort() };
})()`));

console.log('对选中两人下 patrol:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const wheel = window.Game.CompanionCommandWheel;
  const { PartySystem } = window.Game;
  const p = window.Game.player;
  p.x = 600; p.y = 620;
  const luna = PartySystem.getMember('mage_luna');
  const elise = PartySystem.getMember('warrior_bruno');
  luna._command = null; elise._command = null;
  luna.x = 650; luna.y = 660; elise.x = 650; elise.y = 660;
  const aiL = PartySystem._aiInstances['mage_luna'];
  const aiE = PartySystem._aiInstances['warrior_bruno'];
  if (aiL) { aiL._patrolTarget = null; aiL._frozenForCast = false; }
  if (aiE) { aiE._patrolTarget = null; aiE._meleeAtkTimer = 0; aiE._defendPhase = null; aiE._whirlwindHitSet = null; aiE._frozenForCast = false; }
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  wheel._worldPoint = { x: 600, y: 500 };
  const n = wheel._execute('patrol');
  const out = [];
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    out.push([Math.round(luna.x), Math.round(luna.y), Math.round(elise.x), Math.round(elise.y)]);
  }
  return {
    n,
    lunaCmd: luna._command && luna._command.mode,
    eliseCmd: elise._command && elise._command.mode,
    lunaMoved: Math.abs(luna.x - 650) > 5 || Math.abs(luna.y - 660) > 5,
    eliseMoved: Math.abs(elise.x - 650) > 5 || Math.abs(elise.y - 660) > 5,
    final: out[out.length - 1],
  };
})()`));

console.log('点玩家槽清空选中:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const ps = window.__phaserScene;
  const slot = document.querySelector('.party-slot[data-player="1"]');
  if (slot) slot.click();
  await sleep(400);
  return {
    selected: PartySystem.selectedIds,
    slotLuna: !!document.querySelector('.party-slot--selected'),
    lunaRing: ps._selectionRings['mage_luna'] ? ps._selectionRings['mage_luna'].visible : false,
    eliseRing: ps._selectionRings['warrior_bruno'] ? ps._selectionRings['warrior_bruno'].visible : false,
  };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 6)) console.log('  ', e);

await cleanup(0);
