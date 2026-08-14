#!/usr/bin/env node
/* 组队面板动画 + 打开其他面板关闭验证（2026-08-12） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9299;
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

console.log('打开动画:', await ev(`(async () => {
  const { CompanionPanel, PartySystem } = window.Game;
  if (!PartySystem.members.length) PartySystem.addCompanion('warrior_bruno');
  CompanionPanel.close();
  CompanionPanel.openManage();
  // 动画起始：打开瞬间 panel 应无 active（translateX(100%)）→ 下一帧加 active
  const panel = document.getElementById('companionSystemPanel');
  const before = panel.classList.contains('active');
  await new Promise(r => setTimeout(r, 60));   // 等待 rAF 加 active
  const after = panel.classList.contains('active');
  const overlayShown = document.getElementById('companionOverlay').style.display === 'block';
  return { before, after, overlayShown };
})()`));
await sleep(400);
await shot('party_anim_open');

console.log('关闭联动:', await ev(`(async () => {
  const { CompanionPanel } = window.Game;
  const { SystemUI } = await import('/src/ui/system-ui.js');
  // 打开玩家背包（SystemUI equip）→ 组队面板应关闭
  SystemUI.open('equip');
  await new Promise(r => setTimeout(r, 350));
  const manageClosed = document.getElementById('companionOverlay').style.display === 'none';
  const sysOpen = document.getElementById('systemPanel').classList.contains('active');
  return { manageClosed, sysOpen };
})()`));
await sleep(300);
await shot('party_anim_after_bag');

// 出征联动
console.log('出征联动:', await ev(`(async () => {
  const { CompanionPanel, ExpeditionSystem, PartySystem } = window.Game;
  if (!PartySystem.members.length) PartySystem.addCompanion('warrior_bruno');
  CompanionPanel.openManage();
  await new Promise(r => setTimeout(r, 60));
  ExpeditionSystem.open(window.Game.player);
  await new Promise(r => setTimeout(r, 350));
  return {
    manageClosed: document.getElementById('companionOverlay').style.display === 'none',
    expeditionOpen: document.getElementById('expeditionOverlay').style.display !== 'none' && document.getElementById('expeditionPanel').style.display !== 'none',
  };
})()`));

await cleanup(0);
