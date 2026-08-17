#!/usr/bin/env node
/* 四栋产兵建筑实际显示尺寸诊断（CDP 无头 Edge，2026-08-17）。
 * 放置 thatch_hut / blacksmith / hamster_hut(mine) / hamster_barracks(barracks)，
 * 读取每栋渲染精灵的 display 尺寸 + 截图后按内容 alpha 测量。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9227;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.resolve('tools/verify-shots/thatch');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
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
console.log(`edge pid=${edge.pid}`);
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

let smReady = null;
for (let i = 0; i < 50; i++) {
    smReady = await evalJs(`(async () => {
        const u = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) return null;
        const { SceneManager } = await import(u);
        window.__sm = SceneManager;
        window.__imp = (p) => {
            const url = performance.getEntriesByType('resource').map(e => e.name)
                .find(n => n.includes(p) && n.includes('?'));
            if (!url) throw new Error('module not loaded: ' + p);
            return import(url);
        };
        if (SceneManager.currentScene) return { scene: SceneManager.currentScene };
        return null;
    })()`).catch(() => null);
    if (smReady) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('scene mgr ready:', JSON.stringify(smReady));

console.log('switch:', await evalJs(`(async () => {
    await window.__sm.switchScene('scene8', window.Game.player);
    return { scene: window.__sm.currentScene };
})()`));

await evalJs(`(async () => {
    const em = (await import('/src/systems/energy-manager.js')).EnergyManager;
    em.addEnergy(99999);
    return true;
})()`);

// 放置四栋建筑（扫描开阔位置），并返回每栋实体的 sprite 显示尺寸
const placed = await evalJs(`(async () => {
    const m = await window.__imp('/src/world/building-system');
    const bs = m.BuildingSystem;
    const ids = ['thatch_hut', 'blacksmith', 'hamster_hut', 'hamster_barracks'];
    const out = [];
    // 找到真正的 GameScene（带 _neutralSprites 的 Phaser 场景）
    const game = window.__phaserScene.game || (window.__phaserScene.scene && window.__phaserScene.scene.game);
    let scene = null;
    if (game && game.scene) {
        for (const s of game.scene.getScenes(true)) {
            if (s && s._neutralSprites) { scene = s; break; }
        }
    }
    if (!scene) scene = window.__phaserScene;
    const cam = scene.cameras.main;
    // 找 4 个互相间隔、可放置的世界坐标点
    const spots = [];
    outer:
    for (let dy = -700; dy <= 700; dy += 90) {
        for (let dx = -700; dx <= 700; dx += 90) {
            const w = cam.getWorldPoint(960 + dx, 540 + dy);
            if (Math.hypot(w.x - window.Game.player.x, w.y - window.Game.player.y) > 1500) continue;
            if (!bs._canPlace(w.x, w.y)) continue;
            if (spots.some((s) => Math.hypot(s.x - w.x, s.y - w.y) < 260)) continue;
            spots.push({ x: w.x, y: w.y });
            if (spots.length >= ids.length) break outer;
        }
    }
    out.push({ spots: spots.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) })) });
    for (let k = 0; k < ids.length && k < spots.length; k++) {
        const id = ids[k];
        const item = m.BUILD_ITEMS.find((i) => i.id === id);
        if (!item) { out.push({ id, err: 'no BUILD_ITEMS' }); continue; }
        bs._selectItem(item);
        bs._place(spots[k].x, spots[k].y);
        bs._cancelPlacement();
    }
    await new Promise((r) => setTimeout(r, 600));
    const texCheck = {};
    for (const k of ['thatch_hut', 'blacksmith', 'mine', 'barracks', 'hamster_hut', 'hamster_barracks']) {
        texCheck[k] = !!(scene && scene.textures && scene.textures.exists(k));
    }
    out.unshift({ texCheck, gameSceneFound: !!(game && game.scene) });
    const wanted = new Set(['thatch_hut', 'blacksmith', 'mine', 'barracks']);
    for (const e of window.Game.entities.values()) {
        if (!e || !e._isDefenseStructure) continue;
        if (!wanted.has(e.cfgKey) && !wanted.has((e.spriteCfg || {}).idleKey)) continue;
        let spr = null;
        try {
            const data = (scene._neutralSprites && scene._neutralSprites.get) ? scene._neutralSprites.get(e) : null;
            spr = data ? data.sprite : null;
        } catch { spr = null; }
        out.push({
            name: e.name,
            cfgKey: e.cfgKey || e.constructor.name,
            spriteCfg: e.spriteCfg ? { size: e.spriteCfg.size, sizeH: e.spriteCfg.sizeH, foot: e.spriteCfg.footOffsetY } : null,
            display: spr ? { w: Math.round(spr.displayWidth), h: Math.round(spr.displayHeight) } : 'NO_SPRITE',
            texture: spr ? spr.texture.key : null,
            footOffsetY: e.footOffsetY,
        });
    }
    // 相机移到建筑群中心
    if (scene && scene.cameras) {
        const cx = spots.length ? spots.reduce((s, p) => s + p.x, 0) / spots.length : 0;
        const cy = spots.length ? spots.reduce((s, p) => s + p.y, 0) / spots.length : 0;
        scene.cameras.main.centerOn(cx, cy);
    }
    return out;
})()`);
console.log('placed:', JSON.stringify(placed, null, 1));
fs.writeFileSync(path.resolve('tools/verify-shots/thatch/size_probe.json'), JSON.stringify(placed, null, 1));
await shot('size_probe');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
