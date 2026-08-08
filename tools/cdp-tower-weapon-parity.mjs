#!/usr/bin/env node
/* 防御塔枪械属性一致性验证（2026-08-06）：
 * 同一把 AKM（强化+3、改造 damagePercent/attackIntervalDelta、附魔 damagePercent/attackIntervalMul）
 * 对比：塔每发伤害 vs 玩家公式链（computeWeaponAttack）、射速、换弹时间。
 * 前置：vite dev 已起。用法：node tools/cdp-tower-weapon-parity.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9239;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-parity-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });

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
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
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
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

const mods = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    return {
        defense: pick('world/defense-system.js'),
        formula: pick('config/attack-formula.js'),
        ammo: pick('config/gun-ammo.js'),
    };
})()`);
const url = (n) => JSON.stringify(mods[n]);

const result = await evalJs(`(async () => {
    const DefenseMod = await import(${url('defense')});
    const { DefenseTower } = DefenseMod;
    const FormulaMod = await import(${url('formula')});
    const { computeWeaponAttack } = FormulaMod;
    const GunAmmoMod = await import(${url('ammo')});
    const { getAmmoConfig } = GunAmmoMod;

    const p = window.Game.player;
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const item = JSON.parse(JSON.stringify(eq.equipment.akm));
    // 放大基础间隔，验证附魔倍率 + 改造差值真的生效（AKM 原始 100ms 会卡下限）
    item.attack = { ...(item.attack || {}), attackInterval: 500 };

    // 强化 +3 / 改造 damagePercent 20% + attackIntervalDelta -80 / 附魔 damagePercent 15% + attackIntervalMul 0.9
    item.enhanceLevel = 3;
    item._craftEffects = { damagePercent: 0.20, attackIntervalDelta: -80, magazineDelta: 10, reloadTimeDelta: 300 };
    item._enchantEffects = { damagePercent: 0.15, attackIntervalMul: 0.9 };

    // 玩家链路参考：无精通（null skills）= 武器属性本身；带精通 = 玩家完整链路
    const playerAtkNoSkill = computeWeaponAttack(item, p.data, null);
    const playerAtkFull = computeWeaponAttack(item, p.data, p.skills);

    // 塔
    const t = new DefenseTower(p.x + 120, p.y, { id: 'parity' });
    t.equipWeapon(item);
    const atk = t.attacks[t._attackKey];
    const ammoState = t._getAmmoState('weapon');
    const ammoCfg = getAmmoConfig(item);

    return {
        item: item.name,
        playerAtkNoSkill,
        playerAtkFull,
        towerDamageL1: t._computeDamage(p, 1),
        towerDamageL5: t._computeDamage(p, 5),
        towerInterval: atk ? atk.maxCooldown : null,
        rawInterval: item.attack && item.attack.attackInterval,
        expectedInterval: item.attack ? Math.max(100, Math.round(item.attack.attackInterval * 0.9 - 80)) : null,
        towerReload: ammoState ? ammoState.reloadTime : null,
        expectedReload: ammoCfg ? ammoCfg.reloadTime + 300 : null,
        towerMag: ammoState ? ammoState.max : null,
        expectedMag: ammoCfg ? ammoCfg.max + 10 : null,
    };
})()`);
console.log('parity:', JSON.stringify(result, null, 1));
console.log('--- errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
