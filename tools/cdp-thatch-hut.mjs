#!/usr/bin/env node
/* 草屋端到端验证（CDP 无头 Edge，2026-08-17）。前置：vite dev @5173。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9226;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.resolve('tools/verify-shots/thatch');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
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
    } finally {
        clearTimeout(t);
    }
}
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
const mouse = (type, x, y, button) => send('Input.dispatchMouseEvent', {
    type, x, y, button: button || 'none', clickCount: 1,
});

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
    if (!started) await new Promise((r) => setTimeout(r, 500));
}
console.log('started:', started);

let smReady = null;
for (let i = 0; i < 50; i++) {
    smReady = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return null;
        const { SceneManager } = await import(u);
        window.__sm = SceneManager;
        window.__imp = (p) => {
            const url = performance.getEntriesByType('resource').map(e => e.name)
                .find(n => n.includes(p) && n.includes('?'));
            if (!url) throw new Error('module not loaded: ' + p);
            return import(url);
        };
        if (SceneManager.currentScene) return { scene: SceneManager.currentScene };
        return null;
    })()`).catch(() => null);
    if (smReady) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('scene mgr ready:', JSON.stringify(smReady));

console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return { scene: window.__sm.currentScene };
})()`));

const itemCheck = await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const it = m.BUILD_ITEMS.find((i) => i.id === 'thatch_hut');
    return it ? { id: it.id, name: it.name, cost: it.cost, currency: it.currency, kind: it.kind } : null;
})()`);
console.log('build item:', JSON.stringify(itemCheck));

await evalJs(`(async () => {
    const em = (await window.__imp('/src/systems/energy-manager')).EnergyManager;
    em.addEnergy(9999);
    return true;
})()`);
const spot = await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const bs = m.BuildingSystem;
    const cam = window.__phaserScene.cameras.main;
    for (let dy = -320; dy <= 320; dy += 60) {
        for (let dx = -320; dx <= 320; dx += 60) {
            const w = cam.getWorldPoint(960 + dx, 540 + dy);
            if (bs._canPlace(w.x, w.y)) return { sx: 960 + dx, sy: 540 + dy };
        }
    }
    return null;
})()`);
console.log('spot:', JSON.stringify(spot));

await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    m.BuildingSystem.open();
    m.BuildingSystem._selectItem(m.BUILD_ITEMS.find((i) => i.id === 'thatch_hut'));
    return true;
})()`);
await mouse('mouseMoved', spot.sx, spot.sy);
await new Promise((r) => setTimeout(r, 400));
await shot('ghost_thatch');
await mouse('mousePressed', spot.sx, spot.sy, 'left');
await mouse('mouseReleased', spot.sx, spot.sy, 'left');
await new Promise((r) => setTimeout(r, 500));

const placed = await evalJs(`(async () => {
    const ps = (await window.__imp('/src/world/producer-building-system')).ProducerBuildingSystem;
    const b = ps.buildings[0] || null;
    const en = [...window.Game.entities.values()].filter((e) => e && e._isProducerBuilding).length;
    return b ? { count: ps.buildings.length, entities: en, cfg: b.cfgKey, unitType: b.unitType, spawnMs: b._cfg.spawnIntervalMs, cost: b._cfg.cost } : { count: ps.buildings.length, entities: en };
})()`);
console.log('placed:', JSON.stringify(placed));
await shot('placed_thatch');

await new Promise((r) => setTimeout(r, 11000));
const spawnCheck = await evalJs(`(async () => {
    const ps = (await window.__imp('/src/world/producer-building-system')).ProducerBuildingSystem;
    const b = ps.buildings[0];
    if (!b) return { err: 'no building' };
    const units = b.units.filter((u) => u && u.active && !u._dying);
    return { alive: b.aliveUnitCount(), units: units.map((u) => u.constructor.name), hasShooter: units.some((u) => u.constructor.name === 'HamsterShooter'), unitType: b.unitType };
})()`);
console.log('spawn:', JSON.stringify(spawnCheck));
await shot('spawned_thatch');

await evalJs(`(async () => {
    const ps = (await window.__imp('/src/world/producer-building-system')).ProducerBuildingSystem;
    const b = ps.buildings[0];
    if (b) ps._ensurePanel().openFor(b, window.Game.player);
    return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
const panelCheck = await evalJs(`(() => {
    const el = document.querySelector('#producerBuildingPanel');
    if (!el) return null;
    const title = el.querySelector('#pbTitle');
    const types = [...el.querySelectorAll('[data-unit-type]')].map((b) => b.textContent);
    return { title: title ? title.textContent : null, types };
})()`);
console.log('panel:', JSON.stringify(panelCheck));
await shot('panel_thatch');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
