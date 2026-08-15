#!/usr/bin/env node
/** 写实树实机截图（纯 __phaserScene，不 import 任何模块，2026-08-15） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9331;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-pure-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); await r.json(); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const l = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const page = l.find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) { return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
}
await send('Runtime.enable');
await send('Page.enable');

// 等游戏运行 + Phaser 场景就绪（不 import 任何模块）
let ok = false;
for (let i = 0; i < 120 && !ok; i++) {
    const s = await evalJs(`({ g: !!(window.Game && window.Game.isRunning && window.Game.player), p: !!window.__phaserScene })`).catch(() => null);
    if (s && s.g && s.p) ok = true;
    else { await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`).catch(() => null); await new Promise((r) => setTimeout(r, 700)); }
}
if (!ok) { console.error('game/phaser not ready'); edge.kill(); process.exit(2); }

// 导航 scene8（window 全局 + import 兜底；等防守系统拉起作为 scene8 就绪信号）
await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    if (sm.currentScene !== 'scene8') await sm.switchScene('scene8', window.Game.player);
    return sm.currentScene;
})()`);
// 等 scene8 内容渲染（防守系统拉起 + 场景 sprite 数量）
await evalJs(`(async () => {
    for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const scene = window.__phaserScene;
        const ds = window.DefenseSystem;
        if (!scene || !(ds && ds.active)) continue;
        let n = 0;
        scene.children.list.forEach((c) => { if (c && c.active && c.visible && c.type === 'Image') n++; });
        if (n > 60) return n;
    }
    return -1;
})()`);

// 相机锁定 + 截图
await evalJs(`(() => {
    const scene = window.__phaserScene;
    const cam = scene.cameras.main;
    if (cam.stopFollow) cam.stopFollow();
    if (scene._updateCamera) scene._updateCamera = () => {};
    cam.centerOn(2048, 2048); cam.setZoom(0.45);
    return true;
})()`);
await new Promise((r) => setTimeout(r, 500));
await shot('tree-realistic-overview');
await evalJs(`(() => {
    const cam = window.__phaserScene.cameras.main;
    cam.centerOn(2048, 1500); cam.setZoom(1.0);
    return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
await shot('tree-realistic-field');
ws.close();
edge.kill();
console.log('done');
