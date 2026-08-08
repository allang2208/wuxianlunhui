#!/usr/bin/env node
/* 多房迷宫竞技场验证：进沼泽地牢战斗节点 → 检查房间数/通道方向/墙件连续/碰撞可通行 + 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9299;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-maze-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${profile}`, 'about:blank',
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
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
        errs.push(`[console.warn] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
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
    DungeonMapSystem.init('scene7', player, 'swamp');
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    await new Promise((r) => setTimeout(r, 600));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite');
    let enterErr = null;
    if (node) {
        DungeonMapSystem.currentNodeId = node.id;
        try {
            await DungeonMapSystem._enterNode(node);
        } catch (e) {
            enterErr = String(e && e.stack ? e.stack : e);
        }
    }
    let isoCount = 0;
    for (let i = 0; i < 16; i++) {
        const n = (await import(pick('world/wall-system.js'))).WallSystem.isoVisuals.length;
        if (n > 80) { isoCount = n; break; }
        await new Promise((r) => setTimeout(r, 500));
    }
    return { dungeonType: DungeonMapSystem.dungeonType, node: node ? node.type : null, isoCount, enterErr, phaserScene: !!window.__phaserScene };
})()`);
console.log('entered:', JSON.stringify(r));

// 手动重进竞技场，捕获返回值和完整错误
const manual = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    if (CombatRoomSystem._arena) return { already: true };
    const Game = window.Game;
    if (CombatRoomSystem.cleanupRoom) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    try {
        const info = CombatRoomSystem.enterCombatArena(Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
        return { ok: !!info, info: info ? { rooms: info.rooms.length, passages: info.passages.length, world: [info.worldW, info.worldH] } : null };
    } catch (e) {
        return { err: String(e && e.stack ? e.stack : e) };
    }
})()`);
console.log('manual arena:', JSON.stringify(manual, null, 1));

// 门创建诊断：scene/纹理/功能门判定/实际调用
const gateDiag = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const scene = window.__phaserScene;
    const a = CombatRoomSystem._arena;
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const out = {
        scene: !!scene,
        texSwampGate: scene ? scene.textures.exists('swamp_gate') : null,
        texWallStraight: scene ? scene.textures.exists('swamp_wall_straight') : null,
        arenaPassages: a ? a.passages.length : 0,
        gatesPerPassage: a ? a.passages.map((p) => p.gates.length) : [],
        gateSprites: scene ? scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_gate').length : null,
        gateInIso: WallSystem.isoVisuals.filter((p) => p.tex === 'swamp_gate').length,
    };
    // 手动建一个门看返回
    if (a && a.passages[0]) {
        try {
            const lib = (await import(pick('world/wall-prefabs.js'))).getWallPrefabLibrary();
            const def = lib['左右通道·沼泽'];
            const gatePiece = def.pieces.find((p) => p.tex === 'swamp_gate');
            const inst = CombatRoomSystem._createArenaGate(gatePiece);
            out.manualGate = inst ? 'OK' : 'NULL';
            if (inst) { inst.sprite.destroy(); }
            // 复刻 _placeArenaPassage 的门件判定
            out.gateCheck = def.pieces.map((p) => ({
                tex: p.tex,
                func: CombatRoomSystem._isFunctionalGatePiece(p),
                geo: !!WallSystem._geoForTex(p.tex),
            }));
        } catch (e) { out.manualGateErr = String(e); }
    }
    return out;
})()`);
console.log('gate diag:', JSON.stringify(gateDiag, null, 1));

// 逐步复刻：布局 + 逐通道放置，定位失败点
const step = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const { computeMazeLayout, MAZE_AXIS_V1, MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const arenaCfg = DungeonConfig.getCombatArenaConfig();
    const aV1 = CombatRoomSystem._resolvePassagePrefab(arenaCfg, MAZE_AXIS_V1);
    const aV2 = CombatRoomSystem._resolvePassagePrefab(arenaCfg, MAZE_AXIS_V2);
    const analysisFor = (axis) => {
        const isV2 = Math.abs(axis.x * MAZE_AXIS_V2.x + axis.y * MAZE_AXIS_V2.y) > 0.8;
        return isV2 && aV2 ? aV2 : aV1;
    };
    const sizes = [1024, 1024, 1024, 1024, 1792];
    const layout = computeMazeLayout({ sizes, passageLen: aV1.len, gap: 0, rows: 2 });
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    for (const r of layout.rooms) WallSystem.buildIsoDiamondWalls(r.cx, r.cy, r.rx, r.ry);
    const out = { rooms: layout.rooms.length, passages: layout.passages.length, placed: [] };
    for (let i = 0; i < layout.passages.length; i++) {
        const a = analysisFor(layout.passages[i].axis);
        try {
            const rec = CombatRoomSystem._placeArenaPassage(a, layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
            out.placed.push({ i: i + 1, ok: !!rec, gates: rec ? rec.gates.length : -1, axis: [layout.passages[i].axis.x.toFixed(3), layout.passages[i].axis.y.toFixed(3)], outEdge: layout.rooms[i].outEdge, inEdge: layout.rooms[i + 1].inEdge });
        } catch (e) {
            out.placed.push({ i: i + 1, err: String(e) });
        }
    }
    return out;
})()`);
console.log('step place:', JSON.stringify(step, null, 1));

// 配置与预制解析诊断
const diag = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { MAZE_AXIS_V1, MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const cfg = DungeonConfig.getCombatArenaConfig();
    let v1 = null, v2 = null, v1e = null, v2e = null;
    try { v1 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V1); } catch (e) { v1e = String(e); }
    try { v2 = CombatRoomSystem._resolvePassagePrefab(cfg, MAZE_AXIS_V2); } catch (e) { v2e = String(e); }
    const { getWallPrefabLibrary } = await import(pick('world/wall-prefabs.js'));
    const lib = getWallPrefabLibrary ? getWallPrefabLibrary() : null;
    let libKeys = lib ? Object.keys(lib) : [];
    let styleKey = null, analyzeDebug = null;
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
    styleKey = style ? (style.chestPrefab || 'no-chest') : 'no-style';
    if (lib) {
        for (const k of ['左右通道', '上下通道', '左右通道·沼泽', '上下通道·沼泽']) {
            if (lib[k]) {
                try {
                    const an = CombatRoomSystem._analyzePassagePrefab(lib[k]);
                    analyzeDebug = analyzeDebug || {};
                    analyzeDebug[k] = an ? { len: Math.round(an.len), axis: an.axis ? [an.axis.x.toFixed(3), an.axis.y.toFixed(3)] : null } : 'NULL';
                } catch (e) { analyzeDebug = analyzeDebug || {}; analyzeDebug[k] = 'ERR:' + String(e); }
            }
        }
    }
    // 复刻 _resolvePassagePrefab 的候选选择，定位 null 来源
    const { getWallPrefabLibrary: getLib2 } = await import(pick('world/wall-prefabs.js'));
    const lib2 = getLib2 ? getLib2() : null;
    const nameFor = (names, ax) => {
        if (!names) return null;
        if (typeof names === 'string') return names;
        const isV2 = Math.abs(ax.x * MAZE_AXIS_V2.x + ax.y * MAZE_AXIS_V2.y) > 0.8;
        return isV2 ? (names.v2 || names.v1) : (names.v1 || names);
    };
    const style2 = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
    const cand = [];
    if (style2 && style2.chestPrefab && /沼泽/.test(style2.chestPrefab)) cand.push(nameFor(cfg.passagePrefabs && cfg.passagePrefabs.swamp, MAZE_AXIS_V1));
    cand.push(nameFor(cfg.passagePrefabs && cfg.passagePrefabs.default, MAZE_AXIS_V1));
    const candRes = cand.map((n) => ({
        n,
        inLib: !!(lib2 && lib2[n]),
        analyze: (n && lib2 && lib2[n]) ? (CombatRoomSystem._analyzePassagePrefab(lib2[n]) ? 'OK' : 'NULL') : 'skip',
    }));
    return {
        cfg,
        v1: v1 ? { len: Math.round(v1.len), axis: [v1.axis.x.toFixed(3), v1.axis.y.toFixed(3)] } : null,
        v2: v2 ? { len: Math.round(v2.len), axis: [v2.axis.x.toFixed(3), v2.axis.y.toFixed(3)] } : null,
        v1e, v2e,
        libKeys: libKeys.length,
        hasSwampV1: !!(lib && lib['左右通道·沼泽']),
        hasSwampV2: !!(lib && lib['上下通道·沼泽']),
        styleKey,
        analyzeDebug,
        candRes,
        state: CombatRoomSystem.state,
        arena: !!CombatRoomSystem._arena,
    };
})()`);
console.log('diag:', JSON.stringify(diag, null, 1));

// 迷宫探针：房间/通道/墙件连续性/碰撞
const probe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const arena = CombatRoomSystem._arena;
    const rooms = arena ? arena.rooms.map((rm) => ({
        index: rm.index, size: rm.size,
        cx: Math.round(rm.cx), cy: Math.round(rm.cy),
        inEdge: rm.inEdge, outEdge: rm.outEdge,
    })) : null;
    const passages = arena ? arena.passages.map((p) => ({
        index: p.index,
        mid1: [Math.round(p.mid1.x), Math.round(p.mid1.y)],
        mid2: [Math.round(p.mid2.x), Math.round(p.mid2.y)],
        gates: p.gates.length,
    })) : null;
    // 通道连续：每条通道两门应分别落在两侧房间出/入边中点
    const midOf = (room, edge) => ({
        LT: [room.cx - room.rx/2, room.cy - room.ry/2],
        TR: [room.cx + room.rx/2, room.cy - room.ry/2],
        RB: [room.cx + room.rx/2, room.cy + room.ry/2],
        BL: [room.cx - room.rx/2, room.cy + room.ry/2],
    }[edge]);
    const gateChecks = [];
    if (arena) {
        for (let i = 0; i < arena.passages.length; i++) {
            const p = arena.passages[i], a = arena.rooms[i], b = arena.rooms[i+1];
            const m1 = midOf(a, a.outEdge), m2 = midOf(b, b.inEdge);
            const d1 = Math.hypot(p.mid1.x - m1[0], p.mid1.y - m1[1]);
            const d2 = Math.hypot(p.mid2.x - m2[0], p.mid2.y - m2[1]);
            gateChecks.push({ i: i+1, d1: Math.round(d1), d2: Math.round(d2) });
        }
    }
    // 墙件连续性：沿每条通道轴把直墙件端点投影，检查空隙
    const walls = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== 'swamp_wall_straight') continue;
        const seg = WallSystem._pieceBaseSegments(p)[0];
        if (!seg) continue;
        walls.push({ A: [seg[0].x, seg[0].y], B: [seg[1].x, seg[1].y] });
    }
    // 碰撞抽查：每房门口内侧可通行、通道中点可通行
    const can = [];
    if (arena) {
        for (let i = 0; i < arena.passages.length; i++) {
            const c = arena.passages[i].center;
            can.push({ i: i+1, center: [Math.round(c.x), Math.round(c.y)], can: WallSystem.canMoveTo ? WallSystem.canMoveTo(c.x, c.y, 20) : null });
        }
    }
    // 地板 quad 几何验证：端点应分别落在两侧房间出/入边线上（转弯通道 TR/BL 重点）
    const quads = [];
    if (arena) {
        for (let i = 0; i < arena.passages.length; i++) {
            const p = arena.passages[i], a = arena.rooms[i], b = arena.rooms[i + 1];
            try {
                const lineOf = (room, edge) => ({
                    RB: { P: { x: room.cx + room.rx, y: room.cy }, d: { x: -room.rx, y: room.ry } },
                    LT: { P: { x: room.cx, y: room.cy - room.ry }, d: { x: -room.rx, y: room.ry } },
                    TR: { P: { x: room.cx, y: room.cy - room.ry }, d: { x: room.rx, y: room.ry } },
                    BL: { P: { x: room.cx, y: room.cy + room.ry }, d: { x: -room.rx, y: -room.ry } },
                }[edge]);
                const plen = Math.hypot(p.mid2.x - p.mid1.x, p.mid2.y - p.mid1.y);
                const axisDir = { x: (p.mid2.x - p.mid1.x) / plen, y: (p.mid2.y - p.mid1.y) / plen };
                const perpDir = { x: -axisDir.y, y: axisDir.x };
                let dPos = Infinity, dNeg = Infinity;
                for (const q of WallSystem.isoVisuals) {
                    if (q.tex !== 'swamp_wall_straight') continue;
                    const seg = WallSystem._pieceBaseSegments(q)[0];
                    if (!seg) continue;
                    const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
                    const d = (mx - p.center.x) * perpDir.x + (my - p.center.y) * perpDir.y;
                    if (d > 40 && d < dPos) dPos = d;
                    if (d < -40 && -d < dNeg) dNeg = -d;
                }
                if (dPos === Infinity) dPos = 172;
                if (dNeg === Infinity) dNeg = 199;
                const eA = lineOf(a, a.outEdge || 'RB'), eB = lineOf(b, b.inEdge || 'LT');
                const near = { P: { x: p.center.x + perpDir.x * dPos, y: p.center.y + perpDir.y * dPos }, d: axisDir };
                const far = { P: { x: p.center.x - perpDir.x * dNeg, y: p.center.y - perpDir.y * dNeg }, d: axisDir };
                const itsc = (l1, l2) => {
                    const ex = l2.P.x - l1.P.x, ey = l2.P.y - l1.P.y;
                    const denom = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
                    if (Math.abs(denom) < 1e-6) return null;
                    const t = (ex * l2.d.y - ey * l2.d.x) / denom;
                    return { x: l1.P.x + l1.d.x * t, y: l1.P.y + l1.d.y * t };
                };
                const onLine = (pt, L) => Math.abs((pt.x - L.P.x) * L.d.y - (pt.y - L.P.y) * L.d.x) / Math.hypot(L.d.x, L.d.y);
                const pts = [itsc(near, eA), itsc(near, eB), itsc(far, eB), itsc(far, eA)];
                quads.push({
                    i: i + 1,
                    errA: pts[0] ? Math.round(onLine(pts[0], eA)) : -1,
                    errB: pts[1] ? Math.round(onLine(pts[1], eB)) : -1,
                    pts: pts.map((pp) => pp ? [Math.round(pp.x), Math.round(pp.y)] : null),
                });
            } catch (e) { quads.push({ i: i + 1, err: String(e) }); }
        }
    }
    return {
        roomCount: arena ? arena.rooms.length : 0,
        world: arena ? [Math.round(CombatRoomSystem._diamond.worldW), Math.round(CombatRoomSystem._diamond.worldH)] : null,
        rooms, passages, gateChecks, can, quads,
        wallCount: walls.length,
        errs: [],
    };
})()`);
console.log('maze probe:', JSON.stringify(probe, null, 1));
fs.writeFileSync(path.join(OUT_DIR, 'maze_probe.json'), JSON.stringify(probe, null, 1));

// 全览截图（相机拉远看整体布局）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(0.35);
    const a = (await import(pick('world/combat-room-system.js'))).CombatRoomSystem._arena;
    const cx = a.rooms.reduce((s, r) => s + r.cx, 0) / a.rooms.length;
    const cy = a.rooms.reduce((s, r) => s + r.cy, 0) / a.rooms.length;
    Camera.x = cx; Camera.y = cy;
    const p = window.Game.player; p.x = cx; p.y = cy;
    await new Promise((r) => setTimeout(r, 800));
    return true;
})()`);
await shot('maze_overview');
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    const a = (await import(pick('world/combat-room-system.js'))).CombatRoomSystem._arena;
    const p = window.Game.player;
    // 房1 入口附近
    p.x = a.rooms[0].cx - 200; p.y = a.rooms[0].cy;
    Camera.x = p.x; Camera.y = p.y;
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('maze_room1');
// 房3→房4 转弯通道（v2 上下通道·沼泽）放大
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    const p = window.Game.player;
    p.x = 6650; p.y = 3555;
    Camera.x = p.x; Camera.y = p.y;
    if (scene) scene.cameras.main.setZoom(1.6);
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('maze_turn_p3_p4');
// 房4→房5 反向通道（-v1，旋转180°放置）放大
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (scene) scene.cameras.main.setZoom(1);
    const p = window.Game.player;
    p.x = 6420; p.y = 2230;
    Camera.x = p.x; Camera.y = p.y;
    if (scene) scene.cameras.main.setZoom(1.6);
    await new Promise((r) => setTimeout(r, 700));
    return true;
})()`);
await shot('maze_reverse_p4_p5');
console.log('errs:', JSON.stringify(errs.slice(0, 8)));
edge.kill();
process.exit(0);
