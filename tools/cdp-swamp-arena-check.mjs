#!/usr/bin/env node
/* 沼泽地牢竞技场验证：进 swampDungeon 地图 → 触发战斗节点（三房间串联竞技场）→ 截图走廊 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9293;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-swamp-arena-'));
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

// 复刻 expedition-system depart 流程进入 swampDungeon 地图
const entered = await evalJs(`(async () => {
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
    CONFIG.WORLD_WIDTH = 2048;
    CONFIG.WORLD_HEIGHT = 2048;
    player.x = 1024; player.y = 1024;
    const dungeonType = 'swamp';
    DungeonMapSystem.init('scene7', player, dungeonType);
    SceneManager.currentScene = 'scene7';
    await new Promise((r) => setTimeout(r, 1200));
    return {
        scene: SceneManager.currentScene,
        dungeonType: DungeonMapSystem.dungeonType,
        nodes: DungeonMapSystem.nodes.length,
        wallStyle: (await import(pick('world/wall-system.js'))).WallSystem.getWallStyle(),
        styleChest: (await import(pick('world/wall-system.js'))).WallSystem.getWallStyle()?.chestPrefab,
    };
})()`);
console.log('entered swamp map:', JSON.stringify(entered));
await shot('swamp_map');

// 触发第一个战斗节点（竞技场）
const arena = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { DungeonMapSystem } = await import(pick('world/dungeon-map-system.js'));
    const node = DungeonMapSystem.nodes.find((n) => n.type === 'combat' || n.type === 'elite' || n.type === 'boss');
    if (!node) return { ok: false, err: 'no combat node' };
    DungeonMapSystem.currentNodeId = node.id;
    await DungeonMapSystem._enterNode(node);
    await new Promise((r) => setTimeout(r, 1800));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    return {
        ok: true,
        nodeType: node.type,
        state: CombatRoomSystem.state,
        rooms: CombatRoomSystem._arenaRooms ? CombatRoomSystem._arenaRooms.length : (CombatRoomSystem.getArenaRoomBounds ? 3 : -1),
    };
})()`);
console.log('arena enter:', JSON.stringify(arena));
await new Promise((r) => setTimeout(r, 800));
await shot('swamp_arena');

// 收集竞技场墙件贴图键（看走廊是否用沼泽墙）
const walls = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const counts = {};
    const passagePieces = [];
    for (const p of WallSystem.isoVisuals) {
        counts[p.tex] = (counts[p.tex] || 0) + 1;
    }
    return { counts, total: WallSystem.isoVisuals.length };
})()`);
console.log('arena wall texture counts:', JSON.stringify(walls));

// 找出 8 块僵尸墙的位置 + 通道预制解析结果
const detail = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { WallSystem } = await import(pick('world/wall-system.js'));
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const { getWallPrefabLibrary } = await import(pick('world/wall-prefabs.js'));
    const lib = getWallPrefabLibrary();
    const zombiePieces = [];
    for (const p of WallSystem.isoVisuals) {
        if (p.tex === 'wall_straight') {
            zombiePieces.push({ x: Math.round(p.x), y: Math.round(p.y), depth: Math.round(p.depth) });
        }
    }
    const prefabKeys = Object.keys(lib).filter((k) => k.includes('\u901a\u9053'));
    const cfg = (await import(pick('config/dungeon-config.js'))).DungeonConfig.getCombatArenaConfig();
    return {
        zombiePieces,
        prefabKeys,
        passagePrefabs: cfg.passagePrefabs,
        prefabLoaded: !!lib['左右通道·沼泽'],
        swampPrefabPieces: lib['左右通道·沼泽'] ? lib['左右通道·沼泽'].pieces.map((p) => p.tex) : null,
    };
})()`);
console.log('detail:', JSON.stringify(detail, null, 1));

// 门件检查：通道功能门是否沼泽藤门
const gateCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource');
    const pick = ${pickExpr()};
    const { CombatRoomSystem } = await import(pick('world/combat-room-system.js'));
    const gates = [];
    if (CombatRoomSystem._arenaGates && CombatRoomSystem._arenaGates.length) {
        for (const g of CombatRoomSystem._arenaGates) {
            gates.push({ tex: g.tex || (g.sprite && g.sprite.texture.key), x: Math.round(g.x), y: Math.round(g.y) });
        }
    }
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    const spriteGates = [];
    if (scene) {
        scene.children.list.forEach((s) => {
            if (s.texture && typeof s.texture.key === 'string' && s.texture.key.includes('gate')) {
                spriteGates.push({ tex: s.texture.key, x: Math.round(s.x), y: Math.round(s.y) });
            }
        });
    }
    return { arenaGates: gates, spriteGates };
})()`);
console.log('gate check:', JSON.stringify(gateCheck));
console.log('errs:', errs.slice(0, 8));
edge.kill();
process.exit(0);
