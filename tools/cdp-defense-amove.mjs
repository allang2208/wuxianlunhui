#!/usr/bin/env node
/**
 * 世界-122 怪物 A 移动验证（2026-08-15）：
 * - Case A：防守怪在玩家 320px 交战半径内 → 锁定并攻击玩家
 * - Case B：防守怪远离玩家/侍从 → 锁定最近防守建筑（推进基地方向）
 * - Case C：交战目标消失 → 自动回落到建筑目标（继续推进基地）
 * 判据：monster.target 的归属 + 玩家掉血（真实攻击发生）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9314;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-amove-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); await r.json(); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
}
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
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8:', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));
console.log('defense setup:', await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    return { active: ds.active, engage: (await import('/src/world/defense-system.js')).DEFENSE_CONFIG.spawn.engageHostileRange };
})()`));

const out = await evalJs(`(async () => {
    const { Zombie } = await import('/src/entities/enemy-types.js');
    const ds = (window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem);
    const player = window.Game.player;
    const res = {};
    function mk(x, y, id) {
        const m = new Zombie(x, y, { id });
        m._defenseMonster = true;
        m._preferDefenseTargets = true;
        m._engageHostileRange = 320;
        m._alertRange = 3800;
        if (m._aggroRange && m._aggroRange < 3800) m._aggroRange = 3800;
        window.Game.entities.set(id, m);
        return m;
    }
    const cls = (e) => !e ? null : (e._isDefenseStructure ? '建筑:' + (e.name || e.id) : '单位:' + (e.name || e.id));

    // 把玩家瞬移到空旷区（远离基地建筑群），再测交战判定
    const p0 = { x: player.x, y: player.y };
    player.x = 2600; player.y = 2048;

    // Case A：交战半径内（玩家 +120px）→ 应锁定玩家并真实攻击
    const a = mk(player.x + 120, player.y, 'probe_a');
    const php0 = player.hp;
    await new Promise((r) => setTimeout(r, 2500));
    res.A = {
        target: cls(a.target), playerHpDrop: Math.round(php0 - player.hp),
        dist: Math.round(Math.hypot(a.x - player.x, a.y - player.y)),
    };
    window.Game.entities.delete('probe_a');

    // Case B：远离玩家（3000,1600）→ 应锁定最近防守建筑
    const b = mk(3000, 1600, 'probe_b');
    await new Promise((r) => setTimeout(r, 1200));
    res.B = { target: cls(b.target), pos: [Math.round(b.x), Math.round(b.y)] };
    window.Game.entities.delete('probe_b');

    // Case C：交战目标消失 → 回落建筑（先锁玩家，再把玩家瞬移出交战半径；
    // 感知记忆 6000ms（DEFAULT_PERCEPTION.memoryDuration），窗口须 >6s 才会遗忘回落）
    const c = mk(player.x + 100, player.y, 'probe_c');
    await new Promise((r) => setTimeout(r, 800));
    const before = cls(c.target);
    player.x = p0.x; player.y = p0.y; // 瞬移出交战半径（回基地）
    await new Promise((r) => setTimeout(r, 7800));
    const after = cls(c.target);
    res.C = { before, after };
    window.Game.entities.delete('probe_c');

    // Case D：怪物推进建筑途中，玩家贴近到交战半径内 → 免滞回转火单位
    const d = mk(3100, 1600, 'probe_d');
    await new Promise((r) => setTimeout(r, 1200));
    const dBefore = cls(d.target);
    player.x = d.x + 150; player.y = d.y; // 贴近怪物
    await new Promise((r) => setTimeout(r, 1500));
    const dAfter = cls(d.target);
    res.D = { before: dBefore, after: dAfter };
    window.Game.entities.delete('probe_d');

    player.x = p0.x; player.y = p0.y; // 还原玩家
    return res;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
