#!/usr/bin/env node
/* 世界-122 防守模式 AI 索敌/寻路优化 实机 CDP 验证。
 * 验证矩阵：黑狼进场 / 僵尸绕门洞 / 堵门转火啃墙 / 墙背 LOS / 远程风筝 /
 * chargeStraight 直冲 / 骑士 aggro3800 / 索敌性能 / 控制台报错。
 * 用法：node tools/cdp-defense-ai-verify.mjs（需 vite dev server 已跑在 5173） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9237;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

// 临时 Edge profile 必须退出即清（C 盘爆过两次，SKILL.md 铁律）
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
process.on('exit', () => {
    try { if (edge) edge.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const consoleErrs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') consoleErrs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('  saved', `${OUT_DIR}/${name}.png`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');

// ---------- 启动游戏 + 进 scene8 ----------
let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await sleep(500);
}
for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        try {
            const { SceneManager } = await import('/src/world/scene-manager.js');
            window.__sm = SceneManager;
            return SceneManager.currentScene || null;
        } catch { return null; }
    })()`).catch(() => null);
    if (ok) break;
    await sleep(500);
}
await evalJs(`(async () => { await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);
let defenseActive = false;
for (let i = 0; i < 20 && !defenseActive; i++) {
    await sleep(600);
    defenseActive = await evalJs(`(async () => {
        const { DefenseSystem } = await import('/src/world/defense-system.js');
        return !!(DefenseSystem.active && DefenseSystem.base);
    })()`).catch(() => false);
}
console.log('defense active:', defenseActive);
if (!defenseActive) { console.error('scene8 defense not active, abort'); process.exit(1); }

// ---------- 页面侧探针辅助 ----------
await evalJs(`(() => {
    window.__v = {
        // 强制指定类型走真实 _spawnMonster 管线（验证 aggro 归一化等出生逻辑）
        async spawnForced(type) {
            const { DefenseSystem } = await import('/src/world/defense-system.js');
            const orig = DefenseSystem._pickMonsterType;
            DefenseSystem._pickMonsterType = () => type;
            const before = new Set([...window.Game.entities.keys()]);
            try { DefenseSystem._spawnMonster(1, null, 1); } finally { DefenseSystem._pickMonsterType = orig; }
            const id = [...window.Game.entities.keys()].find(k => !before.has(k));
            const m = window.Game.entities.get(id);
            return id ? { id, x: Math.round(m.x), y: Math.round(m.y), aggro: m._aggroRange, ai: m._aiState } : null;
        },
        teleport(id, x, y) { const m = window.Game.entities.get(id); if (m) { m.x = x; m.y = y; } return !!m; },
        snap(id) {
            const m = window.Game.entities.get(id);
            if (!m) return null;
            return { id: m.id, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, ai: m._aiState, aggro: m._aggroRange,
                stuck: Math.round(m._stuckTimer || 0), target: m.target ? m.target.id : null,
                relay: m._relayTarget ? [Math.round(m._relayTarget.x), Math.round(m._relayTarget.y)] : null,
                los: m._perception ? m._perception.hasLOS : null, active: m.active };
        },
        covers() {
            return [...window.Game.entities.values()].filter(e => e && e._isDefenseStructure && e.active && !e._isDefenseTower)
                .map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp, max: e.maxHp }));
        },
        coverHp(id) { const c = window.Game.entities.get(id); return c ? { hp: c.hp, max: c.maxHp, active: c.active } : null; },
        baseHp() { const b = window.Game.entities.get('defense_base'); return b ? b.hp : null; },
        async blockGate() {
            const { DefenseCover } = await import('/src/world/defense-system.js');
            const mk = (x, y, id) => { const c = new DefenseCover(x, y, { grade: 'A', orient: 'v', id }); window.Game.entities.set(id, c); return { id, x: Math.round(c.x), y: Math.round(c.y), hp: c.hp }; };
            return [mk(1086, 2211, 'probe_gate_a'), mk(1226, 2141, 'probe_gate_b')];
        },
        killDefenseMonsters() {
            let n = 0;
            for (const [k, e] of [...window.Game.entities.entries()]) {
                if (e && e._defenseMonster) {
                    try { e.active = false; if (e.removeFromCollision) e.removeFromCollision(); } catch {}
                    window.Game.entities.delete(k); n++;
                }
            }
            return n;
        },
        async naturalSpawn(on) {
            const { DefenseSystem } = await import('/src/world/defense-system.js');
            if (!on) { DefenseSystem._spawnTimer = 9e9; DefenseSystem._eliteTimer = 9e9; DefenseSystem._lordTimer = 9e9; }
            else { DefenseSystem._spawnTimer = 100; }
            return true;
        },
        movePlayer(x, y) { const p = window.Game.player; p.x = x; p.y = y; return true; },
        fpsSample(ms) {
            return new Promise(res => {
                let frames = 0; let updateMs = 0;
                const orig = window.Game.update.bind(window.Game);
                window.Game.update = (dt) => { const a = performance.now(); orig(dt); updateMs += performance.now() - a; };
                const t0 = performance.now();
                const tick = () => {
                    frames++;
                    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
                    else { window.Game.update = orig; res({ fps: Math.round(frames / ((performance.now() - t0) / 1000)), avgUpdateMs: +(updateMs / frames).toFixed(2), frames }); }
                };
                requestAnimationFrame(tick);
            });
        },
    };
    return true;
})()`);

const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const BASE = { x: 900, y: 2048 };
const GATE = { x: 1156, y: 2176 };

await evalJs(`window.__v.naturalSpawn(false)`);

// ========== 1. 黑狼：出生即朝基地推进，不原地踱步 ==========
console.log('--- P1 黑狼进场 ---');
{
    const w = await evalJs(`window.__v.spawnForced('blackWolf')`);
    console.log('  wolf spawned:', JSON.stringify(w));
    const samples = [];
    for (let i = 0; i < 27; i++) { await sleep(300); const s = await evalJs(`window.__v.snap('${w.id}')`); if (s) samples.push(s); }
    const last = samples[samples.length - 1];
    const sawChasing = samples.some(s => s.ai === 'chasing');
    const approach = dist(w, BASE) - dist(last, BASE);
    await evalJs(`window.__v.movePlayer(${last.x}, ${last.y})`);
    await sleep(700);
    await shot('defense_ai_wolf_advance');
    const pass = w.aggro >= 3800 && sawChasing && approach > 400;
    record('P1 黑狼进场', pass, `aggro=${w.aggro} chasing=${sawChasing} 向基地推进=${Math.round(approach)}px 轨迹(${samples.length}点): ${samples.filter((_, i) => i % 4 === 0).map(s => `${s.x},${s.y}/${s.ai}`).join(' -> ')}`);
}

// ========== 2a. 普通近战：绕掩体走门洞 ==========
console.log('--- P2a 僵尸群走门洞 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const ids = [];
    for (const [t, x, y] of [['zombie', 2400, 2900], ['zombie', 2480, 2960], ['minerZombie', 2340, 2840]]) {
        const m = await evalJs(`window.__v.spawnForced('${t}')`);
        await evalJs(`window.__v.teleport('${m.id}', ${x}, ${y})`);
        ids.push(m.id);
    }
    let minGate = 1e9, minBase = 1e9, reached = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
        await sleep(400);
        for (const id of ids) {
            const s = await evalJs(`window.__v.snap('${id}')`);
            if (!s) continue;
            minGate = Math.min(minGate, dist(s, GATE));
            minBase = Math.min(minBase, dist(s, BASE));
            if (minGate < 200 || minBase < 450) reached = true;
        }
        if (reached) break;
    }
    await evalJs(`window.__v.movePlayer(${GATE.x}, ${GATE.y})`);
    await sleep(700);
    await shot('defense_ai_zombie_gate');
    record('P2a 近战走门洞', reached, `耗时=${((Date.now() - t0) / 1000).toFixed(1)}s minDist门洞=${Math.round(minGate)} minDist基地=${Math.round(minBase)}`);
}

// ========== 3. 掩体 LOS：墙背面接近也能出手 ==========
console.log('--- P3 墙背 LOS ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    // TR 边中点 (1156,1920) 附近找掩体，从房间外（东北侧）贴脸放僵尸
    const info = await evalJs(`(() => {
        const cs = window.__v.covers();
        let best = null, bd = 1e9;
        for (const c of cs) { const d = Math.hypot(c.x - 1156, c.y - 1920); if (d < bd) { bd = d; best = c; } }
        return best;
    })()`);
    console.log('  TR cover:', JSON.stringify(info));
    const out = { x: info.x + (info.x - BASE.x), y: info.y + (info.y - BASE.y) };
    const ol = Math.hypot(out.x - info.x, out.y - info.y);
    const zx = Math.round(info.x + (out.x - info.x) / ol * 110);
    const zy = Math.round(info.y + (out.y - info.y) / ol * 110);
    const z = await evalJs(`window.__v.spawnForced('zombie')`);
    await evalJs(`window.__v.teleport('${z.id}', ${zx}, ${zy})`);
    const hp0 = (await evalJs(`window.__v.coverHp('${info.id}')`)).hp;
    let hpEnd = hp0, tgt = null, stayedOutside = true;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
        await sleep(500);
        const s = await evalJs(`window.__v.snap('${z.id}')`);
        if (!s) break;
        tgt = s.target;
        // 菱形房内判定：|x-900|/512 + |y-2048|/256 < 1 视为进了房
        if (Math.abs(s.x - BASE.x) / 512 + Math.abs(s.y - BASE.y) / 256 < 0.95) stayedOutside = false;
        const c = await evalJs(`window.__v.coverHp('${info.id}')`);
        hpEnd = c.hp;
        if (hpEnd < hp0) break;
    }
    await evalJs(`window.__v.movePlayer(${zx}, ${zy})`);
    await sleep(700);
    await shot('defense_ai_los_behind');
    const pass = hpEnd < hp0 && tgt === info.id && stayedOutside;
    record('P3 墙背 LOS 出手', pass, `掩体=${info.id} hp ${hp0}->${hpEnd} 僵尸target=${tgt} 始终在墙外=${stayedOutside}`);
}

// ========== 4. 远程怪：环绕风筝不卡死 ==========
console.log('--- P4 远程风筝 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const sp = await evalJs(`window.__v.spawnForced('spitterZombie')`);
    await evalJs(`window.__v.teleport('${sp.id}', 2400, 2048)`);
    const wz = await evalJs(`window.__v.spawnForced('zombieWizard')`);
    await evalJs(`window.__v.teleport('${wz.id}', 2400, 2300)`);
    const hp0 = await evalJs(`(() => { const cs = window.__v.covers(); let s = 0; for (const c of cs) s += c.hp; return s + (window.__v.baseHp() || 0); })()`);
    const track = { [sp.id]: { first: null, last: null, maxStuck: 0, los: false }, [wz.id]: { first: null, last: null, maxStuck: 0, los: false } };
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
        await sleep(500);
        for (const id of [sp.id, wz.id]) {
            const s = await evalJs(`window.__v.snap('${id}')`);
            if (!s) continue;
            const t = track[id];
            if (!t.first) t.first = { x: s.x, y: s.y };
            t.last = { x: s.x, y: s.y, ai: s.ai, target: s.target };
            t.maxStuck = Math.max(t.maxStuck, s.stuck);
            if (s.los) t.los = true;
        }
    }
    const hp1 = await evalJs(`(() => { const cs = window.__v.covers(); let s = 0; for (const c of cs) s += c.hp; return s + (window.__v.baseHp() || 0); })()`);
    await evalJs(`window.__v.movePlayer(1600, 2100)`);
    await sleep(700);
    await shot('defense_ai_ranged_kite');
    const mv = (t) => t.first && t.last ? Math.round(Math.hypot(t.last.x - t.first.x, t.last.y - t.first.y)) : 0;
    const pass = hp1 < hp0 && mv(track[sp.id]) > 100 && mv(track[wz.id]) > 100 && track[sp.id].maxStuck < 5000 && track[wz.id].maxStuck < 5000;
    record('P4 远程风筝', pass, `结构总hp ${hp0}->${hp1} 毒液位移=${mv(track[sp.id])}px maxStuck=${track[sp.id].maxStuck} los=${track[sp.id].los} tgt=${track[sp.id].last?.target} | 巫师位移=${mv(track[wz.id])}px maxStuck=${track[wz.id].maxStuck} los=${track[wz.id].los} tgt=${track[wz.id].last?.target}`);
}

// ========== 5. chargeStraight 胖子僵尸：直冲不走接力 ==========
console.log('--- P5 胖子直冲 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const f = await evalJs(`window.__v.spawnForced('fatZombie')`);
    console.log('  fat spawned:', JSON.stringify(f));
    const pts = [];
    let tgtPos = null, relaySeen = false;
    for (let i = 0; i < 30; i++) {
        await sleep(400);
        const s = await evalJs(`window.__v.snap('${f.id}')`);
        if (!s) break;
        pts.push(s);
        if (s.relay) relaySeen = true;
        if (!tgtPos && s.target) {
            const tp = await evalJs(`(() => { const t = window.Game.entities.get('${s.target}'); return t ? { x: t.x, y: t.y } : null; })()`);
            if (tp) tgtPos = tp;
        }
    }
    const aim = tgtPos || BASE;
    // 距目标 >850px 的采样点相对 出生点→目标 直线的最大垂直偏差
    let maxDev = 0;
    const L = Math.hypot(aim.x - f.x, aim.y - f.y);
    for (const p of pts) {
        if (Math.hypot(p.x - aim.x, p.y - aim.y) <= 850) continue;
        const dev = Math.abs((aim.x - f.x) * (f.y - p.y) - (f.x - p.x) * (aim.y - f.y)) / L;
        maxDev = Math.max(maxDev, dev);
    }
    const last = pts[pts.length - 1];
    await evalJs(`window.__v.movePlayer(${last.x}, ${last.y})`);
    await sleep(700);
    await shot('defense_ai_fat_straight');
    const pass = !relaySeen && maxDev < 150 && pts.length > 5;
    record('P5 chargeStraight 直冲', pass, `relay出现过=${relaySeen} 直线最大偏差=${Math.round(maxDev)}px 目标=${pts[0]?.target ?? 'n/a'} 采样=${pts.length}`);
}

// ========== 6. 骑士：aggro 900→3800 远距离索敌 ==========
console.log('--- P6 骑士远距索敌 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const k = await evalJs(`window.__v.spawnForced('armoredKnight')`);
    console.log('  knight spawned:', JSON.stringify(k));
    const samples = [];
    for (let i = 0; i < 20; i++) { await sleep(300); const s = await evalJs(`window.__v.snap('${k.id}')`); if (s) samples.push(s); }
    const last = samples[samples.length - 1];
    const sawChasing = samples.some(s => s.ai === 'chasing');
    const approach = dist(k, BASE) - dist(last, BASE);
    await evalJs(`window.__v.movePlayer(${last.x}, ${last.y})`);
    await sleep(700);
    await shot('defense_ai_knight_aggro');
    const pass = k.aggro >= 3800 && sawChasing && approach > 300;
    record('P6 骑士 aggro3800', pass, `aggro=${k.aggro} chasing=${sawChasing} 推进=${Math.round(approach)}px`);
}

// ========== 2b. 堵门：卡住 ~500ms 主动转火掩体啃墙 ==========
console.log('--- P2b 堵门转火啃墙 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const gate = await evalJs(`window.__v.blockGate()`);
    console.log('  gate blockers:', JSON.stringify(gate));
    const ids = [];
    for (const [t, x, y] of [['minerZombie', 2000, 2600], ['minerZombie', 2080, 2660]]) {
        const m = await evalJs(`window.__v.spawnForced('${t}')`);
        await evalJs(`window.__v.teleport('${m.id}', ${x}, ${y})`);
        ids.push(m.id);
    }
    const coverIds = gate.map(g => g.id);
    const hp0 = {};
    for (const id of coverIds) hp0[id] = (await evalJs(`window.__v.coverHp('${id}')`)).hp;
    let retargetAt = null, retargetTarget = null, firstStuckAt = null, chewed = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
        await sleep(400);
        for (const id of ids) {
            const s = await evalJs(`window.__v.snap('${id}')`);
            if (!s) continue;
            if (s.stuck >= 400 && !firstStuckAt) firstStuckAt = Date.now() - t0;
            if (s.target && (coverIds.includes(s.target) || String(s.target).includes('cover'))) {
                if (!retargetAt) { retargetAt = Date.now() - t0; retargetTarget = s.target; }
            }
        }
        for (const cid of coverIds) {
            const c = await evalJs(`window.__v.coverHp('${cid}')`);
            if (c && c.hp < hp0[cid]) chewed = true;
        }
        if (retargetAt && chewed) break;
    }
    // 任一掩体（含房间原有 D 级墙）被啃也算：补查全体掩体掉血
    const anyCoverChewed = await evalJs(`(() => window.__v.covers().some(c => c.hp < c.max))()`);
    await evalJs(`window.__v.movePlayer(${GATE.x}, ${GATE.y})`);
    await sleep(700);
    await shot('defense_ai_gate_blocked_chew');
    const pass = retargetAt !== null && (chewed || anyCoverChewed);
    record('P2b 卡住转火啃墙', pass, `首次卡住=${firstStuckAt}ms 转火=${retargetAt}ms target=${retargetTarget} 堵门掩体掉血=${chewed} 任意掩体掉血=${anyCoverChewed}`);
}

// ========== 7. 性能：~35 怪 FPS/帧耗时 ==========
console.log('--- P7 索敌性能 ---');
{
    await evalJs(`window.__v.killDefenseMonsters()`);
    const types = ['zombie', 'blackWolf', 'minerZombie', 'spitterZombie', 'fatZombie', 'armoredKnight', 'zombie'];
    for (let i = 0; i < 36; i++) await evalJs(`window.__v.spawnForced('${types[i % types.length]}')`);
    const alive = await evalJs(`(() => [...window.Game.entities.values()].filter(e => e._defenseMonster && e.active).length)()`);
    await sleep(3000); // 让怪群进入索敌/寻路稳态
    const perf = await evalJs(`window.__v.fpsSample(5000)`);
    const alive2 = await evalJs(`(() => [...window.Game.entities.values()].filter(e => e._defenseMonster && e.active).length)()`);
    await evalJs(`window.__v.movePlayer(${BASE.x}, ${BASE.y})`);
    await sleep(500);
    await shot('defense_ai_perf_horde');
    const pass = perf.fps >= 45;
    record('P7 索敌性能', pass, `场上怪=${alive}->${alive2} fps=${perf.fps} avgUpdate=${perf.avgUpdateMs}ms frames=${perf.frames}`);
}

// ========== 8. 控制台报错 ==========
{
    const errs = consoleErrs.filter(e => !e.includes('favicon'));
    record('P8 无控制台报错', errs.length === 0, errs.length ? `${errs.length} 条:\n${errs.slice(0, 10).join('\n')}` : '0 条');
}

console.log('\n===== 汇总 =====');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
ws.close();
edge.kill();
console.log('done');
