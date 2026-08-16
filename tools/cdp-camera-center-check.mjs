#!/usr/bin/env node
/* 世界-122 相机恒居中断因排查（2026-08-16）：
 * - 进 scene8 → 连续采样：玩家逻辑坐标 / Camera.x,y / aimOffset / zoom /
 *   worldView 中心与玩家偏差（世界坐标 + 屏幕像素换算）
 * - 再连续瞬移玩家模拟运动，观察相机是否仍然钉在玩家身上
 * 用法：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-camera-center-check.mjs
 * （需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = 9397;
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
edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://127.0.0.1:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 12000));
async function fetchJson(url) { const r = await fetch(url); return r.json(); }
let page = null;
for (let i = 0; i < 12 && !page; i++) {
    try { page = (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('127.0.0.1:5173')); } catch {}
    if (!page) await new Promise(r => setTimeout(r, 1500));
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
        pageExceptions.push((d.exception?.description || d.text || '').slice(0, 500));
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

await ev(`(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js'));
  const { SceneManager } = await import(u);
  await SceneManager.switchScene('scene8', window.Game.player, 'explore');
  return true;
})()`);
let ready = null;
for (let i = 0; i < 20; i++) {
    await sleep(800);
    ready = await ev(`(async () => {
      const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js'));
      const { DefenseSystem } = await import(u);
      return DefenseSystem.active ? true : null;
    })()`);
    if (ready) break;
}
await sleep(500);

// 采样：devWorld = 玩家相对 worldView 中心的世界偏差；devScreenPx = 乘 zoom 后的屏幕像素偏差
const sampleExpr = `(async () => {
  const cu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/camera.js'));
  const { Camera } = await import(cu);
  const su = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js'));
  const { SceneManager } = await import(su);
  const cam = window.__phaserScene.cameras.main;
  const p = window.Game.player;
  const wv = cam.worldView;
  const ccx = wv.x + wv.width / 2, ccy = wv.y + wv.height / 2;
  return {
    scene: SceneManager.currentScene,
    player: { x: Math.round(p.x), y: Math.round(p.y) },
    cameraXY: { x: Math.round(Camera.x), y: Math.round(Camera.y) },
    aimOffset: { x: Camera.aimOffsetX, y: Camera.aimOffsetY },
    drone: !!(p.droneSystem && p.droneSystem.controlling),
    zoom: Math.round(cam.zoom * 1000) / 1000,
    devWorld: { x: Math.round(p.x - ccx), y: Math.round(p.y - ccy) },
    devScreenPx: { x: Math.round((p.x - ccx) * cam.zoom), y: Math.round((p.y - ccy) * cam.zoom) },
  };
})()`;

console.log('== 静止采样（每 300ms x 6）==');
for (let i = 0; i < 6; i++) {
    console.log(i, JSON.stringify(await ev(sampleExpr)));
    await sleep(300);
}

console.log('== 模拟移动（每 100ms 瞬移 +40px x 10）==');
for (let i = 0; i < 10; i++) {
    await ev(`window.Game.player.x += 40; true`);
    console.log(i, JSON.stringify(await ev(sampleExpr)));
    await sleep(100);
}

await sleep(800);
console.log('== 停止后最终采样 ==');
console.log(JSON.stringify(await ev(sampleExpr)));

// 玩家精灵的屏幕包围盒（检测 精灵绘制位置 vs 逻辑位置 是否错位）
console.log('== 精灵屏幕位置 ==');
console.log(JSON.stringify(await ev(`(async () => {
  const s = window.__phaserScene;
  const ps = s.playerSprite;
  if (!ps) return 'no playerSprite';
  const cam = s.cameras.main;
  const sx = (ps.x - cam.scrollX) * cam.zoom;
  const sy = (ps.y - cam.scrollY) * cam.zoom;
  const sxFoot = (window.Game.player.x - cam.scrollX) * cam.zoom;
  const syFoot = (window.Game.player.y - cam.scrollY) * cam.zoom;
  return {
    spriteVisible: ps.visible,
    spriteScreenCenter: { x: Math.round(sx), y: Math.round(sy) },
    footScreenPos: { x: Math.round(sxFoot), y: Math.round(syFoot) },
    screenCenter: { x: 960, y: 540 },
    devPx: { x: Math.round(sx - 960), y: Math.round(sy - 540) },
    camScroll: { x: Math.round(cam.scrollX), y: Math.round(cam.scrollY) },
    viewWH: { w: Math.round(cam.worldView.width), h: Math.round(cam.worldView.height) },
  };
})()`)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.join(ROOT, 'tools/verify-shots'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools/verify-shots/scene8_camera_center.png'), Buffer.from(shot.result.data, 'base64'));
console.log('saved tools/verify-shots/scene8_camera_center.png');
console.log('页面异常数:', pageExceptions.length, pageExceptions.slice(0, 3));
await cleanup(0);
