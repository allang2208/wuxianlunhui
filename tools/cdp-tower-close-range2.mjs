#!/usr/bin/env node
/**
 * 防御塔近距离死角探针 v2（2026-08-15）——补两个实战场景：
 * 1. 移动目标：僵尸犬（未冻结，自然 AI 跑向基地玩家）途经 AKM 塔，记录全程命中；
 * 2. 霰弹塔：Super90 对 60/100/200px 静止目标（散布弹丸近距离表现）。
 * 判据：测试怪掉血 / 出弹数 / 弹丸终态。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9313;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-towerclose2-'));
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

console.log('switch scene8:', await evalJs(`(async () => {
    const sm = (window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager);
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`));
console.log('defense setup:', await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep'; ds._phaseTimer = 9999999;
    return ds.active;
})()`));

// 场景 1：移动犬途经 AKM 塔
console.log('--- moving dog pass-by (AKM tower) ---');
console.log(JSON.stringify(await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const { createZombieDog } = await import('/src/entities/enemy-types.js');
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const akm = Object.values(eq.equipment).find((e) => e && e.weaponId === 'weapon7');
    const t = new DefenseTower(2500, 2048, { id: 'probe_akm' });
    window.Game.entities.set('probe_akm', t);
    t.equipWeapon(JSON.parse(JSON.stringify(akm)));
    t.range = 600;
    const dog = createZombieDog(3000, 2148);
    dog.name = 'PROBE_DOG';
    window.Game.entities.set('probe_dog', dog);
    const hp0 = dog.hp;
    const track = [];
    for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 250));
        track.push({
            t: i * 0.25,
            dogPos: [Math.round(dog.x), Math.round(dog.y)],
            dist: Math.round(Math.hypot(dog.x - 2500, dog.y - 2048)),
            hp: Math.round(dog.hp),
            alive: dog.active,
        });
        if (!dog.active) break;
    }
    window.Game.entities.delete('probe_dog');
    window.Game.entities.delete('probe_akm');
    return { hp0, finalHp: Math.round(dog.hp), alive: dog.active, track: track.filter((_, i) => i % 2 === 0) };
})()`), null, 1));

// 场景 2：Super90 霰弹塔近距离
console.log('--- shotgun tower close range (Super90) ---');
console.log(JSON.stringify(await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const { Zombie } = await import('/src/entities/enemy-types.js');
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const s90 = Object.values(eq.equipment).find((e) => e && e.weaponId === 'weapon12');
    const t = new DefenseTower(2500, 2048, { id: 'probe_s90' });
    window.Game.entities.set('probe_s90', t);
    t.equipWeapon(JSON.parse(JSON.stringify(s90)));
    t.range = 500;
    const out = [];
    for (const d of [60, 100, 200]) {
        const m = new Zombie(2500 + d, 2048, { id: 'probe_m2' });
        m.speed = 0; m.maxSpeed = 0; m._usePacingAI = false;
        m.name = 'PROBE_S90_' + d;
        window.Game.entities.set('probe_m2', m);
        const hp0 = m.hp;
        await new Promise((r) => setTimeout(r, 1500));
        out.push({ d, hpDrop: Math.round((hp0 - m.hp) * 10) / 10, alive: m.active });
        window.Game.entities.delete('probe_m2');
    }
    window.Game.entities.delete('probe_s90');
    return out;
})()`), null, 1));

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
