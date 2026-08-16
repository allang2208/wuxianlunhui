#!/usr/bin/env node
/* 伊莉丝动作音效实机探针（2026-08-16）：
 * - 复制文件存在性（Node 侧）
 * - 页面内 spy SoundManager.playWorld → 注入敌人触发攻击/防御
 * - 验证 attacking/defending 两个新音效路径被调用
 * 用法：node tools/cdp-elise-sound.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUND_FILES = [
    'assets/sounds/companions/elise/attacking.mp3',
    'assets/sounds/companions/elise/defending.mp3',
];
for (const f of SOUND_FILES) {
    console.log(`${fs.existsSync(path.join(ROOT, f)) ? 'OK ' : 'MISSING '} ${f}`);
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9375;
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

console.log('音效触发:', await ev(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { PartySystem } = window.Game;
  for (const id of ['mage_luna', 'warrior_bruno']) {
    if (PartySystem.getMember(id)) PartySystem.removeCompanion(id);
  }
  PartySystem._roster = {};
  PartySystem.addCompanion('warrior_bruno');
  let t0 = Date.now();
  while (!PartySystem._aiInstances['warrior_bruno'] && Date.now() - t0 < 5000) await sleep(100);
  const elise = PartySystem.getMember('warrior_bruno');
  const ai = PartySystem._aiInstances['warrior_bruno'];
  const p = window.Game.player;
  window.__auditBlocker = setInterval(() => {
    for (const [k, e] of Array.from(window.Game.entities.entries())) {
      if (e && e._faction === 'enemy' && !e._auditEnemy) window.Game.entities.delete(k);
    }
  }, 250);
  elise.x = p.x - 80; elise.y = p.y;
  elise._command = null; elise._tacticalTarget = null; elise.target = null;
  elise._frozenForCast = false; elise._castState = 'idle'; elise._basicAtkCd = 0;
  if (ai) { ai._initPos = true; ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0; ai._whirlwindHitSet = null; }
  // spy：覆盖 AI 实例的 _playSound（动态 import 会造平行模块实例，勿用）
  window.__soundCalls = [];
  const origPlaySound = ai._playSound.bind(ai);
  ai._playSound = function (key) {
    window.__soundCalls.push(key);
    return origPlaySound(key);
  };
  // 阶段1：1 个贴脸敌人 → 攻击
  const melee = { id: 'snd_melee', active: true, _auditEnemy: true, x: p.x + 60, y: p.y, vx: 0, vy: 0, hp: 9999, maxHp: 9999, groundRadius: 20, bodyHeight: 130, attackRange: 70, attacks: { melee: {} }, _faction: 'enemy', takeDamage(d) { this.hp -= d; }, update() {} };
  window.Game.entities.set('snd_melee', melee);
  await sleep(2500);
  window.Game.entities.delete('snd_melee');
  const attackCalls = window.__soundCalls.filter(s => s === 'attacking');
  // 阶段2：4 个贴脸敌人 → 防御
  // 4 敌放 250~380px：在防御范围 400 内、但风车范围（~205px）外 → 只触发防御
  for (let i = 0; i < 4; i++) {
    window.Game.entities.set('snd_def' + i, { id: 'snd_def' + i, active: true, _auditEnemy: true, x: p.x + 250 + i * 40, y: p.y + 20, vx: 0, vy: 0, hp: 9999, maxHp: 9999, groundRadius: 20, bodyHeight: 130, attackRange: 70, attacks: { melee: {} }, _faction: 'enemy', takeDamage(d) { this.hp -= d; }, update() {} });
  }
  await sleep(3500);
  for (let i = 0; i < 4; i++) window.Game.entities.delete('snd_def' + i);
  clearInterval(window.__auditBlocker);
  const defendCalls = window.__soundCalls.filter(s => s === 'defending');
  return {
    attackCalls: attackCalls.length,
    defendCalls: defendCalls.length,
    all: window.__soundCalls,
  };
})()`));

console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
