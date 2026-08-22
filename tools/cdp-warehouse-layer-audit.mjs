#!/usr/bin/env node
/* 仓库面板图层遮挡排查：进游戏 → 打开仓库(+背包) → 在仓库面板区域多点 elementFromPoint，
   报告每个点上实际命中的元素（id/class/z-index/pointer-events），并截图。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9317;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/warehouse-layer-audit';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-whlayer-'));
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
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
};

await send('Runtime.enable');
await send('Page.enable');

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise((r) => setTimeout(r, 500));
}
console.log('started:', started);
await new Promise((r) => setTimeout(r, 2500));

// 打开仓库（联动开背包），再等动画
const opened = await evalJs(`(async () => {
    const { WarehouseSystem } = await import('/src/ui/warehouse-system.js');
    WarehouseSystem.open();
    return true;
})()`);
console.log('warehouse opened:', opened);
await new Promise((r) => setTimeout(r, 1200));

const report = await evalJs(`(() => {
    const panel = document.getElementById('warehousePanel');
    if (!panel) return { error: 'no warehousePanel' };
    const rect = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const info = {
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        active: panel.classList.contains('active'),
        zIndex: cs.zIndex,
        pointerEvents: cs.pointerEvents,
        visibility: cs.visibility,
        opacity: cs.opacity,
        transform: cs.transform,
    };
    const points = [];
    for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            points.push([rect.x + rect.width * fx, rect.y + rect.height * fy]);
        }
    }
    const hits = points.map(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return { x: Math.round(x), y: Math.round(y), hit: null };
        const s = getComputedStyle(el);
        return {
            x: Math.round(x), y: Math.round(y),
            hit: el.tagName + '#' + (el.id || '') + '.' + String(el.className).slice(0, 60),
            z: s.zIndex, pe: s.pointerEvents,
        };
    });
    // 全屏可点覆盖物枚举：fixed/absolute 且 pointer-events!=none 且可见
    const overlays = [];
    for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if ((s.position === 'fixed' || s.position === 'absolute')
            && s.pointerEvents !== 'none' && s.visibility !== 'hidden'
            && s.display !== 'none' && Number(s.opacity) > 0.01) {
            const r = el.getBoundingClientRect();
            if (r.width >= innerWidth * 0.3 && r.height >= innerHeight * 0.3) {
                overlays.push({
                    el: el.tagName + '#' + (el.id || '') + '.' + String(el.className).slice(0, 60),
                    z: s.zIndex,
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                });
            }
        }
    }
    return { info, hits, overlays };
})()`);
console.log(JSON.stringify(report, null, 1));
await shot('warehouse-open');

// 再模拟 NPC 对话期间的状态：直接显示对话框复测
await evalJs(`(() => {
    const box = document.getElementById('npcDialogueBox');
    if (box) { box.style.display = 'flex'; box.classList.add('active'); }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
const report2 = await evalJs(`(() => {
    const panel = document.getElementById('warehousePanel');
    const rect = panel.getBoundingClientRect();
    const points = [];
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.2, 0.5, 0.8]) points.push([rect.x + rect.width * fx, rect.y + rect.height * fy]);
    return points.map(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return { x: Math.round(x), y: Math.round(y), hit: null };
        const s = getComputedStyle(el);
        return { x: Math.round(x), y: Math.round(y), hit: el.tagName + '#' + (el.id || '') + '.' + String(el.className).slice(0, 60), z: s.zIndex, pe: s.pointerEvents };
    });
})()`);
console.log('with-dialogue:', JSON.stringify(report2, null, 1));
await shot('warehouse-with-dialogue');

ws.close();
edge.kill();
fs.rmSync(profile, { recursive: true, force: true });
