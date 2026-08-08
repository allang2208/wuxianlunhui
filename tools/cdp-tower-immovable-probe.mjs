#!/usr/bin/env node
/* 防御塔不可移动/不可击退验证（2026-08-06）：
 * 建塔 → 施加击退 → 检查位置与 knockbackX/Y。
 * 前置：vite dev 已起。用法：node tools/cdp-tower-immovable-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9238;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-immov-'));
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

const result = await evalJs(`(async () => {
    const DefenseMod = await import(${url});
    const { DefenseTower, DefenseBase } = DefenseMod;
    const p = window.Game.player;

    const t = new DefenseTower(p.x + 120, p.y, { id: 'immov_t' });
    const b = new DefenseBase(p.x + 200, p.y, { id: 'immov_b' });
    const beforeT = { x: t.x, y: t.y };
    const beforeB = { x: b.x, y: b.y };

    // 施加击退（多角度大力度）
    t.applyKnockback(0, 500);
    t.applyKnockback(Math.PI / 2, 500);
    b.applyKnockback(Math.PI, 400);
    b.applyKnockback(-Math.PI / 2, 400);
    // 模拟几帧位移积分（updateKnockback 由基类 update 驱动）
    for (let i = 0; i < 30; i++) {
        t.update(16);
        b.update(16);
    }

    return {
        tower: {
            immovable: t.immovable,
            noSeparation: t.noSeparation,
            moved: Math.abs(t.x - beforeT.x) > 0.01 || Math.abs(t.y - beforeT.y) > 0.01,
            pos: [t.x, t.y], before: [beforeT.x, beforeT.y],
            kb: [t.knockbackX, t.knockbackY],
        },
        base: {
            immovable: b.immovable,
            moved: Math.abs(b.x - beforeB.x) > 0.01 || Math.abs(b.y - beforeB.y) > 0.01,
            pos: [b.x, b.y], before: [beforeB.x, beforeB.y],
            kb: [b.knockbackX, b.knockbackY],
        },
    };
})()`);
console.log('immovable probe:', JSON.stringify(result, null, 1));
console.log('--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
