#!/usr/bin/env node
/**
 * 伊莉丝圣光 AI 验证（2026-08-17）：
 * - 5 级解锁 holyLight（companion-config unlockSkills）
 * - 施法目标优先级：玩家（生命不满）→ 自己 → 其他队友 → 敌方
 *
 * 用法: powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-elise-holylight.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9344;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-elise-'));
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
    const res = {};
    const Game = window.Game;
    const PS = Game.PartySystem;
    const player = Game.player;

    // 清场：移除已在队的队友与探针怪
    for (const m of [...(PS.members || [])]) PS.removeCompanion(m.id);
    for (const k of [...Game.entities.keys()]) {
        if (k.startsWith('probe_') || k.startsWith('enemy_main')) Game.entities.delete(k);
    }

    // 招募伊莉丝并提到 5 级（解锁圣光）
    PS.addCompanion('warrior_bruno');
    const elise = PS.members.find((m) => m.id === 'warrior_bruno');
    elise.data.level = 5;
    elise._checkUnlocks();
    res.unlock = {
        level: elise.data.level,
        hasHolyLight: !!elise.skills.holyLight,
        holyLightLevel: elise.skills.holyLight ? elise.skills.holyLight.level : null,
    };

    // 玩家与伊莉丝先回满血；把两者放到一起
    const maxP = (p) => (p.data && p.data.maxHp) || p.maxHp || 100;
    player.data.hp = maxP(player);
    elise.data.hp = elise.data.maxHp;
    elise.x = player.x + 80; elise.y = player.y + 20;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const cd = () => elise._holyLightCooldown || 0;
    const resetCd = () => { elise._holyLightCooldown = 0; };

    // 打点：记录每次圣光施放的目标（等 AI 实例创建后再包）
    window.__holyTargets = [];
    await wait(600);
    const eliseAi = PS._aiInstances['warrior_bruno'];
    if (eliseAi && eliseAi._systems && eliseAi._systems.holyLight) {
        const hl = eliseAi._systems.holyLight;
        const origOn = hl.triggerOn.bind(hl);
        hl.triggerOn = (t) => {
            window.__holyTargets.push(t ? (t.id || t.name || t.title || '?') : 'null');
            return origOn(t);
        };
    } else {
        window.__holyTargets.push('WRAP_FAIL');
    }

    // Case A：玩家缺血 → 圣光应治疗玩家
    resetCd();
    player.data.hp = Math.floor(maxP(player) * 0.5);
    const a0 = player.data.hp;
    await wait(2500);
    res.A_player = { before: a0, after: player.data.hp, cd: cd() };

    // Case B：玩家满血、伊莉丝缺血 → 圣光应治疗自己
    resetCd();
    player.data.hp = maxP(player);
    elise.data.hp = Math.floor(elise.data.maxHp * 0.5);
    const b0 = elise.data.hp;
    await wait(2500);
    res.B_self = { before: b0, after: elise.data.hp, cd: cd() };

    // Case C：玩家/自己满血、队友（露娜）缺血 → 圣光应治疗露娜
    resetCd();
    elise.data.hp = elise.data.maxHp;
    PS.addCompanion('mage_luna');
    const luna = PS.members.find((m) => m.id === 'mage_luna');
    luna.data.level = 1;
    luna.x = player.x + 160; luna.y = player.y;
    const c0 = Math.floor(luna.data.maxHp * 0.5);
    luna.data.hp = c0;
    await wait(2500);
    res.C_teammate = { before: c0, after: luna.data.hp, cd: cd() };
    res.C_members = {
        playerHp: player.data.hp, playerMax: maxP(player),
        eliseHp: elise.data.hp, eliseMax: elise.data.maxHp,
        lunaHp: luna.data.hp, lunaMax: luna.data.maxHp,
        targets: window.__holyTargets.slice(),
    };

    // Case D：全员满血、有敌人 → 圣光应打最近敌人
    resetCd();
    luna.data.hp = luna.data.maxHp;
    const { Zombie } = await import('/src/entities/enemy-types.js');
    const enemy = new Zombie(player.x + 120, player.y + 80, { id: 'probe_enemy' });
    window.Game.entities.set('probe_enemy', enemy);
    const d0 = enemy.hp;
    await wait(2500);
    res.D_enemy = { before: d0, after: enemy.hp, cd: cd(), elisePos: [Math.round(elise.x), Math.round(elise.y)] };
    res.D_targets = window.__holyTargets.slice();
    window.Game.entities.delete('probe_enemy');

    // 清理队友，还原玩家血量
    for (const m of [...(PS.members || [])]) PS.removeCompanion(m.id);
    player.data.hp = maxP(player);
    return res;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
