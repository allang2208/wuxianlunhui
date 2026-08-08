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
    // 页面实际加载的模块 URL（排查 HMR/缓存）
    const urls = performance.getEntriesByType('resource')
        .filter((u) => u.name.includes('combat-room-system'))
        .map((u) => u.name.slice(0, 120));
    let hasClipDbg = null;
    try {
        const CRS = (await import(pick('world/combat-room-system.js'))).CombatRoomSystem;
        hasClipDbg = String(CRS._clipPassagePieceToRooms).includes('CLIPDBG');
    } catch (e) { hasClipDbg = 'ERR'; }
    return { dungeonType: DungeonMapSystem.dungeonType, node: node ? node.type : null, isoCount, enterErr, phaserScene: !!window.__phaserScene, urls, hasClipDbg };
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

// 首次 _enterNode 场的通道墙计数（wrapDiag 重建前）
const firstPassageWalls = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const arena = CombatRoomSystem._arena;
    const out = [];
    if (!arena) return { none: true };
    for (let i = 0; i < arena.passages.length; i++) {
        const p = arena.passages[i];
        const plen = Math.hypot(p.mid2.x - p.mid1.x, p.mid2.y - p.mid1.y);
        const axisDir = { x: (p.mid2.x - p.mid1.x) / plen, y: (p.mid2.y - p.mid1.y) / plen };
        const perpDir = { x: -axisDir.y, y: axisDir.x };
        let cnt = 0, sides = [0, 0];
        for (const q of WallSystem.isoVisuals) {
            if (q.tex !== 'swamp_wall_straight') continue;
            const seg = WallSystem._pieceBaseSegments(q)[0];
            if (!seg) continue;
            const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
            const pd = (mx - p.center.x) * perpDir.x + (my - p.center.y) * perpDir.y;
            if (Math.abs(pd) < 60 || Math.abs(pd) > 400) continue;
            const along = (mx - p.center.x) * axisDir.x + (my - p.center.y) * axisDir.y;
            if (Math.abs(along) > plen / 2 + 260) continue;
            cnt++;
            sides[pd > 0 ? 0 : 1]++;
        }
        out.push({ i: i + 1, count: cnt, sides: sides.join('/') });
    }
    return out;
})()`);
console.log('first passage walls:', JSON.stringify(firstPassageWalls));

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
            const before = WallSystem.isoVisuals.length;
            const rec = CombatRoomSystem._placeArenaPassage(a, layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
            const added = WallSystem.isoVisuals.length - before;
            out.placed.push({ i: i + 1, ok: !!rec, gates: rec ? rec.gates.length : -1, wallsAdded: added, axis: [layout.passages[i].axis.x.toFixed(3), layout.passages[i].axis.y.toFixed(3)], outEdge: layout.rooms[i].outEdge, inEdge: layout.rooms[i + 1].inEdge });
        } catch (e) {
            out.placed.push({ i: i + 1, err: String(e) });
        }
    }
    return out;
})()`);
console.log('step place:', JSON.stringify(step, null, 1));

