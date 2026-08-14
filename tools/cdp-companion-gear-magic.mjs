#!/usr/bin/env node
/* 侍从装备+魔法跑通测试（2026-08-12）：验证后自动还原（队伍/档案/玩家背包/玩家装备）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9275;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

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
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('  saved', `${OUT_DIR}/${name}.png`);
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
  const player = window.Game.player;
  // 快照还原点
  window.__restore = {
    backpack: JSON.parse(JSON.stringify(eq.backpackItems || [])),
    equipments: JSON.parse(JSON.stringify(player.equipments || {})),
    partyInit: () => PartySystem.init(),
  };
  while (PartySystem.members.length) PartySystem.removeCompanion(PartySystem.members[0].id);
  // 招募祭司（魔法型侍从）
  PartySystem.addCompanion('priest_sera');
  const priest = PartySystem.getMember('priest_sera');
  const statsBefore = { int: priest.data.int, wis: priest.data.wis, matk: priest.data.matk, maxMp: priest.data.maxMp, def: priest.data.def };
  return { recruited: !!priest, statsBefore };
})()`));

console.log('装备测试:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  const eq = window.Game.EquipManager;
  const priest = PartySystem.getMember('priest_sera');
  // 玩家背包放法杖+法袍 → 走队员装备槽拖入逻辑
  const staff = { name: '测试法杖', category: 'weapon_ranged', weaponType: 'staff', equipSlot: 'weapon', isTwoHanded: true, rarity: 'rare', icon: '🪄', bonusStats: { int: 3 }, matkFormula: { base: 12, intMul: 1.2, wisMul: 0.5, enhanceBase: 2, enhanceIntMul: 0.1, enhanceWisMul: 0.05 } };
  const robe = { name: '测试法袍', category: 'armor', equipSlot: 'armor', rarity: 'epic', icon: '🥋', bonusStats: { wis: 2, maxMp: 40 }, defense: { base: 8, perEnhance: 2 }, enhanceLevel: 2 };
  eq.backpackItems.push({ ...staff, slot: 90 });
  eq.backpackItems.push({ ...robe, slot: 91 });
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 90 };
  CompanionPanel._equipFromPlayerToSlot(priest, 'weapon');
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 91 };
  CompanionPanel._equipFromPlayerToSlot(priest, 'armor');
  const equippedStaff = priest.equipments.weapon && priest.equipments.weapon.name === '测试法杖';
  const equippedRobe = priest.equipments.armor && priest.equipments.armor.name === '测试法袍';
  const d = priest.data;
  return {
    equippedStaff, equippedRobe,
    int: d.int, wis: d.wis, matk: d.matk, maxMp: d.maxMp, def: d.def,
  };
})()`));

// 打开队员面板属性页截图（装备后属性）
await ev(`(() => { const { CompanionPanel } = window.Game; CompanionPanel.close(); CompanionPanel.openManage(); CompanionPanel._currentTab = 'status'; CompanionPanel._renderBody(); return 1; })()`);
await sleep(300);
await shot('gear_magic_status');

console.log('魔法测试:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  const priest = PartySystem.getMember('priest_sera');
  const { buildSkillMap, grantSkillExp, getSkillEffect } = await import('/src/systems/skill-system.js');
  // 注入魔法技能（圣光+火球，模拟 companion-config.skills 配置）
  priest.skills = buildSkillMap(['holyLight', 'fireball'], window.SKILL_DATA || {});
  const built = !!priest.skills.holyLight && !!priest.skills.fireball;
  const lv1 = getSkillEffect(priest, 'holyLight', 1);
  const leveled = grantSkillExp(priest, 'holyLight', priest.skills.holyLight.maxExp);
  const lv2 = getSkillEffect(priest, 'holyLight', 2);
  // 技能页渲染验证
  CompanionPanel._currentTab = 'skill';
  CompanionPanel._renderBody();
  const body = document.getElementById('companionBody');
  const cards = body.querySelectorAll('.skill-card').length;
  return {
    built, leveled,
    holyLv: priest.skills.holyLight.level,
    healLv1: lv1.healBase, healLv2: lv2.healBase,
    skillCards: cards,
  };
})()`));
await sleep(300);
await shot('gear_magic_skill');

// ===== 还原 =====
console.log('restore:', await ev(`(() => {
  const r = window.__restore;
  const { PartySystem } = window.Game;
  const eq = window.Game.EquipManager;
  const player = window.Game.player;
  // 清空队伍+档案（PartySystem.init 重置 members/roster/listeners）
  PartySystem.init();
  // 还原玩家背包（移除测试物品，恢复快照）
  eq.backpackItems.length = 0;
  eq.backpackItems.push(...JSON.parse(JSON.stringify(r.backpack)));
  // 还原玩家装备
  Object.keys(player.equipments).forEach(k => delete player.equipments[k]);
  Object.assign(player.equipments, JSON.parse(JSON.stringify(r.equipments)));
  if (player.calculateCombatStats) player.calculateCombatStats();
  if (player.updateMaxStats) player.updateMaxStats();
  if (eq.updateInventorySlots) eq.updateInventorySlots();
  const cp = document.getElementById('companionOverlay');
  if (cp) cp.style.display = 'none';
  return {
    partySize: PartySystem.members.length,
    rosterEmpty: Object.keys(PartySystem.serializeRoster()).length === 0,
    backpackRestored: JSON.stringify(eq.backpackItems) === JSON.stringify(r.backpack),
  };
})()`));

await cleanup(0);
