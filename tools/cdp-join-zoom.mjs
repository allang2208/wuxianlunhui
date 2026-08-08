#!/usr/bin/env node
/* 实机放大拼接点截图（摆两段 v 墙，相机 zoom 到拼接处）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9241;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 25000) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); } }
const page = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const p = `${OUT_DIR}/${name}.png`; fs.writeFileSync(p, Buffer.from(r.result.data, 'base64')); console.log('saved', p); };
await send('Runtime.enable'); await send('Page.enable');
let started = false;
for (let i = 0; i < 60 && !started; i++) { started = await evalJs(`(async()=>{ if(window.Game&&window.Game.isRunning&&window.Game.player) return true; const b=document.getElementById('startGameBtn'); if(b&&getComputedStyle(b).display!=='none') b.click(); return false; })()`).catch(()=>false); if (!started) await new Promise(r => setTimeout(r, 500)); }
for (let i = 0; i < 50; i++) { const ok = await evalJs(`(async()=>{ let u=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/scene-manager.js?')); if(!u) u='/src/world/scene-manager.js'; try{ const {SceneManager}=await import(u); window.__sm=SceneManager; return SceneManager.currentScene||null; }catch{ return null; } })()`).catch(()=>null); if (ok) break; await new Promise(r => setTimeout(r, 500)); }
await evalJs(`(async()=>{ await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);
await new Promise((r) => setTimeout(r, 1500));
await evalJs(`(async()=>{
  const G = window.Game;
  let du = performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/defense-system.js?'));
  if(!du) du='/src/world/defense-system.js';
  const dc = await import(du);
  for (const id of ['jz1','jz2']) { const e=G.entities.get(id); if(e){ e.active=false; G.entities.delete(id); } }
  const a = new dc.DefenseCover(1700, 2200, { grade:'D', orient:'v', id:'jz1' });
  // 吸附放置：face 步长 (176,-87) 后沿轴线回退 40px（SNAP_OVERLAP）
  const ln = Math.hypot(176, -87);
  const bx = 1700 + 176 - 40 * 176 / ln;
  const by = 2200 - 87 - 40 * (-87) / ln;
  const b = new dc.DefenseCover(Math.round(bx), Math.round(by), { grade:'D', orient:'v', id:'jz2' });
  G.entities.set('jz1', a); G.entities.set('jz2', b);
  await new Promise(r=>setTimeout(r, 400));
  const p = G.player; p.x = 1788; p.y = 2075;
  const scene = window.PhaserGame ? window.PhaserGame.scene : null;
  if (scene && scene.cameras && scene.cameras.main) { scene.cameras.main.setZoom(2.2); scene.cameras.main.centerOn(1788, 2075); }
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1000));
await shot('join_zoom_live');
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill(); console.log('done');
