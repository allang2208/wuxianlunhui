#!/usr/bin/env node
/* 量化通道2（房2→房3）直墙件相对房间边线的侵入：
 * 在页面进入沼泽竞技场后，读取 CombatRoomSystem._arena.rooms + WallSystem.isoVisuals，
 * 把 passage2 范围内的 swamp_wall_straight 端点投影到房2 RB / 房3 LT 边线，
 * 输出“越线深度”（>0 = 探入房内）。同时截一张房2入口放大图。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9298;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-pass2-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'about:blank',
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
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
    const dungeonType = '${process.env.DUNGEON || 'swamp'}';
    DungeonMapSystem.init('scene7', player, dungeonType);
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    await new Promise((r) => setTimeout(r, 600));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    if (node) { DungeonMapSystem.currentNodeId = node.id; await DungeonMapSystem._enterNode(node); }
    let isoCount = 0;
    for (let i = 0; i < 14; i++) {
        const n = (await import(pick('world/wall-system.js'))).WallSystem.isoVisuals.length;
        if (n > 50) { isoCount = n; break; }
        await new Promise((r) => setTimeout(r, 500));
    }
    return { dungeonType: DungeonMapSystem.dungeonType, node: node ? node.type : null, isoCount };
})()`);
console.log('entered:', JSON.stringify(r));

// 主探针：房间几何 + 通道2墙件 + 越线深度
    const probe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    const rooms = arena ? arena.rooms.map((rm) => ({ cx: rm.cx, cy: rm.cy, rx: rm.rx, ry: rm.ry, index: rm.index })) : null;
    const texSummary = {};
    for (const p of WallSystem.isoVisuals) {
        texSummary[p.tex] = (texSummary[p.tex] || 0) + 1;
    }
    // 房2 RB 边 / 房3 LT 边（同通道2 的 edgeA/edgeB）
    const roomA = arena ? arena.rooms[1] : null;
    const roomB = arena ? arena.rooms[2] : null;
    const edgeA = roomA ? { P: { x: roomA.cx + roomA.rx, y: roomA.cy }, d: { x: -roomA.rx, y: roomA.ry } } : null;
    const edgeB = roomB ? { P: { x: roomB.cx, y: roomB.cy - roomB.ry }, d: { x: -roomB.rx, y: roomB.ry } } : null;
    const sOf = (e, P) => {
        let nx = -e.d.y, ny = e.d.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        // 法线指向房心
        const center = (e === edgeA) ? { x: roomA.cx, y: roomA.cy } : { x: roomB.cx, y: roomB.cy };
        const sc = (center.x - e.P.x) * nx + (center.y - e.P.y) * ny;
        if (sc < 0) { nx = -nx; ny = -ny; }
        return (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
    };
    const walls = [];
    for (const p of WallSystem.isoVisuals) {
        const tex = p.tex;
        if (tex !== 'swamp_wall_straight' && tex !== 'wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        const [A, B] = seg;
        const mx = (A.x + B.x) / 2;
        if (mx < 3600 || mx > 5500) continue;
        walls.push({
            x: Math.round(p.x), y: Math.round(p.y), sx: +(p.scaleX || 1).toFixed(3),
            A: [Math.round(A.x), Math.round(A.y)],
            B: [Math.round(B.x), Math.round(B.y)],
            sA: edgeA ? +sOf(edgeA, A).toFixed(1) : null,
            sB: edgeA ? +sOf(edgeA, B).toFixed(1) : null,
            tA: edgeB ? +sOf(edgeB, A).toFixed(1) : null,
            tB: edgeB ? +sOf(edgeB, B).toFixed(1) : null,
        });
    }
    // 房2 门洞内侧碰撞检查：原突出件在房2 内部留下的墙段
    const coll = [];
    if (WallSystem.canMoveTo) {
        for (const [x, y] of [[4238, 2313], [4300, 2350], [4350, 2380], [4250, 2400], [4400, 2330], [4450, 2360], [4200, 2280]]) {
            coll.push({ x, y, can: WallSystem.canMoveTo(x, y, 20) });
        }
    }
    return {
        rooms,
        camZoom: (() => {
            const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
            return scene ? scene.cameras.main.zoom : null;
        })(),
        texSummary,
        isoCount: WallSystem.isoVisuals.length,
        arenaActive: !!(arena && arena.rooms && arena.rooms.length),
        edgeA: edgeA ? { P: [edgeA.P.x, edgeA.P.y], d: [edgeA.d.x, edgeA.d.y] } : null,
        edgeB: edgeB ? { P: [edgeB.P.x, edgeB.P.y], d: [edgeB.d.x, edgeB.d.y] } : null,
        walls,
        coll,
    };
})()`);
console.log('probe:', JSON.stringify(probe, null, 1));
fs.writeFileSync(path.join(OUT_DIR, 'passage2_probe.json'), JSON.stringify(probe, null, 1));

// 房2 入口放大截图（房2 RB 边中点附近，向房3 方向拉远一点看整条通道）
const spriteDump = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const scene = window.__phaserScene;
    const out = { gates: [], pieces: [] };
    if (scene) {
        scene.children.list.forEach((s) => {
            if (!s.texture || typeof s.texture.key !== 'string') return;
            const k = s.texture.key;
            if (k === 'swamp_gate' || k === 'swamp_wall_straight') {
                const rec = { tex: k, x: Math.round(s.x), y: Math.round(s.y), dw: Math.round(s.displayWidth), dh: Math.round(s.displayHeight), depth: Math.round(s.depth * 10) / 10, flipX: !!s.flipX };
                if (k === 'swamp_gate') out.gates.push(rec); else out.pieces.push(rec);
            }
        });
    }
    // 通道2 直墙件（x 3800~5300）的 base 段
    const walls = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2;
        if (mx < 3800 || mx > 5300) continue;
        walls.push({
            A: [Math.round(seg[0].x), Math.round(seg[0].y)],
            B: [Math.round(seg[1].x), Math.round(seg[1].y)],
            depth: Math.round(p.depth * 10) / 10,
        });
    }
    out.walls = walls;
    return out;
})()`);
console.log('sprite dump:', JSON.stringify(spriteDump, null, 1));

await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 4480; p.y = 2520;
    Camera.x = 4480; Camera.y = 2520;
    if (scene) scene.cameras.main.setZoom(1.6);
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('passage2_roomA_junction');
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 4600; p.y = 2400;
    Camera.x = 4600; Camera.y = 2400;
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 600));
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('passage2_roomA_junction_zoom3');
edge.kill();
process.exit(0);
