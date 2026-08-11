#!/usr/bin/env node
/* 恶魔洞窟闸门确定性验证：直接 enterCombatArena + placeAt 打点记录 + 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9302;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-demon2-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'about:blank',
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
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
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

const r = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { SceneManager } = await import(pick('world/scene-manager.js'));
    const { CONFIG } = await import(pick('config/config.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { whenWallPrefabsLoaded } = await import(pick('world/wall-prefabs.js'));
    const Game = window.Game;
    const player = Game.player;
    if (player && player.iceWallSystem && typeof player.iceWallSystem.breakdown === 'function') player.iceWallSystem.breakdown();
    Game.entities.clear();
    Game.entities.set('player', player);
    CONFIG.WORLD_WIDTH = 2048; CONFIG.WORLD_HEIGHT = 2048;
    player.x = 1024; player.y = 1024;

    // placeAt 打点
    const WG = window.WallGate;
    const calls = [];
    const orig = WG.placeAt.bind(WG);
    WG.placeAt = (...args) => {
        try {
            const scene = window.__phaserScene;
            const texOk = !!(scene && scene.textures && scene.textures.exists('demon_gate'));
            const frameOk = texOk ? scene.textures.get('demon_gate').has(args[0] ? WG._frame : 15) : false;
            const ret = orig(...args);
            calls.push({ a: [Math.round(args[0].x), Math.round(args[0].y)], b: [Math.round(args[1].x), Math.round(args[1].y)], flip: args[2], texOk, ret, sprite: !!WG.sprite });
            return ret;
        } catch (e) {
            calls.push({ err: String(e && e.message ? e.message : e) });
            return false;
        }
    };

    SceneManager.currentScene = 'scene7';
    await whenWallPrefabsLoaded();
    // 等闸门贴图就绪（真实流程 BootScene 加载完才进游戏；测试直进需显式等待）
    for (let i = 0; i < 40; i++) {
        const sc = window.__phaserScene;
        if (sc && sc.textures && sc.textures.exists('demon_gate')) break;
        await new Promise((r) => setTimeout(r, 250));
    }
    let arenaInfo = null, arenaErr = null;
    try {
        arenaInfo = CombatRoomSystem.enterCombatArena(player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'demonCavern' });
    } catch (e) { arenaErr = String(e && e.stack ? e.stack : e); }

    let isoCount = 0;
    for (let i = 0; i < 16; i++) {
        isoCount = WallSystem.isoVisuals.length;
        if (isoCount > 80) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    const gates = [];
    const a = CombatRoomSystem._arena;
    if (a) {
        if (a.entryGate) gates.push({ kind: 'entry', x: Math.round(a.entryGate.center.x), y: Math.round(a.entryGate.center.y), tex: a.entryGate.sprite ? a.entryGate.sprite.texture.key : null, frame: a.entryGate.sprite ? a.entryGate.sprite.frame.name : null });
        for (let i = 0; i < (a.passages || []).length; i++) {
            for (const g of (a.passages[i].gates || [])) gates.push({ kind: 'passage' + (i + 1), x: Math.round(g.center.x), y: Math.round(g.center.y), tex: g.sprite ? g.sprite.texture.key : null, frame: g.sprite ? g.sprite.frame.name : null });
        }
    }
    return {
        arenaInfo: arenaInfo ? { rooms: arenaInfo.rooms.length, world: [arenaInfo.worldW, arenaInfo.worldH] } : null,
        arenaErr, isoCount,
        gates,
        wallGate: { seg: !!WG._seg, sprite: !!WG.sprite, frame: WG.sprite ? WG.sprite.frame.name : null },
        placeCalls: calls,
    };
})()`);
console.log(JSON.stringify(r, null, 1));

await new Promise((r) => setTimeout(r, 1200));
await shot('demon-cavern2-overview');

const gateShot = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const a = CombatRoomSystem._arena;
    const gates = [];
    if (a) {
        if (a.entryGate) gates.push(a.entryGate);
        for (const rec of a.passages || []) for (const g of rec.gates || []) gates.push(g);
    }
    if (window.WallGate && window.WallGate.sprite) gates.push(window.WallGate);
    if (!gates.length) return { none: true };
    const gate = gates.find((g) => g.sprite && g.sprite.active) || gates[0];
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam && gate.sprite) { cam.centerOn(gate.sprite.x, gate.sprite.y); cam.setZoom(1.6); }
    await new Promise((r) => setTimeout(r, 400));
    return { gates: gates.length, center: gate.sprite ? [Math.round(gate.sprite.x), Math.round(gate.sprite.y)] : null };
})()`);
console.log('gate cam:', JSON.stringify(gateShot));
await shot('demon-cavern2-gate');

console.log('ERRORS:');
console.log(errs.slice(0, 12).join('\n') || '(none)');
edge.kill();
