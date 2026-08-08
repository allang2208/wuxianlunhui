#!/usr/bin/env node
/* 防御塔面板点击端到端验证（2026-08-06）：
 * 真实 CDP 鼠标点击塔身中部 → 走完整 Input → game.js 链路 → 面板应打开。
 * 前置：vite dev 已起。用法：node tools/cdp-tower-click-e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9237;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-e2e-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'http://localhost:5173/?towerE2E=1',
], { stdio: 'ignore' });

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
    const l = await fetchJson(`${CDP}/json/list`);
    return l && l.find((x) => x.type === 'page' && x.url.includes('localhost:5173'));
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
        errs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
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
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

// 进入世界-122 防守地图（scene8）：真实点击链要求 DefenseSystem.active
const sceneEnter = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const plainScene = (await import('/src/world/scene-manager.js')).SceneManager;
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    const out = { sameInstance: SM === plainScene, plainScene: plainScene.currentScene, tScene: SM.currentScene };
    if (SM.currentScene !== 'scene8') {
        try { out.ret = await SM.switchScene('scene8', p, 'explore'); }
        catch (e) { out.err = String(e && e.stack || e); }
    }
    out.after = { plain: plainScene.currentScene, t: SM.currentScene };
    return out;
})()`);
console.log('scene enter:', JSON.stringify(sceneEnter));

const sceneEnsure = await evalJs(`(async () => {
    // 真实实例 = 无 ?t= 的 plain 模块（game.js 静态导入即此实例，点击链读它的状态）
    const DS = (await import('/src/world/defense-system.js')).DefenseSystem;
    const SM = (await import('/src/world/scene-manager.js')).SceneManager;
    const p = window.Game.player;
    const out = { sceneBefore: SM.currentScene, activeBefore: DS.active };
    if (SM.currentScene !== 'scene8') {
        try { await SM.switchScene('scene8', p, 'explore'); }
        catch (e) { out.err = String(e && e.stack || e); }
    }
    await new Promise((r) => setTimeout(r, 800));
    if (!DS.active) DS.setup(p);
    out.scene = SM.currentScene;
    out.active = DS.active;
    return out;
})()`);
console.log('scene ensure:', JSON.stringify(sceneEnsure));

const mods = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    // 页面真实实例 = 游戏运行使用的模块（无 ?t= 缓存分叉）；测试对象必须与真实点击链同实例
    const real = (name) => {
        const plain = perfs.find((u) => u.includes('/src/' + name) && !u.includes('?t='));
        return plain || pick(name);
    };
    return {
        defense: real('world/defense-system.js'),
        renderer: real('world/renderer.js'),
    };
})()`);
const url = (name) => JSON.stringify(mods[name]);

const setup = await evalJs(`(async () => {
    const DefenseMod = await import(${url('defense')});
    const DS = DefenseMod.DefenseSystem;
    const { DefenseTower } = DefenseMod;
    const RendererMod = await import(${url('renderer')});
    const Renderer = RendererMod.Renderer;
    const p = window.Game.player;
    const t = new DefenseTower(p.x + 120, p.y, { id: 'e2e' });
    window.Game.entities.set('e2e', t);
    DS.towers.push(t);
    DS.active = true;
    window.__towerE2E = { t };
    const body = Renderer.worldToScreen(t.x, t.y - 131);
    const Input = (await import('/src/ui/input.js')).Input;
    // 点击点附近是否有 NPC / DropItem（会抢先拦截点击）
    const npc = [...window.Game.entities.values()]
        .filter((e) => e && e.active && (e.npcType || e._isNPC) && Math.hypot(e.x - t.x, e.y - t.y) < 200)
        .map((e) => e.npcType || e.name);
    const drops = [...window.Game.entities.values()]
        .filter((e) => e && e.itemData && e.active && Math.hypot(e.x - t.x, e.y - t.y) < 120).length;
    // 记录真实实例引用，供点击诊断
    window.__towerClickDiag = { DS, t, Input, bodyX: Math.round(body.x), bodyY: Math.round(body.y) };
    // 画布视口偏移：CDP 用客户端坐标，Phaser canvas 可能不贴 (0,0)
    const canvas = (window.__phaserScene && window.__phaserScene.game && window.__phaserScene.game.canvas) || null;
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    return {
        x: Math.round(body.x + (rect ? rect.left : 0)),
        y: Math.round(body.y + (rect ? rect.top : 0)),
        px: p.x,
        py: p.y,
        canvasRect: rect ? { left: rect.left, top: rect.top, w: rect.width, h: rect.height } : null,
        npcNear: npc,
        dropsNear: drops,
        inputType: typeof Input,
        hasLeft: !!(Input && Input.mouse),
    };
})()`);
console.log('click target (tower body):', JSON.stringify(setup));

// 诊断：直接模拟 Input 左键按下，观察 game.js 点击链是否到达 DefenseSystem
const diag = await evalJs(`(async () => {
    const d = window.__towerClickDiag;
    const Input = d.Input;
    Input.mouse.x = d.bodyX;
    Input.mouse.y = d.bodyY;
    Input.mouse.leftPressed = true;
    await new Promise((r) => setTimeout(r, 300));
    const panel = d.DS._panel;
    return {
        leftPressedAfter: Input.mouse.leftPressed,
        panelOpen: panel ? panel.isOpen : null,
        trapReturn: (await import('/src/world/trap-system.js')).TrapSystem.tryInteract(d.bodyX, d.bodyY, window.Game.player),
        dsActive: d.DS.active,
        towers: d.DS.towers.length,
        inReach: Math.hypot(d.t.x - window.Game.player.x, d.t.y - window.Game.player.y),
    };
})()`);
console.log('direct input diag:', JSON.stringify(diag));

// 真实点击塔身中部
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: setup.x, y: setup.y });
const pre = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), paused: !!(window.Game && window.Game._paused), uiOpen: !!(window.UIState && Object.values(window.UIState._state || {}).some(Boolean)), scene: !!(window.SceneManager) ? window.SceneManager.currentScene : null })`);
console.log('pre-click state:', JSON.stringify(pre));
const fc1 = await evalJs(`window.Game.frameCount`);
await new Promise((r) => setTimeout(r, 800));
const fc2 = await evalJs(`window.Game.frameCount`);
console.log('frameCount delta over 800ms:', fc2 - fc1, `(${fc1} -> ${fc2})`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1 });
// 逐帧观察真实 Input 状态
for (let i = 0; i < 10; i++) {
    const st = await evalJs(`(async () => {
        const Input = (await import('/src/ui/input.js')).Input;
        const d = window.__towerClickDiag;
        const p = d.DS._panel;
        return { t: Math.round(performance.now()), lp: !!Input.mouse.leftPressed, open: p ? !!p.isOpen : false, mx: Input.mouse.x, my: Input.mouse.y };
    })()`);
    console.log('frame', st.t, 'leftPressed:', st.lp, 'panelOpen:', st.open, 'mouse:', st.mx, st.my);
    await new Promise((r) => setTimeout(r, 200));
}

const after = await evalJs(`(async () => {
    const DefenseMod = await import(${url('defense')});
    const DS = DefenseMod.DefenseSystem;
    const p = DS._panel;
    const t = DS.towers.find((x) => x.id === 'e2e');
    return {
        panelOpen: p ? p.isOpen : null,
        panelTower: p && p.tower ? p.tower.id : null,
        towerAlive: !!t,
    };
})()`);
console.log('after real click on tower body:', JSON.stringify(after));
await shot('tower_panel_open');

// 再点一次应关闭（toggle）
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 500));
const after2 = await evalJs(`(async () => {
    const DefenseMod = await import(${url('defense')});
    return { panelOpen: DefenseMod.DefenseSystem._panel ? DefenseMod.DefenseSystem._panel.isOpen : null };
})()`);
console.log('after second click (toggle close):', JSON.stringify(after2));

console.log('--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
