#!/usr/bin/env node
/* 世界-122 基地铁栅栏滑动门验证（2026-08-15）：
 * 进 scene8 → 检查 DefenseSystem.gate 存在 → 截图打开/关闭两态 → 校验门洞碰撞段。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9311;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gate-'));
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
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250)}`);
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
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}
const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

// 手动拉起 Phaser BootScene（headless 下场景队列可能不自动推进），等贴图加载完成
console.log('boot phaser:', await evalJs(`(async () => {
    const g = window.PhaserGame && window.PhaserGame.game;
    if (!g || !g.scene) return 'no-game';
    const sm = g.scene;
    if (!window.__phaserScene) {
        try { sm.start('BootScene'); } catch (e) { /* 已启动则忽略 */ }
    }
    for (let i = 0; i < 80; i++) {
        if (window.__phaserScene && window.__phaserScene.textures &&
            window.__phaserScene.textures.exists('cover_gate_D')) {
            return 'ready:' + window.__phaserScene.scene.key;
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    return 'no-scene:' + (window.__phaserScene ? window.__phaserScene.scene.key : 'none');
})()`));

console.log('switch scene8:', await evalJs(`(async () => {
    const sm = ${sceneApi};
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    if (sm.scenes && !sm.scenes.scene8) {
        sm.scenes.scene8 = { name: '世界-122', type: 'instance', label: '场景八', width: 4096, height: 4096, background: '#0d1b0a', origin: { x: 2048, y: 2048 } };
    }
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));

// headless 下场景切换可能没走完 DefenseSystem.setup，手动补一次（setup 自带 teardown，幂等）
console.log('ensure defense setup:', await evalJs(`(async () => {
    const mod = await import('/src/world/defense-system.js');
    mod.DefenseSystem.setup(window.Game.player);
    return mod.DefenseSystem.active;
})()`));

const gateInfo = await waitFor(async () => {
    const g = await evalJs(`(async () => {
        const D = (await import('/src/world/defense-system.js')).DefenseSystem;
        const gate = D.gate;
        if (!D.active || !gate || !gate.sprite) return null;
        return {
            state: gate.state,
            frame: gate.sprite.frame.name,
            cx: Math.round(gate._cx), cy: Math.round(gate._cy),
            scale: gate._scale,
            segIn: !!(window.WallSystem && window.WallSystem.isoSegments && window.WallSystem.isoSegments.indexOf(gate._gateSeg) >= 0),
            tex: gate.sprite.texture.key,
            texW: gate.sprite.texture.source[0].width,
        };
    })()`);
    return g;
});
if (!gateInfo) { console.error('gate not found'); edge.kill(); process.exit(3); }
console.log('gate:', JSON.stringify(gateInfo));

// 玩家移到门旁（友军靠近 → 应自动开门），让相机对准门
await evalJs(`(async () => {
    const { DefenseSystem } = await import('/src/world/defense-system.js');
    const p = window.Game.player;
    p.x = DefenseSystem.gate._cx + 0;
    p.y = DefenseSystem.gate._cy + 120;
    if (window.Camera && window.Camera.follow) window.Camera.follow(p);
    for (let i = 0; i < 30; i++) DefenseSystem.update(0.05); // 模拟 1.5s 游戏循环
    return true;
})()`);
await new Promise((r) => setTimeout(r, 900));
await shot('gate_open');
console.log('after approach:', await evalJs(`(async () => {
    const { DefenseSystem } = await import('/src/world/defense-system.js');
    const g = DefenseSystem.gate;
    return { state: g.state, frame: g.sprite.frame.name,
        segIn: window.WallSystem.isoSegments.indexOf(g._gateSeg) >= 0 };
})()`));

// 玩家离开 → 1.2s 后自动关门
await evalJs(`(async () => {
    const { DefenseSystem } = await import('/src/world/defense-system.js');
    const p = window.Game.player;
    p.x = DefenseSystem.gate._cx - 320;
    p.y = DefenseSystem.gate._cy + 260;
    if (window.Camera && window.Camera.follow) window.Camera.follow(p);
    for (let i = 0; i < 60; i++) DefenseSystem.update(0.05); // 模拟 3s：离开延时 + 关门动画
    const g = DefenseSystem.gate;
    return { state: g.state, frame: g.sprite.frame.name, timer: Math.round((g._closeTimer || 0) * 100) / 100 };
})()`);
await new Promise((r) => setTimeout(r, 2200));
await shot('gate_closed');
console.log('after leaving:', await evalJs(`(async () => {
    const { DefenseSystem } = await import('/src/world/defense-system.js');
    const g = DefenseSystem.gate;
    return { state: g.state, frame: g.sprite.frame.name,
        segIn: window.WallSystem.isoSegments.indexOf(g._gateSeg) >= 0 };
})()`));

console.log('console errors:', errs.length ? errs.slice(0, 10) : 'none');
edge.kill();
process.exit(errs.length ? 4 : 0);
