#!/usr/bin/env node
/* 世界-122 防御塔机械臂旋转 + 武器挂载运行时验证（CDP 无头 Edge，2026-08-04）。
 * 一条龙：spawn 无头 Edge → CDP 驱动 → 切进世界-122 → 给塔摆不同朝向角 → 截图。
 * 前置：vite dev 已起（http://localhost:5173）。
 * 用法：node tools/cdp-defense-tower.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9224;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

// profile 放系统临时目录（避免 vite watcher EBUSY）
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

async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}

await send('Runtime.enable');
await send('Page.enable');

// 等游戏启动（Node 侧轮询，不依赖单次长 Promise）
let ready = false;
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ game: typeof window.Game, running: !!(window.Game && window.Game.isRunning),
        hasPlayer: !!(window.Game && window.Game.player), body: (document.body.innerText || '').slice(0, 60) })`);
    if (i === 0 || s.game === 'object') console.log('page state:', JSON.stringify(s));
    if (s.running && s.hasPlayer) { ready = true; break; }
    if (s.game === 'object' && !s.running && !s.hasPlayer) {
        const started = await evalJs(`(async () => {
            if (window.Game && !window.Game.isRunning) {
                try { window.Game.start(); return 'called'; } catch (e) { return 'err:' + String(e); }
            }
            return 'skip';
        })()`);
        if (started !== 'skip') console.log('Game.start ->', started);
    }
    await new Promise((r) => setTimeout(r, 500));
}
console.log('game ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

// 切进世界-122
console.log('window refs:', await evalJs(`({
    SceneManager: typeof window.SceneManager,
    DefenseSystem: typeof window.DefenseSystem,
    smScenes: window.SceneManager ? Object.keys(window.SceneManager.scenes || {}) : null,
})`));
const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;
console.log('scenes:', await evalJs(`(async () => Object.keys((${sceneApi}).scenes || {}))()`));
console.log('switch scene8:', await evalJs(`(async () => {
    const sm = ${sceneApi};
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));

const defenseReady = await evalJs(`new Promise((res) => {
    const t = setInterval(async () => {
        const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
        const ds = raw.DefenseSystem || raw;
        if (ds.active && ds.towers.length >= 3) { clearInterval(t); res(true); }
    }, 200);
    setTimeout(() => { clearInterval(t); res(false); }, 15000);
})`);
console.log('defense ready:', defenseReady);
if (!defenseReady) {
    // 兜底：手动 setup（等价 scene8 加载路径的产物）
    console.log('manual setup:', await evalJs(`(async () => {
        const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
        const ds = raw.DefenseSystem || raw;
        ds.setup(window.Game.player);
        return ds.active;
    })()`));
}

// 2 号塔装 AKM；三座塔设不同朝向角
const posed = await evalJs(`(async () => {
    const ds = await import('/src/world/defense-system.js');
    const towers = ds.DefenseSystem.towers;
    if (!towers || towers.length < 3) return { error: 'no towers', len: towers ? towers.length : 0 };
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const akm = JSON.parse(JSON.stringify(eq.equipment.akm));
    const isTowerWeapon = ds.DefenseTower.isTowerWeapon(akm);
    const eqRet = towers[1].equipWeapon(akm);
    console.log('AKM equip diag:', JSON.stringify({
        eqType: typeof eq, hasEquipment: !!(eq && eq.equipment), cat: akm.category, wt: akm.weaponType,
        isTowerWeapon, eqRet,
    }));
    towers[0].aimAngle = -0.37;
    towers[1].aimAngle = 2.2;
    towers[2].aimAngle = 0.6;
    return towers.map((t) => ({ name: t.name, weapon: t.weaponItem ? t.weaponItem.name : null, aim: +t.aimAngle.toFixed(2) }));
})()`);
console.log('towers posed:', JSON.stringify(posed));

await evalJs(`new Promise((res) => setTimeout(res, 600))`);
await shot('tower_aim_1');

await evalJs(`(async () => {
    const ds = await import('/src/world/defense-system.js');
    const towers = ds.DefenseSystem.towers;
    towers[0].aimAngle = 2.8;
    towers[1].aimAngle = -1.4;
    towers[2].aimAngle = 3.4;
    return true;
})()`);
await evalJs(`new Promise((res) => setTimeout(res, 600))`);
await shot('tower_aim_2');

console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
