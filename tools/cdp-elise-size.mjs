#!/usr/bin/env node
/**
 * 伊莉丝各动作实际渲染尺寸排查（2026-08-17）：
 * 逐状态读取 Phaser 精灵的贴图/帧格/显示尺寸，判断"施法/攻击缩小"是否属实。
 *
 * 用法: powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-elise-size.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9355;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-esize-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900', '--no-first-run', '--no-default-browser-check',
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
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250)}`);
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
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

const out = await evalJs(`(async () => {
    try {
    const Game = window.Game;
    const PS = Game.PartySystem;
    const player = Game.player;
    for (const m of [...(PS.members || [])]) PS.removeCompanion(m.id);
    PS.addCompanion('warrior_bruno');
    const elise = PS.members.find((m) => m.id === 'warrior_bruno');
    elise.data.level = 5;
    elise._checkUnlocks();
    elise.x = player.x + 120; elise.y = player.y + 40;
    // 禁用 AI 工厂，避免每 120ms 决策把 _animState 覆盖回 idle
    PS._aiFactories['warrior_bruno'] = null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(800);
    const scene = window.__phaserScene;
    // 轮询等精灵创建（_syncCompanionSprites 每帧执行）
    let sprite = null;
    for (let i = 0; i < 20 && !sprite; i++) {
        const s = window.__phaserScene;
        if (s && s._companionSprites) sprite = s._companionSprites['warrior_bruno'] || null;
        if (!sprite) await wait(250);
    }
    if (!sprite) {
        return {
            diag: {
                sceneKey: scene ? scene.scene ? scene.scene.key : scene.constructor.name : 'null',
                hasMembers: !!(PS.members && PS.members.length),
                memberAnimations: elise.animations ? Object.keys(elise.animations) : null,
                walkTex: !!(window.__phaserScene && window.__phaserScene.textures
                    && window.__phaserScene.textures.exists('companion_warrior_bruno_walk')),
                spritesKeys: scene && scene._companionSprites ? Object.keys(scene._companionSprites) : null,
            },
        };
    }
    const read = () => ({
        tex: sprite.texture.key,
        frame: [sprite.frame.width, sprite.frame.height],
        display: [Math.round(sprite.displayWidth), Math.round(sprite.displayHeight)],
        frameName: sprite.frame.name,
        pos: [Math.round(sprite.x), Math.round(sprite.y)],
    });
    const res = {};
    const states = ['idle', 'walk', 'run', 'attack', 'windmill', 'defend'];
    for (const st of states) {
        sprite.setData('atkPlayed', false);
        sprite.setData('wmPlayed', false);
        sprite.setData('defPhase', null);
        elise._animState = st;
        await wait(250);
        res[st] = read();
    }
    for (const m of [...(PS.members || [])]) PS.removeCompanion(m.id);
    return res;
    } catch (e) { return { error: String(e && e.stack || e) }; }
})()`);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
