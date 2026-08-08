#!/usr/bin/env node
/* 防御塔能量轻机枪 ramp+过热验证（2026-08-06）：
 * 建塔装能量LMG + 假想敌 → 采样射速(冷却)与过热值随时间变化，
 * 确认 333→50ms ramp、~5s 过热停射、冷却后恢复。
 * 前置：vite dev 已起。用法：node tools/cdp-tower-lmg-overheat.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9241;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-lmg-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });

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
    const l = await fetchJson(`${CDP}/json/list`);
    return l && l.find((x) => x.type === 'page' && x.url.includes('localhost:5173'));
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
        errs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

const mods = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    return { defense: pick('world/defense-system.js') };
})()`);
const url = JSON.stringify(mods.defense);

// 先预取武器数据（减少建塔前的耗时），再快速建塔+靶子，立即采样
await evalJs(`(async () => {
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    window.__lmgItem = JSON.parse(JSON.stringify(eq.equipment.energy_lmg));
})()`);
await evalJs(`(async () => {
    const DefenseMod = await import(${url});
    const DS = DefenseMod.DefenseSystem;
    const { DefenseTower } = DefenseMod;
    const p = window.Game.player;
    const t = new DefenseTower(p.x + 120, p.y, { id: 'lmgtest' });
    window.Game.entities.set('lmgtest', t);
    DS.towers.push(t);
    t.equipWeapon(window.__lmgItem);
    const Enemy = (await import('/src/entities/enemy.js')).Enemy;
    const dummy = new Enemy(t.x + 500, t.y, {
        faction: 'enemy', hp: 999999, maxHp: 999999, size: 40, collisionRadius: 24, name: '靶子',
    });
    dummy._defenseMonster = true;
    window.Game.entities.set('lmgtest_dummy', dummy);
    return { atkKey: t._attackKey };
})()`);

// 采样：0~3s 看 ramp，3~7s 看过热停射，7~12s 看冷却恢复
const samples = [];
for (let i = 0; i <= 48; i++) {
    const at = i * 250;
    await new Promise((r) => setTimeout(r, 250));
    const s = await evalJs(`(async () => {
        const DefenseMod = await import(${url});
        const t = DefenseMod.DefenseSystem.towers.find((x) => x.id === 'lmgtest');
        const atk = t.attacks[t._attackKey];
        const dummy = window.Game.entities.get('lmgtest_dummy');
        return {
            ms: ${at},
            cd: atk.maxCooldown,
            heat: +t._overheatValue.toFixed(3),
            overheated: t._overheatOverheated,
            firing: t._energyLMGIsFiring,
            fireTime: Math.round(t._energyLMGFireTime),
            target: !!(dummy && dummy.active && t._acquireTarget([...window.Game.entities.values()]) === dummy),
        };
    })()`);
    samples.push(s);
}
console.log('samples:', JSON.stringify(samples));
console.log('--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
