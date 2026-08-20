#!/usr/bin/env node
/* 楼梯/研究院/复杂建筑阴影实机审计（2026-08-19 用户报：研究院异常、楼梯碎裂、时显时不显）：
 * 生成 研究院+仓库+两条楼梯+方块墙+基地核心，全天 10 个相位逐相普查
 * （每相：各目标多边形点数/透明度/层可见性），每相截图。
 * 用法（安全入口）：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-shadow-stair-dump.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9256;
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
};

// 进游戏（scene8 为默认落点；不主动切场景避免触发整页刷新；HMR 重载会毁掉 eval，重试）
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
if (!String(entered).startsWith('in')) { console.error('无法进入游戏'); await cleanup(1); }

// 生成目标集群
console.log('spawn:', await ev(`(async () => {
  if (!window.Game || !window.Game.player) return 'no-player';
  const { ProducerBuilding } = await import('/src/world/producer-building-system.js');
  const { WallStaircase, DefenseBase, DefenseCover } = await import('/src/world/defense-system.js');
  const p = window.Game.player;
  const bx = p.x - 500, by = p.y - 420;
  const made = [];
  const put = (k, e) => { window.Game.entities.set(e.id, e); made.push(k); };
  try { put('research_institute', new ProducerBuilding(bx, by, { id: 'audit_ri', cfgKey: 'research_institute' })); } catch (e) { made.push('ri:ERR:' + e.message); }
  try { put('warehouse', new ProducerBuilding(bx + 420, by, { id: 'audit_wh', cfgKey: 'warehouse' })); } catch (e) { made.push('wh:ERR:' + e.message); }
  try { put('warehouse2', new ProducerBuilding(bx + 560, by + 300, { id: 'audit_wh2', cfgKey: 'warehouse' })); } catch (e) { made.push('wh2:ERR:' + e.message); }
  try { put('stair_e2', new WallStaircase(bx + 840, by, { id: 'audit_stair_e2', dir: 'e2', ascendingSign: 1, segmentCount: 3, groundZ: 0, targetTopZ: 187.5 })); } catch (e) { made.push('stair_e2:ERR:' + e.message); }
  try { put('stair_e1', new WallStaircase(bx + 1260, by, { id: 'audit_stair_e1', dir: 'e1', ascendingSign: 1, segmentCount: 3, groundZ: 0, targetTopZ: 187.5 })); } catch (e) { made.push('stair_e1:ERR:' + e.message); }
  try { put('defense_base', new DefenseBase(bx + 300, by + 500, { id: 'audit_base' })); } catch (e) { made.push('base:ERR:' + e.message); }
  // 一排 4 块方块墙（横排沿 e1 方向步进 (64,32)）
  for (let i = 0; i < 4; i++) {
    try { put('block' + i, new DefenseCover(bx + 900 + i * 64, by + 460 + i * 32, { id: 'audit_block' + i, block: true, grade: 'C', orient: 'v' })); } catch (e) { made.push('block' + i + ':ERR:' + e.message); }
  }
  window.__auditVantage = { x: bx + 620, y: by + 260 };
  return JSON.stringify(made);
})()`));
const spawnResult = await ev(`window.__auditVantage ? 'ok' : 'missing'`);
if (spawnResult !== 'ok') { console.error('生成失败（no-player）'); await cleanup(1); }
await new Promise((r) => setTimeout(r, 2000));

const CENSUS = `JSON.stringify((() => {
  const scene = window.__phaserScene;
  const els = window.EnvironmentLightingSystem;
  const layer = scene._structureShadowLayer;
  const out = { phase: els.getSun()?.phase, daylight: +(els.getSun()?.daylight || 0).toFixed(3),
    layerVisible: layer?.visible, layerAlpha: +(layer?.alpha || 0).toFixed(3),
    jobs: scene._structureShadowJobs?.length ?? -1, targets: {} };
  for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
    const eid = String(data.entity?.id || '');
    if (!eid.startsWith('audit_')) continue;
    const prof = els.getStaticShadow(data);
    out.targets[eid] = {
      poly: data._polyState?.points?.length ?? 0,
      visible: sprite.visible, dataVisible: data.visible !== false,
      opacity: prof ? +prof.opacity.toFixed(3) : null,
      length: prof ? +prof.length.toFixed(1) : null,
      sil: !!data._silCache,
      tex: data.sourceSprite?.texture?.key || '',
    };
  }
  return out;
})())`;

const PHASES = [0.125, 0.438];
const rows = [];
for (const ph of PHASES) {
    await ev(`window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: ${ph} }); 'p${ph}'`);
    await ev(`(() => { const v = window.__auditVantage; if (v) { window.Game.player.x = v.x; window.Game.player.y = v.y; } return 1; })()`);
    await new Promise((r) => setTimeout(r, 450));
    const row = JSON.parse(await ev(CENSUS));
    rows.push(row);
    const t = Object.entries(row.targets).map(([k, v]) => `${k.replace('audit_', '')}:${v.poly}pt/${v.opacity}`).join(' ');
    console.log(`phase=${ph} daylight=${row.daylight} layer=${row.layerVisible}/${row.layerAlpha} jobs=${row.jobs} | ${t}`);
    await shot(`_stairaudit_p${String(ph).replace('.', '_')}.png`);
}
fs.writeFileSync(`${OUT_DIR}/_stairaudit.json`, JSON.stringify(rows, null, 1));
await cleanup(0);
