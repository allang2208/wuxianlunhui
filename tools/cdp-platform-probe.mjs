#!/usr/bin/env node
/* 射击台五版验证：连接式台阶贴图 + 连续抬升（getLift）+ 裁墙洞 + 密封段 + 玩家通行 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9328;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fp5-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
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

await send('Runtime.enable');
await send('Page.enable');
const consoleErrors = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        consoleErrors.push((d.exception && d.exception.description || d.text || '').slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(m.params.type)) {
        const args = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        const s = `[${m.params.type}] ${args.slice(0, 300)}`;
        if (m.params.type !== 'log' || s.includes('预置射击台')) consoleErrors.push(s);
    }
};
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8:', await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('scene-manager.js'));
    const { SceneManager } = await import(u);
    await SceneManager.switchScene('scene8', window.Game.player, 'explore');
    return true;
})()`));

let st = null;
for (let attempt = 0; attempt < 3 && !(st && st.active && st.hasScene); attempt++) {
    if (attempt > 0) {
        await evalJs(`(async () => {
            const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('scene-manager.js'));
            const { SceneManager } = await import(u);
            await SceneManager.switchScene('scene8', window.Game.player, 'explore');
            return true;
        })()`);
    }
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        st = await evalJs(`(async () => {
            const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
            if (!u) return null;
            const { DefenseSystem } = await import(u);
            const plats = (DefenseSystem && DefenseSystem.platforms) || [];
            return { active: DefenseSystem ? DefenseSystem.active : null, count: plats.length, hasScene: !!window.__phaserScene };
        })()`);
        if (st && st.active && st.hasScene) break;
    }
}
console.log('STATE:', JSON.stringify(st));
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors.slice(0, 5)));

// ===== 预置平台已删除（2026-08-16）：几何测试创建临时测试平台（位置=原预置贴墙位）=====
await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const m = await import(u);
    const { DefenseSystem, FiringPlatform } = m;
    if (!DefenseSystem.platforms || !DefenseSystem.platforms.length) {
        const fp = new FiringPlatform(742, 2014, { id: 'probe_test_platform' });
        window.Game.entities.set(fp.id, fp);
        DefenseSystem.platforms.push(fp);
    }
    return true;
})()`);

// ===== 几何（七版表面模型）：入口锚点/台面菱形/台阶走廊，无墙线/无密封段 =====
const geom = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const p = DefenseSystem.platforms[0];
    const out = {
        entity: { x: p.x, y: p.y },
        front: { x: p._frontCx, y: p._frontCy },
        platformHeight: p.platformHeight,
        sprite: p.spriteCfg,
        deckCorners: p._deckCorners,
        corridor: { len: p._corridorLen, halfW: p._corridorHalfW, dir: [p._corridorDirX, p._corridorDirY] },
        depth: p._faceDepth,
        wallLine: p._wallLine || null,
        platSeg: p._platSeg || null,
        hasPlatformSegs: !!(WallSystem.platformSegs && WallSystem.platformSegs.size),
    };
    return out;
})()`);
console.log('GEOM:', JSON.stringify(geom, null, 2));

// ===== 表面可走（七版）：台阶走廊 + 台面菱形全覆盖，无"空气墙" =====
const surfaceTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const on = (x, y) => p.isOnPlatform(x, y);
    // 台阶走廊：入口 E(0,0) → 台面前缘 D，沿线 9 点
    const ax = p._corridorDirX, ay = p._corridorDirY;
    const stairPts = [];
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        stairPts.push(on(p.x + p._frontCx * (1 - t), p.y + p._frontCy * (1 - t)));
    }
    // 台面菱形：前角→后角沿线 20 点（整条台面走通，无中途断崖）
    const F = p._deckCorners[1], B = p._deckCorners[3];
    const deckPts = [];
    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        deckPts.push(on(p.x + F.x + (B.x - F.x) * t, p.y + F.y + (B.y - F.y) * t));
    }
    // 台面两侧边中点向中心内收 15% 采样（角点本身是顶点，内缩方向易出界）
    const L = p._deckCorners[0], R = p._deckCorners[2];
    const cx = (L.x + R.x) / 2, cy = (L.y + R.y) / 2; // 台面中心
    const sideLx = (L.x + p._deckCorners[1].x) / 2, sideLy = (L.y + p._deckCorners[1].y) / 2;
    const sideRx = (p._deckCorners[1].x + R.x) / 2, sideRy = (p._deckCorners[1].y + R.y) / 2;
    const sideL = on(p.x + sideLx + (cx - sideLx) * 0.15, p.y + sideLy + (cy - sideLy) * 0.15);
    const sideR = on(p.x + sideRx + (cx - sideRx) * 0.15, p.y + sideRy + (cy - sideRy) * 0.15);
    // 台外（入口下方 400px / 入口左下 250px）不在台上
    const outside = !on(p.x, p.y + 400) && !on(p.x - 250, p.y + 300);
    return {
        stairAllOn: stairPts.every(Boolean),
        deckAllOn: deckPts.every(Boolean),
        sideL, sideR, outside,
        stairCount: stairPts.filter(Boolean).length,
        deckCount: deckPts.filter(Boolean).length,
    };
})()`);
console.log('SURFACE:', JSON.stringify(surfaceTest, null, 2));

// ===== 玩家登台状态：台上 _onPlatform=true/_platformLift=1；台下归零 =====
const walkTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const player = window.Game.player;
    // 台面中心
    const cx = (p._deckCorners[0].x + p._deckCorners[2].x) / 2;
    const cy = (p._deckCorners[0].y + p._deckCorners[2].y) / 2;
    player.x = p.x + cx; player.y = p.y + cy;
    DefenseSystem._updatePlatformStates();
    const onDeck = { on: player._onPlatform, lift: player._platformLift };
    // 台下（入口下方 300）
    player.x = p.x; player.y = p.y + 300;
    DefenseSystem._updatePlatformStates();
    const onGround = { on: player._onPlatform, lift: player._platformLift };
    return { onDeck, onGround };
})()`);
console.log('WALK:', JSON.stringify(walkTest));

// ===== 精灵锚点（一对一）：平台精灵 = 实体 + spriteCfg.offsetX/footOffsetY；
// 玩家在台面后角时脚底落在台面表面（sprite 脚线 = 后角表面 y）=====
const spriteTest = await evalJs(`(async () => {
    const scene = window.__phaserScene;
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    let plat = null;
    for (const [e, data] of (scene._neutralSprites || new Map()).entries()) {
        if (e && e._isFiringPlatform && data && data.sprite) plat = data.sprite;
    }
    const ox = (p.spriteCfg && p.spriteCfg.offsetX) || 0;
    const oy = (p.spriteCfg && p.spriteCfg.footOffsetY) || 0;
    const anchorOk = plat && Math.abs(plat.x - (p.x + ox)) < 1 && Math.abs(plat.y - (p.y - oy)) < 1;
    // 玩家放台面后角：sprite 脚线 = 后角表面（逻辑 y - 1，lift=1 标记）
    const B = p._deckCorners[3];
    const player = window.Game.player;
    player.x = p.x + B.x; player.y = p.y + B.y;
    DefenseSystem._updatePlatformStates();
    scene._syncBodiesToPhysics();
    const shift = scene._getFootOffsetY(player, scene.playerSprite);
    const footY = scene.playerSprite.y + shift;
    return {
        anchorOk,
        platXY: plat ? { x: Math.round(plat.x), y: Math.round(plat.y) } : null,
        deckBackSurfaceY: p.y + B.y,
        playerFootY: Math.round(footY),
        alignOk: Math.abs(footY - (p.y + B.y)) <= 2,
    };
})()`);
console.log('SPRITE:', JSON.stringify(spriteTest, null, 2));

// ===== 单向登台（七版+）：台面左/右/后三边封死，只留台阶侧进出 =====
const edgeTest = await evalJs(`(async () => {
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const edgeSegs = (WallSystem.isoSegments || []).filter(s => s._platformEdge && s._owner === p);
    const R = 14;
    const cx = (p._deckCorners[0].x + p._deckCorners[2].x) / 2;
    const cy = (p._deckCorners[0].y + p._deckCorners[2].y) / 2;
    const fx = p.x + cx, fy = p.y + cy; // 台面中心
    // 向后边中点外 80px / 左边中点外 80px 走：应被挡（下不去，单向登台）
    const B = p._deckCorners[3], L = p._deckCorners[0];
    const bmidX = p.x + (B.x + L.x) / 2, bmidY = p.y + (B.y + L.y) / 2;
    // 后边外法线（远离台面中心）
    const dxB = (p.x + L.x) - (p.x + B.x), dyB = (p.y + L.y) - (p.y + B.y);
    const lenB = Math.hypot(dxB, dyB) || 1;
    let nBx = -dyB / lenB, nBy = dxB / lenB;
    if (nBx * (fx - bmidX) + nBy * (fy - bmidY) > 0) { nBx = -nBx; nBy = -nBy; }
    const toB = WallSystem.resolve(fx, fy, bmidX + nBx * 80, bmidY + nBy * 80, R);
    const blockedBack = Math.hypot(toB.x - (bmidX + nBx * 80), toB.y - (bmidY + nBy * 80)) > 30;
    const lmidX = p.x + (L.x + p._deckCorners[1].x) / 2, lmidY = p.y + (L.y + p._deckCorners[1].y) / 2;
    const dxL = (p.x + p._deckCorners[1].x) - (p.x + L.x), dyL = (p.y + p._deckCorners[1].y) - (p.y + L.y);
    const lenL = Math.hypot(dxL, dyL) || 1;
    let nLx = -dyL / lenL, nLy = dxL / lenL;
    if (nLx * (fx - lmidX) + nLy * (fy - lmidY) > 0) { nLx = -nLx; nLy = -nLy; }
    const toL = WallSystem.resolve(fx, fy, lmidX + nLx * 80, lmidY + nLy * 80, R);
    const blockedLeft = Math.hypot(toL.x - (lmidX + nLx * 80), toL.y - (lmidY + nLy * 80)) > 30;
    // 向台阶侧（台面前缘 D，open）走：应直达
    const toD = WallSystem.resolve(fx, fy, p.x + p._frontCx, p.y + p._frontCy, R);
    const passFront = Math.hypot(toD.x - (p.x + p._frontCx), toD.y - (p.y + p._frontCy)) <= 3;
    // 入口下方 → 台阶顶（D）整条通路可走
    const climb = WallSystem.resolve(p.x, p.y + 40, p.x + p._frontCx, p.y + p._frontCy, R);
    const passClimb = Math.hypot(climb.x - (p.x + p._frontCx), climb.y - (p.y + p._frontCy)) <= 3;
    return { edgeSegCount: edgeSegs.length, blockedBack, blockedLeft, passFront, passClimb };
})()`);
console.log('EDGE:', JSON.stringify(edgeTest, null, 2));

// ===== 空气墙审计（八版+）：外扩多边形阻挡段后，角色应能走到视觉后缘中点
// （不再提前 28px 被挡），但走不出去（继续外走被挡在边缘 ±8px 内）=====
const edgeStopTest = await evalJs(`(async () => {
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const R = 22.5; // 玩家碰撞半径
    const cx = (p._deckCorners[0].x + p._deckCorners[2].x) / 2;
    const cy = (p._deckCorners[0].y + p._deckCorners[2].y) / 2;
    const start = { x: p.x + cx, y: p.y + cy };
    // 后边 B→L 的中点（视觉台面后缘）
    const B = p._deckCorners[3], L = p._deckCorners[0];
    const target = { x: p.x + (B.x + L.x) / 2, y: p.y + (B.y + L.y) / 2 };
    const res = WallSystem.resolve(start.x, start.y, target.x, target.y, R);
    const stopDist = Math.hypot(res.x - target.x, res.y - target.y);
    // 继续外走 60px：应被挡在边缘附近
    const dxB = (p.x + L.x) - (p.x + B.x), dyB = (p.y + L.y) - (p.y + B.y);
    const lenB = Math.hypot(dxB, dyB) || 1;
    let nBx = -dyB / lenB, nBy = dxB / lenB;
    if (nBx * (start.x - target.x) + nBy * (start.y - target.y) > 0) { nBx = -nBx; nBy = -nBy; }
    const far = { x: target.x + nBx * 60, y: target.y + nBy * 60 };
    const res2 = WallSystem.resolve(start.x, start.y, far.x, far.y, R);
    const stop2 = Math.hypot(res2.x - far.x, res2.y - far.y);
    return {
        stopDist: +stopDist.toFixed(1),
        stop2: +stop2.toFixed(1),
        stopFromEdge: +Math.hypot(res2.x - target.x, res2.y - target.y).toFixed(1),
        // 能走到视觉边缘（≤3px，无空气墙）且外走被挡（stop2 > 50，单向登台）
        edgeOk: stopDist <= 3 && stop2 > 50,
    };
})()`);
console.log('EDGE_STOP:', JSON.stringify(edgeStopTest, null, 2));

// ===== B 面板幽灵锚点审计：平台幽灵位置 = (x-25.6, y-49)，与实体渲染一致 =====
const ghostTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('building-system'));
    const { BuildingSystem } = await import(u);
    // 模拟选中射击台
    const item = { kind: 'platform' };
    BuildingSystem._placing = { item, mirror: false };
    const a = BuildingSystem._ghostAnchor(1000, 2000);
    const f = BuildingSystem._ghostFootOffset();
    BuildingSystem._placing = null;
    return { anchor: { x: Math.round(a.x), y: Math.round(a.y) }, footOffset: f,
             expect: { x: 974, y: 1951 }, ok: Math.round(a.x) === 974 && Math.round(a.y) === 1951 && f === 49 };
})()`);
console.log('GHOST:', JSON.stringify(ghostTest, null, 2));

// ===== 吸附审计：掩体端点吸附是否仍生效（自由放置平台无吸附目标，掩体/门应有）=====
const snapTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('building-system'));
    const m = await import(u);
    const { BuildingSystem, BUILD_ITEMS } = m;
    let cover = null;
    for (const e of window.Game.entities.values()) {
        if (e && e._isDefenseCover && e.active && e._faceLine) { cover = e; break; }
    }
    if (!cover) return { coverFound: false };
    const item = BUILD_ITEMS.find((it) => it.kind === 'cover');
    BuildingSystem._placing = { item, mirror: false };
    // 从掩体端点附近发起吸附
    const ep = cover._faceLine[0];
    const snap = BuildingSystem._snapPosition(ep.x + 5, ep.y + 5);
    BuildingSystem._placing = null;
    return {
        coverFound: true,
        coverSnapWorks: !!snap && typeof snap.x === 'number',
        coverSnapPos: snap ? { x: Math.round(snap.x), y: Math.round(snap.y) } : null,
    };
})()`);
console.log('SNAP:', JSON.stringify(snapTest, null, 2));

// ===== 台阶单通道（九版）：爬台阶途中不能左右下台；沿台阶轴可通行 =====
const stairChannelTest = await evalJs(`(async () => {
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const R = 22.5;
    // 台阶中段（走廊轴 50% 处）
    const ax = p._corridorDirX, ay = p._corridorDirY;
    const mx = p.x + p._frontCx * 0.5, my = p.y + p._frontCy * 0.5;
    // 侧向（走廊垂线）外走 120px：应被侧墙挡
    const pxn = -ay, pyn = ax;
    const side = WallSystem.resolve(mx, my, mx + pxn * 120, my + pyn * 120, R);
    const blockedSide = Math.hypot(side.x - (mx + pxn * 120), side.y - (my + pyn * 120)) > 60;
    // 沿轴向下走（往入口）应可通行
    const down = WallSystem.resolve(mx, my, mx + ax * 60, my + ay * 60, R);
    const passDown = Math.hypot(down.x - (mx + ax * 60), down.y - (my + ay * 60)) <= 3;
    // 沿轴向上走（往台面）应可通行
    const up = WallSystem.resolve(mx, my, mx - ax * 60, my - ay * 60, R);
    const passUp = Math.hypot(up.x - (mx - ax * 60), up.y - (my - ay * 60)) <= 3;
    return { blockedSide, passDown, passUp };
})()`);
console.log('STAIR_CHANNEL:', JSON.stringify(stairChannelTest, null, 2));

// ===== 图层审计（九版）：平台已按统一口径注册接地线（setupStructureDepth）=====
const layerTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    return {
        faceLine: p._faceLine && p._faceLine.length === 2
            ? { x1: Math.round(p._faceLine[0].x), y1: Math.round(p._faceLine[0].y), x2: Math.round(p._faceLine[1].x), y2: Math.round(p._faceLine[1].y) }
            : null,
        faceDepth: p._faceDepth,
        expectDepth: p.y + 12,
        unified: !!(p._faceLine && p._faceLine.length === 2 && p._faceDepth === p.y + 12),
        halfW: p._faceLine ? Math.round((p._faceLine[1].x - p._faceLine[0].x) / 2) : null,
        spriteHalfW: Math.round((p.spriteCfg && p.spriteCfg.size || 0) / 2),
    };
})()`);
console.log('LAYER:', JSON.stringify(layerTest, null, 2));

// ===== 贴墙吸附（九版）：射击台靠近掩体/门墙时返回吸附位 =====
const wallSnapTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('building-system'));
    const m = await import(u);
    const { BuildingSystem, BUILD_ITEMS } = m;
    let wall = null;
    for (const e of window.Game.entities.values()) {
        if (e && (e._isDefenseCover || e._isCoverGate) && e.active && e._faceLine) { wall = e; break; }
    }
    if (!wall) return { wallFound: false };
    const item = BUILD_ITEMS.find((it) => it.kind === 'platform');
    BuildingSystem._placing = { item, mirror: false };
    const [A, B] = wall._faceLine;
    const mx0 = (A.x + B.x) / 2, my0 = (A.y + B.y) / 2;
    const wx = B.x - A.x, wy = B.y - A.y;
    const wl = Math.hypot(wx, wy) || 1;
    const nx = -wy / wl, ny = wx / wl;
    // 从墙中点法线方向 60px 处发起吸附
    const snap = BuildingSystem._snapPosition(mx0 + nx * 60, my0 + ny * 60);
    BuildingSystem._placing = null;
    return {
        wallFound: true,
        wallOrient: ((B.x - A.x) * (B.y - A.y)) >= 0 ? 'h' : 'v',
        snapWorks: !!(snap && typeof snap.x === 'number'),
        snapPos: snap ? { x: Math.round(snap.x), y: Math.round(snap.y) } : null,
    };
})()`);
console.log('WALL_SNAP:', JSON.stringify(wallSnapTest, null, 2));

// ===== 布局审计（九版）：基地 TL 墙贴左边界、平台贴 TR 墙、出生点避开平台 =====
const layoutTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const m = await import(u);
    const { DefenseSystem, DEFENSE_CONFIG } = m;
    const p = DefenseSystem.platforms[0];
    const b = DEFENSE_CONFIG.base;
    const room = DEFENSE_CONFIG.room;
    const Lx = b.x - room.rx;
    // 平台实体（台阶入口）相对 TR 墙几何中点 (T,R) 的距离
    const T = { x: b.x, y: b.y - room.ry };
    const R = { x: b.x + room.rx, y: b.y };
    const gmx = (T.x + R.x) / 2, gmy = (T.y + R.y) / 2;
    const dToWall = Math.hypot(p.x - gmx, p.y - gmy);
    const player = window.Game.player;
    // 出生点（scene-manager 配置）显式摆放后检查是否在平台通行区内（走廊/台面）
    const spawnX = 450, spawnY = 2150;
    const onPlat = player && p.isOnPlatform(spawnX, spawnY);
    return {
        base: { x: b.x, y: b.y },
        roomLx: Lx,
        baseFlushLeft: Lx >= 15 && Lx <= 25,
        platformEntrance: { x: p.x, y: p.y },
        wallMid: { x: Math.round(gmx), y: Math.round(gmy) },
        entranceToWallMid: Math.round(dToWall),
        spawnConfig: { x: spawnX, y: spawnY },
        spawnClearOfPlatform: !!player && !onPlat,
    };
})()`);
console.log('LAYOUT:', JSON.stringify(layoutTest, null, 2));

// ===== 死亡清理（七版+）：onDeath 沉陷接管 + 移出平台列表 + 边缘段清理 =====
const deathTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const m = await import(u);
    const { DefenseSystem, FiringPlatform } = m;
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const fp = new FiringPlatform(500, 500, { id: 'probe_free_platform' });
    window.Game.entities.set(fp.id, fp);
    DefenseSystem.platforms.push(fp);
    const freeOk = fp._isFiringPlatform && !fp._wallLine && !fp._platSeg
        && (fp._edgeSegs || []).length === 5; // 3 台面边 + 2 台阶侧墙
    const before = DefenseSystem.platforms.length;
    fp.onDeath();
    const lingering = (WallSystem.isoSegments || []).filter(s => s._platformEdge && s._owner === fp).length;
    return { freeOk, before, removed: DefenseSystem.platforms.indexOf(fp) < 0, sinking: fp._sinking === true, lingering };
})()`);
console.log('DEATH:', JSON.stringify(deathTest, null, 2));

// ===== 贴图渲染 =====
const render = await evalJs(`(() => {
    const scene = window.__phaserScene;
    const out = { texV: scene.textures.exists('firing_platform'), texH: scene.textures.exists('firing_platform_h') };
    for (const [e, data] of (scene._neutralSprites || new Map()).entries()) {
        if (e && e._isFiringPlatform && data && data.sprite) {
            out.sprite = {
                tex: data.sprite.texture ? data.sprite.texture.key : null,
                dw: Math.round(data.sprite.displayWidth), dh: Math.round(data.sprite.displayHeight),
                x: Math.round(data.sprite.x), y: Math.round(data.sprite.y),
                visible: data.sprite.visible,
            };
        }
    }
    return out;
})()`);
console.log('RENDER:', JSON.stringify(render, null, 2));

edge.kill();
console.log('done');
