#!/usr/bin/env node
/**
 * 世界-122 点击铁栅栏门 → 建筑面板详情验证（2026-08-16）
 * 面板未开时点门应自动弹出建筑面板并直达门详情（含常锁/常开按钮）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WATCHDOG = setTimeout(() => { console.error('[watchdog] 超时退出'); process.exit(9); }, 150000);
WATCHDOG.unref?.();
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9316;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gate-panel-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1200,800', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--mute-audio', '--disable-background-timer-throttling',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
edge.on('error', (e) => { console.error('edge spawn error:', e.message); process.exit(3); });
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
await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 800));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

console.log('switch scene8 (trees off):', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    if (sm.scenes && sm.scenes.scene8) sm.scenes.scene8.treeScatter = { enabled: false };
    await Promise.race([
        sm.switchScene('scene8', window.Game.player),
        new Promise((r) => setTimeout(() => r('SWITCH_TIMEOUT'), 60000)),
    ]);
    return { scene: sm.currentScene };
})()`));

console.log('setup + 注入门实体:', await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    // headless 下门贴图未加载 → 真实 gate.place() 失败；注入等价门实体验证点击/面板链路
    const fakeGate = {
        id: 'probe_gate', x: 1156, y: 2176,
        active: true, hp: 800, maxHp: 800,
        _isDefenseStructure: true, _isCoverGate: true, _faction: 'player',
        name: '铁栅栏门·D级', grade: 'D', state: 'closed', gateMode: 'auto',
        _faceLine: [{ x: 1021, y: 2178 }, { x: 1291, y: 2043 }],
        _gateSeg: { x1: 1021, y1: 2178, x2: 1291, y2: 2043, halfThick: 26 },
        update() {},
        setMode(mode) { this.gateMode = mode; },
    };
    window.Game.entities.set('probe_gate', fakeGate);
    return { active: ds.active, gate: { x: fakeGate.x, y: fakeGate.y, mode: fakeGate.gateMode } };
})()`));

const click = await evalJs(`(async () => {
    const gate = window.Game.entities.get('probe_gate');
    if (!gate) return { ok: false, reason: '无门实体' };
    // 玩家贴近门（交互距离 260px 内）
    window.Game.player.x = gate.x - 60;
    window.Game.player.y = gate.y + 30;
    // 走真实点击链路：window mousemove + mousedown（input.js → Input.mouse.leftPressed
    // → game.js 主循环点击分发）；worldToScreen 返回的已是客户区坐标
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    const pos = Renderer.worldToScreen(gate.x, gate.y);
    const Renderer2 = Renderer;
    const canvas = (Renderer2 && Renderer2.canvas) || document.querySelector('canvas');
    if (!canvas) return { ok: false, reason: '无 canvas' };
    const panelClosedBefore = !document.querySelector('.build-panel');
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: pos.x, clientY: pos.y, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: pos.x, clientY: pos.y, button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: pos.x, clientY: pos.y, button: 0, bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const panelEl = document.querySelector('.build-panel');
    const detEl = panelEl ? panelEl.querySelector('#bpDetail') : null;
    // 点「常开门」按钮 → 门 gateMode 应变 open
    let modeAfterClick = gate.gateMode;
    const openBtn = detEl ? detEl.querySelector('#bpGateOpen') : null;
    if (openBtn) {
        openBtn.click();
        await new Promise((r) => setTimeout(r, 300));
        modeAfterClick = gate.gateMode;
    }
    const after = {
        panelClosedBefore,
        panelOpen: !!panelEl,
        detailVisible: !!(detEl && detEl.style.display !== 'none'),
        detailHasGateButtons: !!(detEl && detEl.querySelector('#bpGateOpen') && detEl.querySelector('#bpGateLock')),
        detailHtml: detEl ? detEl.innerHTML.slice(0, 160) : '',
        modeAfterOpenBtn: modeAfterClick,
    };
    return { after };
})()`);
console.log(JSON.stringify(click, null, 1));

// 二段验证：绕过事件路由，直接调 BuildingSystem.tryInteract（任何实例都会把面板挂进 DOM）
const direct = await evalJs(`(async () => {
    const gate = window.Game.entities.get('probe_gate');
    const bs = (await import('/src/world/building-system.js')).BuildingSystem;
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    const pos = Renderer.worldToScreen(gate.x, gate.y);
    const ret = bs.tryInteract(pos.x, pos.y, window.Game.player);
    await new Promise((r) => setTimeout(r, 300));
    const panelEl = document.querySelector('.build-panel');
    const detEl = panelEl ? panelEl.querySelector('#bpDetail') : null;
    return {
        ret,
        panelOpen: !!panelEl,
        detailHasGateButtons: !!(detEl && detEl.querySelector('#bpGateOpen') && detEl.querySelector('#bpGateLock')),
    };
})()`);
console.log('direct tryInteract:', JSON.stringify(direct, null, 1));

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
clearTimeout(WATCHDOG);
console.log('done');
