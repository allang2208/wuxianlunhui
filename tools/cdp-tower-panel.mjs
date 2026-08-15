#!/usr/bin/env node
/** 防御塔面板截图 + 点击/悬停命中验证（2026-08-15）
 * 用法：node tools/cdp-tower-panel.mjs [outPrefix]
 * 产出：<prefix>-panel.png（面板）+ 命中测试结果（点击塔身/塔顶/塔外三点）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9319;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });
const PREFIX = process.argv[2] || 'tower-ui';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-tpanel-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900', '--no-first-run', '--no-default-browser-check',
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
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
function send(method, params = {}) { return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}
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
await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    return true;
})()`);

// 建 demo 塔（装在玩家附近的空旷点），装 AKM，相机拉近
console.log(await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const p = window.Game.player;
    const t = new DefenseTower(p.x + 180, p.y, { id: 'panel_tower' });
    window.Game.entities.set('panel_tower', t);
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    t.equipWeapon(JSON.parse(JSON.stringify(Object.values(eq.equipment).find((e) => e && e.weaponId === 'weapon7'))));
    const cam = window.__phaserScene && window.__phaserScene.cameras.main;
    if (cam) { cam.centerOn(p.x + 60, p.y - 60); cam.setZoom(1.2); }
    return 'tower ready';
})()`));
await new Promise((r) => setTimeout(r, 600));

// 命中测试：塔脚 / 塔身中部 / 塔顶机械臂 / 塔外空白（screen 坐标 = worldToScreen + 偏移）
console.log('hit tests:', JSON.stringify(await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const { Renderer } = await import('/src/world/renderer.js');
    const t = window.Game.entities.get('panel_tower');
    const pos = Renderer.worldToScreen(t.x, t.y);
    const cases = {
        foot: [pos.x, pos.y - 5],
        body: [pos.x, pos.y - 130],
        arm: [pos.x + 60, pos.y - 235],
        outside: [pos.x + 260, pos.y + 160],
    };
    const out = {};
    for (const [k, [mx, my]] of Object.entries(cases)) {
        const panel = ds._ensurePanel();
        if (panel.isOpen) panel.close();
        out[k] = ds.tryInteract(mx, my, window.Game.player);
        if (panel.isOpen) panel.close();
    }
    return out;
})()`)));

// 打开面板截图（直接 openFor 排版查看）
await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const t = window.Game.entities.get('panel_tower');
    ds._ensurePanel().openFor(t, window.Game.player);
    return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
await shot(`${PREFIX}-panel`);

// 悬停金色轮廓验证：真实 CDP 鼠标移动到塔身 → 检查 _hoverTower 与三层贴图滤镜
const pos0 = await evalJs(`(async () => {
    const { Renderer } = await import('/src/world/renderer.js');
    const t = window.Game.entities.get('panel_tower');
    const pos = Renderer.worldToScreen(t.x, t.y - 130); // 塔身中部
    return [Math.round(pos.x), Math.round(pos.y)];
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos0[0], y: pos0[1] });
await new Promise((r) => setTimeout(r, 400));
console.log('hover test:', JSON.stringify(await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const t = window.Game.entities.get('panel_tower');
    const scene = window.__phaserScene;
    const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
    return {
        hovered: ds._hoverTower === t,
        glow: sp ? { base: !!sp.base.__hoverGlowFx, arm: !!sp.arm.__hoverGlowFx, weapon: !!sp.weapon.__hoverGlowFx } : null,
        cursor: (document.querySelector('canvas') || {}).style ? document.querySelector('canvas').style.cursor : null,
    };
})()`)));
await shot(`${PREFIX}-hover-on`);
// 移出塔外 → 轮廓应消失
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 700 });
await new Promise((r) => setTimeout(r, 400));
console.log('hover out:', JSON.stringify(await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    const t = window.Game.entities.get('panel_tower');
    const scene = window.__phaserScene;
    const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
    return {
        hovered: ds._hoverTower === t,
        glowCleared: sp ? (!sp.base.__hoverGlowFx && !sp.arm.__hoverGlowFx && !sp.weapon.__hoverGlowFx) : null,
    };
})()`)));
await shot(`${PREFIX}-hover`);

console.log('errs:', errs.join(' | ') || '(none)');
ws.close();
edge.kill();
console.log('done');
