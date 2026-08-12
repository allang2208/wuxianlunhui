#!/usr/bin/env node
/* 黑狼贴图实机截图（验证绿幕新 sheet + _noShadow 后的脚部观感）。
 * 主场景玩家旁直接注入 BlackWolf，连拍 4 帧。需 vite dev server 跑在 5173。
 * 用法：node tools/cdp-blackwolf-shot.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9239;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

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
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); await cleanup(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const rawEval = async (expression) => {
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

// 启动游戏（点开始按钮直到 Game 就绪）
let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await rawEval(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await sleep(500);
}
console.log('game started:', started);
if (!started) { await cleanup(1); }

// 注入黑狼到玩家右侧 160px（模块 URL 必须带 ?t= 与页面实例一致，否则拿到第二份模块）
const spawnRes = await rawEval(`(async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name)
        .filter(n => n.includes('/src/entities/enemy-types.js'));
    const u = urls.find(n => n.includes('.js?')) || urls[0];
    const m = await import(u);
    const p = window.Game.player;
    const w = new m.BlackWolf(p.x + 160, p.y);
    window.Game.entities.set('probe_wolf', w);
    return { x: Math.round(w.x), y: Math.round(w.y), noShadow: !!w._noShadow, hp: w.hp };
})()`);
console.log('spawned:', JSON.stringify(spawnRes));

// 连拍 4 帧（狼会朝玩家移动/攻击，覆盖 walk/run/bite 姿态）
for (let i = 0; i < 4; i++) {
    await sleep(900);
    await shot(`blackwolf_ingame_${i}`);
}
await cleanup(0);
