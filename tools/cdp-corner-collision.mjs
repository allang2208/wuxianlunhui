#!/usr/bin/env node
/* 世界-122 基地四角碰撞审计（2026-08-08）：
 * 列出场景全部实体 + WallSystem.isoSegments 中 cover 段，
 * 标出四个角点附近的 cover 段端点，检查碰撞是否有缺口。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9281;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-corner-coll-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
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
    const l = await fetchJson(`${CDP_PORT > 0 ? 'http://127.0.0.1:' + CDP_PORT + '/json/list' : ''}`);
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
function sceneExpr() {
    return `window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null)`;
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

const entered = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    const out = { sceneBefore: SM.currentScene };
    if (SM.currentScene !== 'scene8') {
        try { await SM.switchScene('scene8', p, 'explore'); } catch (e) { out.err = String(e && e.stack || e); }
    }
    await new Promise((r) => setTimeout(r, 900));
    out.scene = SM.currentScene;
    return out;
})()`);
console.log('entered:', JSON.stringify(entered));

const data = await evalJs(`(() => {
    const scene = ${sceneExpr()};
    const ents = [];
    for (const [k, e] of window.Game.entities) {
        if (!e || typeof e !== 'object') continue;
        ents.push({
            key: k,
            cls: e.constructor ? e.constructor.name : '?',
            x: Math.round(e.x), y: Math.round(e.y),
            isCover: !!e._isDefenseStructure,
            isTower: !!e._isDefenseTower,
            hp: e.hp ?? e.data?.hp ?? null,
        });
    }
    const segs = [];
    const ws = window.WallSystem;
    if (ws && ws.isoSegments) {
        for (const s of ws.isoSegments) {
            segs.push({
                x1: Math.round(s.x1), y1: Math.round(s.y1),
                x2: Math.round(s.x2), y2: Math.round(s.y2),
                halfThick: s.halfThick,
                cover: !!s._cover,
            });
        }
    }
    return { ents, segs, hasWallSystem: !!ws };
})()`);
console.log('entities:', JSON.stringify(data.ents, null, 0));
console.log('isoSegments count:', data.segs.length);
// 只打印 cover 段
const covers = data.segs.filter((s) => s.cover);
console.log('cover segments:', JSON.stringify(covers));

// 场景里是否有非掩体精灵（土块/贴花/装饰）靠近四角
const extras = await evalJs(`(() => {
    const scene = ${sceneExpr()};
    if (!scene) return null;
    const out = [];
    scene.children.list.forEach((s) => {
        if (!s.texture || typeof s.texture.key !== 'string') return;
        const k = s.texture.key;
        const nearCorner = s.x > 250 && s.x < 1650 && s.y > 1700 && s.y < 2400;
        const isCover = k.startsWith('obstacle_cover');
        const isTower = k.startsWith('obstacle_defense') || k.startsWith('weapon');
        const isBase = k.includes('base') || k.includes('core') || k.includes('altar') || k.includes('warehouse');
        if (nearCorner && !isCover && !isTower && !isBase) {
            out.push({ tex: k, x: Math.round(s.x), y: Math.round(s.y), type: s.type, alpha: s.alpha });
        }
    });
    return out;
})()`);
console.log('extra non-cover sprites near room:', JSON.stringify(extras));

// 截四角图
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved:', `${OUT_DIR}/${name}.png`);
}
for (const [cname, wx, wy] of [['cornerL', 480, 2020], ['cornerR', 1320, 2020], ['cornerB', 900, 2280]]) {
    await evalJs(`(async () => {
        const perfs = performance.getEntriesByType('resource').map((e) => e.name);
        const pick = (name) => {
            const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
            return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
        };
        const Camera = (await import(pick('world/camera.js'))).Camera;
        const p = window.Game.player;
        p.x = ${wx}; p.y = ${wy};
        Camera.x = ${wx}; Camera.y = ${wy};
        await new Promise((r) => setTimeout(r, 500));
        Camera.x = ${wx}; Camera.y = ${wy};
        await new Promise((r) => setTimeout(r, 500));
        return true;
    })()`);
    await shot(cname);
}

// 逐角碰撞覆盖测试：WallSystem.canMoveTo(半径 20) 在角点周围 200x200 网格的阻挡情况
const probe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const WS = (await import(pick('world/wall-system.js'))).WallSystem;
    const apices = {
        top: [900, 1728], left: [388, 1984], right: [1412, 1984], bottom: [900, 2239],
    };
    const out = {};
    for (const [name, [ax, ay]] of Object.entries(apices)) {
        const blocked = [];
        for (let dy = -100; dy <= 100; dy += 20) {
            for (let dx = -100; dx <= 100; dx += 20) {
                const px = ax + dx, py = ay + dy;
                const ok = WS.canMoveTo(px, py, 20);
                blocked.push({ dx, dy, blocked: !ok });
            }
        }
        out[name] = { apex: [ax, ay], blocked };
    }
    return out;
})()`);
for (const [name, p] of Object.entries(probe)) {
    console.log(`=== ${name} corner apex ${p.apex} (半径20 阻挡图，x→dx, y→dy) ===`);
    for (let dy = -100; dy <= 100; dy += 20) {
        const row = [];
        for (let dx = -100; dx <= 100; dx += 20) {
            const b = p.blocked.find((q) => q.dx === dx && q.dy === dy);
            row.push(b && b.blocked ? '#' : '.');
        }
        console.log(`  dy=${String(dy).padStart(4)}: ${row.join('')}`);
    }
}

// 沿墙线扫点：每条边 face 线段上及其上方，找"本应阻挡却可通行"的点
const gapProbe = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const WS = (await import(pick('world/wall-system.js'))).WallSystem;
    const segs = [
        ['TL-first', 724,1815,900,1728], ['TR-first', 900,1728,1076,1815],
        ['TL-last', 336,2009,512,1922], ['LB-first', 388,1984,564,2071],
        ['TR-last', 1288,1922,1464,2009], ['RB-first', 1236,2071,1412,1984],
        ['LB-last', 776,2178,952,2265], ['RB-last', 848,2265,1024,2178],
    ];
    const out = [];
    for (const [name, x1,y1,x2,y2] of segs) {
        const len = Math.hypot(x2-x1, y2-y1);
        const ux = (x2-x1)/len, uy = (y2-y1)/len;
        const pass = [];
        for (let d = 0; d <= len; d += 20) {
            const px = x1 + ux*d, py = y1 + uy*d;
            const up = WS.canMoveTo(px, py - 20, 12);
            if (up) pass.push([Math.round(px), Math.round(py-20)]);
        }
        out.push({ name, passableOnWall: pass });
    }
    return out;
})()`);
for (const g of gapProbe) {
    console.log(`${g.name}: ${g.passableOnWall.length} passable ->`, JSON.stringify(g.passableOnWall));
}

// 怪物行为测试：把一只怪放到左角外侧，目标=基地核心，跑 1.5s 看它能否穿过墙角
const monsterTest = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    let m = null;
    for (const e of window.Game.entities.values()) {
        if (e && e._faction === 'enemy' && e.active) { m = e; break; }
    }
    if (!m) return { ok: false };
    const base = window.Game.entities.get('defense_base');
    const start = { x: m.x, y: m.y };
    m.x = 300; m.y = 2050;
    if (base) { m.target = base; m._targetPos = { x: base.x, y: base.y }; }
    const path = [];
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        path.push({ x: Math.round(m.x), y: Math.round(m.y) });
    }
    return { ok: true, start, end: { x: Math.round(m.x), y: Math.round(m.y) }, path };
})()`);
console.log('monster walk at left corner:', JSON.stringify(monsterTest));

// 直接验证：给一只怪设置房内目标，看寻路路径是否穿过墙（找路器是否把掩体墙当障碍）
const pathTest = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const PFM = await import(pick('ai/pathfinder.js'));
    const pf = PFM.pathFinder || PFM.PathFinder;
    if (!pf) return { ok: false, err: 'no pathfinder' };
    // 怪从右墙外（1510, 2050）到基地核心（900,2048）——路径应绕开右墙
    const start = { x: 1530, y: 2050 }, end = { x: 900, y: 2048 };
    const r = pf.findPath ? await pf.findPath(start.x, start.y, end.x, end.y, 14) : null;
    const crossesWall = [];
    const WS = (await import(pick('world/wall-system.js'))).WallSystem;
    if (r && Array.isArray(r.path)) {
        for (const pt of r.path) {
            const blocked = !WS.canMoveTo(pt.x, pt.y, 14);
            if (blocked) crossesWall.push([Math.round(pt.x), Math.round(pt.y)]);
        }
    }
    return {
        ok: true, found: !!r,
        keys: r ? Object.keys(r) : null,
        status: r && (r.status || r.code || r.result),
        pathLen: r && r.path ? r.path.length : (r && Array.isArray(r) ? r.length : null),
        pathHead: r && r.path ? r.path.slice(0, 5) : (Array.isArray(r) ? r.slice(0, 5) : null),
        pathTail: r && r.path ? r.path.slice(-3) : (Array.isArray(r) ? r.slice(-3) : null),
    };
})()`);
console.log('pathfinder through-wall test:', JSON.stringify(pathTest));
console.log('errs:', errs.slice(0, 5));
edge.kill();
process.exit(0);
