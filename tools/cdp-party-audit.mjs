#!/usr/bin/env node
/* 队友指令全量审计（2026-08-16）：
 * 场景 = {露娜, 伊莉丝} × {新招募, 档案恢复} × 5 指令 {hold, follow, patrol, aggressive, gather}
 * 每个用例：
 *   - 重置成员状态/位置，起敌人屏蔽器（删非 _auditEnemy 的敌人，防主城野怪干扰）
 *   - 按指令注入对象：aggressive→假敌人，gather→假能源点
 *   - 走真实轮盘路径（resolveTargets + execute）
 *   - 采样 3.5s，按各指令语义判定 PASS/FAIL
 * 用法：node tools/cdp-party-audit.mjs（需 vite dev server 在 5173）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9361;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 800)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 9000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
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
    } catch (err) { console.log('boot retry', attempt, err.message.slice(0, 80)); await sleep(2000); }
}
if (bootOk !== 'ready') { console.error('boot failed'); await cleanup(1); }
console.log('boot: ready');

const scenarios = [
    { label: '露娜·新招募', memberId: 'mage_luna', fresh: true },
    { label: '伊莉丝·新招募', memberId: 'warrior_bruno', fresh: true },
    { label: '露娜·档案恢复', memberId: 'mage_luna', fresh: false },
    { label: '伊莉丝·档案恢复', memberId: 'warrior_bruno', fresh: false },
];
const modes = ['hold', 'follow', 'patrol', 'aggressive', 'gather'];

/** 场景准备：确保目标成员在场（fresh=清档案后新招募；否则走解散再招募=档案恢复） */
async function setupScenario(sc) {
    const r = await ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const { PartySystem } = window.Game;
      for (const id of ['mage_luna', 'warrior_bruno']) {
        if (PartySystem.getMember(id)) PartySystem.removeCompanion(id);
      }
      if (${sc.fresh}) PartySystem._roster = {};
      // 先加一次（档案恢复场景：先建档案再解散再招募）
      PartySystem.addCompanion('${sc.memberId}');
      if (!${sc.fresh}) {
        PartySystem.removeCompanion('${sc.memberId}');
        PartySystem.addCompanion('${sc.memberId}');
      }
      // 等 AI 实例就绪
      let t0 = Date.now();
      while (!PartySystem._aiInstances['${sc.memberId}'] && Date.now() - t0 < 5000) await sleep(100);
      const m = PartySystem.getMember('${sc.memberId}');
      return {
        aiReady: !!PartySystem._aiInstances['${sc.memberId}'],
        aiRole: PartySystem._aiInstances['${sc.memberId}'] ? PartySystem._aiInstances['${sc.memberId}'].cfg.role : null,
        memberAiConfig: !!m.aiConfig,
        roster: !!PartySystem._roster['${sc.memberId}'],
      };
    })()`);
    return r;
}

/** 单用例：重置 + 注入 + 指令 + 采样 */
async function runCase(sc, mode) {
    const r = await ev(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const { PartySystem } = window.Game;
      const p = window.Game.player;
      const m = PartySystem.getMember('${sc.memberId}');
      const ai = PartySystem._aiInstances['${sc.memberId}'];
      // 清理旧测试对象
      for (const [k, e] of Array.from(window.Game.entities.entries())) {
        if (e && (e._isEnergyNode || e._auditEnemy)) window.Game.entities.delete(k);
      }
      // 重置成员（防 AI 传送干扰：_initPos 置 true）
      const startX = '${mode}' === 'follow' ? p.x + 250 : p.x - 100;
      m._command = null; m._tacticalTarget = null; m.target = null;
      m._frozenForCast = false; m._castState = 'idle'; m._basicAtkCd = 0;
      m.x = startX; m.y = p.y;
      if (ai) {
        ai._initPos = true; ai._followCache = null;
        ai._meleeAtkTimer = 0; ai._defendPhase = null; ai._defendCd = 0;
        ai._whirlwindHitSet = null; ai._patrolTarget = null; ai._gatherPhase = 'work';
      }
      // 敌人屏蔽器：删非审计敌人（主城野怪会随时间刷出）
      window.__auditBlocker = setInterval(() => {
        for (const [k, e] of Array.from(window.Game.entities.entries())) {
          if (e && e._faction === 'enemy' && !e._auditEnemy) window.Game.entities.delete(k);
        }
      }, 250);
      // 注入场景对象
      let enemy = null, node = null;
      if ('${mode}' === 'aggressive') {
        enemy = {
          id: 'audit_enemy', active: true, _auditEnemy: true,
          x: p.x + 280, y: p.y, vx: 0, vy: 0,
          hp: 5000, maxHp: 5000, groundRadius: 20, bodyHeight: 130,
          attackRange: 70, attacks: { melee: {} }, _faction: 'enemy',
          takeDamage(d) { this.hp -= d; return d; }, update() {},
        };
        window.Game.entities.set('audit_enemy', enemy);
      } else if ('${mode}' === 'gather') {
        node = {
          id: 'audit_node', active: true, _isEnergyNode: true, _depleted: false,
          x: p.x + 260, y: p.y + 10, hp: 3000, maxHp: 3000,
          groundRadius: 24, bodyHeight: 130, _faction: 'neutral', immovable: true,
          takeDamage(d) { this.hp -= d; return d; }, update() {},
        };
        window.Game.entities.set('audit_node', node);
      }
      await sleep(300);
      // 真实轮盘路径
      PartySystem.setSelected(['${sc.memberId}']);
      const w = window.Game.CompanionCommandWheel;
      w._resolveTargets(false);
      w._worldPoint = { x: p.x + 260, y: p.y + 10 };
      const n = w._execute('${mode}');
      const cmd = m._command && m._command.mode;
      // 采样
      const out = [];
      for (let i = 0; i < 35; i++) {
        await sleep(100);
        out.push({
          anim: m._animState, last: m._lastAction,
          pos: [Math.round(m.x), Math.round(m.y)],
          frozen: m._frozenForCast, target: m.target ? m.target.id : null,
          enemyDist: enemy ? Math.round(Math.hypot(m.x - enemy.x, m.y - enemy.y)) : null,
          enemyHp: enemy ? enemy.hp : null,
          nodeDist: node ? Math.round(Math.hypot(m.x - node.x, m.y - node.y)) : null,
          nodeHp: node ? node.hp : null,
        });
      }
      clearInterval(window.__auditBlocker);
      window.Game.entities.delete('audit_enemy');
      window.Game.entities.delete('audit_node');
      const startPos = out[0].pos;
      const maxDelta = Math.max(...out.map(s => Math.hypot(s.pos[0] - startPos[0], s.pos[1] - startPos[1])));
      const distP0 = Math.hypot(startX - p.x, 0);
      const distP1 = Math.hypot(out[out.length - 1].pos[0] - p.x, out[out.length - 1].pos[1] - p.y);
      return {
        n, cmd,
        maxDelta: Math.round(maxDelta),
        playerDist: [Math.round(distP0), Math.round(distP1)],
        anims: [...new Set(out.map(s => s.anim))],
        minEnemyDist: enemy ? Math.min(...out.map(s => s.enemyDist)) : null,
        enemyHpDelta: enemy ? 5000 - enemy.hp : null,
        minNodeDist: node ? Math.min(...out.map(s => s.nodeDist)) : null,
        nodeHpDelta: node ? 3000 - node.hp : null,
        sawAttack: out.some(s => s.anim === 'attack' || s.anim === 'spell' || s.anim === 'windmill'),
        finalPos: out[out.length - 1].pos,
      };
    })()`);
    return r;
}

