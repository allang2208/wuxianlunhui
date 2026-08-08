#!/usr/bin/env node
/* 红狼王变身+嚎叫技能实机探针（2026-08-08）：
 * 1) 生成红狼王 -> 压血触发变身；
 * 2) 变身完成后检查是否还自动嚎叫（_howlTimer 应为 0、纹理应为 idle/run 而非 howl）；
 * 3) 在红狼人形态下等待嚎叫技能冷却触发（配置 cooldown 30s，探针里手动把 _howlCd 置 0 加速），
 *    检查 _animState === 'howl'、纹理为 changed_howl、场上怪物获得 inspire。
 * 前置：vite dev 已启动。用法：node tools/cdp-redwolf-howl.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9245;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-rwhowl-'));
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
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
await send('Page.reload');
await new Promise((r) => setTimeout(r, 2500));

const ready = await waitFor(async () => {
    const s = await evalJs(`({ g: !!(window.Game && window.Game.entities), p: !!(window.Game && window.Game.player) })`);
    if (s && s.g && !s.p) {
        await evalJs(`(async () => { try { if (window.Game && !window.Game.isRunning) await window.Game.start(); } catch (e) { return String(e); } })()`);
        return null;
    }
    return s && s.g && s.p ? s : null;
});
if (!ready) { console.error('game not ready'); edge.kill(); process.exit(2); }

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
    const scene = window.__phaserScene;
    if (scene && typeof scene.getOrCreateEnemySprite === 'function' && !e._phaserSprite) {
        scene.getOrCreateEnemySprite(e, e._getTextureKey ? e._getTextureKey() : 'enemy_circle');
    }
    if (window.__phaserScene && window.__phaserScene.cameras && window.__phaserScene.cameras.main) {
        window.__phaserScene.cameras.main.centerOn(p.x, p.y);
    }
    await new Promise((r) => setTimeout(r, 1200));
    return { made: true, hasSprite: !!e._phaserSprite };
})()`);
console.log('spawn:', JSON.stringify(spawnResult));

// 触发变身
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return;
    e.hp = e.maxHp * 0.3;
    e._transformTriggered = false; e._isTransforming = false; e._isTransformed = false;
    if (e._transformCfg && e._transformCfg.hpThreshold) e._transformCfg.hpThreshold = 0.5;
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
const mid = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    return e ? { isTransforming: e._isTransforming, animState: e._animState, texKey: e._getTextureKey() } : null;
})()`).catch(() => null);
console.log('mid-transform:', JSON.stringify(mid));

// 变身完成（duration 2000 + 缓冲）
await new Promise((r) => setTimeout(r, 2500));
const afterTransform = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    return e ? {
        isTransformed: e._isTransformed,
        isTransforming: e._isTransforming,
        howlTimer: e._howlTimer,
        animState: e._animState,
        texKey: e._getTextureKey(),
    } : null;
})()`).catch(() => null);
console.log('after-transform:', JSON.stringify(afterTransform));
await shot('rwhowl_after_transform');

// 手动清零嚎叫冷却，等嚎叫技能触发
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (e) e._howlCd = 0;
})()`).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
const howlActive = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    const sp = e && e._phaserSprite;
    return e ? {
        howlTimer: e._howlTimer,
        animState: e._animState,
        texKey: e._getTextureKey(),
        spriteTex: sp && sp.texture ? sp.texture.key : null,
    } : null;
})()`).catch(() => null);
console.log('howl-active:', JSON.stringify(howlActive));
await shot('rwhowl_active');

// 检查怪物激励状态
const inspireCheck = await evalJs(`(() => {
    const out = { list: [] };
    if (window.Game && window.Game.entities) {
        window.Game.entities.forEach((e) => {
            if (!e || e._faction !== 'enemy') return;
            out.list.push({
                name: e.name,
                inspired: typeof e.hasStatusEffect === 'function' ? e.hasStatusEffect('inspire') : false,
                remaining: typeof e.getStatusEffectRemaining === 'function' ? Math.round(e.getStatusEffectRemaining('inspire')) : 0,
            });
        });
    }
    return out;
})()`).catch(() => null);
console.log('inspire:', JSON.stringify(inspireCheck, null, 2));

console.log('DONE');
edge.kill();
