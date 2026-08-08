#!/usr/bin/env node
/* 世界-122 防御塔机械臂（2026-08-06 新抠）实机验证：
 * 建 3 塔（PKM/AKM/能量LMG）→ 冻结瞄准 → 多角度截图 + 单塔特写。
 * 前置：vite dev 已起（http://localhost:5173）。
 * 用法：node tools/cdp-defense-tower-arm.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9225;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-arm-'));
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

async function waitFor(fn, timeoutMs = 20000, step = 300) {
    const t0 = Date.now();
    for (;;) {
        try {
            const v = await fn();
            if (v) return v;
        } catch { /* retry */ }
        if (Date.now() - t0 > timeoutMs) return null;
        await new Promise((r) => setTimeout(r, step));
    }
}

async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        return await r.json();
    } finally {
        clearTimeout(t);
    }
}

const page = await waitFor(async () => {
    const list = await fetchJson(`${CDP}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
}, 25000);
if (!page) {
    console.error('no game page on CDP');
    edge.kill();
    process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        consoleErrors.push(`[exception] ${d.text} ${d.exception?.description || ''}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(`[console.error] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};

function send(method, params = {}) {
    return new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
        throw new Error(`eval failed: ${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description || ''}`);
    }
    return r.result?.result?.value;
}

async function shot(name, clip) {
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}

await send('Runtime.enable');
await send('Page.enable');

let ready = false;
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ game: typeof window.Game, running: !!(window.Game && window.Game.isRunning),
        hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    if (s.game === 'object' && !s.running && !s.hasPlayer) {
        await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    }
    await new Promise((r) => setTimeout(r, 500));
}
console.log('game ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;
console.log('switch scene8:', await evalJs(`(async () => {
    const sm = ${sceneApi};
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));
await new Promise((r) => setTimeout(r, 800));

const posed = await evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const DS = dsMod.DefenseSystem;
    const { DefenseTower } = dsMod;
    if (!DS.active) DS.setup(window.Game.player);
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const mk = (id) => JSON.parse(JSON.stringify(eq.equipment[id]));
    const spots = [
        { x: 1500, y: 1800, wp: 'pkm' },
        { x: 1750, y: 2050, wp: 'akm' },
        { x: 1980, y: 2300, wp: 'energy_lmg' },
    ];
    const towers = [];
    for (let i = 0; i < spots.length; i++) {
        const t = new DefenseTower(spots[i].x, spots[i].y, { id: 'armtest_' + i });
        window.Game.entities.set('armtest_' + i, t);
        DS.towers.push(t);
        t.range = 0;                 // 不索敌
        t._updateAim = () => {};     // 冻结瞄准（手动控制角度）
        const ok = t.equipWeapon(mk(spots[i].wp));
        towers.push({ name: t.name, wp: spots[i].wp, equipped: ok, aim: +t.aimAngle.toFixed(3) });
    }
    return towers;
})()`);
console.log('towers:', JSON.stringify(posed, null, 0));

// 等待渲染稳定
await new Promise((r) => setTimeout(r, 1200));

const setAims = async (angles) => evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const ts = dsMod.DefenseSystem.towers.filter((t) => (t.id || '').startsWith('armtest'));
    ${JSON.stringify(angles)}.forEach((a, i) => { if (ts[i]) ts[i].aimAngle = a; });
    return ts.map((t) => +t.aimAngle.toFixed(3));
})()`);

const NAT = 1.825;
const cases = [
    ['arm_nat', [NAT, NAT, NAT]],
    ['arm_right', [0, 0, 0]],
    ['arm_left', [Math.PI, Math.PI, Math.PI]],
    ['arm_up', [-Math.PI / 2, -Math.PI / 2, -Math.PI / 2]],
    ['arm_down', [Math.PI / 2, Math.PI / 2, Math.PI / 2]],
    ['arm_mix1', [0.6, 2.2, -0.37]],
    ['arm_mix2', [2.8, -1.4, 3.4]],
];
for (const [name, angles] of cases) {
    await setAims(angles);
    await new Promise((r) => setTimeout(r, 500));
    await shot(`arm_${name}`, undefined);
}

// 单塔特写（第 2 号塔，aim=π/2 向下 + 武器），clip 以塔世界坐标转屏幕
await setAims([NAT, Math.PI / 2, 0]);
await new Promise((r) => setTimeout(r, 400));
const clip = await evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const t = dsMod.DefenseSystem.towers.filter((x) => (x.id || '').startsWith('armtest'))[1];
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    const p = Renderer.worldToScreen(t.x, t.y);
    const s = window.__gameScale || 1;
    return { x: Math.max(0, p.x - 150), y: Math.max(0, p.y - 320), width: 340, height: 420, scale: s };
})()`);
if (clip && clip.width) {
    await shot('arm_closeup', clip);
}

console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
