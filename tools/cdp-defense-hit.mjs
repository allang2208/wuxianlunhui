#!/usr/bin/env node
/**
 * 世界-122 怪物攻击建筑不出伤害排查（2026-08-16）
 *
 * 复现用户反馈：怪物贴墙/贴掩体，攻击距离足够、攻击动画正常播放，但建筑不掉血。
 * 分别对 僵尸（CombatSystem + ThrustAttack 命中链路）与 黑狼（自定义 bite 状态机）
 * 采样：distanceToEntityShape / LOS / weaponAnim / _pendingThrust / 建筑 hp 变化，
 * 并手动调用一次 checkTriangleHit / _updateBite 定位断点在哪一环。
 *
 * 用法: powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-defense-hit.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deflit-'));
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
    return { active: ds.active };
})()`));

const out = await evalJs(`(async () => {
    const { Zombie, BlackWolf } = await import('/src/entities/enemy-types.js');
    const { distanceToEntityShape } = await import('/src/utils/collision-helpers.js');
    const wsmod = await import('/src/world/wall-system.js');
    const WallSystem = wsmod.WallSystem || wsmod.default || wsmod;
    const player = window.Game.player;
    const res = { covers: 0, gates: 0, base: null, cases: {} };

    // 找一个现有掩体（基地菱形房墙段）
    let cover = null;
    for (const e of window.Game.entities.values()) {
        if (e && e._isDefenseCover && e.active && e.hp > 0 && e._faceLine) { cover = e; break; }
    }
    if (!cover) {
        const { DefenseCover } = await import('/src/world/defense-system.js');
        cover = new DefenseCover(2400, 2048, { grade: 'D', orient: 'v', id: 'probe_cover' });
        window.Game.entities.set('probe_cover', cover);
    }
    res.covers = cover ? (cover.id || cover.name) : null;
    for (const e of window.Game.entities.values()) {
        if (e && e._isCoverGate && e.active) { res.gates++; }
        if (e && e._isDefenseBase) res.base = e.id;
    }

    // 玩家挪远，避免交战半径内抢目标
    const p0 = { x: player.x, y: player.y };
    player.x = 5800; player.y = 3800;

    // 掩体 face 线外法向（远离基地中心一侧）作为怪物出生侧
    const facePos = (() => {
        const A = cover._faceLine[0], B = cover._faceLine[1];
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        let nx = -(B.y - A.y), ny = (B.x - A.x);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        const base = window.Game.entities.get('defense_base') || window.Game.entities.get('defense_base_gate') || player;
        const bx = base ? base.x : 0, by = base ? base.y : 0;
        if (nx * (bx - mx) + ny * (by - my) > 0) { nx = -nx; ny = -ny; }
        return { mx, my, nx, ny, A, B };
    })();
    res.face = { mid: [Math.round(facePos.mx), Math.round(facePos.my)], normal: [facePos.nx.toFixed(3), facePos.ny.toFixed(3)] };

    const place = (cls, id, off) => {
        const m = new cls(facePos.mx + facePos.nx * off, facePos.my + facePos.ny * off, { id });
        m._defenseMonster = true;
        m._preferDefenseTargets = true;
        m._engageHostileRange = 320;
        m._alertRange = 6200;
        if (m._aggroRange && m._aggroRange < 6200) m._aggroRange = 6200;
        m.target = cover;
        m._aiState = 'chasing';
        m._lastKnownTargetPos = { x: cover.x, y: cover.y };
        m._lostTimer = 0;
        window.Game.entities.set(id, m);
        return m;
    };

    const sample = (m, coverHp0) => {
        const dist = distanceToEntityShape(cover, m.x, m.y);
        const losRaw = WallSystem.blocked ? WallSystem.blocked(m.x, m.y, cover.x, cover.y) : null;
        return {
            hp: cover.hp, hpDrop: Math.round((coverHp0 - cover.hp) * 10) / 10,
            mPos: [Math.round(m.x), Math.round(m.y)],
            dist: Math.round(dist * 10) / 10,
            losBlocked: losRaw,
            anim: m._animState,
            wAnim: m.weaponAnim ? m.weaponAnim.state : null,
            thrust: m._pendingThrust ? m._pendingThrust.active : null,
            bite: m._biteState || null,
            target: m.target && m.target.id ? m.target.id : (m.target ? m.target.name : null),
        };
    };

    // ===== Case 1: 僵尸（CombatSystem + ThrustAttack）=====
    const z = place(Zombie, 'probe_z', 80);
    const zHp0 = cover.hp;
    // 给真实 swing 链路打点：记录每次 checkTriangleHit 调用时的判定现场
    const hitLog = [];
    const origCheck = z.attacks.melee.checkTriangleHit.bind(z.attacks.melee);
    z.attacks.melee.checkTriangleHit = (src) => {
        const pt = src._pendingThrust;
        const rec = {
            t: Math.round(performance.now()),
            hasPt: !!pt && !!pt.active,
            dist: pt ? Math.round(distanceToEntityShape(cover, src.x, src.y) * 10) / 10 : null,
            dyn: pt ? pt.dynamicRange : null,
            range: pt ? pt.range : null,
            wAnim: src.weaponAnim ? src.weaponAnim.state : null,
            srcPos: [Math.round(src.x), Math.round(src.y)],
            coverPos: [Math.round(cover.x), Math.round(cover.y)],
            blocked: WallSystem.blocked ? WallSystem.blocked(src.x, src.y, cover.x, cover.y) : null,
            hpBefore: cover.hp,
        };
        origCheck(src);
        rec.hpAfter = cover.hp;
        rec.hit = cover.hp < rec.hpBefore;
        hitLog.push(rec);
    };
    // 掩体 takeDamage 打点：确认伤害管道是否被调用
    const origTake = cover.takeDamage.bind(cover);
    let takeCalls = [];
    cover.takeDamage = (...args) => {
        takeCalls.push({ t: Math.round(performance.now()), dmg: args[0], src: args[1] ? (args[1].id || args[1].name) : null });
        return origTake(...args);
    };
    await new Promise((r) => setTimeout(r, 500));
    const zSamples = [];
    for (let i = 0; i < 10; i++) {
        zSamples.push(sample(z, zHp0));
        await new Promise((r) => setTimeout(r, 250));
    }
    res.cases.zombie = {
        samples: zSamples,
        hitLog: hitLog,
        takeCalls: takeCalls.slice(0, 20),
    };
    // 合成一个"新鲜" _pendingThrust（startTime=当前）手动跑一次命中判定，排除过期窗口干扰
    const fresh = await (async () => {
        const before = cover.hp;
        z._pendingThrust = {
            x: z.x, y: z.y, range: 80, width: 18,
            angle: Math.atan2(cover.y - z.y, cover.x - z.x),
            facingDir: 'right', hitSet: new Set(),
            damage: { min: 11, max: 11 }, damageBonus: 0,
            damageType: 'physical', knockback: 13,
            entities: Array.from(window.Game.entities.values()),
            active: true, startTime: performance.now(),
            totalHitCount: 0, totalKillCount: 0, dynamicRange: 100, expGiven: false,
        };
        const cands = z.attacks.melee._queryNearbyEntities(z.x, z.y, 180, z, z._pendingThrust.entities);
        const hasCover = cands.some((e) => e === cover);
        z.attacks.melee.checkTriangleHit(z);
        return {
            before, after: cover.hp, hit: cover.hp < before,
            dist: Math.round(distanceToEntityShape(cover, z.x, z.y) * 10) / 10,
            candidates: cands.length, hasCover,
        };
    })();
    res.cases.zombie.freshPendingThrust = fresh;
    window.Game.entities.delete('probe_z');
    if (z._phaserSprite && z._phaserSprite.active) z._phaserSprite.destroy();

    // ===== Case 2: 黑狼（自定义 bite 状态机）=====
    const w = place(BlackWolf, 'probe_w', 80);
    const wHp0 = cover.hp;
    await new Promise((r) => setTimeout(r, 500));
    const wSamples = [];
    for (let i = 0; i < 8; i++) {
        wSamples.push(sample(w, wHp0));
        await new Promise((r) => setTimeout(r, 400));
    }
    res.cases.blackWolf = { samples: wSamples };

    // 强制撕咬态并手动跑一帧 _updateBite，验证伤害路径本身是否通
    const biteManual = await (async () => {
        w._biteState = 'attacking';
        w._biteTarget = cover;
        w._animState = 'attack';
        const before = cover.hp;
        w._updateBite(300);
        return { before, after: cover.hp, hit: cover.hp < before, biteDamage: w._getBiteDamage ? w._getBiteDamage() : null };
    })();
    res.cases.blackWolf.manualBite = biteManual;
    window.Game.entities.delete('probe_w');
    if (w._phaserSprite && w._phaserSprite.active) w._phaserSprite.destroy();

    player.x = p0.x; player.y = p0.y;
    return res;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
