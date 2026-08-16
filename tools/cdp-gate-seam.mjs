#!/usr/bin/env node
/* 铁栅栏门拼接缝图层回归（2026-08-16）：
   - 门对门：左门右柱盖右门左柱（syncGateSeamDepths 原有）；
   - 门对掩体（新增用户口径）：门与墙相连同样"左在右之前"——
     门在墙左 → 门右柱抬到墙之上；墙在门左 → 门左柱压到墙之下。
   用法：node tools/cdp-gate-seam.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9355);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-gates-'));
let edge = null;
const rmProfile = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await new Promise(r => setTimeout(r, 1200));
    for (let i = 0; i < 5; i++) { rmProfile(); if (!fs.existsSync(profile)) break; await new Promise(r => setTimeout(r, 700)); }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => { try { if (edge) edge.kill(); } catch {} rmProfile(); });

edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, APP_URL,
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 8000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:517')));
if (!page) { console.error('no page'); await cleanup(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, (m) => { clearTimeout(timer); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
});
const rawEval = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---------- 启动 + 进入 scene8 ----------
for (let i = 0; i < 150; i++) {
    const started = await rawEval(`(async () => {
        try {
            if (window.Game && window.Game.isRunning && window.Game.player) return true;
            const b = document.getElementById('startGameBtn');
            if (b) b.click();
            return false;
        } catch { return false; }
    })()`).catch(() => false);
    if (started) break;
    await sleep(1000);
}
let ready = false;
for (let i = 0; i < 150 && !ready; i++) {
    const ok = await rawEval(`(async () => {
        try {
            if (!(window.Game && window.Game.isRunning && window.Game.player && window.__phaserScene)) return null;
            window.__imp = async (name) => {
                const urls = performance.getEntriesByType('resource').map(e => e.name)
                    .filter(n => n.includes('/src/world/' + name + '.js'));
                const u = urls.find(n => n.includes('.js?')) || urls[0] || ('/src/world/' + name + '.js');
                return import(u);
            };
            const { SceneManager } = await window.__imp('scene-manager');
            window.__sm = SceneManager;
            return 'ready';
        } catch { return null; }
    })()`).catch(() => null);
    if (!ok) { await sleep(500); continue; }
    await rawEval(`(async () => {
        try {
            if (!Object.keys(window.__sm.scenes || {}).length) window.__sm.init();
            if (window.__sm.currentScene === 'scene8') return 'already';
            await window.__sm.switchScene('scene8', window.Game.player, 'explore');
            return window.__sm.currentScene;
        } catch (e) { return String(e); }
    })()`).catch(() => null);
    for (let j = 0; j < 60; j++) {
        await sleep(600);
        ready = await rawEval(`(async () => {
            const { DefenseSystem } = await window.__imp('defense-system');
            return !!(window.__sm.currentScene === 'scene8' && DefenseSystem.active && DefenseSystem.gate);
        })()`).catch(() => false);
        if (ready) break;
    }
}
check('世界-122 已就绪（基地门存在）', ready);
if (!ready) { console.error('scene8 not ready, abort'); await cleanup(1); }
await rawEval(`(async () => {
    const { DefenseSystem } = await window.__imp('defense-system');
    DefenseSystem._phase = 'prep'; DefenseSystem._phaseTimer = 1e9;
})()`).catch(() => false);
await sleep(1500);

// ---------- A. 门对掩体：左在右之前 ----------
console.log('A. 基地门两侧接墙（左在右之前）');
const a = await evalRobust(`(async () => {
    const { DefenseSystem } = await window.__imp('defense-system');
    const g = DefenseSystem.gate;
    if (!g || !g._faceLine || !g.spriteL || !g.spriteR) return { err: 'gate missing' };
    const gf = g._faceLine;
    const SEAM = 70;
    const covers = [...window.Game.entities.values()].filter(e => e && e._isDefenseCover && !e._isCoverGate && e.active);
    const results = [];
    for (const c of covers) {
        const cf = c._faceLine;
        if (!cf) continue;
        const dAB = Math.hypot(gf[1].x - cf[0].x, gf[1].y - cf[0].y);
        const dBA = Math.hypot(gf[0].x - cf[1].x, gf[0].y - cf[1].y);
        if (dAB <= SEAM || dBA <= SEAM) {
            results.push({
                wall: c.id,
                wallDepth: c._faceDepth,
                gateL: g.spriteL.depth,
                gateR: g.spriteR.depth,
                gateLeftOfWall: dAB <= SEAM,
                wallLeftOfGate: dBA <= SEAM,
            });
        }
    }
    return results;
})()`);
if (!a || a.err) check('门对掩体可测', false, JSON.stringify((a && a.err) || 'eval undefined'));
else {
    const okWall = a.filter(r => !((r.gateLeftOfWall && r.gateR <= r.wallDepth) || (r.wallLeftOfGate && r.gateL >= r.wallDepth)));
    check(`门-墙相接处"左在右之前"（${a.length} 处接墙）`, okWall.length === a.length && a.length >= 2,
        JSON.stringify(a.map(r => `${r.wall}:wall=${r.wallDepth},L=${r.gateL},R=${r.gateR}`)));
}

// ---------- B. 门对门：左门右柱盖右门左柱（回归） ----------
console.log('B. 门对门拼接缝（左门右柱盖右门左柱）');
const b = await evalRobust(`(async () => {
    const { DefenseSystem, BuildableGate, syncGateSeamDepths } = await window.__imp('defense-system');
    // 'h' 朝向 face 线 A(高)→B(低) 斜度 -0.5：右门需沿坡线下移 2×half×0.5 = 135px 才共线
    const g1 = new BuildableGate(2600, 2600, { orient: 'h', grade: 'D', id: 'probe_gate1' });
    // 一格门（2026-08-16）：h 向 face 沿 (+176,+88)，与掩体墙同跨
    const g2 = new BuildableGate(2600 + 176, 2600 + 88, { orient: 'h', grade: 'D', id: 'probe_gate2' });
    window.Game.entities.set(g1.id, g1);
    window.Game.entities.set(g2.id, g2);
    DefenseSystem.gates.push(g1, g2);
    syncGateSeamDepths();
    const r = {
        g1R: g1.spriteR ? g1.spriteR.depth : null,
        g2L: g2.spriteL ? g2.spriteL.depth : null,
        g1Face: g1._faceLine ? g1._faceLine.map(p => [Math.round(p.x), Math.round(p.y)]) : null,
        g2Face: g2._faceLine ? g2._faceLine.map(p => [Math.round(p.x), Math.round(p.y)]) : null,
    };
    DefenseSystem.gates = DefenseSystem.gates.filter(x => x !== g1 && x !== g2);
    return r;
})()`);
if (!b || b.err) check('门对门可测', false, JSON.stringify((b && b.err) || 'eval undefined'));
else {
    check('左门右柱盖右门左柱（g1R > g2L）',
        b.g1R !== null && b.g2L !== null && b.g1R > b.g2L,
        `g1R=${b.g1R} g2L=${b.g2L} g1face=${JSON.stringify(b.g1Face)} g2face=${JSON.stringify(b.g2Face)}`);
}

async function evalRobust(expr) {
    try {
        return await rawEval(expr);
    } catch (err) {
        return { probeErr: String(err && err.message || err).slice(0, 300) };
    }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
