#!/usr/bin/env node
/* 世界-122 建筑面板运行时验证（CDP 无头 Edge，2026-08-04）。
 * 前置：vite dev 已起（localhost:5173）。一条龙：点开始 → 等真实模块就绪 →
 * 切世界-122 → 开面板 → 选建筑 → 鼠标幽灵 → 放置（扣金币）→ 镜像 → 截图。
 * 关键：等页面完全加载后点官方"开始"按钮（避免与 vite 依赖优化后的整页重载竞争）；
 * 模块一律走 performance 资源表里的真实 ?t= URL（避免动态 import 重复实例）。
 * 用法：node tools/cdp-building-panel.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9225;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/verify';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
// 等页面 + vite 依赖优化彻底稳定（过早连接会被整页重载打断）
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        return await r.json();
    } finally {
        clearTimeout(t);
    }
}
async function waitFor(fn, timeoutMs = 20000, step = 300) {
    const t0 = Date.now();
    for (;;) {
        try {
            const v = await fn();
            if (v) return v;
        } catch { /* retry */ }
        if (Date.now() - t0 > timeoutMs) return null;
        await new Promise((r) => setTimeout(r, step));
    }
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
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
};
const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
};
const mouse = (type, x, y, button) => send('Input.dispatchMouseEvent', {
    type, x, y, button: button || 'none', clickCount: 1,
});

await send('Runtime.enable');
await send('Page.enable');

// 1) Node 侧轮询点"开始"按钮（官方路径；页面重载时 eval 可能中断，容错重试）
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

// 2) 挂载真实模块助手 + 等真实 SceneManager 就绪（init 已跑、currentScene 非空）
let smReady = null;
for (let i = 0; i < 50; i++) {
    smReady = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return null;
        const { SceneManager } = await import(u);
        try {
            window.__sm = SceneManager;
            window.__imp = (p) => {
                const url = performance.getEntriesByType('resource').map(e => e.name)
                    .find(n => n.includes(p) && n.includes('?'));
                if (!url) throw new Error('module not loaded: ' + p);
                return import(url);
            };
        } catch (e) { return { scene: null, keys: 0, err: String(e) }; }
        if (SceneManager.currentScene) {
            return { scene: SceneManager.currentScene, keys: Object.keys(SceneManager.scenes || {}).length };
        }
        return null;
    })()`).catch(() => null);
    if (smReady) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('scene mgr ready:', JSON.stringify(smReady));

// 3) 切世界-122 + 发金币
console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return { scene: window.__sm.currentScene };
})()`));
const bootState = await evalJs(`(async () => {
    // 真实掉落+自动拾取链路给玩家 9999 金币（进入真实背包/GoldManager）
    window.Game.dropItem(window.Game.player.x, window.Game.player.y + 50, { name: '金币', category: 'gold', stack: 9999 });
    await new Promise((r) => setTimeout(r, 900));
    const ds = (await window.__imp('/src/world/defense-system')).DefenseSystem;
    return { active: ds.active, towers: ds.towers.length };
})()`);
console.log('boot:', JSON.stringify(bootState));
console.log('gold diag:', await evalJs(`(async () => {
    const em = (await window.__imp('/src/ui/equip-manager')).EquipManager;
    const gold = (em.backpackItems || []).reduce((s, i) => s + (i.category === 'gold' ? (i.stack || 0) : 0), 0);
    return { gold, slots: em.backpackItems ? em.backpackItems.length : -1 };
})()`));

// 直接调 _place 验证逻辑链路（绕过鼠标事件）
console.log('direct place:', await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const bs = m.BuildingSystem;
    const em = (await window.__imp('/src/ui/equip-manager')).EquipManager;
    const gold0 = (em.backpackItems || []).reduce((s, i) => s + (i.category === 'gold' ? (i.stack || 0) : 0), 0);
    bs._selectItem(m.BUILD_ITEMS.find((i) => i.id === 'tower'));
    const can = bs._canPlace(2800, 1200);
    bs._place(2800, 1200);
    const gold1 = (em.backpackItems || []).reduce((s, i) => s + (i.category === 'gold' ? (i.stack || 0) : 0), 0);
    const towers = (await window.__imp('/src/world/defense-system')).DefenseSystem.towers.length;
    return { gold0, gold1, can, towers, placing: !!bs._placing };
})()`));

// 找一个有效的屏幕落点（扫 600×600 区域，避开墙/建筑）
const spot = await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const bs = m.BuildingSystem;
    const cam = window.__phaserScene.cameras.main;
    for (let dy = -300; dy <= 300; dy += 60) {
        for (let dx = -300; dx <= 300; dx += 60) {
            const w = cam.getWorldPoint(960 + dx, 540 + dy);
            if (bs._canPlace(w.x, w.y)) return { sx: 960 + dx, sy: 540 + dy, wx: Math.round(w.x), wy: Math.round(w.y) };
        }
    }
    return null;
})()`);
console.log('spot:', JSON.stringify(spot));

// 4) 开建筑面板 + 选防御塔
await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    m.BuildingSystem.open();
    m.BuildingSystem._selectItem(m.BUILD_ITEMS.find((i) => i.id === 'tower'));
    return true;
})()`);
await new Promise((r) => setTimeout(r, 500));
await shot('building_panel_tower');

await mouse('mouseMoved', spot.sx, spot.sy);
await new Promise((r) => setTimeout(r, 400));
await shot('building_ghost_tower');

const before = await evalJs(`(async () => {
    const ds = (await window.__imp('/src/world/defense-system')).DefenseSystem;
    return { towers: ds.towers.length };
})()`);
await mouse('mousePressed', spot.sx, spot.sy, 'left');
await mouse('mouseReleased', spot.sx, spot.sy, 'left');
await new Promise((r) => setTimeout(r, 400));
const after = await evalJs(`(async () => {
    const ds = (await window.__imp('/src/world/defense-system')).DefenseSystem;
    return { towers: ds.towers.length };
})()`);
console.log('place tower:', JSON.stringify({ before, after }));

// 5) 选掩体 F 水平 + 镜像 + 放置
await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    m.BuildingSystem._selectItem(m.BUILD_ITEMS.find((i) => i.id === 'cover_F_h'));
    m.BuildingSystem._toggleMirror();
    return m.BuildingSystem._placing ? { mirror: m.BuildingSystem._placing.mirror, item: m.BuildingSystem._placing.item.name } : null;
})()`);
const spot2 = await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const bs = m.BuildingSystem;
    const cam = window.__phaserScene.cameras.main;
    for (let dy = -300; dy <= 300; dy += 60) {
        for (let dx = -300; dx <= 300; dx += 60) {
            const w = cam.getWorldPoint(960 + dx, 540 + dy);
            if (bs._canPlace(w.x, w.y)) return { sx: 960 + dx, sy: 540 + dy };
        }
    }
    return null;
})()`);
await mouse('mouseMoved', spot2.sx, spot2.sy);
await new Promise((r) => setTimeout(r, 400));
await shot('building_ghost_cover_mirror');
await mouse('mousePressed', spot2.sx, spot2.sy, 'left');
await mouse('mouseReleased', spot2.sx, spot2.sy, 'left');
await new Promise((r) => setTimeout(r, 400));
const coverState = await evalJs(`(async () => {
    let mirror = null;
    for (const e of window.Game.entities.values()) {
        if (e && e.grade && e.id && String(e.id).startsWith('built_cover_F_h')) {
            mirror = !!e._facingLeft;
        }
    }
    return { mirror };
})()`);
console.log('place cover mirrored:', JSON.stringify(coverState));
await shot('building_placed');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
