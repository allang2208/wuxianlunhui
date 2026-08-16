#!/usr/bin/env node
/* 世界-122 BGM 验证探针 v3：playBgmForScene('scene8') → 检查 WebAudio BufferSource 加载旷野慢风 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9319;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-bgm3-'));
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

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

const r = await evalJs(`(async () => {
    const { SoundManager } = await import('/src/ui/sound-manager.js');
    window.__SM = SoundManager;
    const out = { enabled: SoundManager.enabled, hasCtx: !!SoundManager.ctx };
    // 先读配置
    const cfg = (await import('/data/audio-config.json')).default || null;
    out.scene8Cfg = cfg ? cfg.bgm.scene8 : null;
    // 触发
    const ret = SoundManager.playBgmForScene('scene8');
    out.playReturn = ret;
    await new Promise(res => setTimeout(res, 2000));
    const l = SoundManager._loops || {};
    out.loops = Object.keys(l).map(k => ({ id: k, hasSrc: !!l[k].src, hasGain: !!l[k].gain, vol: l[k].volume }));
    // 网络资源确认
    out.musicResources = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('music')).map(n => n.split('/').pop());
    return out;
})()`);
console.log('BGM:', JSON.stringify(r, null, 2));

edge.kill();
console.log('done');
