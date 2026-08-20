#!/usr/bin/env node
/* 阴影贴合实机审计（2026-08-19 "换个思路"排查 v2）：
 * 新档没有已建建筑，直接通过 ProducerBuilding 构造器在基地旁生成全部目标建筑，
 * 导出运行时真实数据（精灵显示尺寸/footY/剪影缓存/最终多边形 _polyState）+ 截图。
 * 用法（安全入口）：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-shadow-fit-dump.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9255;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise((r) => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise((r) => setTimeout(r, 700)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080',
    '--no-first-run', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 7000));

const fetchJson = async (u) => (await fetch(u)).json();
let page = null;
for (let i = 0; i < 40; i++) {
    try { const l = await fetchJson(`${CDP}/json/list`); page = l.find((t) => t.type === 'page' && t.url.includes('5173')); if (page) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
}
if (!page) { console.error('no page'); await cleanup(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (file) => {
    const d = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${file}`, Buffer.from(d.result.data, 'base64'));
    console.log('shot:', file);
};

// 进游戏
console.log('enter:', await ev(`(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
})()`));

// 切 122 基地场景（window.SceneManager 全局已在 main.js 暴露，不要动态 import 裸 URL）
console.log('scene:', await ev(`(async () => {
  for (let i = 0; i < 90; i++) {
    const SM = window.SceneManager;
    if (window.Game && window.Game.player && window.__phaserScene && SM) {
      if (SM.currentScene === 'scene8') return 'scene8';
      if (!window.__switching) {
        window.__switching = true;
        Promise.resolve(SM.switchScene('scene8', window.Game.player, 'explore'))
          .catch(() => {}).finally(() => { window.__switching = false; });
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout:' + String(window.SceneManager && window.SceneManager.currentScene);
})()`));
await new Promise((r) => setTimeout(r, 2500));
// 场景切换后 player 可能尚未重建，再等一轮就绪
console.log('ready:', await ev(`(async () => {
  for (let i = 0; i < 40; i++) {
    if (window.Game && window.Game.player && window.__phaserScene) return 'ok';
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'not-ready';
})()`));

// 在玩家附近生成全部目标建筑（两排，间距 420）
console.log('spawn:', await ev(`(async () => {
  if (!window.Game || !window.Game.player) return 'no-player';
  const { ProducerBuilding } = await import('/src/world/producer-building-system.js');
  const { HamsterBarracks, HamsterBarracksSystem } = await import('/src/world/hamster-barracks-system.js');
  const minerMod = null;
  const keys = ['warehouse', 'church', 'blacksmith', 'shooting_range', 'thatch_hut',
    'cavalry_school', 'research_institute'];
  const p = window.Game.player;
  const bx = p.x - 900, by = p.y - 500;
  const made = [];
  keys.forEach((k, i) => {
    try {
      const x = bx + (i % 4) * 420;
      const y = by + Math.floor(i / 4) * 420;
      const b = new ProducerBuilding(x, y, { id: 'audit_' + k, cfgKey: k });
      window.Game.entities.set(b.id, b);
      made.push(k);
    } catch (e) { made.push(k + ':ERR:' + String(e.message || e)); }
  });
  try {
    const b = new HamsterBarracks(bx + 3 * 420, by + 420, { id: 'audit_barracks' });
    window.Game.entities.set(b.id, b);
    if (HamsterBarracksSystem?.barracks) HamsterBarracksSystem.barracks.push(b);
    made.push('barracks');
  } catch (e) { made.push('barracks:ERR:' + String(e.message || e)); }
  try {
    const { HamsterHut } = await import('/src/world/hamster-hut-system.js');
    const m = new HamsterHut(bx, by + 840, { id: 'audit_mine' });
    window.Game.entities.set(m.id, m);
    made.push('mine');
  } catch (e) { made.push('mine:ERR:' + String(e.message || e)); }
  made.push('defense_base_present:' + !!window.Game.entities.get('defense_base'));
  return JSON.stringify(made);
})()`));
await new Promise((r) => setTimeout(r, 2000));

// 固定太阳：上午 09:00（phase 0.125，阴影朝右下）
await ev(`window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.125 }); 'sun-fixed'`);
// 相机对准建筑群
await ev(`(async () => {
  const scene = window.__phaserScene;
  const p = window.Game.player;
  scene.cameras.main.centerOn(p.x - 100, p.y - 200);
  return 'cam';
})()`);
await new Promise((r) => setTimeout(r, 1200));

const dump = await ev(`JSON.stringify((() => {
  const scene = window.__phaserScene;
  const els = window.EnvironmentLightingSystem;
  const out = { sun: els.getSun(), items: [] };
  for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
    if (!data.hull || !data.entity) continue;
    const eid = String(data.entity.id || '');
    if (!eid.startsWith('audit_') && eid !== 'defense_base') continue;
    const sp = data.sourceSprite;
    const sil = data._silCache || null;
    const prof = els.getStaticShadow(data);
    out.items.push({
      id: data.entity.id, key: sp?.texture?.key || '', flipX: !!data.flipX,
      sprite: sp ? { x: sp.x, y: sp.y, dw: sp.displayWidth, dh: sp.displayHeight,
        cw: sp.frame?.cutWidth, ch: sp.frame?.cutHeight, flipX: sp.flipX } : null,
      footY: sp ? scene._getFootOffsetY(data.entity, sp) : null,
      entityXY: { x: data.entity.x, y: data.entity.y },
      height: data.height, maxOffset: data.maxOffset,
      footprintVertices: data.footprintVertices || null,
      profile: prof ? { offsetX: prof.offsetX, offsetY: prof.offsetY, length: prof.length, opacity: prof.opacity } : null,
      poly: data._polyState?.points || null,
      sil: sil ? { scaleX: sil.scaleX, scaleY: sil.scaleY, anchorX: sil.anchorX, anchorY: sil.anchorY,
        frontX: sil.frontX, frontY: sil.frontY, texCenterX: sil.texCenterX,
        measuredHeight: sil.measuredHeight, flipMirrored: sil.flipMirrored,
        bodyVertices: sil.bodyVertices || null } : null,
    });
  }
  return out;
})())`);
fs.writeFileSync(`${OUT_DIR}/_fitdump.json`, dump);
const parsed = JSON.parse(dump);
for (const it of parsed.items) {
    console.log(`${it.id}: tex=${it.key} sp=(${it.sprite?.x.toFixed(0)},${it.sprite?.y.toFixed(0)}) dw/dh=${it.sprite?.dw.toFixed(0)}x${it.sprite?.dh.toFixed(0)} footY=${it.footY} sil=${it.sil ? `mh=${it.sil.measuredHeight.toFixed(1)} anchor=(${it.sil.anchorX.toFixed(0)},${it.sil.anchorY.toFixed(0)})` : 'null'} poly=${it.poly?.length ?? 0}pt`);
}
// 逐建筑对准截图（相机每帧钉玩家坐标——直接把玩家传送到建筑旁）
for (const it of parsed.items) {
    if (!it.sil) continue;
    await ev(`(() => { const p = window.Game.player; p.x = ${it.sil.anchorX} + 150; p.y = ${it.sil.anchorY} + 80; return 1; })()`);
    await new Promise((r) => setTimeout(r, 500));
    await shot(`_liveshot_${it.id}.png`);
}
await shot('_fit_spawned_0900.png');
await cleanup(0);
