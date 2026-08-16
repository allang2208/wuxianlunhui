#!/usr/bin/env node
/* 铁闸门开关音效接线探针 v4：不依赖完整场景——import 真实模块后，用最小桩对象直接驱动
   CoverGate/BuildableGate 的 open/close/_playSound，验证音效路径与播放入口。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9316;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gatesnd4-'));
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
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

// 拦截 SoundManager.playWorld：按 performance 资源表真实 URL import（SKILL #27，
// 裸路径在 HMR 后拿到空单例/不同实例，patch 不生效）
await evalJs(`(async () => {
    window.__sndLog = [];
    // 先触发 defense-system 加载（连带 sound-manager 进资源表）
    const du = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (du) { try { await import(du); } catch (_e) {} }
    const su = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/ui/sound-manager.js?'));
    if (!su) return false;
    const { SoundManager } = await import(su);
    window.__SM = SoundManager;
    window.__SM_patched = typeof SoundManager.playWorld === 'function';
    const origWorld = SoundManager.playWorld.bind(SoundManager);
    SoundManager.playWorld = (p, x, y, ...rest) => { window.__sndLog.push({ type: 'world', path: p, x: Math.round(x), y: Math.round(y) }); return origWorld(p, x, y, ...rest); };
    return true;
})()`);

// 纯逻辑验证：构造最小桩对象，把类的 _playSound 逻辑（open/close 中调用）跑一遍
const result = await evalJs(`(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    if (!u) return { ok: false, why: 'defense-system not loaded' };
    const mod = await import(u);
    const out = {};
    // 1) BuildableGate 类原型上的方法存在性
    out.buildableProto = {
        hasOpen: typeof mod.BuildableGate?.prototype?.open === 'function',
        hasClose: typeof mod.BuildableGate?.prototype?.close === 'function',
        hasPlaySound: typeof mod.BuildableGate?.prototype?._playSound === 'function',
    };
    // 2) CoverGate 未从模块导出（模块内 const），改从源码调用点断言
    out.coverGate = {
        exported: typeof mod.CoverGate, // 'undefined' = 模块内私有，探针不能直接读
        sourceHasPlaySound: true,       // 源码 L2802~2811 有 _playSound（人工核对）
    };
    if (!out.buildableProto.hasPlaySound) return { ok: false, why: 'method missing', ...out };
    // 3) 用最小桩驱动 BuildableGate 实例（跳过构造，直接用原型方法 + 手写字段）
    const bg = Object.create(mod.BuildableGate.prototype);
    Object.assign(bg, {
        state: 'closed',
        _cfg: { frames: 16, halfThick: 26, animMs: 650 },
        _gateSeg: { x1: 100, y1: 100, x2: 400, y2: 300 },
        _detectX: 250, _detectY: 200,
        _spriteCx: 240, _spriteCy: 190,
        x: 200, y: 180,
        setPassable() {}, _play() {}, _setBarsSeg() {},
        active: true, gateMode: 'auto',
    });
    // 拦截原型 _play 不做事，只验证 open/close 调用 _playSound
    bg._play = () => { bg._played = (bg._played || 0) + 1; };
    bg._playSound = mod.BuildableGate.prototype._playSound.bind(bg);
    const b0 = window.__sndLog.length;
    bg.open();
    bg.close();
    out.buildableCalls = window.__sndLog.slice(b0).map(c => ({ ...c, path: c.path.split('/').pop() }));
    // 4) CoverGate 未导出，跳过桩验证（源码调用点已人工核对）
    out.coverCalls = 'n/a (CoverGate 模块内私有，源码调用点已核对)';
    out.ok = out.buildableCalls.length === 2;
    return out;
})()`);
console.log('RESULT:', JSON.stringify(result, null, 2));

edge.kill();
console.log('done');
