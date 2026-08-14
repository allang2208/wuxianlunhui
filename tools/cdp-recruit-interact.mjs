#!/usr/bin/env node
/* 招募 ↔ 队员管理交互审计（2026-08-12 返工）：
 * A) 队员管理打开 → 招募 → 加入 → 队员管理应保持显示且显示新队员（不隐藏、刷新）
 * B) 空状态（无队员）→ 管理 → 招募 → 加入 → 管理自动切到新队员详情
 * C) 招募背景关闭 → 队员管理仍在
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9271;
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

// ===== 场景 A：队员管理打开 → 招募 → 加入 → 管理保持显示且含新队员 =====
console.log('A 管理+招募+加入:', await ev(`(async () => {
  const { CompanionPanel, RecruitUI, PartySystem } = window.Game;
  while (PartySystem.members.length) PartySystem.removeCompanion(PartySystem.members[0].id);
  CompanionPanel.close();
  CompanionPanel.openManage();
  RecruitUI.open();
  await new Promise(r => setTimeout(r, 300));
  const recruitOv = document.getElementById('recruitOverlay');
  const manageOv = document.getElementById('companionOverlay');
  const btn = recruitOv.querySelector('.recruit-card-btn:not([disabled])');
  btn.click();
  await new Promise(r => setTimeout(r, 900)); // 等成功反馈+延迟关闭
  return {
    recruitClosed: recruitOv.style.display === 'none',
    manageStillVisible: manageOv.style.display === 'block',   // 关键：不应被隐藏
    memberCount: PartySystem.members.length,
    memberShown: manageOv.querySelector('.companion-name') ? manageOv.querySelector('.companion-name').textContent : null,
    chipCount: manageOv.querySelectorAll('.companion-member-chip').length,
  };
})()`));
await shot('interact_A_after_join');

// ===== 场景 B：空状态 → 招募 → 加入 → 自动切到新队员 =====
await sleep(400);
console.log('B 空状态招募:', await ev(`(async () => {
  const { CompanionPanel, RecruitUI, PartySystem } = window.Game;
  while (PartySystem.members.length) PartySystem.removeCompanion(PartySystem.members[0].id);
  CompanionPanel.close();
  CompanionPanel.openManage();
  const emptyBefore = !!CompanionPanel._overlay.querySelector('.companion-empty');
  RecruitUI.open();
  await new Promise(r => setTimeout(r, 300));
  const recruitOv = document.getElementById('recruitOverlay');
  const btn = recruitOv.querySelector('.recruit-card-btn:not([disabled])');
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  return {
    emptyBefore,
    memberCount: PartySystem.members.length,
    autoSelected: CompanionPanel._memberId,
    nameShown: CompanionPanel._overlay.querySelector('.companion-name') ? CompanionPanel._overlay.querySelector('.companion-name').textContent : null,
    emptyStillShown: !!CompanionPanel._overlay.querySelector('.companion-empty'),
  };
})()`));
await shot('interact_B_after_join');

// ===== 场景 C：招募背景关闭 → 队员管理仍在 =====
await sleep(400);
console.log('C 背景关闭:', await ev(`(async () => {
  const { CompanionPanel, RecruitUI } = window.Game;
  CompanionPanel.openManage();
  RecruitUI.open();
  await new Promise(r => setTimeout(r, 200));
  const recruitOv = document.getElementById('recruitOverlay');
  // 模拟点背景（overlay 自身）关闭
  recruitOv.click();
  await new Promise(r => setTimeout(r, 200));
  const manageOv = document.getElementById('companionOverlay');
  return {
    recruitClosed: recruitOv.style.display === 'none',
    manageStillVisible: manageOv.style.display === 'block',
  };
})()`));
await shot('interact_C_bg_close');

await cleanup(0);
