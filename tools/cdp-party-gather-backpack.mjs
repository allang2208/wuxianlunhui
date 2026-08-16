#!/usr/bin/env node
/* 队友采集直接入包实机探针（2026-08-16）：
 * - 露娜/伊莉丝 gather → 攻击镜像能源点（伤害×50% → source.addMinedEnergy，与真实节点同分支）
 * - 验证：队友背包直接出现能源堆；地面无 energy 掉落实体
 * 用法：node tools/cdp-party-gather-backpack.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9371;
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

async function runMember(memberId, label) {
    return ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const { PartySystem } = window.Game;
      for (const id of ['mage_luna', 'warrior_bruno']) {
        if (PartySystem.getMember(id)) PartySystem.removeCompanion(id);
      }
      PartySystem._roster = {};
      PartySystem.addCompanion('${memberId}');
      let t0 = Date.now();
      while (!PartySystem._aiInstances['${memberId}'] && Date.now() - t0 < 5000) await sleep(100);
      const m = PartySystem.getMember('${memberId}');
      const p = window.Game.player;
      // 敌人屏蔽器
      window.__auditBlocker = setInterval(() => {
        for (const [k, e] of Array.from(window.Game.entities.entries())) {
          if (e && e._faction === 'enemy') window.Game.entities.delete(k);
        }
      }, 250);
      // 清理旧节点/掉落
      for (const [k, e] of Array.from(window.Game.entities.entries())) {
        if (e && (e._isEnergyNode || (e.itemData && e.itemData.category === 'energy'))) window.Game.entities.delete(k);
      }
      m.backpack = m.backpack.filter(b => b.category !== 'energy');
      m._command = null; m._tacticalTarget = null; m.target = null;
      m._frozenForCast = false; m._castState = 'idle'; m._basicAtkCd = 0;
      m.x = p.x - 100; m.y = p.y;
      const ai = PartySystem._aiInstances['${memberId}'];
      if (ai) { ai._initPos = true; ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._gatherPhase = 'work'; ai._patrolTarget = null; }
      // 镜像真实能源节点（伤害×50% → addMinedEnergy 直接入包；无 addMinedEnergy 才落地）
      const node = {
        id: 'mirror_node', active: true, _isEnergyNode: true, _depleted: false,
        x: p.x + 260, y: p.y + 10, hp: 3000, maxHp: 3000,
        groundRadius: 24, bodyHeight: 130, _faction: 'neutral', immovable: true,
        takeDamage(dmg, source) {
          if (this._depleted) return 0;
          if (source && source._faction === 'enemy') return 0;
          const before = this.hp;
          this.hp = Math.max(0, this.hp - dmg);
          const dealt = before - this.hp;
          if (dealt <= 0) return dealt;
          const energy = Math.floor(dealt * 0.5);
          if (energy > 0) {
            if (source && typeof source.addMinedEnergy === 'function') {
              source.addMinedEnergy(energy);
            } else {
              window.Game.entities.set('ground_energy_' + Math.random().toString(36).slice(2, 8), {
                id: 'ground_energy', active: true, itemData: { category: 'energy', stack: energy },
                x: this.x, y: this.y, update() {},
              });
            }
          }
          return dealt;
        },
        update() {},
      };
      window.Game.entities.set('mirror_node', node);
      await sleep(300);
      PartySystem.setSelected(['${memberId}']);
      const w = window.Game.CompanionCommandWheel;
      w._resolveTargets(false);
      w._worldPoint = { x: p.x + 260, y: p.y + 10 };
      w._execute('gather');
      const out = [];
      for (let i = 0; i < 45; i++) {
        await sleep(100);
        const energyTotal = (m.backpack || []).filter(b => b.category === 'energy').reduce((s, b) => s + (b.stack || 0), 0);
        out.push({ dist: Math.round(Math.hypot(m.x - node.x, m.y - node.y)), nodeHp: node.hp, energyTotal });
      }
      clearInterval(window.__auditBlocker);
      window.Game.entities.delete('mirror_node');
      const groundDrops = Array.from(window.Game.entities.values())
        .filter(e => e && e.itemData && e.itemData.category === 'energy').length;
      for (const [k, e] of Array.from(window.Game.entities.entries())) {
        if (e && e.itemData && e.itemData.category === 'energy') window.Game.entities.delete(k);
      }
      const final = (m.backpack || []).filter(b => b.category === 'energy');
      return {
        label: '${label}',
        nodeHpDelta: 3000 - node.hp,
        backpackEnergyStacks: final.length,
        backpackEnergyTotal: final.reduce((s, b) => s + (b.stack || 0), 0),
        groundDrops,
        minDist: Math.min(...out.map(s => s.dist)),
        sawAttack: out.some(s => s.dist < 140),
      };
    })()`);
}

console.log('露娜采集入包:', JSON.stringify(await runMember('mage_luna', '露娜')));
console.log('伊莉丝采集入包:', JSON.stringify(await runMember('warrior_bruno', '伊莉丝')));
console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);
await cleanup(0);
