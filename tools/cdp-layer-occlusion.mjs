#!/usr/bin/env node
/* 世界-122 建筑图层统一口径回归（2026-08-16）：
   - 全建筑（塔/基地核心/能源矿/小屋）都注册统一遮挡锚线（_faceLine/_faceDepth，
     src/world/structure-depth.js）；掩体/铁闸门沿用原有正确实现；
   - 单位（仓鼠等友方/玩家/敌人）经 junctionCorrectedDepth 仲裁：
     脚线在建筑接地线之后 → 建筑盖单位；在前/同线 → 单位盖建筑（+0.5 消除同线 z-fight）；
   - 合成场景 36 组合 + 真实基地场景同线/前后抽查，杜绝"建筑遮挡仓鼠"复发。
   用法：node tools/cdp-layer-occlusion.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9351);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-layer-'));
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

// ---------- 启动游戏 + 进入 scene8 ----------
let sceneReady = false;
for (let i = 0; i < 150; i++) {
    const started = await rawEval(`(async () => {
        try {
            if (window.Game && window.Game.isRunning && window.Game.player) return true;
            const b = document.getElementById('startGameBtn');
            if (b) b.click();
            if (window.Game && typeof window.Game.start === 'function' && !window.Game.isRunning) {
                window.Game.start().catch(() => {});
            }
            return false;
        } catch { return false; }
    })()`).catch(() => false);
    if (started) break;
    await sleep(1000);
}
for (let i = 0; i < 150 && !sceneReady; i++) {
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
        sceneReady = await rawEval(`(async () => {
            const { DefenseSystem } = await window.__imp('defense-system');
            return !!(window.__sm.currentScene === 'scene8' && DefenseSystem.active && DefenseSystem.base);
        })()`).catch(() => false);
        if (sceneReady) break;
    }
}
check('世界-122 已就绪', sceneReady);
if (!sceneReady) { console.error('scene8 not ready, abort'); await cleanup(1); }
await rawEval(`(async () => {
    const { DefenseSystem } = await window.__imp('defense-system');
    DefenseSystem._phase = 'prep'; DefenseSystem._phaseTimer = 1e9;
})()`).catch(() => false);

// 2026-08-16 起默认战士/射手改由「仓鼠兵营」生成——探针手动构造一只测试射手
await rawEval(`(async () => {
    if ([...window.Game.entities.values()].some(e => e && e._isHamsterShooter && e.active)) return 'exists';
    const { HamsterShooter } = await import('/src/entities/hamster-shooter.js');
    const p = window.Game.player;
    const s = new HamsterShooter(p.x + 90, p.y - 30, { id: 'probe_shooter' });
    window.Game.entities.set(s.id, s);
    if (!Array.isArray(window.Game.friendlyUnits)) window.Game.friendlyUnits = [];
    window.Game.friendlyUnits.push(s);
    return 'spawned';
})()`).catch(() => null);

// ---------- A. 合成场景：塔/基地核心/能源矿/小屋 × 墙位 × 前/同/后 ----------
console.log('A. 合成场景全组合（建筑盖单位 iff 建筑脚线在单位之后）');
const a = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep2(1200);
    const shooter = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    if (!shooter) return { err: 'no shooter' };
    shooter._ai = null;
    shooter.target = null; shooter._tacticalTarget = null;
    shooter.vx = 0; shooter.vy = 0; shooter.isMoving = false; shooter.maxSpeed = 0;
    const { DefenseTower, DefenseBase, DefenseCover } = await window.__imp('defense-system');
    const { HamsterHut, HamsterHutSystem } = await window.__imp('hamster-hut-system');
    const { HamsterBarracks, HamsterBarracksSystem } = await window.__imp('hamster-barracks-system');
    const structures = [];
    const mk = (id, s) => { window.Game.entities.set(id, s); return s; };
    structures.push(mk('probe_tower', new DefenseTower(2600, 2600)));
    structures.push(mk('probe_base', new DefenseBase(2800, 2800)));
    const node = [...window.Game.entities.values()].find(e => e && e._isEnergyNode && e.active);
    if (node) {
        node.x = 3000; node.y = 3000;
        const { setupStructureDepth } = await import('/src/world/structure-depth.js');
        setupStructureDepth(node, node.spriteCfg.size / 2);
        structures.push(mk('probe_node', node));
    }
    const hut = new HamsterHut(3200, 3200);
    structures.push(mk('probe_hut', hut));
    HamsterHutSystem.huts.push(hut);
    const barracks = new HamsterBarracks(3400, 3400);
    structures.push(mk('probe_barracks', barracks));
    if (HamsterBarracksSystem && Array.isArray(HamsterBarracksSystem.barracks)) {
        HamsterBarracksSystem.barracks.push(barracks);
    }
    const cover = mk('probe_cover', new DefenseCover(2400, 2400, { orient: 'h', w: 260, d: 52, grade: 'F' }));
    const scene = window.__phaserScene;
    const structDepth = (s) => {
        if (s._isDefenseTower) {
            const sp = scene._defenseSprites.get(s);
            return sp ? sp.base.depth : null;
        }
        const d = scene._neutralSprites.get(s);
        return d ? d.sprite.depth : null;
    };
    const results = [];
    const rule = (s, hy) => (s.y > hy ? 'structure' : 'hamster');
    for (const s of structures) {
        if (s === cover) continue;
        for (const [cwLabel, cwDy] of [['no-wall', 0], ['wall-front', -150], ['wall-behind', 150]]) {
            if (cwLabel !== 'no-wall') {
                // 移动墙段并同步其遮挡锚线（构造时的锚线已过期）
                cover.x = s.x; cover.y = s.y + cwDy;
                cover._faceLine = [{ x: cover.x - 130, y: cover.y }, { x: cover.x + 130, y: cover.y }];
                cover._faceDepth = cover.y + 12;
            }
            for (const [label, dy] of [['behind', -120], ['same', 0], ['front', 120]]) {
                shooter.x = s.x; shooter.y = s.y + dy;
                await sleep2(80);
                const sd = structDepth(s);
                const ham = scene._companionSprites[shooter.id];
                const hd = ham ? ham.depth : null;
                const onTop = (hd !== null && sd !== null) ? (hd > sd ? 'hamster' : (hd < sd ? 'structure' : 'equal')) : 'missing';
                results.push({ s: s.constructor.name, w: cwLabel, p: label, sd, hd, onTop, ok: onTop === rule(s, shooter.y) });
            }
        }
    }
    return results;
})()`);
if (!a || a.err) check('合成场景可运行', false, JSON.stringify((a && a.err) || 'eval undefined'));
else {
    const bad = a.filter(x => !x.ok);
    check('合成场景全组合正确（36/36）', bad.length === 0,
        `${a.length} 组合，失败 ${bad.length}：${JSON.stringify(bad.slice(0, 3))}`);
}

// ---------- B. 真实基地场景：建筑都有统一锚线 + 同线不再 z-fight ----------
console.log('B. 真实基地场景抽查');
const b = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    const shooter = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    if (!shooter) return { err: 'no shooter' };
    shooter._ai = null;
    shooter.target = null; shooter._tacticalTarget = null;
    shooter.vx = 0; shooter.vy = 0; shooter.isMoving = false; shooter.maxSpeed = 0;
    const scene = window.__phaserScene;
    const { DefenseSystem } = await window.__imp('defense-system');
    const base = DefenseSystem.base;
    const tower = [...window.Game.entities.values()].find(e => e && e._isDefenseTower && e.active);
    const hut = [...window.Game.entities.values()].find(e => e && e._isHamsterHut && e.active);
    const node = [...window.Game.entities.values()].find(e => e && e._isEnergyNode && e.active);
    // 现场建造小屋/兵营（走真实构造器，验证统一锚线对这两类建筑同样生效）
    const { HamsterHut, HamsterHutSystem } = await window.__imp('hamster-hut-system');
    const { HamsterBarracks, HamsterBarracksSystem } = await window.__imp('hamster-barracks-system');
    const builtHut = new HamsterHut(3600, 2800, { id: 'probe_real_hut' });
    window.Game.entities.set(builtHut.id, builtHut);
    HamsterHutSystem.huts.push(builtHut);
    const builtBarracks = new HamsterBarracks(3800, 2800, { id: 'probe_real_barracks' });
    window.Game.entities.set(builtBarracks.id, builtBarracks);
    HamsterBarracksSystem.barracks.push(builtBarracks);
    const targets = [base, tower, hut, node, builtHut, builtBarracks].filter(Boolean);
    const structDepth = (s) => {
        if (s._isDefenseTower) {
            const sp = scene._defenseSprites.get(s);
            return sp ? sp.base.depth : null;
        }
        const d = scene._neutralSprites.get(s);
        return d ? d.sprite.depth : null;
    };
    const rows = [];
    for (const s of targets) {
        const hasAnchor = !!s._faceLine && s._faceLine.length === 2 && typeof s._faceDepth === 'number';
        shooter.x = s.x; shooter.y = s.y; // 同线
        await sleep2(80);
        const sd = structDepth(s);
        const ham = scene._companionSprites[shooter.id];
        const hd = ham ? ham.depth : null;
        rows.push({
            name: s.name || s.constructor.name,
            hasAnchor,
            faceDepth: s._faceDepth,
            sd, hd,
            sameLineOk: hasAnchor && hd !== null && sd !== null && hd > sd,
        });
    }
    return rows;
})()`);
if (!b || b.err) check('真实场景可运行', false, JSON.stringify((b && b.err) || 'eval undefined'));
else {
    const names = b.map(r => `${r.name}:anchor=${r.hasAnchor},sameLine=${r.sameLineOk}`).join(' | ');
    check('真实建筑全部带统一锚线 + 同线单位盖过建筑（无 z-fight）',
        b.length >= 3 && b.every(r => r.hasAnchor && r.sameLineOk), names);
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
