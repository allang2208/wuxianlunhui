#!/usr/bin/env node
/* 选中光圈参数与图层验证（2026-08-16）：
 * - 填充 alpha=0.15、边缘 strokeAlpha=1.0
 * - 光圈深度 = 该成员精灵深度 - 0.1（贴图之下）
 * - 深度随队员 Y 排序仲裁同步（手改错误深度后 500ms 应自动回正；队员 Y 大幅变化后
 *   光圈仍保持 精灵-0.1）
 * 用法：node tools/cdp-ring-check.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9367;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 600)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });
edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
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

let bootOk = null;
for (let attempt = 0; attempt < 3 && bootOk !== 'ready'; attempt++) {
    try {
        bootOk = await ev(`(async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          let t0 = Date.now();
          while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
          if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
          t0 = Date.now();
          while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
          await sleep(1500);
          return 'ready';
        })()`);
    } catch (err) { console.log('boot retry', err.message.slice(0, 80)); await sleep(2000); }
}
if (bootOk !== 'ready') { console.error('boot failed'); await cleanup(1); }

const out = await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  if (!PartySystem.getMember('mage_luna')) PartySystem.addCompanion('mage_luna');
  const luna = PartySystem.getMember('mage_luna');
  luna.x = 650; luna.y = 660;
  PartySystem.setSelected(['mage_luna']);
  await sleep(600);
  const ps = window.__phaserScene;
  const ring = ps._selectionRings['mage_luna'];
  const sprite = ps._companionSprites['mage_luna'];
  if (!ring || !sprite) return { created: !!ring, sprite: !!sprite };
  const before = {
    fillAlpha: ring.fillAlpha,
    strokeAlpha: ring.strokeAlpha,
    depth: ring.depth,
    spriteDepth: sprite.depth,
    gap: Math.round((ring.depth - sprite.depth) * 100) / 100,
    visible: ring.visible,
  };
  // 深度跟踪①：手改错误深度，500ms 后应被每帧刷新回正
  ring.setDepth(9999);
  await sleep(500);
  const after = {
    depth: ring.depth,
    gap: Math.round((ring.depth - ps._companionSprites['mage_luna'].depth) * 100) / 100,
  };
  // 深度跟踪②：队员 Y 大幅变化（+500px 更靠屏幕下方 → 仲裁深度增大），
  // 光圈应保持 精灵-0.1（此前固定玩家深度会盖到贴图上）
  const luna2 = PartySystem.getMember('mage_luna');
  luna2.y += 500;
  await sleep(400);
  const moved = {
    ringDepth: ring.depth,
    spriteDepth: ps._companionSprites['mage_luna'].depth,
    gap: Math.round((ring.depth - ps._companionSprites['mage_luna'].depth) * 100) / 100,
    ringBelow: ring.depth < ps._companionSprites['mage_luna'].depth,
  };
  luna2.y -= 500;
  return { before, after, moved };
})()`);

console.log(JSON.stringify(out, null, 2));
console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 6)) console.log('  ', e);
await cleanup(0);
