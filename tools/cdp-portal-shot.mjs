#!/usr/bin/env node
/* 传送门新贴图实机验证：进 scene8（世界-122）→ 定位 portal 建筑 → 总览 + 特写截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9305;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/portal-verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-portal-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
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
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}
const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;

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
    const sm = ${sceneApi};
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));
await evalJs(`new Promise((r) => setTimeout(r, 3000))`);
console.log('diag:', JSON.stringify(await evalJs(`(async () => {
    const sc = window.__phaserScene;
    const cam = sc ? sc.cameras.main : null;
    const pg = (await import('/src/phaser/PhaserGame.js')).PhaserGame;
    return {
        sceneKey: sc ? sc.scene.key : null,
        cam: cam ? { x: Math.round(cam.midPoint.x), y: Math.round(cam.midPoint.y), zoom: cam.zoom } : null,
        player: window.Game.player ? { x: Math.round(window.Game.player.x), y: Math.round(window.Game.player.y) } : null,
        entities: window.Game.entities ? window.Game.entities.size : -1,
        portalTex: sc ? sc.textures.exists('portal') : null,
        phaserReady: pg.isReady, sceneReadyFlag: !!window.__phaserSceneReady,
        canvasCount: document.querySelectorAll('canvas').length,
    };
})()`)));
// Phaser 未启动则手动 init 并等 BootScene 加载完
console.log('phaser boot:', await evalJs(`(async () => {
    const pg = (await import('/src/phaser/PhaserGame.js')).PhaserGame;
    if (!pg.isReady) pg.init();
    for (let i = 0; i < 120; i++) {
        if (window.__phaserScene && window.__phaserScene.textures
            && window.__phaserScene.textures.exists('portal')) return 'ready after ' + (i * 0.5) + 's';
        await new Promise((r) => setTimeout(r, 500));
    }
    return 'timeout';
})()`));

const portalInfo = await evalJs(`(async () => {
    const found = [];
    for (const e of window.Game.entities.values()) {
        if (!e) continue;
        const s = JSON.stringify({ name: e.name, cfgKey: e.cfgKey, tex: e._cfg?.tex || e.spriteCfg?.idleKey,
            core: !!e._isWorldPortalCore, hub: !!e._isMainHubPortalBuilding, label: e.label, kind: e.kind });
        if (/portal|传送门/i.test(s)) found.push({ x: Math.round(e.x), y: Math.round(e.y), s });
    }
    return { count: found.length, found: found.slice(0, 10) };
})()`);
console.log('portal entities:', JSON.stringify(portalInfo, null, 1));
const pick = portalInfo && portalInfo.found && portalInfo.found[0];
if (!pick) { console.error('portal entity not found in scene8'); edge.kill(); process.exit(3); }
portalInfo.x = pick.x; portalInfo.y = pick.y;

// 特写：相机对准传送门
await evalJs(`(async () => {
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam) { cam.centerOn(${portalInfo.x}, ${portalInfo.y - 140}); cam.setZoom(1.6); }
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 2000))`);
await shot('portal-closeup');

// 黄昏长影验证：推进时钟到 17:00 前后再截
console.log('advance to dusk:', await evalJs(`(async () => {
    const els = (await import('/src/world/environment-lighting-system.js')).EnvironmentLightingSystem;
    for (let i = 0; i < 2000; i++) {
        const t = els.getGameTime();
        if (t.hour === 17) return t.hour + ':' + t.minute;
        els.advanceTime(5 * 1000);
    }
    return 'timeout';
})()`));
await evalJs(`new Promise((r) => setTimeout(r, 1500))`);
await shot('portal-dusk');

// 总览：看与周边建筑的观感
await evalJs(`(async () => {
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam) { cam.centerOn(${portalInfo.x}, ${portalInfo.y - 200}); cam.setZoom(0.6); }
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 1500))`);
await shot('portal-overview');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
await new Promise((r) => setTimeout(r, 1500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留由 cleanup-c-drive-caches.ps1 兜底 */ }
console.log('done');
