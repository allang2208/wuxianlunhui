#!/usr/bin/env node
/* 防御塔自动瞄准+开火验证（2026-08-06）：
 * 解除冻结 → 放假想敌 → 截图确认手臂转向目标、枪口火焰/弹道从臂尖出。
 * 前置：vite dev 已起。用法：node tools/cdp-defense-tower-arm-fire.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9226;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-fire-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

async function waitFor(fn, timeoutMs = 20000, step = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > timeoutMs) return null;
        await new Promise((r) => setTimeout(r, step));
    }
}
async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(url, { signal: ctrl.signal }); return await r.json(); }
    finally { clearTimeout(t); }
}

const page = await waitFor(async () => {
    const list = await fetchJson(`${CDP}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
}, 25000);
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(`[console.error] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};
function send(method, params = {}) {
    return new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function shot(name, clip) {
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
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
    if (!s.running) await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;
await evalJs(`(async () => { await (${sceneApi}).switchScene('scene8', window.Game.player); })()`);
await new Promise((r) => setTimeout(r, 800));

const info = await evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const DS = dsMod.DefenseSystem;
    const { DefenseTower } = dsMod;
    if (!DS.active) DS.setup(window.Game.player);
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const t = new DefenseTower(1500, 1800, { id: 'firetest' });
    window.Game.entities.set('firetest', t);
    DS.towers.push(t);
    t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.pkm)));
    // 假想敌：可移动的敌对实体（防御塔只会锁 _faction==='enemy' 的目标）
    const Enemy = (await import('/src/entities/enemy.js')).Enemy;
    const dummy = new Enemy(1950, 1800, {
        faction: 'enemy', hp: 5000, maxHp: 5000, size: 40, collisionRadius: 24, name: '测试目标',
    });
    dummy._defenseMonster = true;
    window.Game.entities.set('firetest_dummy', dummy);
    return { tower: { x: t.x, y: t.y, range: t.range, wp: t.weaponItem?.name }, dummy: { x: dummy.x, y: dummy.y } };
})()`);
console.log('setup:', JSON.stringify(info));

// 等塔转到目标并开火
await new Promise((r) => setTimeout(r, 2500));
const state = await evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const t = dsMod.DefenseSystem.towers.find((x) => x.id === 'firetest');
    const V = dsMod.DEFENSE_TOWER_VISUAL;
    const s = V.arm.s;
    const px = t.x, py = t.y - V.arm.pivotWorldY;
    const rot = t.aimAngle - V.arm.naturalAngle;
    const tdx = (V.arm.tip.x - V.arm.pivot.x) * s;
    const tdy = (V.arm.tip.y - V.arm.pivot.y) * s;
    const tipX = px + tdx * Math.cos(rot) - tdy * Math.sin(rot);
    const tipY = py + tdx * Math.sin(rot) + tdy * Math.cos(rot);
    const target = t._aimTargetPos;
    return {
        aim: +t.aimAngle.toFixed(3),
        tip: [+tipX.toFixed(1), +tipY.toFixed(1)],
        target,
        weaponAnim: t.weaponAnim ? t.weaponAnim.state : null,
        ammo: t._getAmmoState ? t._getAmmoState('weapon') : null,
    };
})()`);
console.log('tower state:', JSON.stringify(state));

await shot('arm_firing', undefined);

// 特写（开火瞬间枪口）
const clip = await evalJs(`(async () => {
    const dsMod = await import('/src/world/defense-system.js');
    const t = dsMod.DefenseSystem.towers.find((x) => x.id === 'firetest');
    const Renderer = (await import('/src/world/renderer.js')).Renderer;
    const p = Renderer.worldToScreen(t.x, t.y);
    return { x: Math.max(0, p.x - 160), y: Math.max(0, p.y - 340), width: 360, height: 460, scale: 1 };
})()`);
await shot('arm_firing_closeup', clip);

console.log('--- console errors ---');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
