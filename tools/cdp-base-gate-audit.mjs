#!/usr/bin/env node
/**
 * 基地门可攻击 + 能源 800px 禁矿带审计（2026-08-16）
 *  A. 基地门已换成 BuildableGate：在 Game.entities、_isCoverGate、有 hp/_gateSeg/face 几何一致；
 *  B. 点击基地门 → 建筑面板弹出门详情（面板入口链路）；
 *  C. 能源节点距基地 (900,2048) ≥ 800px。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WATCHDOG = setTimeout(() => { console.error('[watchdog] 超时退出'); process.exit(9); }, 150000);
WATCHDOG.unref?.();
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9318;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-gate-audit-'));
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

console.log('switch scene8:', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await Promise.race([
        sm.switchScene('scene8', window.Game.player),
        new Promise((r) => setTimeout(() => r('SWITCH_TIMEOUT'), 60000)),
    ]);
    return { scene: sm.currentScene };
})()`));

const out = await evalJs(`(async () => {
    const res = {};
    // A. 基地门实体
    const gate = window.Game.entities.get('defense_base_gate');
    res.gate = gate ? {
        isCoverGate: !!gate._isCoverGate,
        isDefenseStructure: !!gate._isDefenseStructure,
        faction: gate._faction,
        hp: gate.hp, maxHp: gate.maxHp,
        gateSeg: !!(gate._gateSeg && gate._gateSeg._gateHole),
        faceLine: gate._faceLine ? [Math.round(gate._faceLine[0].x), Math.round(gate._faceLine[1].x)] : null,
        mode: gate.gateMode,
    } : null;
    const DEF = (await import('/src/world/defense-system.js')).DEFENSE_CONFIG;
    const gs = DEF.covers.gate;
    res.gateGeoMatch = gate && gs
        ? Math.abs(gate._faceLine[0].x - gs.A.x) < 1 && Math.abs(gate._faceLine[0].y - gs.A.y) < 1
            && Math.abs(gate._faceLine[1].x - gs.B.x) < 1 && Math.abs(gate._faceLine[1].y - gs.B.y) < 1
        : false;
    // C. 能源节点 800px 禁矿带
    let minDist = Infinity;
    let count = 0;
    for (const e of window.Game.entities.values()) {
        if (e && e._isEnergyNode) {
            count++;
            minDist = Math.min(minDist, Math.hypot(e.x - 900, e.y - 2048));
        }
    }
    res.energy = { count, minDistToBase: Math.round(minDist) };
    // B. 点击基地门 → 建筑面板详情
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    const pos = Renderer.worldToScreen(gate.x, gate.y);
    const canvas = (Renderer && Renderer.canvas) || document.querySelector('canvas');
    window.Game.player.x = gate.x - 60;
    window.Game.player.y = gate.y + 30;
    if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: pos.x, clientY: pos.y, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: pos.x, clientY: pos.y, button: 0, bubbles: true }));
        canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: pos.x, clientY: pos.y, button: 0, bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 900));
    const panelEl = document.querySelector('.build-panel');
    const detEl = panelEl ? panelEl.querySelector('#bpDetail') : null;
    res.panel = {
        open: !!panelEl,
        gateDetail: !!(detEl && detEl.querySelector('#bpGateOpen') && detEl.querySelector('#bpGateLock')),
    };
    return res;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
clearTimeout(WATCHDOG);
console.log('done');
