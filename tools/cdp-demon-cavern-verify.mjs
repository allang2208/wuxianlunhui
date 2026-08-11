#!/usr/bin/env node
/* 恶魔洞窟路线 B 素材游戏内验证：进入 demonCavern 战斗房 → 检查岩壁/铁闸/地砖 + 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9301;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-demon-'));
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
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const { SceneManager } = await import(pick('world/scene-manager.js'));
    const { CONFIG } = await import(pick('config/config.js'));
    const Game = window.Game;
    const player = Game.player;
    if (player && player.iceWallSystem && typeof player.iceWallSystem.breakdown === 'function') player.iceWallSystem.breakdown();
    Game.entities.clear();
    Game.entities.set('player', player);
    CONFIG.WORLD_WIDTH = 2048; CONFIG.WORLD_HEIGHT = 2048;
    player.x = 1024; player.y = 1024;
    DungeonMapSystem.init('scene7', player, 'demonCavern');
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    // 等闸门贴图就绪（BootScene 在真实流程中先加载完；测试直进需等待）
    for (let i = 0; i < 40; i++) {
        const sc = window.__phaserScene;
        if (sc && sc.textures && sc.textures.exists('demon_gate')) break;
        await new Promise((r) => setTimeout(r, 250));
    }
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    let enterErr = null;
    if (node) {
        DungeonMapSystem.currentNodeId = node.id;
        try { await DungeonMapSystem._enterNode(node); } catch (e) { enterErr = String(e && e.stack ? e.stack : e); }
    }
    let isoCount = 0, gateReady = false;
    for (let i = 0; i < 24; i++) {
        const ws = (await import(pick('world/wall-system.js'))).WallSystem;
        isoCount = ws.isoVisuals.length;
        if (isoCount > 80) {
            const WG = (typeof window !== 'undefined') ? window.WallGate : null;
            if (WG && WG.sprite) gateReady = true;
        }
        if (isoCount > 80 && gateReady) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    let gateInfo = null;
    try {
        const CRS = (await import(pick('world/combat-room-system.js'))).CombatRoomSystem;
        const a = CRS._arena;
        const gates = [];
        if (a) {
            if (a.entryGate) gates.push({ kind: 'entry', inst: a.entryGate });
            for (let i = 0; i < (a.passages || []).length; i++) {
                for (const g of (a.passages[i].gates || [])) gates.push({ kind: 'passage' + (i + 1), inst: g });
            }
        }
        gateInfo = gates.map(({ kind, inst }) => ({
            kind,
            tex: inst.sprite && inst.sprite.texture ? inst.sprite.texture.key : null,
            frame: inst.sprite ? inst.sprite.frame.name : null,
            x: Math.round(inst.sprite ? inst.sprite.x : -1),
            y: Math.round(inst.sprite ? inst.sprite.y : -1),
        }));
    } catch (e) { gateInfo = { err: String(e) }; }
    const wallTexs = new Set();
    const ws2 = (await import(pick('world/wall-system.js'))).WallSystem;
    for (const v of ws2.isoVisuals) wallTexs.add(v.tex);
    let texDbg = null;
    try {
        const scene = window.__phaserScene;
        const tex = scene && scene.textures ? scene.textures.get('demon_gate') : null;
        texDbg = {
            exists: !!(scene && scene.textures && scene.textures.exists('demon_gate')),
            frames: tex ? tex.frameTotal : null,
            frameNames: tex ? tex.getFrameNames().slice(0, 4) : null,
        };
    } catch (e) { texDbg = { err: String(e) }; }
    return { dungeonType: DungeonMapSystem.dungeonType, node: node ? node.type : null, isoCount, enterErr, gateInfo, wallTexs: [...wallTexs].slice(0, 12), texDbg };
})()`);
console.log('entered:', JSON.stringify(r, null, 1));
await new Promise((r) => setTimeout(r, 1200));
await shot('demon-cavern-overview');

// 闸门特写：把相机对准闸门
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
    const gate = gates[0];
    if (!gate || !gate.sprite) return { none: true };
    const cx = gate.sprite.x, cy = gate.sprite.y;
    const cam = window.__phaserScene ? window.__phaserScene.cameras.main : null;
    if (cam) { cam.centerOn(cx, cy); cam.setZoom(1.4); }
    await new Promise((r) => setTimeout(r, 400));
    return { center: [Math.round(cx), Math.round(cy)], zoom: cam ? cam.zoom : null };
})()`);
console.log('gate cam:', JSON.stringify(gateShot));
await shot('demon-cavern-gate');

// 关闭帧特写
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const a = CombatRoomSystem._arena;
    const gates = [];
    if (a) {
        if (a.entryGate) gates.push(a.entryGate);
        for (const rec of a.passages || []) for (const g of rec.gates || []) gates.push(g);
    }
    if (!gates.length) return;
    const g = gates[0];
    if (g._animCounter) g._animCounter.stop();
    if (g.sprite) g.sprite.setFrame(0);
    await new Promise((r) => setTimeout(r, 300));
})()`);
await shot('demon-cavern-gate-closed');

// 关/开门帧验证
const anim = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const a = CombatRoomSystem._arena;
    const gates = [];
    if (a) {
        if (a.entryGate) gates.push(a.entryGate);
        for (const rec of a.passages || []) for (const g of rec.gates || []) gates.push(g);
    }
    if (!gates.length) return { none: true };
    const g = gates[0];
    const setFrame = (n) => { if (g.sprite) g.sprite.setFrame(n); if (g._animCounter) g._animCounter.stop(); };
    const out = [];
    setFrame(0); await new Promise((r) => setTimeout(r, 250));
    out.push({ name: 'closed', frame: g.sprite ? g.sprite.frame.name : null });
    setFrame(15); await new Promise((r) => setTimeout(r, 250));
    out.push({ name: 'open', frame: g.sprite ? g.sprite.frame.name : null });
    return out;
})()`);
console.log('anim:', JSON.stringify(anim));
await shot('demon-cavern-gate-open');

console.log('ERRORS:');
console.log(errs.slice(0, 12).join('\n') || '(none)');
edge.kill();
