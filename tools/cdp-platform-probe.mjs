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
for (let attempt = 0; attempt < 3 && !(st && st.active && st.count >= 1); attempt++) {
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
        if (st && st.active && st.count >= 1 && st.hasScene) break;
    }
}
console.log('STATE:', JSON.stringify(st));
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors.slice(0, 5)));

// ===== 诊断：平台未生成时直接重跑 _placeInitialPlatform 看异常 =====
if (!st || !st.count) {
    const dbg = await evalJs(`(async () => {
        const all = performance.getEntriesByType('resource').map(e => e.name);
        const u = all.find(n => n.includes('/src/world/defense-system.js')) || all.find(n => n.includes('defense-system'));
        if (!u) return { noModule: true, urls: all.filter(n => n.includes('defense')).slice(0, 5) };
        const m = await import(u);
        const DS = m.DefenseSystem;
        const covers = [];
        for (const e of (window.Game && window.Game.entities ? window.Game.entities.values() : [])) {
            if (e && e._isDefenseCover && e._faceLine) covers.push(e._faceLine.map(p => [Math.round(p.x), Math.round(p.y)]));
        }
        const preHas = !!(window.Game && window.Game.entities && window.Game.entities.get('firing_platform_initial'));
        let err = null;
        try { DS._placeInitialPlatform(); } catch (e) { err = String(e && e.stack || e); }
        return { active: DS.active, platCount: (DS.platforms || []).length, preHas, coverCount: covers.length, covers: covers.slice(0, 8), err: err ? err.slice(0, 400) : null };
    })()`);
    console.log('DIAG:', JSON.stringify(dbg));
}

// ===== 几何：实体/顶面/后缘/前缘/走廊 + 裁墙洞 + 密封段 =====
const geom = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const p = DefenseSystem.platforms[0];
    const out = {
        entity: { x: p.x, y: p.y },
        top: { x: p._topCx, y: p._topCy },
        front: { x: p._frontCx, y: p._frontCy },
        platformHeight: p.platformHeight,
        sprite: p.spriteCfg,
        corridor: { len: p._corridorLen, halfW: p._corridorHalfW, dir: [p._corridorDirX, p._corridorDirY] },
        depth: p._faceDepth,
    };
    // 密封段
    out.platSeg = p._platSeg ? { x1: p._platSeg.x1, y1: p._platSeg.y1, x2: p._platSeg.x2, y2: p._platSeg.y2, inSegs: WallSystem.isoSegments.includes(p._platSeg), inIgnore: WallSystem.platformSegs.has(p._platSeg) } : null;
    // 裁墙洞：分裂段（_splitOf 回链原掩体段）+ 原段（_orig）
    out.trimmed = (WallSystem.isoSegments || []).filter(s => s._cover && (s._orig || s._splitOf)).map(s => ({ x1: Math.round(s.x1), y1: Math.round(s.y1), x2: Math.round(s.x2), y2: Math.round(s.y2) }));
    return out;
})()`);
console.log('GEOM:', JSON.stringify(geom, null, 2));

// ===== getLift 连续抬升：从房内（入口下方 200）沿走廊走到台面 =====
const liftTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const ax = p._corridorDirX, ay = p._corridorDirY;
    const samples = [];
    // 从入口下 200px（地面）走到前缘上 30px（台面）：沿走廊轴 t 从 1.6 → -0.2
    for (let i = 0; i <= 12; i++) {
        const t = 1.6 - (i / 12) * 1.8; // 1.6 → -0.2
        const x = p._frontCx + ax * p._corridorLen * t;
        const y = p._frontCy + ay * p._corridorLen * t;
        samples.push({ t: +t.toFixed(2), lift: p.getLift(x, y) });
    }
    const lifts = samples.map(s => s.lift);
    // 平滑：从地面 0 单调升到台面满值，且无跳变（相邻差 < 40）
    const smooth = lifts.every((v, i) => i === 0 || (v >= lifts[i-1] && v - lifts[i-1] < 40));
    return { samples, smooth, maxLift: Math.max(...lifts), minLift: Math.min(...lifts) };
})()`);
console.log('LIFT:', JSON.stringify(liftTest, null, 2));

// ===== 玩家沿走廊移动，_platformLift 连续变化 =====
const walkTest = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    const player = window.Game.player;
    const ax = p._corridorDirX, ay = p._corridorDirY;
    const lifts = [];
    for (let i = 0; i <= 10; i++) {
        const t = 1.4 - (i / 10) * 1.8;
        player.x = p._frontCx + ax * p._corridorLen * t;
        player.y = p._frontCy + ay * p._corridorLen * t;
        DefenseSystem._updatePlatformStates();
        lifts.push(player._platformLift);
    }
    return { lifts, smooth: lifts.every((v, i) => i === 0 || v >= lifts[i-1]) };
})()`);
console.log('WALK:', JSON.stringify(walkTest));

// ===== 玩家通行：入口→台面 用 resolve（带 ignore）应直达；无 ignore 应被密封段挡 =====
const passTest = await evalJs(`(async () => {
    const wu = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('wall-system'));
    const { WallSystem } = await import(wu);
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('defense-system'));
    const { DefenseSystem } = await import(u);
    const p = DefenseSystem.platforms[0];
    // 玩家：入口 (x, y) → 台面 (x, y-170)，步进 5px
    const path = [];
    let blockedNoIgnore = false;
    let passedWithIgnore = true;
    for (let i = 1; i <= 34; i++) {
        const tx = p.x, ty = p.y - 170 * (i / 34);
        const noIg = WallSystem.resolve(p.x, p.y, tx, ty, 14);
        if (Math.hypot(noIg.x - tx, noIg.y - ty) > 2) blockedNoIgnore = true;
        const withIg = WallSystem.resolve(p.x, p.y, tx, ty, 14, { segs: WallSystem.platformSegs });
        if (Math.hypot(withIg.x - tx, withIg.y - ty) > 2) passedWithIgnore = false;
    }
    // 怪物：无 ignore 应在密封段前挡停
    const monster = WallSystem.resolve(p.x - 60, p.y + 60, p.x - 60, p.y - 300, 16);
    const monsterBlocked = Math.hypot(monster.x - (p.x - 60), monster.y - (p.y - 300)) > 2;
    return { blockedNoIgnore, passedWithIgnore, monsterBlocked, monsterEnd: { x: Math.round(monster.x), y: Math.round(monster.y) } };
})()`);
console.log('PASS:', JSON.stringify(passTest, null, 2));

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
