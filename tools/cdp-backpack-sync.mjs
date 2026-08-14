#!/usr/bin/env node
/* 玩家背包双界面同步审计（2026-08-12）：
 * A) 队员面板操作玩家背包 → 玩家系统面板是否同步
 * B) 玩家系统面板操作 → 队员面板左侧玩家背包栏是否同步
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9283;
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

console.log('setup:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  const eq = window.Game.EquipManager;
  if (!PartySystem.members.length) PartySystem.addCompanion('warrior_bruno');
  // 打开队员面板 equip tab（玩家背包栏显示）+ 打开玩家系统面板（玩家背包显示）
  CompanionPanel.close();
  CompanionPanel.openManage();
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  // 玩家背包塞一个测试物品（模拟已有物品）
  if (!eq.backpackItems.some(i => i.name === '同步测试物')) {
    eq.backpackItems.push({ name: '同步测试物', slot: 3, category: 'consumable', icon: '🧪' });
    eq.updateInventorySlots();
    CompanionPanel._renderBody();
  }
  const playerGrid = document.getElementById('inventoryGrid');
  const memberGrid = document.getElementById('companionPlayerGrid');
  return {
    playerHas: playerGrid ? !!playerGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : false,
    memberHas: memberGrid ? !!memberGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : false,
  };
})()`));

// A) 队员面板操作（移走物品）→ 玩家系统面板是否同步
console.log('A 队员侧操作→玩家面板:', await ev(`(() => {
  const { CompanionPanel, PartySystem } = window.Game;
  const eq = window.Game.EquipManager;
  const member = PartySystem.members[0];
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 3 };
  CompanionPanel._moveFromPlayerToCompanion(member, 0);   // 队员侧拖走同步测试物
  const playerGrid = document.getElementById('inventoryGrid');
  const memberGrid = document.getElementById('companionPlayerGrid');
  return {
    movedToMember: member.backpack.some(b => b.slot === 0 && b.name === '同步测试物'),
    playerPanelCleared: playerGrid ? !playerGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : null,
    memberPanelCleared: memberGrid ? !memberGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : null,
  };
})()`));

// 还原：把物品放回玩家背包 3 号
await ev(`(() => {
  const { PartySystem } = window.Game;
  const eq = window.Game.EquipManager;
  const member = PartySystem.members[0];
  const idx = member.backpack.findIndex(b => b.slot === 0 && b.name === '同步测试物');
  if (idx >= 0) {
    const item = member.backpack.splice(idx, 1)[0];
    eq.backpackItems.push({ ...item, slot: 3 });
    eq.updateInventorySlots();
  }
  return 1;
})()`);

// B) 玩家系统面板操作（移动/更新）→ 队员面板玩家背包栏是否同步
console.log('B 玩家侧操作→队员面板:', await ev(`(() => {
  const { CompanionPanel } = window.Game;
  const eq = window.Game.EquipManager;
  // 确保队员面板 equip tab 打开且玩家背包栏显示"同步测试物"
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  const memberGrid = document.getElementById('companionPlayerGrid');
  const memberShowsBefore = memberGrid ? !!memberGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : null;
  // 玩家侧更新背包（模拟拖动/使用后的渲染刷新）——只调 updateInventorySlots
  eq.backpackItems = eq.backpackItems.filter(i => i.slot !== 3);
  eq.updateInventorySlots();
  const playerGrid = document.getElementById('inventoryGrid');
  const playerPanelCleared = playerGrid ? !playerGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : null;
  const memberPanelCleared = memberGrid ? !memberGrid.querySelector('.inv-cell[data-slot="3"] .inv-name') : null;
  // 还原物品
  eq.backpackItems.push({ name: '同步测试物', slot: 3, category: 'consumable', icon: '🧪' });
  eq.updateInventorySlots();
  CompanionPanel._renderBody();
  return { memberShowsBefore, playerPanelCleared, memberPanelCleared };
})()`));

await cleanup(0);
