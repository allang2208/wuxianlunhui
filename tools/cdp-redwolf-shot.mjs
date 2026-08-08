#!/usr/bin/env node
/* 红狼王实机截图探针（简化版，2026-08-08）：
 * 加载 dev 页面 -> 等 window.Game -> 把红狼王强制生成到玩家旁 -> 变身 -> 截图狼形态与红狼人形态。
 * 前置：vite dev 已启动。用法：node tools/cdp-redwolf-shot.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9244;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-rw2-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });

async function waitFor(fn, t = 50000, s = 400) {
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
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} :: ${r.result.exceptionDetails.exception?.description || ''}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('shot:', name);
}

await send('Runtime.enable');
await send('Page.enable');

const ready = await waitFor(async () => {
    const s = await evalJs(`({ g: !!(window.Game && window.Game.entities), p: !!(window.Game && window.Game.player) })`);
    return s && s.g ? s : null;
});
if (!ready) { console.error('game not ready'); edge.kill(); process.exit(2); }
console.log('game ready');

// 强制生成/复用红狼王，拉到玩家旁
const spawnResult = await evalJs(`(async () => {
    const g = window.Game;
    const p = g.player;
    if (!p) return { error: 'no player' };
    let e = g.entities.get('enemy_main_red_wolf');
    if (!e) {
        const EnemyClass = (await import('/src/entities/enemy-types.js')).default || (await import('/src/entities/enemy-types.js'));
        // 尝试多种取类方式
        const ctor = EnemyClass.RedWolfKing || EnemyClass.redWolfKing || Object.values(EnemyClass).find((v) => v && v.name === 'RedWolfKing');
        if (!ctor) return { error: 'no RedWolfKing ctor', keys: Object.keys(EnemyClass) };
        e = new ctor(p.x + 140, p.y - 40, {});
        g.entities.set('enemy_main_red_wolf', e);
    }
    e.x = p.x + 140; e.y = p.y - 40;
    return { made: true, name: e.name, x: e.x, y: e.y };
})()`);
console.log('spawn:', JSON.stringify(spawnResult));

await new Promise((r) => setTimeout(r, 2500));
await shot('rw_shot_wolf');

// 尝试变身
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return;
    e.hp = e.maxHp * 0.3;
    e._transformTriggered = false; e._isTransforming = false; e._isTransformed = false;
    e.takeDamage(100, null, 'physical', true);
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 5500));
await shot('rw_shot_humanoid');

const state = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    return e ? { isTransformed: e._isTransformed, animState: e._animState, texKey: e._getTextureKey() } : null;
})()`).catch(() => null);
console.log('final state:', JSON.stringify(state));
console.log('errs:', errs.length ? errs : 'none');
edge.kill();
