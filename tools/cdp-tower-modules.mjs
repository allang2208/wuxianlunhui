#!/usr/bin/env node
/* 防御塔模块化升级验证（2026-08-07）：
 * - 等级解锁模块位：Lv1=3 / Lv3=4 / Lv5=5
 * - 模块升级：伤害/射程/速射/换弹/过热/散热 逐项改武器参数
 * - 费用扣除、满级/模块位不足拦截
 * 前置：vite dev 已启动。用法：node tools/cdp-tower-modules.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9244;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-mod-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
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
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
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
    };
})()`);
const url = (name) => JSON.stringify(mods[name]);

const r = await evalJs(`(async () => {
    const DefMod = await import(${url('defense')});
    const { DefenseTower, DEFENSE_CONFIG, getTowerModuleSlots, getTowerModuleMults, getTowerModuleCost } = DefMod;
    const Gold = (await import('/src/systems/gold-manager.js')).GoldManager;
    // 从游戏运行数据拿 PKM 武器模板（避免 JSON 模块路径问题）
    const equipmentJson = window.__equipmentJson || null;
    let pkm = equipmentJson && equipmentJson.equipment && equipmentJson.equipment.pkm
        ? JSON.parse(JSON.stringify(equipmentJson.equipment.pkm)) : null;
    if (!pkm) {
        // 兜底：直接构造一份 PKM 配置（与 data/equipment.json 同口径）
        pkm = {
            id: 'pkm', name: 'PKM', category: 'weapon_ranged', weaponType: 'pkm',
            attack: { attackInterval: 500, range: 900 },
            ammoConfig: { max: 40, reloadTime: 1450 },
        };
    }
    const p = window.Game.player;
    const out = {};
    // 1) 模块位随等级增长
    out.slots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((lv) => getTowerModuleSlots(lv));

    // 2) 建塔装武器
    const t = new DefenseTower(p.x + 120, p.y, { id: 'mod_e2e' });
    window.Game.entities.set('mod_e2e', t);
    t.equipWeapon(pkm);
    out.base = {
        dmg: t._computeDamage(p, t.level),
        range: t.range,
        interval: t.attacks[t._attackKey].maxCooldown,
        reload: t._ammoState.weapon ? t._ammoState.weapon.reloadTime : null,
    };
    const gold0 = Gold.getGold();

    // 3) Lv1 有 3 个模块位：升 damage + range + attackSpd
    const r1 = t.upgradeModule('damage', p);
    const r2 = t.upgradeModule('range', p);
    const r3 = t.upgradeModule('attackSpd', p);
    // 第 4 个应被模块位拦截
    const r4 = t.upgradeModule('reload', p);
    out.lv1 = { r1: r1.ok, r2: r2.ok, r3: r3.ok, r4: r4, goldCost: gold0 - Gold.getGold() };
    out.after3 = {
        dmg: t._computeDamage(p, t.level),
        range: t.range,
        interval: t.attacks[t._attackKey].maxCooldown,
        mults: getTowerModuleMults(t.modules),
    };

    // 4) 升到 Lv3 → 模块位 4，可升 reload
    Gold.addGold(100000);
    t.upgrade(p);
    t.upgrade(p);
    out.slotsAfterLv3 = { slots: t.getModuleSlots(), purchased: t.getPurchasedModuleCount() };
    const r5 = t.upgradeModule('reload', p);
    out.lv3Reload = { ok: r5.ok, reload: t._ammoState.weapon ? t._ammoState.weapon.reloadTime : null, cost: r5.cost };

    // 5) 过热/散热模块（无过热武器时仅验证倍率计算）
    // 升到 Lv7 → 模块位 6，补齐 overheat + cooling
    for (let i = 0; i < 4; i++) t.upgrade(p);
    out.slotsLv7 = { slots: t.getModuleSlots(), purchased: t.getPurchasedModuleCount() };
    const ro = t.upgradeModule('overheat', p);
    const rc = t.upgradeModule('cooling', p);
    out.overheatPurchased = { overheat: ro.ok, cooling: rc.ok, moduleLvs: { ...t.modules } };
    out.overheatMults = { time: getTowerModuleMults(t.modules).overheatTime, cooldown: getTowerModuleMults(t.modules).overheatCooldown };

    // 6) 满级拦截
    // 当前 6 槽已满：再升 damage 应被槽位拦截
    const blockedBySlot = t.upgradeModule('damage', p);
    out.slotBlock = { ok: blockedBySlot.ok, reason: blockedBySlot.reason };
    // 升到 Lv9（7 槽）后把 damage 升满验证满级拦截
    for (let i = 0; i < 4; i++) t.upgrade(p);
    for (let i = 0; i < 10; i++) t.upgradeModule('damage', p);
    out.damageMaxed = { lv: t.modules.damage, blocked: !t.canUpgradeModule('damage') };
    return out;
})()`);
console.log(JSON.stringify(r, null, 2));

console.log('--- errors ---');
console.log(errs.slice(0, 10).join('\n') || '(none)');
edge.kill();
process.exit(0);
