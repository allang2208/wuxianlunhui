#!/usr/bin/env node
/* 各档位（F/E/C/B/A）带土贴图实机验证：改 coverGrade 重建房间，截图转角+直缝 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9287;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-grade-soil-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${profile}`, 'about:blank',
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
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
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
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved:', `${OUT_DIR}/${name}.png`);
}
function pickExpr() {
    return `(name) => {
        const withT = performance.getEntriesByType('resource').find((u) => u.name.includes('/src/' + name) && u.name.includes('?t='));
        return withT ? withT.name : performance.getEntriesByType('resource').find((u) => u.name.includes('/src/' + name))?.name || null;
    }`;
}
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173/' });
await new Promise((r) => setTimeout(r, 2500));
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

// 等 Phaser 场景就绪
let sceneOk = false;
for (let i = 0; i < 40; i++) {
    sceneOk = await evalJs(`!!(window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene))`);
    if (sceneOk) break;
    await new Promise((r) => setTimeout(r, 250));
}
console.log('scene ready:', sceneOk);

// 进入世界-122（基地房）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    if (SM.currentScene !== 'scene8') await SM.switchScene('scene8', p, 'explore');
    await new Promise((r) => setTimeout(r, 900));
    return SM.currentScene;
})()`);

async function swapGrade(grade) {
    return evalJs(`(() => {
        const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
        if (!scene) return { ok: false, err: 'no scene' };
        let n = 0;
        for (const e of window.Game.entities.values()) {
            if (!e._isDefenseStructure || !e._faceLine) continue;
            if (e.orient === 'v') e.spriteCfg.idleKey = 'obstacle_cover_${grade}_v';
            else e.spriteCfg.idleKey = 'obstacle_cover_${grade}_h';
            const data = scene._neutralSprites.get(e);
            if (data && data.sprite) { data.sprite.setTexture(e.spriteCfg.idleKey); n++; }
        }
        return { ok: true, swapped: n };
    })()`);
}
async function camAt(wx, wy) {
    await evalJs(`(async () => {
        const perfs = performance.getEntriesByType('resource');
        const pick = ${pickExpr()};
        const Camera = (await import(pick('world/camera.js'))).Camera;
        const p = window.Game.player;
        p.x = ${wx}; p.y = ${wy};
        Camera.x = ${wx}; Camera.y = ${wy};
        await new Promise((r) => setTimeout(r, 600));
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
}

for (const grade of ['F', 'A']) {
    const ent = await swapGrade(grade);
    console.log('swap to', grade, '->', JSON.stringify(ent));
    // 全房间视角
    await camAt(900, 2048);
    await shot(`grade_${grade}_room_full`);
    // 上夹角
    await camAt(900, 1900);
    await shot(`grade_${grade}_corner_top`);
    // 左夹角
    await camAt(480, 2020);
    await shot(`grade_${grade}_corner_left`);
}
// 恢复 D
const restored = await swapGrade('D');
console.log('restore D ->', JSON.stringify(restored));
console.log('errs:', errs.slice(0, 5));
edge.kill();
process.exit(0);
