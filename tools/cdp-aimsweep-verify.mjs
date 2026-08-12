#!/usr/bin/env node
/* 玩家全帧瞄准扫描（aimSweep）实机验证：装备 M416（双持枪械 → gun_idle），
 * CDP 控制鼠标位置覆盖压枪/水平/举枪角度 + 开火帧，截图裁剪玩家区域。
 * 需 vite dev server 跑在 5173。用法：node tools/cdp-aimsweep-verify.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9243;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 700)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1920,1080',
    '--no-first-run', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 7000));

const fetchJson = async (u) => (await fetch(u)).json();
let page = null;
for (;;) {
    try { const l = await fetchJson(`${CDP}/json/list`); page = l.find(t => t.type === 'page' && t.url.includes('5173')); if (page) break; } catch {}
    await new Promise(r => setTimeout(r, 300));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const rawEval = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await rawEval(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await sleep(500);
}
console.log('started:', started);
if (!started) await cleanup(1);

// 装备 M416（双持步枪 → gun_idle 姿态；模块 URL 带 ?t= 与页面实例一致）
const eq = await rawEval(`(async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name);
    const pick = (frag) => { const u = urls.filter(n => n.includes(frag)); return u.find(n => n.includes('.js?')) || u[0]; };
    const { EquipDataManager } = await import(pick('/src/ui/equip-data-manager.js'));
    const p = window.Game.player;
    const item = JSON.parse(JSON.stringify(EquipDataManager.M416_ITEM));
    p.equipments.weapon1 = item;
    p.weaponMode = 'weapon1';
    if (p.equippedRangedType) p.equippedRangedType = 'm416';
    const { EquipManager } = await import(pick('/src/ui/equip-manager.js'));
    if (EquipManager.syncWeaponVisual) EquipManager.syncWeaponVisual();
    return { name: item.name, weaponType: item.weaponType, mode: p.weaponMode };
})()`);
console.log('equipped:', JSON.stringify(eq));
await sleep(6000); // 等场景淡入

const CX = 948, CY = 494; // 视口中心（相机跟随玩家）
async function shotAt(mx, my, name, fire = false) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
    await sleep(350);
    if (fire) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'left', clickCount: 1 });
        await sleep(120); // 开火后 ~120ms 内抓 flinch 帧
    }
    // 锚点红点标记（_sweepState 世界坐标 → 屏幕），用于手-枪偏差量化
    await rawEval(`(async () => {
        const s = window.__phaserScene;
        const camUrls = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/world/camera.js'));
        const cam = await import(camUrls.find(n => n.includes('.js?')) || camUrls[0]);
        let dot = document.getElementById('__anchorDot');
        if (!dot) {
            dot = document.createElement('div');
            dot.id = '__anchorDot';
            dot.style.cssText = 'position:fixed;width:10px;height:10px;border-radius:50%;background:#f00;z-index:99999;pointer-events:none;outline:2px solid #fff';
            document.body.appendChild(dot);
        }
        if (s._sweepState) {
            dot.style.display = 'block';
            dot.style.left = (s._sweepState.x - cam.Camera.x + ${CX} - 5) + 'px';
            dot.style.top = (s._sweepState.y - cam.Camera.y + ${CY} - 5) + 'px';
        } else dot.style.display = 'none';
    })()`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/aimsweep_${name}.png`, Buffer.from(r.result.data, 'base64'));
    if (fire) await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'left', clickCount: 1 });
    const info = await rawEval(`(() => {
        const s = window.__phaserScene;
        return { tex: s.playerSprite.texture.key, frame: s.playerSprite.frame.name, flip: s.playerSprite.flipX };
    })()`);
    console.log(`shot ${name}:`, JSON.stringify(info));
    await sleep(200);
}

await shotAt(CX + 500, CY + 350, 'down');   // 压枪（右下）
await shotAt(CX + 500, CY, 'level');        // 水平
await shotAt(CX + 350, CY - 400, 'up');     // 举枪（右上）
// 先点一次激活鼠标捕获，再开火抓 flinch 帧
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: CX + 300, y: CY, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: CX + 300, y: CY, button: 'left', clickCount: 1 });
await sleep(300);
await shotAt(CX + 500, CY, 'fire', true);   // 水平开火
await shotAt(CX - 500, CY - 100, 'left');   // 左侧（镜像）
// 移动中瞄准（行走矩阵验证）：按住 D 向右走，鼠标指向右上方，连拍 3 帧
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: CX + 350, y: CY - 300 });
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
for (let i = 0; i < 3; i++) {
    await sleep(320);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/aimsweep_move_${i}.png`, Buffer.from(r.result.data, 'base64'));
    const info = await rawEval(`(() => { const s = window.__phaserScene;
        return { tex: s.playerSprite.texture.key, frame: s.playerSprite.frame.name, moving: window.Game.player.isMoving }; })()`);
    console.log(`shot move_${i}:`, JSON.stringify(info));
}
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
await cleanup(0);
