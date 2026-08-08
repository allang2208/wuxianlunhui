#!/usr/bin/env node
/* 世界-122 新布局验证（CDP 无头 Edge，2026-08-04）：
 * 基地在左端、无预制物；刷怪点全在右端；常规=普通怪；30s 精英；90s 领主。
 * 用法：node tools/cdp-defense-layout.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9226;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        return await r.json();
    } finally { clearTimeout(t); }
}
async function waitFor(fn, timeoutMs = 20000, step = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > timeoutMs) return null;
        await new Promise((r) => setTimeout(r, step));
    }
}

const page = await waitFor(async () => {
    const list = await fetchJson(`${CDP}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
}, 25000);
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
        errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
};
const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
};

await send('Runtime.enable');
await send('Page.enable');

// 开始游戏（官方按钮；等页面稳定）
let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise((r) => setTimeout(r, 500));
}
console.log('started:', started);

// 真实模块 + 切 scene8
for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return null;
        const { SceneManager } = await import(u);
        window.__sm = SceneManager;
        return SceneManager.currentScene || null;
    })()`).catch(() => null);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return window.__sm.currentScene;
})()`));

// 布局检查
console.log('layout:', await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    const m = await import(u);
    const ds = m.DefenseSystem;
    const iso = window.WallSystem ? window.WallSystem.isoVisuals.length : -1;
    let covers = 0, towers = 0;
    for (const e of window.Game.entities.values()) {
        if (e && e._isDefenseTower) towers++;
        if (e && e.grade) covers++;
    }
    return {
        base: ds.base ? { x: Math.round(ds.base.x), y: Math.round(ds.base.y) } : null,
        towers, covers, iso,
        player: { x: Math.round(window.Game.player.x), y: Math.round(window.Game.player.y) },
        spawnPoints: m.DEFENSE_CONFIG ? m.DEFENSE_CONFIG.spawnPoints.length : -1,
    };
})()`));

// 快进定时器：普通流 + 30s 精英 + 90s 领主
console.log('spawn test:', await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    const m = await import(u);
    const ds = m.DefenseSystem;
    const s = m.DEFENSE_CONFIG.spawn;
    ds._spawnTimer = s.interval;
    ds._eliteTimer = s.eliteEveryMs - 10;
    ds._lordTimer = s.lordEveryMs - 10;
    ds.update(20);
    const ranks = {};
    for (const e of window.Game.entities.values()) {
        if (e && e._defenseMonster && e.active) {
            const r = e.rank || '?';
            ranks[r] = (ranks[r] || 0) + 1;
        }
    }
    return { ranks, eliteTimer: Math.round(ds._eliteTimer), lordTimer: Math.round(ds._lordTimer) };
})()`));

await new Promise((r) => setTimeout(r, 600));
await shot('layout_base_left');
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
