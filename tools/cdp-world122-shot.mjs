#!/usr/bin/env node
/* 世界-122 防守地图素材分析：进 scene8 → 截总览/掩体/防御塔特写（供 GLM 角度分析） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9305;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-w122-'));
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

const defenseReady = await evalJs(`new Promise((res) => {
    const t = setInterval(async () => {
        const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
        const ds = raw.DefenseSystem || raw;
        if (ds.active && ds.towers.length >= 1) { clearInterval(t); res(true); }
    }, 200);
    setTimeout(() => { clearInterval(t); res(false); }, 15000);
})`);
console.log('defense ready:', defenseReady);
if (!defenseReady) {
    console.log('manual setup:', await evalJs(`(async () => {
        const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
        const ds = raw.DefenseSystem || raw;
        ds.setup(window.Game.player);
        return ds.active;
    })()`));
}

const info = await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const towers = (ds.towers || []).map((t) => ({ name: t.name, x: Math.round(t.x), y: Math.round(t.y), aim: +t.aimAngle.toFixed(3) }));
    const covers = [];
    for (const e of window.Game.entities.values()) {
        if (e && e._isDefenseStructure && String(e.name || '').includes('掩体')) {
            covers.push({ x: Math.round(e.x), y: Math.round(e.y), name: e.name, id: e.id });
        }
    }
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const t = new DefenseTower(1300, 1850, { id: 'demo_tower' });
    window.Game.entities.set('demo_tower', t);
    t.aimAngle = 0.5;
    try {
        const eq = await fetch('/data/equipment.json').then((r) => r.json());
        const pkm = JSON.parse(JSON.stringify(eq.equipment.pkm));
        t.equipWeapon(pkm);
    } catch (e) { /* 武器挂载失败不阻塞 */ }
    return { towers, covers: covers.slice(0, 12), coverCount: covers.length, demo: { x: Math.round(t.x), y: Math.round(t.y) }, cfgRoom: ds.room || null };
})()`);
console.log('world122 info:', JSON.stringify(info, null, 1));

await evalJs(`new Promise((r) => setTimeout(r, 800))`);
// 总览：相机居中到基地
await evalJs(`(async () => {
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam) { cam.centerOn(900, 2050); cam.setZoom(0.5); }
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 500))`);
await shot('w122-overview');

// 防御塔特写
await evalJs(`(async () => {
    const t = window.Game.entities.get('demo_tower');
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam && t) { cam.centerOn(t.x, t.y); cam.setZoom(1.5); }
    return t ? { x: Math.round(t.x), y: Math.round(t.y) } : null;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 500))`);
await shot('w122-tower');

// 机械臂另一旋转角（360° 旋转验证）
await evalJs(`(async () => {
    const t = window.Game.entities.get('demo_tower');
    if (t) t.aimAngle = 2.5;
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 500))`);
await shot('w122-tower-aim2');

// 掩体特写（第一个水平 + 第一个垂直）
await evalJs(`(async () => {
    let c = null;
    for (const e of window.Game.entities.values()) {
        if (e && e._isDefenseStructure && String(e.name || '').includes('掩体')) { c = e; break; }
    }
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam && c) { cam.centerOn(c.x, c.y); cam.setZoom(1.4); }
    return c ? { x: Math.round(c.x), y: Math.round(c.y) } : null;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 500))`);
await shot('w122-cover');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
