#!/usr/bin/env node
/* 防御塔六维芯片升级验证（2026-08-16 重构：取代原等级/模块）：
 * - 初始芯片六维 = base 10，无 level/modules 字段
 * - 武器 ↔ 主属性挂钩：PKM→力量；未挂钩属性（如敏捷）对伤害零影响
 * - 升级扣金币、伤害实时提升；费用公式 round(baseCost × growth^(值-base)) 逐级递增
 * - 强化武器实时计入（perEnhance 使每点边际变大）；上限拦截
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
    const { DefenseTower, DEFENSE_CONFIG } = DefMod;
    const Gold = (await import('/src/systems/gold-manager.js')).GoldManager;
    const EqData = await import('/src/ui/equip-data-manager.js');
    const Atk = await import('/src/config/attack-formula.js');
    // PKM 完整配置（EquipDataManager 全量源，含 attackFormula）
    const pkm = JSON.parse(JSON.stringify(EqData.findWeaponConfig('weapon6', 'PKM')));
    const p = window.Game.player;
    const out = {};
    // 1) 建塔：初始芯片 = base 10，无等级/模块字段
    const t = new DefenseTower(p.x + 120, p.y, { id: 'chip_e2e' });
    window.Game.entities.set('chip_e2e', t);
    out.init = { chip: { ...t.chip }, hasLevel: t.level !== undefined, hasModules: !!t.modules };

    // 2) 装 PKM：主属性=力量（配置表 pkm→str）；力量有边际、敏捷无影响
    t.equipWeapon(pkm);
    out.stat = {
        key: t.getChipWeaponStat(pkm),
        margStr: t._statMarginalPerPoint('str'),
        margDex: t._statMarginalPerPoint('dex'),
    };
    const dmg0 = t._computeDamage();

    // 3) 升力量：扣金币、伤害提升；升敏捷：扣金币但伤害不变（未挂钩）
    const gold0 = Gold.getGold();
    const r1 = t.upgradeStat('str', p);
    const dmg1 = t._computeDamage();
    const gold1 = Gold.getGold();
    const r2 = t.upgradeStat('dex', p);
    const dmg2 = t._computeDamage();
    out.upgrades = { r1, r2, dmg0, dmg1, dmg2, strCost: gold0 - gold1, dexCost: gold1 - Gold.getGold() };

    // 4) 费用逐级递增：值 10..14 → 60 / 87 / 126 / 183 / 265（round(60×1.45^n)）
    out.costCurve = [10, 11, 12, 13, 14].map((v) => {
        t.chip.str = v;
        return t.getChipUpgradeCost('str');
    });

    // 5) 强化武器实时计入：PKM 强化 +1 后 perEnhance 0.15 → 每点力量边际变大
    t.chip.str = 14;
    const margBase = t._statMarginalPerPoint('str');
    pkm.enhanceLevel = 1;
    const margEnh = t._statMarginalPerPoint('str');
    const dmgEnh = t._computeDamageFor(pkm);
    out.enhanced = {
        margBase,
        margEnh,
        dmgEnh,
        formula: Atk.buildFormulaDisplay(pkm.attackFormula, 1, pkm._craftEffects),
    };

    // 6) 上限拦截
    t.chip.str = 99;
    const blocked = t.upgradeStat('str', p);
    out.maxBlock = { ok: blocked.ok, reason: blocked.reason };

    // 7) 未装武器：伤害 0、边际 0
    const t2 = new DefenseTower(p.x + 260, p.y, { id: 'chip_empty' });
    out.empty = { dmg: t2._computeDamage(), marg: t2._statMarginalPerPoint('str') };

    // 8) 面板 DOM：武器贴图 + 六维升级卡，且无等级/模块区块
    const panel = DefMod.DefenseSystem._ensurePanel();
    panel.openFor(t, p);
    out.panel = {
        hasUpgradeBlock: !!document.querySelector('#dtUpgrade'),
        hasModulesBlock: !!document.querySelector('#dtModules'),
        chipCards: document.querySelectorAll('[data-chip]').length,
        weaponImgSrc: document.querySelector('#dtWeaponSlot img') ? document.querySelector('#dtWeaponSlot img').src.split('/').pop() : null,
        chipHeader: document.querySelector('#dtChip') ? document.querySelector('#dtChip').innerText.split('\\n')[0].slice(0, 30) : '',
    };
    panel.close();
    return out;
})()`);
console.log(JSON.stringify(r, null, 2));

console.log('--- errors ---');
console.log(errs.slice(0, 10).join('\n') || '(none)');
edge.kill();
process.exit(0);
