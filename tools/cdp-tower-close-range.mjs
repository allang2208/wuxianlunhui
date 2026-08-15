#!/usr/bin/env node
/**
 * 防御塔近距离射击死角定位探针（2026-08-15）
 *
 * 方法：scene8 防守就绪后，建两座装 AKM 的塔（空旷区 + 基地菱形房内），
 * 在塔的 60/100/150/250/400px × 东南西北 各放一只静止测试怪，逐案记录：
 * - _acquireTarget 是否索到 / WallSystem.blocked 视线是否被拦
 * - fireProjectile 是否真正出弹（canFire/冷却/弹药闸门）
 * - 弹丸终态：命中目标 / 撞墙 / 超射程 / 其它
 * - 测试怪掉血量（最终判据）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9312;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-towerclose-'));
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

// 防守系统拉起 + 冻结准备期（不刷波次，避免干扰）
console.log('defense setup:', await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active) ds.setup(window.Game.player);
    ds._phase = 'prep';
    ds._phaseTimer = 9999999;
    return ds.active;
})()`));

// 主探针：双塔 × 距离 × 方向
const result = await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const { Zombie } = await import('/src/entities/enemy-types.js');
    const { Projectile } = await import('/src/combat/projectile.js');
    const WallSystem = (await import('/src/world/wall-system.js')).WallSystem;
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const akm = Object.values(eq.equipment).find((e) => e && e.weaponId === 'weapon7');

    // ---- 弹丸终态插桩（只记本案两座塔发出的弹丸） ----
    const towerIds = new Set(['probe_open', 'probe_room']);
    const projLog = [];
    const origUpdate = Projectile.prototype.update;
    Projectile.prototype.update = function (dt) {
        const was = this.active;
        const r = origUpdate.call(this, dt);
        if (was && !this.active && this.source && towerIds.has(this.source.id)) {
            projLog.push({
                tower: this.source.id,
                traveled: Math.round(this.traveled),
                hits: Array.from(this.hitTargets).map((e) => e.name || e.id),
                end: [Math.round(this.x), Math.round(this.y)],
            });
        }
        return r;
    };

    const DIST = [60, 100, 150, 250, 400];
    const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
    const out = [];

    async function runTower(towerId, tx, ty) {
        const t = new DefenseTower(tx, ty, { id: towerId });
        window.Game.entities.set(towerId, t);
        t.equipWeapon(JSON.parse(JSON.stringify(akm)));
        t.range = 500; // 探针隔离：只索近距离测试怪，不索场景散怪
        // 索敌插桩
        const origAcq = t._acquireTarget.bind(t);
        let acq = null;
        t._acquireTarget = (ents) => {
            const b = origAcq(ents);
            acq = b ? { name: b.name, d: Math.round(Math.hypot(b.x - t.x, b.y - t.y)) } : null;
            return b;
        };
        // 开火插桩
        const origFire = t.fireProjectile.bind(t);
        let fires = 0;
        let lastSpawn = null;
        t.fireProjectile = (a, b, e, c) => {
            const r = origFire(a, b, e, c);
            if (r) { fires++; lastSpawn = [Math.round(t.x), Math.round(t.y)]; }
            return r;
        };
        // 塔脚视线参考（塔脚→测试怪 是否被真实墙拦）
        for (const d of DIST) {
            for (const [dn, [ux, uy]] of Object.entries(DIRS)) {
                const mx = tx + ux * d, my = ty + uy * d;
                const m = new Zombie(mx, my, { id: 'probe_m' });
                m.speed = 0; m.maxSpeed = 0; m._usePacingAI = false;
                m.name = 'PROBE_' + d + dn;
                window.Game.entities.set('probe_m', m);
                acq = null; fires = 0; lastSpawn = null;
                const hp0 = m.hp;
                const logMark = projLog.length;
                await new Promise((r) => setTimeout(r, 1300));
                const blockedLos = WallSystem && WallSystem.blocked
                    ? WallSystem.blocked(t.x, t.y, m.x, m.y) : null;
                out.push({
                    tower: towerId, d, dir: dn,
                    acquired: acq, fired: fires, spawn: lastSpawn,
                    hpDrop: Math.round((hp0 - m.hp) * 10) / 10,
                    losBlocked: blockedLos,
                    proj: projLog.slice(logMark),
                });
                window.Game.entities.delete('probe_m');
            }
        }
        window.Game.entities.delete(towerId);
    }

    await runTower('probe_open', 2500, 2048);   // 空旷区（远离基地建筑）
    await runTower('probe_room', 1100, 2100);   // 基地菱形房内（贴近掩体墙实战摆位）

    Projectile.prototype.update = origUpdate;
    return out;
})()`);

for (const c of result) {
    const projSummary = c.proj.map((p) => `${p.traveled}px${p.hits.length ? '→命中' + p.hits.join('/') : '→未命中'}`).join('; ');
    console.log(
        `[${c.tower}] d=${c.d}${c.dir}`,
        `索敌=${c.acquired ? c.acquired.name + '@' + c.acquired.d : '无'}`,
        `出弹=${c.fired}`,
        `掉血=${c.hpDrop}`,
        `LOS拦=${c.losBlocked}`,
        projSummary ? `弹丸[${projSummary}]` : '弹丸[]',
    );
}
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
