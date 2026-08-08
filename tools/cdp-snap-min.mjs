#!/usr/bin/env node
/* 极简：房间 v 墙左右外接吸附（snap/canPlace）。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9240;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,900', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 25000) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); } }
const page = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
await send('Runtime.enable');
let started = false;
for (let i = 0; i < 60 && !started; i++) { started = await evalJs(`(async()=>{ if(window.Game&&window.Game.isRunning&&window.Game.player) return true; const b=document.getElementById('startGameBtn'); if(b&&getComputedStyle(b).display!=='none') b.click(); return false; })()`).catch(()=>false); if (!started) await new Promise(r => setTimeout(r, 500)); }
for (let i = 0; i < 50; i++) { const ok = await evalJs(`(async()=>{ let u=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/scene-manager.js?')); if(!u) u='/src/world/scene-manager.js'; try{ const {SceneManager}=await import(u); window.__sm=SceneManager; return SceneManager.currentScene||null; }catch{ return null; } })()`).catch(()=>null); if (ok) break; await new Promise(r => setTimeout(r, 500)); }
await evalJs(`(async()=>{ await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);
await new Promise((r) => setTimeout(r, 1500));
const res = await evalJs(`(async()=>{
  try {
    const G = window.Game;
    let bu = performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/building-system.js?'));
    if(!bu) bu='/src/world/building-system.js';
    const bm = await import(bu);
    const BS = bm.BuildingSystem;
    if (BS.active) BS.close();
    let w = null;
    for (const e of G.entities.values()) { if (e && e.orient==='v' && Math.abs(e.x-1300)<5) { w=e; break; } }
    if (!w) return { error: 'no v wall' };
    const fl = w._faceLine;
    const L = fl[0], R = fl[1];
    const item = bm.BUILD_ITEMS.find(i=>i.id==='cover_D_v');
    BS._selectItem(item);
    const test = (label, tx, ty) => {
      const snap = BS._snapPosition(tx, ty);
      return { label, target:[Math.round(tx),Math.round(ty)], snapped: snap?[Math.round(snap.x),Math.round(snap.y),snap.same]:null, placeable: snap?BS._canPlace(snap.x,snap.y):false };
    };
    const out = [];
    // 左延续：新件 R 贴锚 L（中心 = L - R.off + ... 用锚端点直接推）
    out.push(test('left', w.x + L.x - w.x - (R.x - w.x), w.y + (L.y-w.y) - (R.y-w.y)));
    out.push(test('right', w.x + (R.x-w.x) - (L.x-w.x), w.y + (R.y-w.y) - (L.y-w.y)));
    BS._placing.mirror = true;
    const hL = { x: -R.x+w.x, y: R.y-w.y }; // 镜像近似，直接用锚 R 推
    out.push(test('leftM', w.x + (R.x-w.x) - (-(L.x-w.x)), w.y + (R.y-w.y) - (L.y-w.y)));
    out.push(test('rightM', w.x + (-(L.x-w.x)) - (R.x-w.x), w.y + (L.y-w.y) - (R.y-w.y)));
    BS._cancelPlacement();
    // 空旷处测试：构造孤立 v 墙（远离房间 x>2000），移除其 isoSegments 不影响
    let du2 = performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/defense-system.js?'));
    if(!du2) du2='/src/world/defense-system.js';
    const dc2 = await import(du2);
    const open = new dc2.DefenseCover(2400, 2100, { grade: 'D', orient: 'v', id: 'open_anchor' });
    G.entities.set('open_anchor', open);
    const fl2 = open._faceLine;
    const L2 = fl2[0], R2 = fl2[1];
    BS._selectItem(item);
    const out2 = [];
    out2.push(test('openLeft', open.x + L2.x - open.x - (R2.x - open.x), open.y + (L2.y-open.y) - (R2.y-open.y)));
    out2.push(test('openRight', open.x + (R2.x-open.x) - (L2.x-open.x), open.y + (R2.y-open.y) - (L2.y-open.y)));
    BS._cancelPlacement();
    open.removeFromCollision(); open.active=false; G.entities.delete('open_anchor');
    return { anchor: { x: Math.round(w.x), y: Math.round(w.y), L: [Math.round(L.x),Math.round(L.y)], R: [Math.round(R.x),Math.round(R.y)] }, out, out2 };
  } catch (err) { return { error: String(err && err.stack || err) }; }
})()`);
console.log(JSON.stringify(res, null, 2));
ws.close(); edge.kill(); console.log('done');
