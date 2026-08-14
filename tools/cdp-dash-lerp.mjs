#!/usr/bin/env node
/* 冲刺攻击 Lerp 轨迹实机验证（2026-08-12）：
 * 注入剑 → 模拟冲刺（progress 0 / 0.5 / 1）→ 截图 + 读 weaponSprite origin/position/rotation。
 * 需 vite dev server 跑在 5173。用法：node tools/cdp-dash-lerp.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9251;
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

console.log('inject:', await ev(`(async () => {
  const p = window.Game.player, s = window.__phaserScene;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  p.equipments['weapon'] = { name:'生锈的剑', weaponId:'weapon1', type:'剑', weaponType:'sword',
    category:'weapon_melee', weaponCategory:'mainhand', animConfigKey:'sword', equipSlot:'weapon',
    rarity:'common', level:1, attack:{ range:110, knockback:20, attackInterval:400, damageType:'物理' } };
  p.equipments['offhand'] = null;
  p.weaponMode = 'weapon';
  s.syncWeapon(p, p.weaponAnim || {});
  await sleep(500);
  return 'sword injected';
})()`));

const sample = async (label, timerMs) => {
  const st = await ev(`(() => {
    const p = window.Game.player, s = window.__phaserScene;
    // 固定玩家位置/朝向，确保截图时人物在画面内
    p.x = 600; p.y = 620; p.rotation = 0;
    if (s._mapModeActive !== undefined) s._mapModeActive = false;
    s.playerSprite.setPosition(p.x, p.y);
    s.playerSprite.setVisible(true);
    p._isDashing = true;
    p._dashDirection = { x: 1, y: 0 };
    p._dashTotalMs = 800;
    p._dashTimer = ${timerMs};
    s._syncSpecialWeaponAnim(p, 'sword', p.weaponAnim || {});
    const w = s.weaponSprite;
    return {
      progress: ${timerMs} / 800,
      origin: { x: +w.originX.toFixed(3), y: +w.originY.toFixed(3) },
      pos: { x: +w.x.toFixed(1), y: +w.y.toFixed(1) },
      rotDeg: +((w.rotation * 180 / Math.PI) % 360).toFixed(1),
      flipX: w.flipX,
      tex: w.texture.key,
    };
  })()`);
  console.log(label, JSON.stringify(st));
  await shot('dash_lerp_' + label.replace(/[^a-z0-9]/gi, '_'));
};

await sample('start', 0);
await sleep(300);
await sample('mid', 400);
await sleep(300);
await sample('end', 800);
await sleep(300);

// 冲刺结束复位验证：非特殊动画状态读普通路径，origin 应回到 0.5
console.log('复位:', JSON.stringify(await ev(`(() => {
  const p = window.Game.player, s = window.__phaserScene;
  p._isDashing = false;
  p._dashRecoverAt = 0;
  p.rotation = 0;
  p.x = 600; p.y = 620;
  if (s.syncWeapon) s.syncWeapon(p, p.weaponAnim || {});
  const w = s.weaponSprite;
  return { origin: { x: +w.originX.toFixed(3), y: +w.originY.toFixed(3) }, rotDeg: +((w.rotation * 180 / Math.PI) % 360).toFixed(1) };
})()`), null, 2));

await cleanup(0);
