#!/usr/bin/env node
/* 露娜初始魔法 600 + 消耗品自动使用设置验证（2026-08-15）：
   1) 招募露娜 → data.maxMp === 600
   2) 队员面板背包页有"消耗品使用设置"按钮，可展开/保存
   3) HP/MP 低于阈值时自动使用背包药水（堆叠减少、数值回升） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9335;
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
  await sleep(1200);
  return 'ready';
})()`));

console.log('初始魔法+面板按钮:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  if (!PartySystem.getMember('mage_luna')) PartySystem.addCompanion('mage_luna');
  const luna = PartySystem.getMember('mage_luna');
  const mpInfo = { maxMp: luna.data.maxMp, mp: luna.data.mp, lv: luna.data.level };
  CompanionPanel.open('mage_luna');
  CompanionPanel._currentTab = 'equip';
  CompanionPanel._renderBody();
  const ov = document.getElementById('companionOverlay');
  const btn = ov ? ov.querySelector('[data-action="toggle-consumable-settings"]') : null;
  let panelExpanded = false;
  if (btn) { btn.click(); panelExpanded = !!ov.querySelector('#companionConsumableSettings')
      && ov.querySelector('#companionConsumableSettings').style.display !== 'none'; }
  return { mpInfo, btnExists: !!btn, panelExpanded, packVisible: !!ov.querySelector('#companionPlayerPack') };
})()`));

console.log('自动用药:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  // 清场景怪，避免 AI 施法耗蓝干扰 MP 恢复测试
  for (const [k, e] of Array.from(window.Game.entities.entries())) {
    if (e && e !== luna && e._faction === 'enemy') window.Game.entities.delete(k);
  }
  luna.target = null;
  // 清背包，塞测试药水（低级：hp30 / 高级：hp80 验证低级优先）
  luna.backpack.length = 0;
  luna.backpack.push(
    { slot: 0, name: '治疗药水', category: 'consumable', useEffect: { hp: 30 }, stack: 3, level: 1 },
    { slot: 1, name: '大治疗药水', category: 'consumable', useEffect: { hp: 80 }, stack: 2, level: 3 },
    { slot: 2, name: '魔力药水', category: 'consumable', useEffect: { mp: 25 }, stack: 2, level: 1 },
  );
  luna.consumableSettings = { enabled: true, hpThreshold: 0.5, mpThreshold: 0.5, useLowToHigh: true };
  const maxHp = luna.data.maxHp, maxMp = luna.data.maxMp;
  luna.data.hp = Math.floor(maxHp * 0.4);
  luna.data.mp = Math.floor(maxMp * 0.4);
  const hpBefore = luna.data.hp, mpBefore = luna.data.mp;
  await sleep(1800);
  const hpAfter = luna.data.hp, mpAfter = luna.data.mp;
  const hpPotion = luna.backpack.find(b => b.name === '治疗药水');
  const mpPotion = luna.backpack.find(b => b.name === '魔力药水');
  const bigPotion = luna.backpack.find(b => b.name === '大治疗药水');
  return {
    hpDelta: hpAfter - hpBefore,
    mpDelta: mpAfter - mpBefore,
    hpPotionStack: hpPotion ? hpPotion.stack : 0,
    bigPotionStack: bigPotion ? bigPotion.stack : 0,
    mpPotionStack: mpPotion ? mpPotion.stack : 0,
    usedLowHpFirst: !hpPotion || hpPotion.stack < 3,
    usedMpPotion: !mpPotion || mpPotion.stack < 2,
  };
})()`));

console.log('设置保存:', await ev(`(async () => {
  const { PartySystem, CompanionPanel } = window.Game;
  const luna = PartySystem.getMember('mage_luna');
  const ov = document.getElementById('companionOverlay');
  const hpEl = ov.querySelector('#csHp');
  const mpEl = ov.querySelector('#csMp');
  const enabledEl = ov.querySelector('#csEnabled');
  hpEl.value = '20';
  mpEl.value = '15';
  enabledEl.checked = false;
  ov.querySelector('#csSave').click();
  return {
    enabled: luna.consumableSettings.enabled,
    hpThreshold: luna.consumableSettings.hpThreshold,
    mpThreshold: luna.consumableSettings.mpThreshold,
  };
})()`));

await cleanup(0);
