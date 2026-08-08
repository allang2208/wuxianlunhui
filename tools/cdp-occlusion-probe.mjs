#!/usr/bin/env node
/* 复现/验证：怪物在掩体前却被遮挡（图层排序）。用法：node tools/cdp-occlusion-probe.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9231;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 25000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
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

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise(r => setTimeout(r, 500));
}
for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) u = '/src/world/scene-manager.js';
        try { const { SceneManager } = await import(u); window.__sm = SceneManager; return SceneManager.currentScene || null; } catch { return null; }
    })()`).catch(() => null);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
}
await evalJs(`(async () => { await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);

const info = await evalJs(`(async () => {
    const G = window.Game;
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    // 清掉上次探针怪
    const old = G.entities.get('probe_monster');
    if (old) { old.active = false; G.entities.delete('probe_monster'); }
    // 找一个 v 掩体（右门柱）
    let post = null;
    for (const e of G.entities.values()) {
        if (e && e.orient === 'v' && Math.abs(e.x - 1300) < 5) { post = e; break; }
    }
    if (!post) return { error: 'post cover not found' };
    // 生成一只僵尸站到掩体“前侧”：脚底 y 大于墙底边线、但小于掩体 depth 键（复现被盖）
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/entities/enemy-types.js?'));
    const mod = await import(u || '/src/entities/enemy-types.js');
    const z = new mod.Zombie(1300, 2090);
    z._defenseMonster = true;
    z._preferDefenseTargets = true;
    G.entities.set('probe_monster', z);
    await new Promise(r => setTimeout(r, 400));
    const coverSprite = scene && scene._neutralSprites && scene._neutralSprites.get(post) ? scene._neutralSprites.get(post).sprite : null;
    const monSprite = z._phaserSprite;
    // 手动跑一次仲裁，确认掩体面线是否已注册
    const WS = window.WallSystem;
    // 关键判例：高端前侧（x=1404 处底边线 y≈1974），实体脚底 1990 在线前但自然深度
    // 2000 < 掩体平面深度 2090——只有面线仲裁能把它抬到掩体之上（→2090.5）
    const arb = WS ? WS.junctionCorrectedDepth(1404, 1990, 2000, 120) : null;
    // 对照：同一点无面线时不应变化（隔离面线仲裁本身）
    const arbNoFace = WS ? WS.junctionCorrectedDepth(3000, 1990, 2000, 120) : null;
    // 低端线后：脚底 2060 在底边线 2078 之上（前）→ 自然 2070，应抬到 ≥2090.5
    const arbFrontLow = WS ? WS.junctionCorrectedDepth(1195, 2060, 2070, 120) : null;
    return {
        post: { x: post.x, y: post.y, orient: post.orient, depth: coverSprite ? coverSprite.depth : null },
        faceDepth: post._faceDepth,
        faceLine: post._faceLine,
        monster: { x: Math.round(z.x), y: Math.round(z.y), depth: monSprite ? monSprite.depth : null },
        arbFront: arb,
        arbNoFace,
        arbFrontLow,
        coverSpriteFound: !!coverSprite,
    };
})()`);
console.log('probe:', JSON.stringify(info, null, 2));

// 玩家移开，相机对准怪与门柱
await evalJs(`(async () => {
    const p = window.Game.player;
    p.x = 700; p.y = 1950;
    return true;
})()`);
await new Promise((r) => setTimeout(r, 1000));
await shot('occlusion_probe');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
