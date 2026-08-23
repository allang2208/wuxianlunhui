#!/usr/bin/env node
/* 圣辉领域/圣光审判实机验证探针（2026-08-23）：
 * A. 圣辉领域：激活→领域 FX→僵尸每跳受伤（×2.5）→玩家回血→净化中毒
 * B. 圣光审判：无法杖拦截→蓄力不足失败（不进 CD/返还 MP）→满蓄落柱（僵尸受伤+低血净化）
 * 用法：node tools/cdp-holy-magic-verify.mjs（需 vite dev server 在 5173）
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
        pageExceptions.push((d.exception?.description || d.text || '').slice(0, 300));
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

// ========== A. 圣辉领域 ==========
console.log('--- A. 圣辉领域 ---');
const a1 = await ev(`(async () => {
  const G = window.Game; const p = G.player;
  G._devNoSkillCost = true;
  const q = (performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js')) || '').replace(/^.*\\/src\\/world\\/scene-manager\\.js/, '');
  const { MinerZombie } = await import('/src/entities/enemy-types.js' + q);
  const z = new MinerZombie(p.x + 100, p.y);
  z.id = 'probe_zombie_1';
  G.entities.set(z.id, z);
  window.__probeZombie = z;
  // 玩家扣血 + 上毒，验证治疗与净化
  p.data.hp = Math.max(1, p.data.hp - 200);
  p.addStatusEffect('poison', 30000);
  const hp0 = p.data.hp;
  const zhp0 = z.hp;
  p.sanctuaryDomainSystem.trigger();
  await new Promise(r => setTimeout(r, 600));
  const activeMid = p._sanctuaryDomainActive === true;
  await new Promise(r => setTimeout(r, 2600));
  return JSON.stringify({
    activeMid,
    activeAfter: p._sanctuaryDomainActive === true,
    playerHealed: p.data.hp > hp0, hp0, hp1: p.data.hp,
    poisonCleansed: !p.hasStatusEffect('poison'),
    zombieHurt: z.hp < zhp0, zhp0, zhp1: z.hp,
  });
})()`);
console.log('A:', a1);

// ========== B. 圣光审判 ==========
console.log('--- B. 圣光审判 ---');
const b1 = await ev(`(async () => {
  const G = window.Game; const p = G.player;
  const __url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js')) || ''; const __qi = __url.indexOf('?'); const q = __qi >= 0 ? __url.slice(__qi) : '';
  // B1 无法杖拦截（关掉测试开关）
  G._devNoSkillCost = false;
  p.holyJudgmentSystem.trigger();
  const blockedNoStaff = !p.holyJudgmentSystem.isCharging();
  // B2 蓄力不足失败：带法杖（挂一个最小法杖对象过门禁）
  const wm = p.weaponMode;
  const savedWpn = p.equipments[wm];
  p.equipments[wm] = { weaponType: 'staff', name: '探针法杖' };
  const mp0 = p.data.mp;
  p.holyJudgmentSystem.trigger();
  await new Promise(r => setTimeout(r, 700)); // 施法前摇后进入蓄力
  const charging = p.holyJudgmentSystem.isCharging();
  p.holyJudgmentSystem.release(); // 立即松开：不足 0.5s → 失败
  await new Promise(r => setTimeout(r, 300));
  const cdAfterFail = p._holyJudgmentCooldown;
  const mpRefunded = p.data.mp >= mp0;
  // B3 满蓄落柱：新僵尸放身前 200px（A 段那只已被领域打死）
  const { MinerZombie } = await import('/src/entities/enemy-types.js' + q);
  const z1 = new MinerZombie(p.x + 200, p.y);
  z1.id = 'probe_zb1'; G.entities.set(z1.id, z1);
  const { Renderer } = await import('/src/world/renderer.js' + q);
  const { Input } = await import('/src/ui/input.js' + q);
  let sp = Renderer.worldToScreen(z1.x, z1.y);
  Input.mouse.x = sp.x; Input.mouse.y = sp.y; // 玩家路径用鼠标选点
  p.holyJudgmentSystem.trigger();
  await new Promise(r => setTimeout(r, 700));
  const charging2 = p.holyJudgmentSystem.isCharging();
  await new Promise(r => setTimeout(r, 2900)); // 满蓄自动落柱
  const fired = !p.holyJudgmentSystem.isCharging();
  const zombieDead = z1.hp <= 0 || z1._dying === true;
  const cdAfterFire = Math.round(p._holyJudgmentCooldown);
  // B4 净化斩杀鉴别：maxHp 放大到 10000，血量 = 实测伤害×1.05 → 伤害后残血 ≤ 阈值 → 净化才致死
  G._devNoSkillCost = true; // 绕 CD 立刻二次释放
  const z2 = new MinerZombie(p.x + 200, p.y);
  z2.id = 'probe_zb2'; G.entities.set(z2.id, z2);
  const z2max = 10000; if (z2.data) { z2.data.maxHp = z2max; }
  z2.maxHp = z2max; z2.hp = z2max; if (z2.data) z2.data.hp = z2max;
  sp = Renderer.worldToScreen(z2.x, z2.y);
  Input.mouse.x = sp.x; Input.mouse.y = sp.y;
  p.holyJudgmentSystem.trigger();
  await new Promise(r => setTimeout(r, 3400));
  const dmgDealt = z2max - z2.hp;
  const z3 = new MinerZombie(p.x + 200, p.y);
  z3.id = 'probe_zb3'; G.entities.set(z3.id, z3);
  z3.maxHp = z2max; if (z3.data) z3.data.maxHp = z2max;
  z3.hp = Math.ceil(dmgDealt * 1.05); if (z3.data) z3.data.hp = z3.hp;
  sp = Renderer.worldToScreen(z3.x, z3.y);
  Input.mouse.x = sp.x; Input.mouse.y = sp.y;
  p.holyJudgmentSystem.trigger();
  await new Promise(r => setTimeout(r, 3400));
  const purifyKilled = z3.hp <= 0 || z3._dying === true;
  const z3wouldSurviveDamage = dmgDealt < Math.ceil(dmgDealt * 1.05); // 纯伤害必然打不死 → 死即净化
  p.equipments[wm] = savedWpn;
  return JSON.stringify({ blockedNoStaff, charging, failCd: cdAfterFail, mpRefunded, charging2, fired, zombieDead, cdAfterFire, dmgDealt, purifyKilled, z3wouldSurviveDamage });
})()`);
console.log('B:', b1);

console.log('page exceptions:', JSON.stringify(pageExceptions.slice(0, 4)));
await cleanup(0);
