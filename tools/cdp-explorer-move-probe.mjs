#!/usr/bin/env node
/* 仓鼠探险家「原地小范围移动」实机探针（2026-08-23）：
 * - 无头 Edge 起新档 → scene8 → 直接生成探险家并下 explore 指令
 * - 每 2s 采样一次：AI 相位 / 目的地距离 / 速度 / maxSpeed / 路径与接力状态
 * - 60s 后汇总总位移与目的地分布，区分「目的地就近」vs「远目的地但走不动」
 * 用法：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-explorer-move-probe.mjs
 * （需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9399;
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

// 切目标场景并确认切换完成
const SCENE = process.argv[2] || 'scene8';
let sceneOk = null;
for (let i = 0; i < 15; i++) {
    sceneOk = await ev(`(async () => {
      const SCENE_ID = ${JSON.stringify('')} || '${SCENE}';
      try {
        const smUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js'));
        if (!smUrl) return 'no sm url yet';
        const { SceneManager } = await import(smUrl);
        window.__smUrl = smUrl;
        if (SceneManager.currentScene !== SCENE_ID) {
          try {
            const wpUrl = smUrl.replace('/src/world/scene-manager.js', '/src/world/world-progression-system.js');
            const { WorldProgressionSystem } = await import(wpUrl);
            const before = WorldProgressionSystem.isPortalConstructed(SCENE_ID);
            if (!before) {
              const ser = WorldProgressionSystem.serialize();
              ser.portals = ser.portals || {};
              if (ser.portals[SCENE_ID]) {
                ser.portals[SCENE_ID].status = 'ACTIVE';
                ser.portals[SCENE_ID].everConstructed = true;
                ser.portals[SCENE_ID].constructed = true;
                ser.portals[SCENE_ID].destroyed = false;
                ser.portals[SCENE_ID].hp = 5000;
                ser.portals[SCENE_ID].worldEpoch = Math.max(1, ser.portals[SCENE_ID].worldEpoch || 1);
              }
              WorldProgressionSystem.restore(ser);
              return 'keys=' + Object.keys(ser.portals).join(',') + ' state=' + JSON.stringify(WorldProgressionSystem.getPortalState(SCENE_ID));
            }
            const after = WorldProgressionSystem.isPortalConstructed(SCENE_ID);
            const r = await SceneManager.switchScene(SCENE_ID, window.Game.player, 'explore');
            return 'portal ' + before + '->' + after + ' switch=' + r + ' cur=' + SceneManager.currentScene;
          } catch (e2) { return 'WPERR:' + (e2 && e2.message || e2); }
        }
        return 'cur=' + SceneManager.currentScene;
      } catch (err) { return 'ERR:' + (err && err.message || err); }
    })()`).catch((e) => 'EVALERR:' + e.message.slice(0, 120));
    console.log('scene probe:', sceneOk);
    if (sceneOk && String(sceneOk).startsWith('cur=' + SCENE)) break;
    await sleep(1500);
}
if (!sceneOk || !String(sceneOk).startsWith('cur=' + SCENE)) { console.error('scene switch failed'); await cleanup(1); }
await sleep(2000);

const spawnInfo = await ev(`(async () => {
  const q = (window.__smUrl || '').replace(/^.*\\/src\\/world\\/scene-manager\\.js/, '');
  const { ProducerBuilding } = await import('/src/world/producer-building-system.js' + q);
  const { TechnologySystem } = await import('/src/world/technology-system.js' + q);
  // 探针环境直接放开科技门禁
  TechnologySystem.isUnlocked = () => true;
  const p = window.Game.player;
  const cx = p.x + 400, cy = p.y + 200;
  const camp = new ProducerBuilding(cx, cy, { cfgKey: 'explorer_camp' });
  window.Game.entities.set(camp.id, camp);
  window.__probeCamp = camp;
  // 用户在场景里的真实布局：营地周围一圈守夜烛台（每个 2x2 硬障碍）
  const R = 420;
  const candleIds = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const c = new ProducerBuilding(cx + Math.round(Math.cos(a) * R), cy + Math.round(Math.sin(a) * R * 0.5), { cfgKey: 'dungeon_candle' });
    window.Game.entities.set(c.id, c);
    candleIds.push(c.id);
  }
  window.__probeCandles = candleIds;
  const e = camp.spawnUnit();
  if (!e) return { err: 'spawnUnit returned null' };
  e._command = { mode: 'explore' };
  window.__probeExplorer = e;
  return { px: Math.round(p.x), py: Math.round(p.y), ex: Math.round(e.x), ey: Math.round(e.y),
    egress: e._spawnEgress ? [Math.round(e._spawnEgress.x), Math.round(e._spawnEgress.y)] : null,
    barracks: !!e._barracks, troop: !!e._troopProducer, cmd0: e._command && e._command.mode };
})()`);
console.log('spawn:', JSON.stringify(spawnInfo));

// 采样 90s（实体若被清掉则重生；页面瞬断时记录错误继续）
for (let t = 0; t <= 90; t += 2) {
    let s;
    try {
        s = await ev(`(async () => {
      if (!window.Game) return { nogame: true };
      let e = window.__probeExplorer;
      if (!e || e.active === false || !window.Game.entities.get(e.id)) {
        const camp = window.__probeCamp;
        if (!camp) return { nospawn: true };
        e = camp.spawnUnit();
        if (!e) return { spawnfail: true };
        e._command = { mode: 'explore' };
        window.__probeExplorer = e;
        return { respawn: true };
      }
      const ai = e._ai || {};
      const d = ai._destination;
      return {
        x: Math.round(e.x), y: Math.round(e.y),
        phase: ai._phase,
        anim: e._animState,
        egress: e._spawnEgress ? [Math.round(e._spawnEgress.x), Math.round(e._spawnEgress.y)] : null,
        dest: d ? Math.round(Math.hypot(d.x - e.x, d.y - e.y)) : null,
        destPt: d ? [Math.round(d.x), Math.round(d.y)] : null,
        spd: Math.round(Math.hypot(e.vx || 0, e.vy || 0)),
        maxSpd: Math.round(e.maxSpeed || 0),
        path: !!(e._pathManager && e._pathManager.hasValidPath && e._pathManager.hasValidPath()),
        relay: e._relayTarget ? [Math.round(e._relayTarget.x), Math.round(e._relayTarget.y)] : null,
        surfNav: e._surfaceNavDestination ? [Math.round(e._surfaceNavDestination.x), Math.round(e._surfaceNavDestination.y)] : null,
        surfCmd: !!e._surfaceNavCommand,
        stuck: Math.round(e._stuckTimer || 0),
      };
    })()`);
    } catch (err) {
        s = { evalErr: err.message.slice(0, 100) };
    }
    console.log(`t=${String(t).padStart(2)}s`, JSON.stringify(s));
    await sleep(2000);
}

console.log('page exceptions:', JSON.stringify(pageExceptions.slice(0, 5)));
await cleanup(0);
