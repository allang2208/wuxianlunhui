#!/usr/bin/env node
/* 楼梯阴影精查：生成 1 条 3 段楼梯，导出实体/分段/精灵/阴影锚点/多边形全量真值。
 * 用法（安全入口）：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-shadow-stair-probe.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9257;
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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
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

let entered = 'timeout';
for (let attempt = 0; attempt < 4 && !String(entered).startsWith('in'); attempt++) {
    entered = await ev(`(async () => {
      for (let i = 0; i < 90; i++) {
        if (window.Game && window.Game.player && window.__phaserScene) return 'in:' + (window.SceneManager?.currentScene || '?');
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') { b.click(); }
        await new Promise((r) => setTimeout(r, 500));
      }
      return 'timeout';
    })()`).catch(() => 'eval-lost');
    if (!String(entered).startsWith('in')) await new Promise((r) => setTimeout(r, 3000));
}
console.log('enter:', entered);

console.log('spawn:', await ev(`(async () => {
  const { WallStaircase } = await import('/src/world/defense-system.js');
  const p = window.Game.player;
  const stair = new WallStaircase(p.x + 260, p.y - 120, { id: 'audit_stair', dir: 'e2', ascendingSign: 1, segmentCount: 3, groundZ: 0, targetTopZ: 187.5 });
  window.Game.entities.set(stair.id, stair);
  window.__auditVantage = { x: p.x + 260, y: p.y - 60 };
  return 'ok';
})()`));
await new Promise((r) => setTimeout(r, 2000));

await ev(`window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.125 }); 'sun'`);

const dump = await ev(`JSON.stringify((() => {
  const scene = window.__phaserScene;
  const e = window.Game.entities.get('audit_stair');
  const neutral = scene._neutralSprites?.get(e);
  const shadowEntry = scene._structureSunShadows?.get(e);
  const shadows = Array.isArray(shadowEntry) ? shadowEntry : (shadowEntry ? [shadowEntry] : []);
  const shadowDatas = shadows.map((sh) => scene._staticSunShadows?.get(sh)).filter(Boolean);
  const data = shadowDatas[0] || null;
  return {
    entity: e ? { x: e.x, y: e.y, dir: e.dir, sign: e.ascendingSign,
      segments: (e.segments || []).map((s) => ({ x: s.x, y: s.y, baseZ: s.baseZ, topZ: s.topZ })),
      visualSegments: (e.visualSegments || []).map((v) => ({ x: v.x, y: v.y, tex: v.texture, dw: v.displayWidth, dh: v.displayHeight })),
    } : null,
    segmentSprites: (neutral?.segmentSprites || []).map((sp) => ({ x: sp.x, y: sp.y, tex: sp.texture?.key, dw: sp.displayWidth, dh: sp.displayHeight, visible: sp.visible })),
    shadowCount: shadowDatas.length,
    shadows: shadowDatas.map((d2) => ({
      x: d2.x, y: d2.y, height: d2.height, maxOffset: d2.maxOffset,
      sourceTex: d2.sourceSprite?.texture?.key,
      sourceXY: d2.sourceSprite ? { x: d2.sourceSprite.x, y: d2.sourceSprite.y } : null,
      sil: d2._silCache ? { anchorX: d2._silCache.anchorX, anchorY: d2._silCache.anchorY,
        frontX: d2._silCache.frontX, frontY: d2._silCache.frontY,
        scaleX: d2._silCache.scaleX, scaleY: d2._silCache.scaleY,
        measuredHeight: d2._silCache.measuredHeight } : null,
      poly: d2._polyState?.points || null,
    })),
    shadow: data ? {
      x: data.x, y: data.y, height: data.height, maxOffset: data.maxOffset,
      sil: data._silCache ? { anchorX: data._silCache.anchorX, anchorY: data._silCache.anchorY,
        measuredHeight: data._silCache.measuredHeight } : null,
      poly: data._polyState?.points || null,
      sourceTex: data.sourceSprite?.texture?.key,
    } : null,
    camera: { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY, zoom: scene.cameras.main.zoom },
    player: { x: window.Game.player.x, y: window.Game.player.y },
  };
})())`);
fs.writeFileSync(`${OUT_DIR}/_stairprobe.json`, JSON.stringify(JSON.parse(dump), null, 1));
const d = JSON.parse(dump);
console.log('entity:', JSON.stringify(d.entity?.segments));
console.log('sprites:', JSON.stringify(d.segmentSprites));
console.log('shadow anchor:', JSON.stringify(d.shadow?.sil ? { ax: d.shadow.sil.anchorX, ay: d.shadow.sil.anchorY, mh: d.shadow.sil.measuredHeight } : null));
console.log('sourceTex:', d.shadow?.sourceTex, 'poly pts:', d.shadow?.poly?.length);

await ev(`(() => { const v = window.__auditVantage; window.Game.player.x = v.x; window.Game.player.y = v.y; return 1; })()`);
await new Promise((r) => setTimeout(r, 500));
await shot('_stairprobe_0900.png');
await cleanup(0);
