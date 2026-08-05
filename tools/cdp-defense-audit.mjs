#!/usr/bin/env node
/* 世界-122 综合审计：墙体/掩体深度规则 + 遮挡仲裁 + 拼接截图。
 * 用法：node tools/cdp-defense-audit.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9232;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
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
// 等精灵创建 + 首帧渲染（最多 8s；掩体精灵在 _neutralSprites 中）
let spritesReady = false;
for (let i = 0; i < 16 && !spritesReady; i++) {
    await new Promise((r) => setTimeout(r, 500));
    spritesReady = await evalJs(`(async () => {
        const scene = window.PhaserGame ? window.PhaserGame.scene : null;
        if (!scene || !scene._neutralSprites) return false;
        let n = 0;
        for (const e of window.Game.entities.values()) {
            if (e && e.grade !== undefined && scene._neutralSprites.has(e)) n++;
        }
        return n >= 14;
    })()`).catch(() => false);
}
console.log('sprites ready:', spritesReady);

// ---- 深度/遮挡审计 ----
const audit = await evalJs(`(async () => {
    const G = window.Game;
    const scene = window.PhaserGame ? window.PhaserGame.scene : null;
    const WS = window.WallSystem;
    const covers = [];
    for (const e of G.entities.values()) {
        if (!e || e.grade === undefined || !e.active) continue;
        const sp = scene && scene._neutralSprites && scene._neutralSprites.get(e) ? scene._neutralSprites.get(e).sprite : null;
        covers.push({
            id: e.id, x: Math.round(e.x), y: Math.round(e.y), orient: e.orient,
            faceDepth: e._faceDepth, spriteDepth: sp ? sp.depth : null,
            ok: sp ? Math.abs(sp.depth - e._faceDepth) < 0.01 : false,
        });
    }
    const wallAudit = WS && typeof WS.__depthAudit === 'function' ? WS.__depthAudit() : 'n/a';
    // 玩家在掩体前/后的仲裁抽样
    const p = G.player;
    const natural = p.y + 10;
    const corrected = WS ? WS.junctionCorrectedDepth(p.x, p.y, natural, 120) : null;
    return { covers: covers.length, depthMismatch: covers.filter(c => !c.ok), wallAudit: wallAudit.length, playerArb: { x: Math.round(p.x), y: Math.round(p.y), natural, corrected } };
})()`);
console.log('audit:', JSON.stringify(audit, null, 2));

// ---- 截图：房间全景（玩家传送到房心）+ 入口特写 ----
await evalJs(`(async () => {
    const p = window.Game.player;
    p.x = 900; p.y = 2048;
    return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
await shot('audit_room_full');

await evalJs(`(async () => {
    const p = window.Game.player;
    p.x = 1156; p.y = 2176;
    return true;
})()`);
await new Promise((r) => setTimeout(r, 1000));
await shot('audit_entrance');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
