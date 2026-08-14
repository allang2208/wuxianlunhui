#!/usr/bin/env node
/* 招募黑屏回归验证（2026-08-12）：
 * 复现"点招募黑屏"路径：注入剑 → 攻击/冲刺（旧逻辑触发武器高斯滤镜创建点）→ 打开招募界面。
 * 修复前：filters.internal.addBlur 创建 framebuffer 失败 → WebGL context lost → 黑屏。
 * 修复后：_applyWeaponBlur 为 no-op，不创建滤镜，应无崩溃、画面正常。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9259;
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
await send('Log.enable');

// 收集页面 console 错误
let pageErrors = [];
ws.addEventListener('message', (ev2) => {
    const m = JSON.parse(ev2.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        pageErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        pageErrors.push('LOG: ' + m.params.entry.text);
    }
});

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

// 注入剑 + 强制触发旧 blur 调用点（攻击 perFrame / 冲刺 / 特殊动画同步）
console.log('trigger:', await ev(`(() => {
  const p = window.Game.player, s = window.__phaserScene;
  p.equipments['weapon'] = { name:'生锈的剑', weaponId:'weapon1', type:'剑', weaponType:'sword',
    category:'weapon_melee', weaponCategory:'mainhand', animConfigKey:'sword', equipSlot:'weapon',
    rarity:'common', level:1, attack:{ range:110, knockback:20, attackInterval:400, damageType:'物理' } };
  p.weaponMode = 'weapon';
  s.syncWeapon(p, p.weaponAnim || {});
  // 旧逻辑创建高斯滤镜的调用点：perFrame 攻击同步 + 冲刺同步 + 直接 _applyWeaponBlur
  s.setPlayerAnimation('attack_sword', 600);
  s._applyWeaponBlur(12, 12);
  p._isDashing = true; p._dashTimer = 400; p._dashTotalMs = 800; p._dashDirection = { x: 1, y: 0 };
  s._syncSpecialWeaponAnim(p, 'sword', p.weaponAnim || {});
  p._isDashing = false;
  s._hideWeaponGhosts();
  return { blurFilter: !!s._weaponBlurFilter };
})()`));

// 打开招募界面（复现用户操作）
console.log('recruit:', await ev(`(async () => {
  window.Game.RecruitUI.open();
  await new Promise(r => setTimeout(r, 400));
  const overlay = document.getElementById('recruitOverlay');
  return { visible: overlay && overlay.style.display === 'flex', cards: overlay ? overlay.querySelectorAll('.recruit-card').length : 0 };
})()`));
await sleep(500);
await shot('recruit_no_crash');

// 渲染器状态 + 错误收集
const state = await ev(`(() => {
  const g = window.__phaserScene && window.__phaserScene.game;
  return { running: !!g && g.isRunning !== false, renderer: g ? g.renderer.type : null };
})()`);
console.log('state:', JSON.stringify(state));
console.log('pageErrors:', JSON.stringify(pageErrors));
const crashed = pageErrors.some(e => /Framebuffer|CONTEXT_LOST|WebGL/i.test(e));
console.log(crashed ? 'RESULT: FAIL（仍崩溃）' : 'RESULT: PASS（无崩溃）');
await cleanup(crashed ? 1 : 0);
