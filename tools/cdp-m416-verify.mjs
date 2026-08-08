#!/usr/bin/env node
/* 极简：启动 headless Edge → 进游戏 → 给玩家装备 M416 → 截图到 tools/verify-shots/ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9241;
const outDir = path.resolve(import.meta.dirname, 'verify-shots');
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-m416-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise(r => setTimeout(r, 8000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > t) return null;
    await new Promise(r => setTimeout(r, 300));
  }
}

const page = await waitFor(async () =>
  (await fetchJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const shot = async (name) => {
  await new Promise(r => setTimeout(r, 1200));
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('shot ->', p);
};

await send('Page.enable');
await send('Runtime.enable');

// 等游戏开始
let started = false;
for (let i = 0; i < 80 && !started; i++) {
  started = await evalJs(`(async()=>{
    if (window.Game && window.Game.isRunning && window.Game.player) return true;
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') b.click();
    return false;
  })()`).catch(() => false);
  if (!started) await new Promise(r => setTimeout(r, 500));
}
console.log('game started:', started);
await new Promise(r => setTimeout(r, 2500));

// 切到主战斗场景，确保玩家可见
await evalJs(`(async()=>{
  let u = performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/src/world/scene-manager.js?'));
  if (!u) u = '/src/world/scene-manager.js';
  const { SceneManager } = await import(u);
  if (SceneManager.currentScene !== 'scene_main' && SceneManager.switchScene) {
    await SceneManager.switchScene('scene_main', window.Game.player);
  }
  return true;
})()`);
await new Promise(r => setTimeout(r, 2000));

// 装备 M416：把 weapon1 槽直接设为 M416_ITEM，再切 weaponMode
const eq = await evalJs(`(async()=>{
  const G = window.Game;
  const p = G.player;
  const { EquipDataManager } = await import('/src/ui/equip-data-manager.js');
  const item = JSON.parse(JSON.stringify(EquipDataManager.M416_ITEM));
  p.equipments.weapon1 = item;
  p.weaponMode = 'weapon1';
  if (p.equippedRangedType) p.equippedRangedType = 'm416';
  const { EquipManager } = await import('/src/ui/equip-manager.js');
  if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
  if (EquipManager.syncWeaponVisual) EquipManager.syncWeaponVisual();
   // 强制玩家朝右
   const sc = G.currentScene || G.scene || null;
   if (sc && sc.playerSprite) { sc.playerSprite.flipX = false; }
   if (sc && sc.weaponSprite) { sc.weaponSprite.setFlipX(false); }
   await new Promise(r => setTimeout(r, 300));
   return {
     name: item.name, weaponType: item.weaponType, mode: p.weaponMode,
     img: p.meleeImage ? p.meleeImage.src : null,
     weaponSpriteKey: sc && sc.weaponSprite ? sc.weaponSprite.texture.key : null,
     weaponVisible: sc && sc.weaponSprite ? sc.weaponSprite.visible : null,
     playerFlipX: sc && sc.playerSprite ? sc.playerSprite.flipX : null,
   };
})()`);
console.log('equipped:', JSON.stringify(eq));

await shot('m416_new_texture.png');

// 同屏再截一张持枪视角（玩家当前朝向）
await evalJs(`(async()=>{
  const G = window.Game;
  if (G.player && G.player._syncWeaponVisual) G.player._syncWeaponVisual();
  return true;
})()`);
await shot('m416_new_hold.png');

ws.close();
edge.kill();
console.log('done');
