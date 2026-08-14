#!/usr/bin/env node
/* 招募按钮图层/命中测试诊断（2026-08-12）：
 * 打开招募 → 检查按钮中心 elementFromPoint / 覆盖元素 / pointer-events 链 / z-index 层级。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9267;
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

console.log('diagnose:', JSON.stringify(await ev(`(async () => {
  window.Game.RecruitUI.open();
  await new Promise(r => setTimeout(r, 300));
  const overlay = document.getElementById('recruitOverlay');
  const btn = overlay.querySelector('.recruit-card-btn:not([disabled])');
  const r = btn.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  // 命中链：hit 及其祖先
  const chain = [];
  let el = hit;
  while (el && el !== document.body) { chain.push(el.id || el.className || el.tagName); el = el.parentElement; }
  // 按钮祖先的 pointer-events / position / z-index
  const btnChain = [];
  el = btn;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    btnChain.push({
      tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 50),
      pe: cs.pointerEvents, pos: cs.position, z: cs.zIndex,
    });
    el = el.parentElement;
  }
  // 全屏覆盖排查：gameContainer 下所有 fixed/absolute 且覆盖按钮区域的元素
  const covers = [];
  document.querySelectorAll('#gameContainer *, #gameContainer').forEach(e => {
    if (!(e instanceof HTMLElement)) return;
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
    if (cs.pointerEvents === 'none') return;
    const er = e.getBoundingClientRect();
    const overlap = er.left < cx && er.right > cx && er.top < cy && er.bottom > cy;
    const above = parseInt(cs.zIndex || 0, 10) >= 100;
    if (overlap && above && e !== overlay && !overlay.contains(e)) {
      covers.push({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 50), z: cs.zIndex, pe: cs.pointerEvents });
    }
  });
  return {
    btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    hitIsBtn: hit === btn || btn.contains(hit),
    hitId: hit.id || String(hit.className).slice(0, 60),
    hitChain: chain.slice(0, 8),
    btnChain,
    covers,
  };
})()`), null, 2));

await cleanup(0);
