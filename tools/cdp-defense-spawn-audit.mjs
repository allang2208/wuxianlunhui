#!/usr/bin/env node
/**
 * 世界-122 刷怪位置 + 卡墙攻击审计（2026-08-16）
 *
 * 目标 1（刷在基地旁）：逐类型 _spawnMonster 后记录实际落点，
 *   检查是否有怪物落点距基地（900,2048）过近，或 findSafeSpawn 兜底跑偏。
 * 目标 2（卡墙无法攻击）：批量刷 12 只僵尸推进 20s，统计每只怪的
 *   目标/攻击距离内判定/贴墙距离/卡住状态，找出「贴墙且够不着目标」的怪。
 *
 * 性能防护：切换 scene8 时保持树木散布开启（复现真实刷怪点被树压住的情形）；
 * 全程看门狗 120s 自杀，防残留进程拖垮机器。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WATCHDOG = setTimeout(() => { console.error('[watchdog] 120s 超时，强制退出'); process.exit(9); }, 120000);
WATCHDOG.unref?.();

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9315;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-spawn-audit-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1200,800', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--mute-audio', '--disable-background-timer-throttling',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
edge.on('error', (e) => { console.error('edge spawn error:', e.message); process.exit(3); });

async function waitFor(fn, t = 30000, s = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > t) return null;
        await new Promise((r) => setTimeout(r, s));
    }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const page = await waitFor(async () => {
    const l = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return l && l.find((x) => x.type === 'page');
});
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250)}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression, timeoutMs = 30000) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 800));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8 (trees on):', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await Promise.race([
        sm.switchScene('scene8', window.Game.player),
        new Promise((r) => setTimeout(() => r('SWITCH_TIMEOUT'), 60000)),
    ]);
    return { scene: sm.currentScene, loading: sm.isLoading };
})()`));

console.log('defense setup:', await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    return { active: ds.active, base: [ds.base && ds.base.x, ds.base && ds.base.y], spawnPts: ds._spawnPtsHint || 0 };
})()`));

// ============ 目标 1：刷怪落点审计 ============
console.log('--- spawn audit ---');
const spawnAudit = await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const BASE_X = 900, BASE_Y = 2048;
    const SP = [[3936,600],[3936,1350],[3936,2048],[3936,2746],[3936,3496],[3736,900],[3736,3196]];
    const types = ['zombie','minerZombie','fatZombie','zombieDog','blackWolf','spitterZombie','flySwarm',
        'lanternMinerZombie','oreSpider','zombieWizard','armoredKnight','poisonMaggot','mutant3',
        'foremanZombie','shounao','flyHand','witch'];
    const rows = [];
    for (const t of types) {
        const before = ds._seq;
        ds._spawnMonster(1, null, 1, t);
        const key = 'defense_monster_' + (before + 1);
        const m = window.Game.entities.get(key);
        if (!m) continue;
        const dBase = Math.round(Math.hypot(m.x - BASE_X, m.y - BASE_Y));
        let dSpawn = Infinity;
        for (const [sx, sy] of SP) dSpawn = Math.min(dSpawn, Math.hypot(m.x - sx, m.y - sy));
        rows.push({ type: t, x: Math.round(m.x), y: Math.round(m.y), dBase, dSpawn: Math.round(dSpawn) });
        window.Game.entities.delete(key);
    }
    const blocked = [];
    for (const [sx, sy] of SP) {
        blocked.push({ x: sx, y: sy, can: !!(window.WallSystem && window.WallSystem.canMoveTo && window.WallSystem.canMoveTo(sx, sy, 30)) });
    }
    return { rows, blocked, nearBase: rows.filter((r) => r.dBase < 1000) };
})()`);
console.log(JSON.stringify(spawnAudit, null, 1));

// ============ 目标 2：批量推进 8s 后卡墙统计（含轨迹跳变检测） ============
console.log('--- crowd advance (8s) ---');
const crowd = await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const ids = [];
    for (let i = 0; i < 12; i++) {
        const before = ds._seq;
        ds._spawnMonster(1, null, 1, 'zombie');
        const key = 'defense_monster_' + (before + 1);
        ids.push(key);
    }
    // 每 2s 采样位置，检测 >400px 跳变（瞬移/刷到基地）
    const samples = [];
    for (let s = 0; s <= 4; s++) {
        await new Promise((r) => setTimeout(r, 2000));
        const snap = {};
        for (const id of ids) {
            const m = window.Game.entities.get(id);
            if (m && m.active) snap[id] = { x: Math.round(m.x), y: Math.round(m.y) };
        }
        samples.push(snap);
    }
    const jumps = [];
    for (let i = 1; i < samples.length; i++) {
        for (const id of ids) {
            const a = samples[i - 1][id], b = samples[i][id];
            if (a && b) {
                const d = Math.hypot(b.x - a.x, b.y - a.y);
                if (d > 400) jumps.push({ id, t: i * 2, from: [a.x, a.y], to: [b.x, b.y], d: Math.round(d) });
            }
        }
    }
    const reachOf = (e) => (e.attackDistance !== undefined ? e.attackDistance : (e.attackRange || 70) * 1.15) + 120;
    const segDist = (px, py) => {
        const ws = window.WallSystem;
        let best = Infinity;
        const segs = (ws && ws.isoSegments) || [];
        for (const s of segs) {
            if (!s || s.x1 === undefined) continue;
            const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
            const len = Math.hypot(dx, dy) || 1;
            let t = ((px - s.x1) * dx + (py - s.y1) * dy) / (len * len);
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
            if (d < best) best = d;
        }
        return best;
    };
    const stats = [];
    for (const id of ids) {
        const m = window.Game.entities.get(id);
        if (!m || !m.active) continue;
        const t = m.target;
        const dist = t ? Math.hypot(m.x - t.x, m.y - t.y) : Infinity;
        stats.push({
            id,
            x: Math.round(m.x), y: Math.round(m.y),
            dBase: Math.round(Math.hypot(m.x - 900, m.y - 2048)),
            target: t ? (t.name || t.id) : null,
            tIsStruct: !!(t && t._isDefenseStructure),
            distToTarget: Math.round(dist),
            inReach: t ? dist <= reachOf(m) : false,
            wallDist: Math.round(segDist(m.x, m.y)),
            moving: m.isMoving === true,
            stuckTimer: Math.round(m._stuckTimer || 0),
        });
    }
    const tgtCount = {};
    for (const id of ids) {
        const m = window.Game.entities.get(id);
        if (m && m.target) tgtCount[m.target.name || m.target.id] = (tgtCount[m.target.name || m.target.id] || 0) + 1;
    }
    return { stats, tgtCount, jumps };
})()`);
console.log(JSON.stringify(crowd, null, 1));

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
clearTimeout(WATCHDOG);
console.log('done');
