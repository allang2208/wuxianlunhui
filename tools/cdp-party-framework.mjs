#!/usr/bin/env node
/* 侍从系统框架实机验证（2026-08-12）：
 * 组队栏替换追踪栏 → 招募卡片 → 加入队员 → 组队栏刷新 → 队员面板 → 出征四圆圈。
 * 需 vite dev server 跑在 5173。用法：node tools/cdp-party-framework.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9255;
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

console.log('UI 状态:', JSON.stringify(await ev(`(() => {
  const partyBar = document.getElementById('partyBar');
  const tracker = document.getElementById('questTracker');
  return {
    partyBar: !!partyBar,
    partySlots: partyBar ? partyBar.querySelectorAll('.party-slot').length : 0,
    trackerHidden: tracker ? (tracker.style.display === 'none') : 'missing',
  };
})()`), null, 2));
await shot('party_bar');

console.log('招募:', await ev(`(async () => {
  window.Game.RecruitUI.open();
  await new Promise(r => setTimeout(r, 300));
  const overlay = document.getElementById('recruitOverlay');
  return { visible: overlay && overlay.style.display === 'flex', cards: overlay ? overlay.querySelectorAll('.recruit-card').length : 0 };
})()`));
await shot('recruit_cards');

console.log('加入队员:', await ev(`(async () => {
  const PartySystem = window.Game.PartySystem;
  const ok1 = PartySystem.addCompanion('warrior_bruno');
  const ok2 = PartySystem.addCompanion('mage_luna');
  const bar = document.getElementById('partyBar');
  return {
    ok1, ok2, size: PartySystem.size,
    memberSlots: bar ? bar.querySelectorAll('.party-slot--member').length : 0,
  };
})()`));
await sleep(200);
await shot('party_bar_filled');

console.log('队员面板:', await ev(`(async () => {
  window.Game.CompanionPanel.open('warrior_bruno');
  await new Promise(r => setTimeout(r, 300));
  const ov = document.getElementById('companionOverlay');
  return {
    visible: ov && ov.style.display === 'block',
    tabs: ov ? ov.querySelectorAll('.companion-tab').length : 0,
    name: ov ? (ov.querySelector('.companion-name') || {}).textContent : null,
    statRows: ov ? ov.querySelectorAll('.companion-stat').length : 0,
    invCells: ov ? ov.querySelectorAll('.companion-inv-cell').length : 0,
  };
})()`));
await shot('companion_panel');

console.log('equip tab + 拖动转移:', await ev(`(async () => {
  // 切到装备背包 tab
  const ov = document.getElementById('companionOverlay');
  ov.querySelectorAll('.companion-tab').forEach(t => { if (t.dataset.tab === 'equip') t.click(); });
  await new Promise(r => setTimeout(r, 200));
  const cells = ov.querySelectorAll('.companion-inv-cell').length;
  // 模拟玩家背包 → 队员背包拖动：塞一个测试物品进玩家背包，再走转移接口
  const PartySystem = window.Game.PartySystem;
  const CompanionPanel = window.Game.CompanionPanel;
  const member = PartySystem.getMember('warrior_bruno');
  const eq = window.Game.EquipManager;
  const testItem = { name: '测试药水', slot: 99, category: 'consumable' };
  eq.backpackItems.push(testItem);
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 99 };
  CompanionPanel._moveFromPlayerToCompanion(member, 0);
  const moved = member.backpack.some(b => b.slot === 0 && b.name === '测试药水');
  const playerRemoved = !eq.backpackItems.some(i => i.slot === 99);
  return { cells, moved, playerRemoved, memberBackpack: member.backpack.length };
})()`));
await shot('companion_equip_tab');

console.log('装备通用:', await ev(`(async () => {
  const PartySystem = window.Game.PartySystem;
  const CompanionPanel = window.Game.CompanionPanel;
  const member = PartySystem.getMember('warrior_bruno');
  const eq = window.Game.EquipManager;
  // 玩家背包塞一件护甲，走队员装备槽拖入逻辑（_equipFromPlayerToSlot）
  const armor = { name: '测试胸甲', slot: 98, category: 'armor', equipSlot: 'armor', bonusStats: { con: 2, maxHp: 30, defense: 4 } };
  eq.backpackItems.push(armor);
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 98 };
  CompanionPanel._equipFromPlayerToSlot(member, 'armor');
  const equipped = member.equipments.armor && member.equipments.armor.name === '测试胸甲';
  const statsApplied = member.data.con === 14 && member.data.maxHp >= 150; // 基础12+2 / hp基础+30
  // 队员背包装备（双击逻辑等价调 equipFromBackpack）
  const sword = { name: '测试剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
  member.backpack.push({ slot: 5, ...sword });
  const eqSlot = member.equipFromBackpack(5);
  // 卸下回包
  const unequipped = member.unequip('armor');
  const backToPack = member.backpack.some(b => b.name === '测试胸甲') && !member.equipments.armor;
  // 队员背包 → 玩家背包
  const armorSlot = member.backpack.find(b => b.name === '测试胸甲');
  CompanionPanel._onCompanionMoveToPlayer({ memberId: member.id, slot: armorSlot ? armorSlot.slot : -1, targetSlot: 7 });
  const movedToPlayer = eq.backpackItems.some(i => i.slot === 7 && i.name === '测试胸甲');
  return {
    equipped, statsApplied, eqSlot,
    unequipped, backToPack, movedToPlayer,
    memberStr: member.data.str, memberCon: member.data.con,
  };
})()`));
await shot('companion_equip_generic');

console.log('技能通用:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  const { CompanionPanel } = window.Game;
  const { buildSkillMap, grantSkillExp } = await import('/src/systems/skill-system.js');
  // 运行时给队员注入一个技能（模拟 companion-config.skills 填 id 后的行为，配置仍保持占位）
  const member = PartySystem.getMember('priest_sera') || (PartySystem.addCompanion('priest_sera') && PartySystem.getMember('priest_sera'));
  const skillData = window.SKILL_DATA || {};
  member.skills = buildSkillMap(['holyLight'], skillData);
  const skill = member.skills.holyLight;
  const built = !!skill && skill.name === '圣光';
  const lvBefore = skill.level;
  const leveled = grantSkillExp(member, 'holyLight', skill.maxExp, {
    refreshUI: () => { if (CompanionPanel._overlay && CompanionPanel._overlay.style.display === 'block') CompanionPanel._renderBody(); },
  });
  const lvAfter = skill.level;
  // 打开队员面板技能 tab 验证渲染
  CompanionPanel.open(member.id);
  CompanionPanel._currentTab = 'skill';
  CompanionPanel._renderBody();
  const cards = CompanionPanel._overlay.querySelectorAll('.companion-skill-card').length;
  const skillName = CompanionPanel._overlay.querySelector('.companion-skill-name');
  return { built, leveled, lvBefore, lvAfter, cards, skillName: skillName ? skillName.textContent : null };
})()`));
await shot('companion_skill_generic');

console.log('管理界面:', await ev(`(async () => {
  const { CompanionPanel } = window.Game;
  const { PartySystem } = window.Game;
  // 关闭队员面板 → 清空队伍测空状态 → 管理入口
  CompanionPanel.close();
  while (PartySystem.members.length) PartySystem.removeCompanion(PartySystem.members[0].id);
  CompanionPanel.openManage();
  const emptyState = !!CompanionPanel._overlay.querySelector('.companion-empty');
  const emptyRecruit = !!CompanionPanel._overlay.querySelector('.companion-empty-recruit');
  // 加入队员后管理界面应显示队员列表 + 详情
  PartySystem.addCompanion('warrior_bruno');
  PartySystem.addCompanion('mage_luna');
  CompanionPanel.openManage();
  const chips = CompanionPanel._overlay.querySelectorAll('.companion-member-chip').length;
  const firstActive = CompanionPanel._memberId;
  const nameShown = CompanionPanel._overlay.querySelector('.companion-name').textContent;
  // 点击第二个 chip 切换
  const chipsEl = CompanionPanel._overlay.querySelectorAll('.companion-member-chip');
  if (chipsEl[1]) chipsEl[1].click();
  const switchedName = CompanionPanel._overlay.querySelector('.companion-name').textContent;
  return { emptyState, emptyRecruit, chips, firstActive, nameShown, switchedName };
})()`));
await shot('companion_manage');

console.log('解除招募保留状态:', await ev(`(async () => {
  const { PartySystem } = window.Game;
  const { CompanionPanel } = window.Game;
  CompanionPanel.close();
  // 清空队伍（roster 已保留此前队员档案）
  while (PartySystem.members.length) PartySystem.removeCompanion(PartySystem.members[0].id);
  // 新招募凯斯 → 升级+装备 → 移除 → 再招募验证继承
  PartySystem.addCompanion('ranger_keith');
  const keith = PartySystem.getMember('ranger_keith');
  keith.gainExp(keith.data.maxExp + 30);
  keith.backpack.push({ slot: 0, name: '猎手箭袋', category: 'accessory' });
  const lvKeep = keith.data.level, dexKeep = keith.data.dex;
  PartySystem.removeCompanion('ranger_keith');
  const rosterHas = !!PartySystem.serializeRoster()['ranger_keith'];
  // 招募卡片应显示"再次加入（继承状态）"
  const cand = PartySystem.candidates.find(c => c.id === 'ranger_keith');
  const rejoin = PartySystem.addCompanion('ranger_keith');
  const keith2 = PartySystem.getMember('ranger_keith');
  return {
    rosterHas,
    candUnlocked: cand && cand.unlocked,
    rejoin,
    lvKeep, lvAfter: keith2.data.level,
    dexKeep, dexAfter: keith2.data.dex,
    backpackInherited: keith2.backpack.some(b => b.name === '猎手箭袋'),
  };
})()`));
await shot('companion_roster_keep');

console.log('双栏背包:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  const eq = window.Game.EquipManager;
  // 确保有队员 + 玩家背包塞入物品
  if (!PartySystem.members.length) PartySystem.addCompanion('warrior_bruno');
  if (!eq.backpackItems.some(i => i.name === '背包测试剑')) {
    eq.backpackItems.push({ name: '背包测试剑', slot: 21, category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' });
  }
  CompanionPanel.close();
  CompanionPanel.openManage();
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  const pack = document.getElementById('companionPlayerPack');
  const grid = document.getElementById('companionPlayerGrid');
  const cells = grid.querySelectorAll('.companion-player-cell').length;
  const filled = grid.querySelectorAll('.companion-player-cell[draggable="true"]').length;
  const packVisible = pack.style.display === 'flex';
  const panelWithPack = document.querySelector('#companionOverlay .companion-panel').classList.contains('with-pack');
  // 切回属性 tab → 玩家背包应隐藏
  CompanionPanel._currentTab = 'status';
  CompanionPanel._renderBody();
  const packHidden = pack.style.display === 'none';
  // 玩家背包格拖动 → 队员背包（模拟 dragSrc + 转移接口）
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  const member = PartySystem.members[0];
  eq._dragDropManager._dragSrc = { type: 'inventory', slot: 21 };
  CompanionPanel._moveFromPlayerToCompanion(member, 0);
  const moved = member.backpack.some(b => b.slot === 0 && b.name === '背包测试剑');
  return { packVisible, panelWithPack, cells, filled, packHidden, moved };
})()`));
await shot('companion_dual_pack');

console.log('复制格式核验:', await ev(`(async () => {
  const { CompanionPanel } = window.Game;
  const eq = window.Game.EquipManager;
  // 塞一个有稀有度/堆叠/强化的物品，验证复制格格式与玩家背包格一致
  const maxSlots = eq.maxBackpackSlots || 10;
  const usedSlots = new Set(eq.backpackItems.map(i => i.slot));
  let testSlot = -1;
  for (let i = 0; i < maxSlots; i++) { if (!usedSlots.has(i)) { testSlot = i; break; } }
  if (!eq.backpackItems.some(i => i.name === '格式核验药水')) {
    eq.backpackItems.push({ name: '格式核验药水', slot: testSlot, category: 'consumable', rarity: 'rare', stack: 5, icon: '🧪', enhanceLevel: 2, itemId: 'fmt-test' });
  }
  CompanionPanel.close();
  CompanionPanel.openManage();
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  const grid = document.getElementById('companionPlayerGrid');
  const sel = '.inv-cell[data-slot="' + testSlot + '"]';
  const cloneCell = grid.querySelector(sel);
  const playerGrid = document.getElementById('inventoryGrid');
  const playerCell = playerGrid.querySelector(sel);
  if (!playerCell) {
    // 玩家格子可能没渲染到 30 号（maxSlots 之外）——取任意同 slot
  }
  return {
    cloneCellClass: cloneCell ? cloneCell.className : null,
    cloneHtml: cloneCell ? cloneCell.innerHTML.slice(0, 200) : null,
    cloneHasRarity: cloneCell ? !!cloneCell.querySelector('.inv-rarity') : false,
    cloneHasName: cloneCell ? !!cloneCell.querySelector('.inv-name') : false,
    cloneHasStack: cloneCell ? !!cloneCell.querySelector('.inv-stack') : false,
    cloneHasEnhanced: cloneCell ? !!cloneCell.querySelector('.inv-enhanced') : false,
    cloneDraggable: cloneCell ? cloneCell.draggable : null,
    cloneDragType: cloneCell ? cloneCell.dataset.dragType : null,
    playerCellExists: !!playerCell,
    playerCellHtml: playerCell ? playerCell.innerHTML.slice(0, 200) : null,
  };
})()`));
await shot('companion_pack_format');

console.log('属性页复刻:', await ev(`(() => {
  const { CompanionPanel, PartySystem } = window.Game;
  if (!PartySystem.members.length) PartySystem.addCompanion('warrior_bruno');
  CompanionPanel.close();
  CompanionPanel.openManage();
  CompanionPanel._currentTab = 'status';
  CompanionPanel._renderBody();
  const body = document.getElementById('companionBody');
  const statusPage = body.querySelector('.status-page');
  const sections = body.querySelectorAll('.status-section').length;
  const bars = body.querySelectorAll('.status-bar').length;
  const attrs = body.querySelectorAll('.attr-item').length;
  const hasBarFill = !!body.querySelector('.bar-fill.hp');
  const headerText = body.querySelector('.status-header') ? body.querySelector('.status-header').textContent.trim() : null;
  return { statusPage: !!statusPage, sections, bars, attrs, hasBarFill, headerText };
})()`));
await shot('companion_status');

console.log('技能页复刻:', await ev(`(async () => {
  const { CompanionPanel, PartySystem } = window.Game;
  const member = PartySystem.members[0];
  const { buildSkillMap } = await import('/src/systems/skill-system.js');
  member.skills = buildSkillMap(['swordMastery', 'whirlwind', 'criticalStrike', 'dashAttack'], window.SKILL_DATA || {});
  CompanionPanel._currentTab = 'skill';
  CompanionPanel._renderBody();
  const body = document.getElementById('companionBody');
  const skillGrid = body.querySelector('.skill-grid');
  const skillCard = body.querySelector('.skill-card');
  return {
    skillGrid: !!skillGrid,
    skillCards: body.querySelectorAll('.skill-card').length,
    skillCardClass: skillCard ? skillCard.className : null,
    skillCardHasIcon: skillCard ? !!skillCard.querySelector('.skill-icon') : false,
    skillCardHasName: skillCard ? !!skillCard.querySelector('.skill-name') : false,
    skillCardHasLevel: skillCard ? !!skillCard.querySelector('.skill-level') : false,
    skillCardHasExpBar: skillCard ? !!skillCard.querySelector('.skill-exp-bar') : false,
  };
})()`));
await shot('companion_skill');

console.log('出征四圆圈:', await ev(`(async () => {
  window.Game.ExpeditionSystem.open(window.Game.player);
  await new Promise(r => setTimeout(r, 300));
  const bar = document.getElementById('expeditionMemberBar');
  return {
    visible: !!bar,
    circles: bar ? bar.querySelectorAll('.expedition-member-circle').length : 0,
    empty: bar ? bar.querySelectorAll('.expedition-member-circle--empty').length : 0,
    members: bar ? bar.querySelectorAll('.expedition-member-circle--member').length : 0,
  };
})()`));
await shot('expedition_member_bar');

await cleanup(0);