// 包装 _clipPassagePieceToRooms：捕获真实放置链路中每件的判定
const wrapDiag = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const calls = [];
    const orig = CombatRoomSystem._clipPassagePieceToRooms.bind(CombatRoomSystem);
    const edgeCalls = [];
    const origEdge = CombatRoomSystem._roomEdgeLine.bind(CombatRoomSystem);
    CombatRoomSystem._roomEdgeLine = function (room, edge) {
        const r = origEdge(room, edge);
        edgeCalls.push({ edge, P: [Math.round(r.P.x), Math.round(r.P.y)], d: [r.d.x.toFixed(2), r.d.y.toFixed(2)], room: [Math.round(room.cx), Math.round(room.cy)] });
        return r;
    };
    CombatRoomSystem._clipPassagePieceToRooms = function (piece, passage, roomA, roomB) {
        const seg = WallSystem._pieceBaseSegments(piece)[0];
        // 同上下文手动复刻
        let manualKept = true;
        let manualDetail = null;
        let insideSegs = null;
        let origRet2 = null;
        let compiledRet = null;
        if (seg && piece.tex === 'swamp_wall_straight' && Math.abs(piece.x - 2626) < 3) {
            // 观察 orig 内部 _pieceBaseSegments 返回的 seg（patch 后调用 orig）
            const origBase = WallSystem._pieceBaseSegments;
            insideSegs = [];
            WallSystem._pieceBaseSegments = function (p) {
                const s = origBase.call(this, p);
                insideSegs.push(s && s[0] ? [[Math.round(s[0][0].x), Math.round(s[0][0].y)], [Math.round(s[0][1].x), Math.round(s[0][1].y)]] : null);
                return s;
            };
            const r2 = orig(piece, passage, roomA, roomB);
            WallSystem._pieceBaseSegments = origBase;
            // 编译源码副本执行（替换 this._roomEdgeLine 为参数函数）
            try {
                const src = orig.toString().replace(/this\._roomEdgeLine/g, 'roomEdgeLine');
                const impl = new Function('WallSystem2', 'roomEdgeLine', 'piece', 'passage', 'roomA', 'roomB', 'return ((' + src + ')).call({}, piece, passage, roomA, roomB);');
                const cr = impl(WallSystem, CombatRoomSystem._roomEdgeLine.bind(CombatRoomSystem), piece, passage, roomA, roomB);
                compiledRet = !!cr;
            } catch (e) { compiledRet = 'ERR:' + e; }
            const [MA, MB] = seg.map((pp) => ({ ...pp }));
            for (const entry of [[roomA, roomA.outEdge || 'RB', roomA], [roomB, roomB.inEdge || 'LT', roomB]]) {
                const e = CombatRoomSystem._roomEdgeLine(entry[0], entry[1]);
                let nx = -e.d.y, ny = e.d.x;
                const nl = Math.hypot(nx, ny) || 1;
                nx /= nl; ny /= nl;
                const sc = (entry[2].cx - e.P.x) * nx + (entry[2].cy - e.P.y) * ny;
                if (sc < 0) { nx = -nx; ny = -ny; }
                const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
                const sA = sOf(MA), sB = sOf(MB);
                manualDetail = { edge: entry[1], sA: Math.round(sA), sB: Math.round(sB), drop: sA > 8 || sB > 8 };
                if (sA > 8 || sB > 8) { manualKept = false; break; }
            }
        }
        const r = orig(piece, passage, roomA, roomB);
        calls.push({
            tex: piece.tex,
            x: Math.round(piece.x), y: Math.round(piece.y),
            seg: seg ? [[Math.round(seg[0].x), Math.round(seg[0].y)], [Math.round(seg[1].x), Math.round(seg[1].y)]] : null,
            kept: !!r,
            manualKept,
            manualDetail,
            insideSegs,
            origRet2,
            compiledRet,
            roomAOut: roomA.outEdge, roomBIn: roomB.inEdge,
        });
        return r;
    };
    // 重新建场捕获真实调用
    if (CombatRoomSystem._arena) CombatRoomSystem.cleanupRoom();
    WallSystem.walls = []; WallSystem.isoVisuals = []; WallSystem.trees = [];
    try {
        CombatRoomSystem.enterCombatArena(window.Game.player, { normalSize: 1024, eliteSize: 1792, dungeonType: 'swamp' });
    } catch (e) { return { err: String(e), calls }; }
    CombatRoomSystem._clipPassagePieceToRooms = orig;
    CombatRoomSystem._roomEdgeLine = origEdge;
    return { calls: calls.filter((c) => c.tex === 'swamp_wall_straight' && c.x > 1900 && c.x < 3200), edgeCalls };
})()`);
console.log('wrap diag:', JSON.stringify(wrapDiag, null, 1));

// 裁剪判定诊断：对通道 1 预制直墙件逐件打印 sA/sB 与结果
const clipDiag = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { computeMazeLayout, MAZE_AXIS_V1, MAZE_AXIS_V2 } = await import(pick('world/combat-arena-layout.js'));
    const { DungeonConfig } = await import(pick('config/dungeon-config.js'));
    const arenaCfg = DungeonConfig.getCombatArenaConfig();
    const aV1 = CombatRoomSystem._resolvePassagePrefab(arenaCfg, MAZE_AXIS_V1);
    const layout = computeMazeLayout({ sizes: [1024, 1024, 1024, 1024, 1792], passageLen: aV1.len, gap: 0, rows: 2 });
    const p1 = layout.passages[0], rA = layout.rooms[0], rB = layout.rooms[1];
    const t = { x: p1.mid1.x - aV1.gA.center.x, y: p1.mid1.y - aV1.gA.center.y };
    const out = { roomA: [rA.cx, rA.cy, rA.outEdge], roomB: [rB.cx, rB.cy, rB.inEdge], pieces: [] };
    try { out.fnSrc = CombatRoomSystem._clipPassagePieceToRooms.toString(); } catch (e) { out.fnSrc = 'ERR ' + e; }
    for (const q of aV1.def.pieces) {
        const translated = { ...q, x: q.x + t.x, y: q.y + t.y };
        if (CombatRoomSystem._isFunctionalGatePiece(translated)) { out.pieces.push({ tex: q.tex, gate: true }); continue; }
        const seg = WallSystem._pieceBaseSegments(translated)[0];
        const clipped = CombatRoomSystem._clipPassagePieceToRooms(translated, p1, rA, rB);
        // 手动复刻 _clipPassagePieceToRooms 判定
        const manualEdges = [
            { P: CombatRoomSystem._roomEdgeLine(rA, rA.outEdge || 'RB').P, d: CombatRoomSystem._roomEdgeLine(rA, rA.outEdge || 'RB').d, c: rA },
            { P: CombatRoomSystem._roomEdgeLine(rB, rB.inEdge || 'LT').P, d: CombatRoomSystem._roomEdgeLine(rB, rB.inEdge || 'LT').d, c: rB },
        ];
        let manualKept = true;
        for (const e of manualEdges) {
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const sc = (e.c.cx - e.P.x) * nx + (e.c.cy - e.P.y) * ny;
            if (sc < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
            if (sOf(seg[0]) > 8 || sOf(seg[1]) > 8) { manualKept = false; break; }
        }
        // 逐行复刻实际函数体（复制粘贴语义，打印每边判定）
        const trace = [];
        const seg2 = WallSystem._pieceBaseSegments(translated)[0];
        const [A2, B2] = seg2.map((pp) => ({ ...pp }));
        const edges2 = [];
        for (const entry of [
            [rA, rA.outEdge || 'RB', rA],
            [rB, rB.inEdge || 'LT', rB],
        ]) {
            const e2 = CombatRoomSystem._roomEdgeLine(entry[0], entry[1]);
            edges2.push({ P: e2.P, d: e2.d, c: entry[2] });
        }
        for (const e of edges2) {
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const signC = (e.c.cx - e.P.x) * nx + (e.c.cy - e.P.y) * ny;
            if (signC < 0) { nx = -nx; ny = -ny; }
            const sOf2 = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
            const sA2 = sOf2(A2), sB2 = sOf2(B2);
            trace.push({ P: [Math.round(e.P.x), Math.round(e.P.y)], d: [e.d.x.toFixed(3), e.d.y.toFixed(3)], sA: Math.round(sA2), sB: Math.round(sB2), drop: sA2 > 8 || sB2 > 8 });
        }
        // 手动计算两房边线的 s 值
        const sVals = [];
        for (const [room, edge] of [[rA, rA.outEdge], [rB, rB.inEdge]]) {
            const e = CombatRoomSystem._roomEdgeLine(room, edge);
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const sc = (room.cx - e.P.x) * nx + (room.cy - e.P.y) * ny;
            if (sc < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny;
            sVals.push({ edge, sA: Math.round(sOf(seg[0])), sB: Math.round(sOf(seg[1])) });
        }
        out.pieces.push({
            tex: q.tex,
            A: seg ? [Math.round(seg[0].x), Math.round(seg[0].y)] : null,
            B: seg ? [Math.round(seg[1].x), Math.round(seg[1].y)] : null,
            kept: !!clipped,
            manualKept,
            trace,
            sVals,
        });
    }
    return out;
})()`);
console.log('clip diag:', JSON.stringify(clipDiag, null, 1));

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
    // 通道侧墙计数：每条通道侧墙带（|perpD| 60~400）内的直墙件数量
    const passageWalls = [];
    if (arena) {
        for (let i = 0; i < arena.passages.length; i++) {
            const p = arena.passages[i];
            const plen = Math.hypot(p.mid2.x - p.mid1.x, p.mid2.y - p.mid1.y);
            const axisDir = { x: (p.mid2.x - p.mid1.x) / plen, y: (p.mid2.y - p.mid1.y) / plen };
            const perpDir = { x: -axisDir.y, y: axisDir.x };
            const found = [];
            for (const q of WallSystem.isoVisuals) {
                if (q.tex !== 'swamp_wall_straight') continue;
                const seg = WallSystem._pieceBaseSegments(q)[0];
                if (!seg) continue;
                const mx = (seg[0].x + seg[1].x) / 2, my = (seg[0].y + seg[1].y) / 2;
                const pd = (mx - p.center.x) * perpDir.x + (my - p.center.y) * perpDir.y;
                if (Math.abs(pd) < 60 || Math.abs(pd) > 400) continue;
                const along = (mx - p.center.x) * axisDir.x + (my - p.center.y) * axisDir.y;
                if (Math.abs(along) > plen / 2 + 260) continue;
                found.push({ side: Math.sign(pd), x: Math.round(mx), y: Math.round(my) });
            }
            passageWalls.push({ i: i + 1, count: found.length, sides: found.filter((f) => f.side > 0).length + '/' + found.filter((f) => f.side < 0).length });
        }
    }
    return {
        roomCount: arena ? arena.rooms.length : 0,
        world: arena ? [Math.round(CombatRoomSystem._diamond.worldW), Math.round(CombatRoomSystem._diamond.worldH)] : null,
        rooms, passages, gateChecks, can, quads,
        passageWalls,
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
// 等 Phaser scene 就绪后强制同步墙精灵，确认数据渲染一致
const syncShot = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    for (let i = 0; i < 20 && !window.__phaserScene; i++) await new Promise((r) => setTimeout(r, 500));
    const hadScene = !!window.__phaserScene;
    if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
    const scene = window.__phaserScene;
    const gateCount = scene ? scene.children.list.filter((s) => s.texture && s.texture.key === 'swamp_gate').length : -1;
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 6650; p.y = 3555;
    Camera.x = p.x; Camera.y = p.y;
    await new Promise((r) => setTimeout(r, 700));
    return { hadScene, gateCount, iso: WallSystem.isoVisuals.length };
})()`);
console.log('sync state:', JSON.stringify(syncShot));
await shot('maze_synced_turn');
console.log('errs:', JSON.stringify(errs.slice(0, 8)));
edge.kill();
process.exit(0);
