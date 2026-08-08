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
await new Promise((r) => setTimeout(r, 600));
return { nodes: DungeonMapSystem.nodes.length, dungeonType: DungeonMapSystem.dungeonType };
})()`);
console.log('map entered:', JSON.stringify(r));
await shot('swamp_map_select');
// 背景图状态
const bgCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const zcfg = DungeonConfig.getZombieDungeonConfig(DungeonMapSystem.dungeonType);
    const img = DungeonMapSystem._bgImg;
    return {
        dungeonType: DungeonMapSystem.dungeonType,
        mapBackground: zcfg && zcfg.mapBackground,
        bgLoaded: !!(img && img.complete && img.naturalWidth > 0),
        bgSize: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
})()`);
console.log('bg check:', JSON.stringify(bgCheck));
const arena = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    if (node) { DungeonMapSystem.currentNodeId = node.id; await DungeonMapSystem._enterNode(node); }
    await new Promise((r) => setTimeout(r, 1800));
    return { node: node ? node.type : null };
})()`);
console.log('arena:', JSON.stringify(arena));
console.log('cam state arena:', JSON.stringify(await evalJs(`(async () => {
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (!scene) return { noScene: true };
    const cam = scene.cameras.main;
    const walls = scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_wall_straight');
    return {
        hasScene: true,
        worldView: { x: Math.round(cam.worldView.x), y: Math.round(cam.worldView.y), w: Math.round(cam.worldView.width), h: Math.round(cam.worldView.height) },
        zoom: cam.zoom,
        canvas: [scene.scale.width, scene.scale.height],
        wallTotal: walls.length,
        inCam: walls.filter((s) => cam.worldView.contains(s.x, s.y)).length,
    };
})()`)));
// 通道3 门实例检查（转弯通道：房3.TR→房4.BL）
const p3Gates = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const p3 = arena.passages[2];
    return {
        gateCount: p3.gates.length,
        gates: p3.gates.map((g) => ({
            center: g.center ? [Math.round(g.center.x), Math.round(g.center.y)] : null,
            baseA: g.baseA ? [Math.round(g.baseA.x), Math.round(g.baseA.y)] : null,
            baseB: g.baseB ? [Math.round(g.baseB.x), Math.round(g.baseB.y)] : null,
            open: g.open,
            hasSprite: !!(g.sprite && g.sprite.active),
        })),
        mid1: [Math.round(p3.mid1.x), Math.round(p3.mid1.y)],
        mid2: [Math.round(p3.mid2.x), Math.round(p3.mid2.y)],
    };
})()`);
console.log('passage3 gates:', JSON.stringify(p3Gates, null, 1));
// 模拟房3 清场：重建场（scene 就绪）→ stage=3 + waveSpawned + 全死怪 → _checkZombieCombatComplete
const gateSim = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    // 重建场（scene 已就绪，门可建）
    if (CombatRoomSystem._arena) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    CombatRoomSystem.enterCombatArena(window.Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena after rebuild' };
    // 设房3 战斗状态
    arena.stage = 3;
    arena.waveSpawned = true;
    arena.awaiting = 0;
    DungeonMapSystem._arenaRoomCleared = false;
    DungeonMapSystem._combatMonsters = [];
    DungeonMapSystem.state = 'combat';
    DungeonMapSystem._zombieWaveActive = true;
    // 先关门（模拟进房3 后布防关门）
    CombatRoomSystem.setArenaRoomGates(3, false);
    const before = arena.passages[2].gates.map((g) => g.open);
    const cleared = DungeonMapSystem._checkZombieCombatComplete();
    const after = arena.passages[2].gates.map((g) => g.open);
    const after2 = arena.passages[1].gates.map((g) => g.open);
    return {
        before,
        cleared,
        after,
        afterP2: after2,
        stage: arena.stage,
        roomsLen: arena.rooms.length,
        awaiting: arena.awaiting,
    };
})()`);
console.log('gate sim:', JSON.stringify(gateSim, null, 1));
// 通道3 门的门洞段/墙身段几何（转弯门 base 方向疑似反）
const gateSegs = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const p3 = arena.passages[2];
    const out = p3.gates.map((g) => ({
        center: g.center ? [Math.round(g.center.x), Math.round(g.center.y)] : null,
        wallSegs: g.wallSegs ? g.wallSegs.map((s) => ({ x1: Math.round(s.x1), y1: Math.round(s.y1), x2: Math.round(s.x2), y2: Math.round(s.y2) })) : [],
        gateSeg: g.gateSeg ? { x1: Math.round(g.gateSeg.x1), y1: Math.round(g.gateSeg.y1), x2: Math.round(g.gateSeg.x2), y2: Math.round(g.gateSeg.y2) } : null,
    }));
    // 房3 TR 边 / 房4 BL 边（通道3 端点）
    const r3 = arena.rooms[2], r4 = arena.rooms[3];
    return {
        gates: out,
        r3TR: { P: [Math.round(r3.cx), Math.round(r3.cy - r3.ry)], d: [Math.round(r3.rx), Math.round(r3.ry)] },
        r4BL: { P: [Math.round(r4.cx), Math.round(r4.cy + r4.ry)], d: [Math.round(-r4.rx), Math.round(-r4.ry)] },
        mid1: [Math.round(p3.mid1.x), Math.round(p3.mid1.y)],
        mid2: [Math.round(p3.mid2.x), Math.round(p3.mid2.y)],
    };
})()`);
console.log('gate segs:', JSON.stringify(gateSegs, null, 1));
// 完整门控链路：进房3 → 关门 → 刷波 → 杀怪 → 开门
const gateChain = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const { Camera } = await import(pick('world/camera.js'));
    if (CombatRoomSystem._arena) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    CombatRoomSystem.enterCombatArena(window.Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const r3 = arena.rooms[2];
    const p = window.Game.player;
    // 1. 玩家进房3（房3 中心附近，非通道）
    p.x = r3.cx - 200; p.y = r3.cy;
    arena.stage = 2; arena.awaiting = 3; arena.waveSpawned = false;
    DungeonMapSystem._arenaRoomCleared = false;
    DungeonMapSystem.state = 'combat';
    DungeonMapSystem._zombieWaveActive = true;
    DungeonMapSystem._arenaDoorPending = null;
    const s1 = { stage: arena.stage, awaiting: arena.awaiting };
    // 2. 触发进房判定
    DungeonMapSystem._checkArenaRoomEntry();
    const s2 = { stage: arena.stage, awaiting: arena.awaiting, pending: !!DungeonMapSystem._arenaDoorPending };
    // 3. 推进关门（玩家距门远）
    p.x = r3.cx + 300; p.y = r3.cy + 200;
    for (let i = 0; i < 30 && DungeonMapSystem._arenaDoorPending; i++) {
        DungeonMapSystem._updateArenaDoorClose(120);
    }
    const s3 = { pending: !!DungeonMapSystem._arenaDoorPending, waveSpawned: arena.waveSpawned, stage: arena.stage, gatesP3: arena.passages[2].gates.map((g) => g.open) };
    // 4. 模拟杀光怪（_combatMonsters 由刷波填充，这里置全死）
    if (DungeonMapSystem._combatMonsters.length === 0) {
        DungeonMapSystem._combatMonsters = [{ active: false, hp: 0 }];
    }
    DungeonMapSystem._combatMonsters.forEach((m) => { m.active = false; m.hp = 0; });
    arena.waveSpawned = true;
    // 5. 清场判定
    const cleared = DungeonMapSystem._checkZombieCombatComplete();
    const s5 = { cleared, stage: arena.stage, awaiting: arena.awaiting, roomCleared: DungeonMapSystem._arenaRoomCleared, gatesP3: arena.passages[2].gates.map((g) => g.open), gatesP2: arena.passages[1].gates.map((g) => g.open) };
    return { s1, s2, s3, s5 };
})()`);
console.log('gate chain:', JSON.stringify(gateChain, null, 1));
// 宝箱房门墙位置（末房房5）——是否挡住通道入口
const chestCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { ChestRoomSystem } = await import(pick('world/chest-room-system.js'));
    const arena = CombatRoomSystem._arena;
    const out = { chestActive: !!ChestRoomSystem && !!ChestRoomSystem.active, arenaRooms: arena ? arena.rooms.length : 0 };
    if (ChestRoomSystem && ChestRoomSystem._gate && ChestRoomSystem._gate.sprite) {
        const g = ChestRoomSystem._gate;
        out.chestGate = {
            x: Math.round(g.sprite.x), y: Math.round(g.sprite.y),
            segs: (g.segs || []).map((s) => ({ x1: Math.round(s.x1), y1: Math.round(s.y1), x2: Math.round(s.x2), y2: Math.round(s.y2) })),
            open: g.open,
        };
    }
    if (arena) {
        const last = arena.rooms[arena.rooms.length - 1];
        out.lastRoom = { cx: Math.round(last.cx), cy: Math.round(last.cy), rx: Math.round(last.rx), ry: Math.round(last.ry) };
        // 末房入口通道（房4→房5 = passages[3]）
        const p4 = arena.passages[3];
        out.p4 = { mid1: [Math.round(p4.mid1.x), Math.round(p4.mid1.y)], mid2: [Math.round(p4.mid2.x), Math.round(p4.mid2.y)] };
    }
    return out;
})()`);
console.log('chest check:', JSON.stringify(chestCheck, null, 1));
// 十修验证：波次数 = 房间数 + 房3 清完开门
const waveCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    if (CombatRoomSystem._arena) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    CombatRoomSystem.enterCombatArena(window.Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
    const arena = CombatRoomSystem._arena;
    const roomCount = CombatRoomSystem.getArenaRoomCount();
    // 重建 _zombieCombat 并走修复后的 forceArenaWaves 时序（enterCombatArena 之后）
    DungeonMapSystem._zombieCombatNode = { isElite: false };
    DungeonMapSystem._zombieCombat = new (await import(pick('world/zombie-dungeon.js'))).ZombieDungeonCombat(undefined, false, null, 'swamp', null);
    DungeonMapSystem._zombieCombat.forceArenaWaves(roomCount);
    const totalWaves = DungeonMapSystem._zombieCombat._totalWaves;
    // 模拟房3 清完
    arena.stage = 3; arena.waveSpawned = true; arena.awaiting = 0;
    DungeonMapSystem._arenaRoomCleared = false;
    DungeonMapSystem._combatMonsters = [{ active: false, hp: 0 }];
    DungeonMapSystem.state = 'combat';
    DungeonMapSystem._zombieWaveActive = true;
    DungeonMapSystem._zombieCombat._currentWave = 3;
    const isCompleteAfter3 = DungeonMapSystem._zombieCombat.isComplete;
    CombatRoomSystem.setArenaRoomGates(3, false);
    const before = arena.passages[2].gates.map((g) => g.open);
    DungeonMapSystem._checkZombieCombatComplete();
    const after = arena.passages[2].gates.map((g) => g.open);
    return { roomCount, totalWaves, isCompleteAfter3, before, after, awaiting: arena.awaiting };
})()`);
console.log('wave check:', JSON.stringify(waveCheck, null, 1));
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
// 重同步墙精灵后对比渲染（诊断"精灵在但没画"）
const resync = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { Camera } = await import(pick('world/camera.js'));
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    const before = scene ? scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_wall_straight').length : -1;
    if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
    const after = scene ? scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_wall_straight').length : -1;
    const p = window.Game.player;
    p.x = 2520; p.y = 1470;
    Camera.x = p.x; Camera.y = p.y;
    await new Promise((r) => setTimeout(r, 800));
    return { before, after, vw: scene && scene.visualWalls ? scene.visualWalls.countActive(true) : -1 };
})()`);
console.log('resync:', JSON.stringify(resync));
await shot('swamp_corridor1_resync');
// 通道3（房3.TR→房4.BL 转弯通道）墙件/碰撞/截图
const p3Check = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const r3 = arena.rooms[2], r4 = arena.rooms[3];
    const p3 = arena.passages[2];
    const walls = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        if (mx > 6000 && mx < 7900 && my > 3000 && my < 4600) {
            walls.push({ x: Math.round(q.x), y: Math.round(q.y), A: [Math.round(seg[0].x), Math.round(seg[0].y)], B: [Math.round(seg[1].x), Math.round(seg[1].y)], depth: Math.round(q.depth) });
        }
    }
    // 通道中点与两侧的可通行性
    const can = [];
    if (WallSystem.canMoveTo) {
        for (const [x, y] of [[6649, 3555], [6500, 3600], [6800, 3510], [6231, 3797], [7067, 3314]]) {
            can.push({ p: [x, y], can: WallSystem.canMoveTo(x, y, 20) });
        }
    }
    return {
        r3: [Math.round(r3.cx), Math.round(r3.cy), r3.outEdge],
        r4: [Math.round(r4.cx), Math.round(r4.cy), r4.inEdge],
        p3: { mid1: [Math.round(p3.mid1.x), Math.round(p3.mid1.y)], mid2: [Math.round(p3.mid2.x), Math.round(p3.mid2.y)] },
        wallCount: walls.length,
        walls,
        can,
    };
})()`);
console.log('passage3 check:', JSON.stringify(p3Check, null, 1));
// 通道3 碰撞剖面：沿轴线每 50px 采样 + 两侧
const p3Coll = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena || !WallSystem.canMoveTo) return { err: 'no' };
    const p = arena.passages[2];
    const dx = p.mid2.x - p.mid1.x, dy = p.mid2.y - p.mid1.y;
    const len = Math.hypot(dx, dy);
    const ax = dx / len, ay = dy / len;
    const pxx = -ay, pyy = ax;
    const rows = [];
    for (let t = 0; t <= len; t += 50) {
        const cx = p.mid1.x + ax * t, cy = p.mid1.y + ay * t;
        const row = { t: Math.round(t), center: WallSystem.canMoveTo(cx, cy, 20) };
        for (const off of [-210, -140, -70, 70, 140, 210]) {
            row['off' + off] = WallSystem.canMoveTo(cx + pxx * off, cy + pyy * off, 20);
        }
        rows.push(row);
    }
    return { len: Math.round(len), rows };
})()`);
console.log('passage3 coll:', JSON.stringify(p3Coll, null, 1));
// 通道3 墙件沿轴分布：perp（垂直偏移）与 along（沿轴位置）
const p3Walls = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const p = arena.passages[2];
    const dx = p.mid2.x - p.mid1.x, dy = p.mid2.y - p.mid1.y;
    const len = Math.hypot(dx, dy);
    const ax = dx / len, ay = dy / len;
    const pxx = -ay, pyy = ax;
    const out = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        // 只统计通道3附近的件（含房3/房4 边界，沿轴 ±700）
        const along = (mx - p.mid1.x) * ax + (my - p.mid1.y) * ay;
        if (along < -600 || along > 1600) continue;
        const perp = (mx - p.mid1.x) * pxx + (my - p.mid1.y) * pyy;
        const dA = Math.round((seg[0].x - p.mid1.x) * pxx + (seg[0].y - p.mid1.y) * pyy);
        const dB = Math.round((seg[1].x - p.mid1.x) * pxx + (seg[1].y - p.mid1.y) * pyy);
        out.push({
            x: Math.round(q.x), y: Math.round(q.y),
            along: Math.round(along), perp: Math.round(perp),
            perpA: dA, perpB: dB,
            label: q.label || null,
            depth: Math.round(q.depth),
        });
    }
    out.sort((a, b) => a.along - b.along);
    return { len: Math.round(len), walls: out };
})()`);
console.log('passage3 walls dist:', JSON.stringify(p3Walls, null, 1));
// 通道3 预制侧墙件 clip 保留诊断（上下通道·沼泽 → 房3.TR→房4.BL）
const p3Clip = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const { MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const cfg = DungeonConfig.getCombatArenaConfig();
    const analysis = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V2);
    const p3 = arena.passages[2], r3 = arena.rooms[2], r4 = arena.rooms[3];
    const t = { x: p3.mid1.x - analysis.gA.center.x, y: p3.mid1.y - analysis.gA.center.y };
    const out = [];
    for (const q of analysis.def.pieces) {
        const tr = { ...q, x: q.x + t.x, y: q.y + t.y };
        if (CombatRoomSystem._isFunctionalGatePiece(tr)) { out.push({ tex: q.tex, gate: true, x: Math.round(tr.x), y: Math.round(tr.y) }); continue; }
        const kept = CombatRoomSystem._clipPassagePieceToRooms(tr, p3, r3, r4);
        const seg = WallSystem._pieceBaseSegments(tr)[0];
        out.push({
            x: Math.round(tr.x), y: Math.round(tr.y),
            kept: !!kept,
            A: seg ? [Math.round(seg[0].x), Math.round(seg[0].y)] : null,
            B: seg ? [Math.round(seg[1].x), Math.round(seg[1].y)] : null,
        });
    }
    return out;
})()`);
console.log('passage3 clip:', JSON.stringify(p3Clip, null, 1));
// 横墙 (6503,3676) 完整属性与来源
const weirdWall = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const out = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        if (Math.abs(q.x - 6503) < 60 && Math.abs(q.y - 3676) < 60) {
            const seg = WallSystem._pieceBaseSegments(q)[0];
            out.push({ x: q.x, y: q.y, sx: q.scaleX, sy: q.scaleY, flipX: q.flipX, flipY: q.flipY, label: q.label || null, depth: q.depth, corner: !!q._corner, seal: !!q._seal, A: seg ? seg[0] : null, B: seg ? seg[1] : null });
        }
    }
    return out;
})()`);
console.log('weird wall:', JSON.stringify(weirdWall, null, 1));
// 通道4（房4→房5，-v1 反向通道）墙分布
const p4Walls = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const p = arena.passages[3];
    const dx = p.mid2.x - p.mid1.x, dy = p.mid2.y - p.mid1.y;
    const len = Math.hypot(dx, dy);
    const ax = dx / len, ay = dy / len;
    const pxx = -ay, pyy = ax;
    const out = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        const along = (mx - p.mid1.x) * ax + (my - p.mid1.y) * ay;
        if (along < -600 || along > 1600) continue;
        const perp = (mx - p.mid1.x) * pxx + (my - p.mid1.y) * pyy;
        if (Math.abs(perp) > 420) continue;
        out.push({ x: Math.round(q.x), y: Math.round(q.y), along: Math.round(along), perp: Math.round(perp), label: q.label || null, sy: Math.round((q.scaleY || 0) * 1000) / 1000 });
    }
    out.sort((a, b) => a.along - b.along);
    return { mid1: [Math.round(p.mid1.x), Math.round(p.mid1.y)], mid2: [Math.round(p.mid2.x), Math.round(p.mid2.y)], len: Math.round(len), walls: out };
})()`);
console.log('passage4 walls:', JSON.stringify(p4Walls, null, 1));
// 分阶段重建：定位横墙（perp≈0 的程序化墙）在哪个阶段产生
const staged = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const { computeMazeLayout, MAZE_AXIS_V1, MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const cfg = DungeonConfig.getCombatArenaConfig();
    const aV1 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V1);
    const aV2 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V2);
    const analysisFor = (axis) => {
        const isV2 = Math.abs(axis.x * MAZE_AXIS_V2.x + axis.y * MAZE_AXIS_V2.y) > 0.8;
        return isV2 && aV2 ? aV2 : aV1;
    };
    const maze = cfg.maze || {};
    const sizes = [];
    for (let i = 0; i < (maze.roomCount || 5); i++) sizes.push(i === (maze.roomCount || 5) - 1 ? 1792 : 1024);
    const layout = computeMazeLayout({ sizes, passageLen: aV1.len, gap: 0, rows: maze.rows || 0 });
    const countWeird = () => {
        const found = [];
        for (const q of WallSystem.isoVisuals) {
            if (q.tex !== 'swamp_wall_straight' || q.label) continue;
            const seg = WallSystem._pieceBaseSegments(q)[0];
            if (!seg) continue;
            const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
            if (mx > 6000 && mx < 7900 && my > 3000 && my < 4600) {
                const p3 = layout.passages[2];
                const dx = p3.mid2.x - p3.mid1.x, dy = p3.mid2.y - p3.mid1.y;
                const len = Math.hypot(dx, dy);
                const ax = dx / len, ay = dy / len;
                const perp = (mx - p3.mid1.x) * (-ay) + (my - p3.mid1.y) * ax;
                if (Math.abs(perp) < 120) found.push({ x: Math.round(q.x), y: Math.round(q.y), perp: Math.round(perp), A: [Math.round(seg[0].x), Math.round(seg[0].y)], B: [Math.round(seg[1].x), Math.round(seg[1].y)] });
            }
        }
        return found;
    };
    const stages = [];
    const reset = () => { WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = []; };
    const dumpZone = () => {
        const arr = [];
        for (const q of WallSystem.isoVisuals) {
            if (q.tex !== 'swamp_wall_straight') continue;
            const seg = WallSystem._pieceBaseSegments(q)[0];
            if (!seg) continue;
            const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
            if (mx > 6000 && mx < 7900 && my > 3000 && my < 4600) {
                arr.push({ x: Math.round(q.x), y: Math.round(q.y), pw: !!q._passageWall, A: [Math.round(seg[0].x), Math.round(seg[0].y)], B: [Math.round(seg[1].x), Math.round(seg[1].y)] });
            }
        }
        return arr;
    };
    reset();
    for (const r of layout.rooms) WallSystem.buildIsoDiamondWalls(r.cx, r.cy, r.rx, r.ry);
    stages.push({ stage: 'rooms', weird: countWeird().length, items: countWeird(), zone: dumpZone() });
    for (let i = 0; i < layout.passages.length; i++) {
        CombatRoomSystem._placeArenaPassage(analysisFor(layout.passages[i].axis), layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
    }
    stages.push({ stage: 'passages', weird: countWeird().length, items: countWeird(), zone: dumpZone() });
    for (let i = 0; i < layout.passages.length; i++) {
        const before = WallSystem.isoVisuals.length;
        try {
            CombatRoomSystem._sealPassageSides(analysisFor(layout.passages[i].axis), layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
        } catch (e) {
            stages.push({ stage: 'seal-err', i, err: String(e) });
        }
        stages.push({ stage: 'seal-after', i, delta: WallSystem.isoVisuals.length - before, added: WallSystem.isoVisuals.slice(before).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), tex: q.tex })) });
    }
    stages.push({ stage: 'seal', weird: countWeird().length, items: countWeird(), zone: dumpZone() });
    // seal 后横墙的 _passageWall 值 + 通道侧墙的 pw
    const detail = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        if (mx > 6000 && mx < 7900 && my > 3000 && my < 4600) {
            detail.push({ x: Math.round(q.x), y: Math.round(q.y), pw: !!q._passageWall, label: q.label || null, sy: Math.round((q.scaleY || 0) * 1000) / 1000 });
        }
    }
    return { stages, detail, sealDbg: layout.passages.map((p) => ({ i: p.index, axis: [p.axis.x.toFixed(2), p.axis.y.toFixed(2)], dbg: p._sealDbg || null })) };
})()`);
console.log('staged:', JSON.stringify(staged, null, 1));
// 页面加载的 _sealPassageSides 是否含最新日志
const sealSrc = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    return {
        hasDbg: String(CombatRoomSystem._sealPassageSides).includes('SEALDBG2'),
        hasPw: String(CombatRoomSystem._sealPassageSides).includes('_passageWall'),
        url: (performance.getEntriesByType('resource').find((u) => u.name.includes('combat-room-system')) || {}).name || 'none',
    };
})()`);
console.log('seal src check:', JSON.stringify(sealSrc));
// 检查 _passageWall 标记与 seal 收集
const markCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const srcHas = String(CombatRoomSystem._placeArenaPassage).includes('_passageWall');
    const sealHas = String(CombatRoomSystem._sealPassageSides).includes('_passageWall');
    const items = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        if (mx > 6000 && mx < 7900 && my > 3000 && my < 4600) {
            items.push({ x: Math.round(q.x), y: Math.round(q.y), pw: !!q._passageWall, label: q.label || null });
        }
    }
    return { srcHas, sealHas, items: items.slice(0, 20) };
})()`);
console.log('mark check:', JSON.stringify(markCheck, null, 1));
// 通道4 seal 收集逻辑模拟：哪些件被当作侧墙
const sealCollect = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    if (!arena) return { err: 'no arena' };
    const p = arena.passages[3]; // 通道4
    const axis = p.axis;
    const perp = { x: -axis.y, y: axis.x };
    const mid = p.center;
    const halfSpan = (p.length || 1000) / 2 + 250;
    const byPiece = [];
    for (const q of WallSystem.isoVisuals) {
        if (q.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(q)[0];
        if (!seg) continue;
        const [a, b] = seg;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const perpD = (mx - mid.x) * perp.x + (my - mid.y) * perp.y;
        if (Math.abs(perpD) < 60 || Math.abs(perpD) > 400) continue;
        const along = (mx - mid.x) * axis.x + (my - mid.y) * axis.y;
        if (Math.abs(along) > halfSpan) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        if (Math.abs(dx * axis.x + dy * axis.y) / L < 0.96) continue;
        byPiece.push({ x: Math.round(q.x), y: Math.round(q.y), perpD: Math.round(perpD), along: Math.round(along), label: q.label || null });
    }
    byPiece.sort((x, y) => x.perpD - y.perpD);
    return { axis: [axis.x.toFixed(3), axis.y.toFixed(3)], mid: [Math.round(mid.x), Math.round(mid.y)], halfSpan: Math.round(halfSpan), byPiece };
})()`);
console.log('seal collect p4:', JSON.stringify(sealCollect, null, 1));
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 6650; p.y = 3555;
    Camera.x = p.x; Camera.y = p.y;
    await new Promise((r) => setTimeout(r, 800));
    return true;
})()`);
await shot('swamp_passage3');
// 通道1区域（房1.RB→房2.LT）数据层 vs 精灵层对比
const p1Layer = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    const inZone = (p) => {
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) return false;
        const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
        return mx > 1900 && mx < 3200 && my > 1900 && my < 2800;
    };
    const iso = WallSystem.isoVisuals.filter(inZone).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), tex: p.tex }));
    const sprites = scene ? scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_wall_straight' && s.x > 1900 && s.x < 3200 && s.y > 1900 && s.y < 2800).map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) })) : [];
    return { isoCount: iso.length, iso, spriteCount: sprites.length, sprites };
})()`);
console.log('passage1 layers:', JSON.stringify(p1Layer, null, 1));
// 通道1墙件被丢弃原因：dump 布局 + 每件 kept 判定
const p1Drop = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { computeMazeLayout, MAZE_AXIS_V1, MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const cfg = DungeonConfig.getCombatArenaConfig();
    const aV1 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V1);
    const aV2 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V2);
    const maze = cfg.maze || {};
    const sizes = [];
    for (let i = 0; i < (maze.roomCount || 5); i++) sizes.push(i === (maze.roomCount || 5) - 1 ? 1792 : 1024);
    const layout = computeMazeLayout({ sizes, passageLen: aV1.len, gap: 0, rows: maze.rows || 0 });
    const p1 = layout.passages[0], rA = layout.rooms[0], rB = layout.rooms[1];
    const t = { x: p1.mid1.x - aV1.gA.center.x, y: p1.mid1.y - aV1.gA.center.y };
    const out = { mid1: [Math.round(p1.mid1.x), Math.round(p1.mid1.y)], mid2: [Math.round(p1.mid2.x), Math.round(p1.mid2.y)], roomA: [Math.round(rA.cx), Math.round(rA.cy), rA.outEdge], roomB: [Math.round(rB.cx), Math.round(rB.cy), rB.inEdge], pieces: [] };
    for (const q of aV1.def.pieces) {
        const tr = { ...q, x: q.x + t.x, y: q.y + t.y };
        if (CombatRoomSystem._isFunctionalGatePiece(tr)) { out.pieces.push({ tex: q.tex, gate: true }); continue; }
        const seg = WallSystem._pieceBaseSegments(tr)[0];
        if (Math.abs(tr.x - 2626) < 3) {
            // 复刻实际函数的 A/B 取值
            const [A2, B2] = seg.map((pp) => ({ ...pp }));
            const mk = (segRef) => {
                const res = [];
                for (const [room, edge] of [[rA, rA.outEdge], [rB, rB.inEdge]]) {
                    const e = CombatRoomSystem._roomEdgeLine(room, edge);
                    let nx = -e.d.y, ny = e.d.x;
                    const nl = Math.hypot(nx, ny) || 1;
                    nx /= nl; ny /= nl;
                    const sc = (room.cx - e.P.x) * nx + (room.cy - e.P.y) * ny;
                    if (sc < 0) { nx = -nx; ny = -ny; }
                    const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
                    res.push({ edge, sA: Math.round(sOf(segRef[0])), sB: Math.round(sOf(segRef[1])) });
                }
                return res;
            };
            out.pieces.push({
                x: Math.round(tr.x), y: Math.round(tr.y),
                segIsArray: Array.isArray(seg[0]),
                seg0Type: typeof seg[0], seg1Type: typeof seg[1],
                seg0: seg[0], seg1: seg[1],
                viaSeg: mk(seg),
                viaMap: mk([A2, B2]),
                seg2Same: seg[0] === A2 ? 'same-ref' : 'copy',
            });
            continue;
        }
        const kept = CombatRoomSystem._clipPassagePieceToRooms(tr, p1, rA, rB);
        // 计算相对两房边线的 s 值
        const sv = [];
        for (const [room, edge] of [[rA, rA.outEdge], [rB, rB.inEdge]]) {
            const e = CombatRoomSystem._roomEdgeLine(room, edge);
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const sc = (room.cx - e.P.x) * nx + (room.cy - e.P.y) * ny;
            if (sc < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
            sv.push({ edge, sA: Math.round(sOf(seg[0])), sB: Math.round(sOf(seg[1])) });
        }
        out.pieces.push({ x: Math.round(tr.x), y: Math.round(tr.y), kept: !!kept, sv });
    }
    return out;
})()`);
console.log('passage1 drop:', JSON.stringify(p1Drop, null, 1));
// 最终确认：包装 _clipPassagePieceToRooms 重建场，捕获实际调用链中通道1墙件判定
const wrapP1 = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const fnSrc = CombatRoomSystem._roomEdgeLine ? CombatRoomSystem._roomEdgeLine.toString() : 'MISSING';
    const ltSample = CombatRoomSystem._roomEdgeLine
        ? CombatRoomSystem._roomEdgeLine({ cx: 3553, cy: 2960, rx: 1228.8, ry: 709.5 }, 'LT')
        : null;
    const calls = [];
    const orig = CombatRoomSystem._clipPassagePieceToRooms.bind(CombatRoomSystem);
    CombatRoomSystem._clipPassagePieceToRooms = function (piece, passage, roomA, roomB) {
        // 内联复刻 + 逐步打印
        if (Math.abs(piece.x - 2626) < 3) {
            calls.push({
                __rooms: {
                    roomA: [Math.round(roomA.cx), Math.round(roomA.cy), roomA.outEdge, Math.round(roomA.rx), Math.round(roomA.ry)],
                    roomB: [Math.round(roomB.cx), Math.round(roomB.cy), roomB.inEdge, Math.round(roomB.rx), Math.round(roomB.ry)],
                },
                __passage: { mid1: [Math.round(passage.mid1.x), Math.round(passage.mid1.y)], mid2: [Math.round(passage.mid2.x), Math.round(passage.mid2.y)] },
            });
        }
        const seg = WallSystem._pieceBaseSegments(piece)[0];
        if (!seg) return piece;
        let [A, B] = seg.map((pp) => ({ ...pp }));
        const edges = [];
        for (const [room, edge, center] of [
            [roomA, roomA.outEdge || 'RB', roomA],
            [roomB, roomB.inEdge || 'LT', roomB],
        ]) {
            const e = CombatRoomSystem._roomEdgeLine(room, edge);
            edges.push({ P: e.P, d: e.d, c: center, edge });
        }
        for (const e of edges) {
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const signC = (e.c.x - e.P.x) * nx + (e.c.y - e.P.y) * ny;
            if (signC < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
            const sA = sOf(A), sB = sOf(B);
            calls.push({
                x: Math.round(piece.x), y: Math.round(piece.y), edge: e.edge,
                sA: Math.round(sA * 10) / 10, sB: Math.round(sB * 10) / 10,
                drop: sA > 8 || sB > 8,
                A: [Math.round(A.x), Math.round(A.y)], B: [Math.round(B.x), Math.round(B.y)],
                P: [Math.round(e.P.x), Math.round(e.P.y)], d: [e.d.x.toFixed(3), e.d.y.toFixed(3)],
                c: [Math.round(e.c.cx), Math.round(e.c.cy)],
                signC: Math.round(signC * 10) / 10,
                nx: Math.round(nx * 1000) / 1000, ny: Math.round(ny * 1000) / 1000,
            });
            if (sA > 8 || sB > 8) return null;
        }
        return piece;
    };
    if (CombatRoomSystem._arena) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    try {
        CombatRoomSystem.enterCombatArena(window.Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
    } catch (e) { CombatRoomSystem._clipPassagePieceToRooms = orig; return { err: String(e), calls }; }
    CombatRoomSystem._clipPassagePieceToRooms = orig;
    const arenaRooms = CombatRoomSystem._arena ? CombatRoomSystem._arena.rooms.map((r) => ({ cx: Math.round(r.cx), cy: Math.round(r.cy), rx: Math.round(r.rx), ry: Math.round(r.ry), out: r.outEdge, in: r.inEdge, size: r.size })) : null;
    return {
        fnSrc,
        ltSample: ltSample ? { P: [Math.round(ltSample.P.x), Math.round(ltSample.P.y)], d: [ltSample.d.x.toFixed(3), ltSample.d.y.toFixed(3)] } : null,
        arenaRooms,
        calls: calls.filter((c) => c.x > 1900 && c.x < 3200 && c.y > 1900 && c.y < 2800),
    };
})()`);
console.log('wrap p1:', JSON.stringify(wrapP1, null, 1));
// 通道2 房2 入口门洞交界（房2 RB 门 ~4167,2421；看侧墙是否探入房内）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 4430; p.y = 2470;
    Camera.x = 4430; Camera.y = 2470;
    if (scene) scene.cameras.main.setZoom(1.7);
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('swamp_corridor2_roomA_gate');
console.log('cam state gate17:', JSON.stringify(await evalJs(`(async () => {
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    return scene ? { zoom: scene.cameras.main.zoom, scrollX: scene.cameras.main.scrollX, scrollY: scene.cameras.main.scrollY } : null;
})()`)));
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    p.x = 4400; p.y = 2400;
    Camera.x = 4400; Camera.y = 2400;
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 600));
    if (scene) scene.cameras.main.setZoom(3);
    await new Promise((r) => setTimeout(r, 300));
    return true;
})()`);
await shot('swamp_corridor2_roomA_gate_zoom3');
console.log('cam state:', JSON.stringify(await evalJs(`(async () => {
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    return scene ? { zoom: scene.cameras.main.zoom, x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY, cw: scene.scale.width, ch: scene.scale.height } : null;
})()`)));

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

// 通道2（房2→房3）突出审计：列出房2 RB 边到房3 LT 边之间的走廊直墙/地板端点
const pass2Probe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const out = { walls: [], floors: [] };
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        const mx = (seg[0].x + seg[1].x) / 2;
        if (mx > 3800 && mx < 5300) {
            out.walls.push({
                x: Math.round(p.x), y: Math.round(p.y), sx: p.scaleX,
                A: [Math.round(seg[0].x), Math.round(seg[0].y)],
                B: [Math.round(seg[1].x), Math.round(seg[1].y)],
            });
        }
    }
    return out;
})()`);
console.log('passage2 walls:', JSON.stringify(pass2Probe.walls, null, 1));

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
