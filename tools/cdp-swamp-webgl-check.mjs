#!/usr/bin/env node
/* 复现沼泽地牢 WebGL 崩溃：真实 GPU 无头加载 → 进沼泽竞技场 → 截图 + 收集 console 错误 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9297;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-swamp-webgl-'));
// 不开 --disable-gpu：真实 GPU 路径
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
const logs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled') {
        const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (/\[PASSAGE\]|\[SEAL\]/.test(txt)) {
            logs.push(`[${m.params.type}] ${txt}`);
            return;
        }
        if (m.params.type === 'error' || /webgl|shader|context|\[SEAL\]|\[PASSAGE\]/i.test(txt)) logs.push(`[${m.params.type}] ${txt}`);
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
console.log('ready, webgl:', await evalJs(`(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? gl.getParameter(gl.RENDERER) : 'no-webgl';
})()`));

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
    if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
    CONFIG.WORLD_WIDTH = 2048; CONFIG.WORLD_HEIGHT = 2048;
    player.x = 1024; player.y = 1024;
    const dungeonType = '${process.env.DUNGEON || 'swamp'}';
    DungeonMapSystem.init('scene7', player, dungeonType);
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    if (node) { DungeonMapSystem.currentNodeId = node.id; await DungeonMapSystem._enterNode(node); }
    await new Promise((r) => setTimeout(r, 1800));
    return { node: node ? node.type : null };
})()`);
console.log('arena:', JSON.stringify(r));
await shot('swamp_webgl_arena');
// 放大通道1（门 ~2103,1230 / 2938,1713 → 中段 ~2520,1470）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 2520; p.y = 1470;
    Camera.x = 2520; Camera.y = 1470;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('swamp_corridor1');
// 放大通道2
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 4584; p.y = 2662;
    Camera.x = 4584; Camera.y = 2662;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('swamp_corridor2');

// 放大通道1中段（3 段墙的接缝区）+ 端部（封口与预制交界）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    p.x = 2400; p.y = 1460;
    Camera.x = 2400; Camera.y = 1460;
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 500));
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_corridor1_zoom3');
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 2050; p.y = 1370;
    Camera.x = 2050; Camera.y = 1370;
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 500));
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_corridor1_end_zoom3');
// 门口交界（room B 侧）：走廊墙与房间墙 60° 相接处
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    p.x = 2900; p.y = 1700;
    Camera.x = 2900; Camera.y = 1700;
    if (scene) scene.cameras.main.setZoom(4);
    await new Promise((r) => setTimeout(r, 600));
    if (scene) scene.cameras.main.setZoom(4);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_gate_junction_zoom4');
// 无裁剪的全房间视角（看墙是否突入房间）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 2200; p.y = 1300;
    Camera.x = 2200; Camera.y = 1300;
    await new Promise((r) => setTimeout(r, 600));
    return true;
})()`);
await shot('swamp_noclip_roomA_view');
// 走廊中段 3 段瓦接缝（side+ 在 t≈-187 附近）放大
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    p.x = 2266; p.y = 1631;
    Camera.x = 2266; Camera.y = 1631;
    if (scene) scene.cameras.main.setZoom(4);
    await new Promise((r) => setTimeout(r, 600));
    if (scene) scene.cameras.main.setZoom(4);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_seam_zoom4');
// 通道与房间交界处 zoom 1.5（看地板覆盖墙角）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 2050; p.y = 1320;
    Camera.x = 2050; Camera.y = 1320;
    if (scene) scene.cameras.main.setZoom(1.5);
    await new Promise((r) => setTimeout(r, 600));
    if (scene) scene.cameras.main.setZoom(1.5);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_floor_junction15');
await evalJs(`(() => {
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    return true;
})()`);

// 定位通道直墙件，检查相邻墙段沿走廊轴的间隙
const gapProbe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const pieces = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight' && p.tex !== 'wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        pieces.push({
            x: Math.round(p.x), y: Math.round(p.y), sx: p.scaleX, sy: p.scaleY,
            A: [Math.round(seg[0].x), Math.round(seg[0].y)],
            B: [Math.round(seg[1].x), Math.round(seg[1].y)],
        });
    }
    return pieces;
})()`);
console.log('corridor wall pieces:', JSON.stringify(gapProbe));
fs.writeFileSync(path.join(OUT_DIR, 'swamp_corridor_pieces.json'), JSON.stringify(gapProbe));

// 运行中预制库的 左右通道·沼泽 内容
const prefabDump = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { getWallPrefabLibrary } = await import(pick('world/wall-prefabs.js'));
    const lib = getWallPrefabLibrary();
    const key = Object.keys(lib).find((k) => {
        const p = lib[k];
        return p && p.pieces && p.pieces.filter((q) => q.tex === 'swamp_gate').length === 2;
    });
    const p = lib[key];
    return p ? {
        key, pieces: p.pieces.map((q) => ({
            tex: q.tex, x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10,
            sx: q.scaleX, sy: q.scaleY,
        })),
    } : { key: null };
})()`);
console.log('prefab dump:', JSON.stringify(prefabDump));

// 竞技场房间几何 + 门闸位置
const roomGeo = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const rooms = CombatRoomSystem._arenaRooms || (CombatRoomSystem.getArenaRooms ? CombatRoomSystem.getArenaRooms() : null);
    const gates = [];
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) {
        scene.children.list.forEach((s) => {
            if (s.texture && typeof s.texture.key === 'string' && s.texture.key === 'swamp_gate') {
                gates.push({ x: Math.round(s.x), y: Math.round(s.y) });
            }
        });
    }
    return { rooms, gates };
})()`);
console.log('room geo:', JSON.stringify(roomGeo));

// 端部错位墙段详情（深度/标记）
const endPieces = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const out = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        if (mx > 1800 && mx < 3200 && my > 1100 && my < 1950) {
            out.push({
                x: Math.round(p.x), y: Math.round(p.y), depth: Math.round(p.depth),
                sx: p.scaleX, corner: !!p._corner, gate: !!p._gate,
                label: p.label || '',
                A: [Math.round(seg[0].x), Math.round(seg[0].y)],
                B: [Math.round(seg[1].x), Math.round(seg[1].y)],
            });
        }
    }
    return out;
})()`);
console.log('end pieces detail:', JSON.stringify(endPieces, null, 1));
fs.writeFileSync(path.join(OUT_DIR, 'swamp_end_pieces.json'), JSON.stringify(endPieces));

// 探测烘焙地板纹理在关键点（墙角/楔形区）的像素：亮=草地，暗=黑/漏洞
const floorProbe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { Renderer } = await import(pick('world/renderer.js'));
    const canvas = Renderer.terrainTexture;
    const out = { hasCanvas: !!canvas };
    if (!canvas) return out;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const pts = {
        'corr_wall_x_roomA_plus': [1921, 1431],
        'corr_wall_x_roomA_minus': [2316, 1202],
        'corr_wall_x_roomB_plus': [2754, 1912],
        'corr_wall_x_roomB_minus': [3150, 1683],
        'gate_mid1': [2103, 1324],
        'corridor_mid': [2521, 1565],
        'corridor_sideA': [2429, 1724],
        'wedge_plus_A': [1900, 1400],
        'wedge_minus_A': [2280, 1210],
    };
    out.points = {};
    for (const [k, [x, y]] of Object.entries(pts)) {
        if (x < 0 || y < 0 || x >= w || y >= h) { out.points[k] = 'out'; continue; }
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        out.points[k] = { rgb: [d[0], d[1], d[2]], lum: (d[0] + d[1] + d[2]) / 3 };
    }
    out.canvasSize = [w, h];
    return out;
})()`);
console.log('floor probe:', JSON.stringify(floorProbe, null, 1));

// 通道墙端点 + 地板 quad（运行时）
const geoNow = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const walls = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2;
        if (mx > 1800 && mx < 3400) {
            walls.push({ x: Math.round(p.x), y: Math.round(p.y), A: [Math.round(seg[0].x), Math.round(seg[0].y)], B: [Math.round(seg[1].x), Math.round(seg[1].y)], sx: p.scaleX });
        }
    }
    return { walls, hasQuad: !!CombatRoomSystem._arenaCorridors };
})()`);
console.log('geo now:', JSON.stringify(geoNow, null, 1));

// 导出烘焙地板纹理（terrainTexture canvas -> dataURL -> 保存）
const floorImg = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { Renderer } = await import(pick('world/renderer.js'));
    const canvas = Renderer.terrainTexture;
    if (!canvas) return { ok: false };
    return { ok: true, url: canvas.toDataURL('image/png') };
})()`);
if (floorImg && floorImg.ok) {
    const b64 = floorImg.url.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(OUT_DIR, 'swamp_terrain_floor.png'), buf);
    console.log('saved terrain floor', buf.length);
}
// 截图后检查 canvas 是否还在渲染（非全黑）
const px = await evalJs(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return { noCanvas: true };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { ctxLost: gl ? gl.isContextLost() : 'no-gl', w: c.width, h: c.height };
})()`);
console.log('canvas state:', JSON.stringify(px));
console.log('logs:', JSON.stringify(logs.slice(0, 12), null, 1));
edge.kill();
process.exit(0);