function verdict(mode, r) {
    if (r.cmd !== mode) return { ok: false, why: `cmd=${r.cmd}` };
    switch (mode) {
        case 'hold':
            return r.maxDelta <= 15 ? { ok: true, why: `位移≤15px` } : { ok: false, why: `位移 ${r.maxDelta}px（应站定）` };
        case 'follow':
            return (r.playerDist[1] < r.playerDist[0] - 20) ? { ok: true, why: `距玩家 ${r.playerDist[0]}→${r.playerDist[1]}px` } : { ok: false, why: `距玩家 ${r.playerDist[0]}→${r.playerDist[1]}px 未归队` };
        case 'patrol':
            return r.maxDelta > 20 ? { ok: true, why: `位移 ${r.maxDelta}px（圈内游走）` } : { ok: false, why: `位移 ${r.maxDelta}px 未移动` };
        case 'aggressive':
            return (r.enemyHpDelta > 0 || (r.minEnemyDist !== null && r.minEnemyDist < 120 && r.sawAttack))
                ? { ok: true, why: `敌掉血 ${r.enemyHpDelta} / 最近 ${r.minEnemyDist}px` }
                : { ok: false, why: `敌掉血 ${r.enemyHpDelta} / 最近 ${r.minEnemyDist}px 未接敌` };
        case 'gather':
            return r.nodeHpDelta > 0
                ? { ok: true, why: `节点掉血 ${r.nodeHpDelta} / 最近 ${r.minNodeDist}px` }
                : { ok: false, why: `节点掉血 0 / 最近 ${r.minNodeDist}px 未采集` };
        default:
            return { ok: false, why: '未知模式' };
    }
}

const results = [];
for (const sc of scenarios) {
    const setup = await setupScenario(sc);
    console.log(`\n== ${sc.label} ==`, JSON.stringify(setup));
    for (const mode of modes) {
        let r = null;
        try {
            r = await runCase(sc, mode);
        } catch (err) {
            console.log('  [case-error]', mode, err.message.slice(0, 120));
        }
        if (r === undefined || r === null) {
            results.push({ ...sc, mode, ok: false, why: '页面上下文丢失（eval 未返回）', metrics: null });
            console.log(`  FAIL  ${mode.padEnd(10)} 页面上下文丢失`);
        } else {
            const v = verdict(mode, r);
            results.push({ ...sc, mode, ok: v.ok, why: v.why, metrics: r });
            console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${mode.padEnd(10)} ${v.why}   anims=[${(r.anims || []).join(',')}]`);
        }
        if (pageExceptions.length) {
            console.log('   [page-exc]', pageExceptions.splice(0, pageExceptions.length).slice(0, 3).join(' | '));
        }
    }
}

console.log('\n===== 汇总 =====');
const fails = results.filter(r => !r.ok);
console.log(`${results.length - fails.length}/${results.length} 通过`);
if (fails.length) {
    console.log('失败项:');
    for (const f of fails) console.log(`  ${f.label} / ${f.mode}: ${f.why}`, JSON.stringify(f.metrics));
}
console.log('页面异常数:', pageExceptions.length);
if (pageExceptions.length) for (const e of pageExceptions.slice(0, 8)) console.log('  ', e);

await cleanup(fails.length ? 1 : 0);
