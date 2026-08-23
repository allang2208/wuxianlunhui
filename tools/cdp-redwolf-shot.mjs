#!/usr/bin/env node
/* 红狼王实机截图探针（六态版，2026-08-23）：
 * 加载 dev 页面 -> 等 window.Game -> 把红狼王强制生成到玩家旁 -> 进入二阶段 -> 截图狼形态与阶段状态。
 * 前置：vite dev 已启动。用法：node tools/cdp-redwolf-shot.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9244;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-rw2-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });

async function waitFor(fn, t = 50000, s = 400) {
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
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} :: ${r.result.exceptionDetails.exception?.description || ''}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('shot:', name);
}

await send('Runtime.enable');
await send('Page.enable');

// 重新加载页面，让 Phaser 场景完整启动
await send('Page.reload');
await new Promise((r) => setTimeout(r, 2500));

const ready = await waitFor(async () => {
    const s = await evalJs(`({ g: !!(window.Game && window.Game.entities), p: !!(window.Game && window.Game.player), scene: !!(window.__phaserScene) })`);
    if (s && s.g && !s.p) {
        // 停在主菜单：先启动游戏生成玩家
        const r = await evalJs(`(async () => {
            try {
                if (window.Game && !window.Game.isRunning) { await window.Game.start(); }
                return { started: window.Game.isRunning, hasPlayer: !!window.Game.player, hasScene: !!window.__phaserScene, canvas: document.querySelectorAll('canvas').length };
            } catch (e) { return { err: String(e && e.stack || e) }; }
        })()`);
        console.log('start result:', JSON.stringify(r));
        return null;
    }
    return s && s.g && s.p && s.scene ? s : null;
});
if (!ready) { console.error('game not ready'); edge.kill(); process.exit(2); }
console.log('game ready');

// 强制生成/复用红狼王，拉到玩家旁
const diag = await evalJs(`(() => {
    const g = window.Game;
    const p = g.player;
    const e = g.entities.get('enemy_main_red_wolf');
    const cam = window.__phaserScene && window.__phaserScene.cameras && window.__phaserScene.cameras.main;
    return {
        player: p ? { x: p.x, y: p.y } : null,
        wolf: e ? { x: e.x, y: e.y, hasSprite: !!e._phaserSprite } : null,
        cam: cam ? { x: cam.scrollX, y: cam.scrollY, w: cam.width, h: cam.height } : null,
    };
})()`);
console.log('diag:', JSON.stringify(diag));

const spawnResult = await evalJs(`(async () => {
    const g = window.Game;
    const p = g.player;
    if (!p) return { error: 'no player' };
    let e = g.entities.get('enemy_main_red_wolf');
    if (!e) {
        if (typeof g.spawnMainRedWolfKing === 'function') g.spawnMainRedWolfKing();
        await new Promise((r) => setTimeout(r, 800));
        e = g.entities.get('enemy_main_red_wolf');
    }
    if (!e) return { error: 'no wolf after spawn' };
    e.x = p.x + 140; e.y = p.y - 40;
    // 强制创建 Phaser sprite
    const scene = window.__phaserScene;
    if (scene && typeof scene.getOrCreateEnemySprite === 'function' && !e._phaserSprite) {
        scene.getOrCreateEnemySprite(e, e._getTextureKey ? e._getTextureKey() : 'enemy_circle');
    }
    if (window.__phaserScene && window.__phaserScene.cameras && window.__phaserScene.cameras.main) {
        window.__phaserScene.cameras.main.centerOn(p.x, p.y);
    }
    await new Promise((r) => setTimeout(r, 1200));
    return { made: true, name: e.name, x: e.x, y: e.y, hasSprite: !!e._phaserSprite };
})()`);
console.log('spawn:', JSON.stringify(spawnResult));

await new Promise((r) => setTimeout(r, 2500));
await shot('rw_shot_wolf');

// 尝试变身
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return;
    e.hp = e.maxHp * 0.3;
    e._transformTriggered = false; e._isTransforming = false; e._isTransformed = false;
    // 确保 update 里能触发变身
    if (e._transformCfg && e._transformCfg.hpThreshold) e._transformCfg.hpThreshold = 0.5;
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 7000));
await shot('rw_shot_phase_two');

// 强制切到奔跑动画再截图
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return;
    e._animState = 'run';
    try { e._endBite(); } catch (_) {}
    try { e._endPounce(); } catch (_) {}
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await shot('rw_shot_phase_two_run');

const state = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    const sp = e && e._phaserSprite;
    return e ? { isTransformed: e._isTransformed, animState: e._animState, texKey: e._getTextureKey(), spriteTex: sp && sp.texture ? sp.texture.key : null, hasSprite: !!sp } : null;
})()`).catch(() => null);
console.log('final state:', JSON.stringify(state));
console.log('errs:', errs.length ? errs : 'none');
edge.kill();
