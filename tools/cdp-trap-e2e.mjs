#!/usr/bin/env node
/* 世界-122 陷阱系统端到端验证（2026-08-07）：
 * - BUILD_ITEMS 含 4 类 × F~A 六档陷阱
 * - 陷阱实体渲染贴图/配置正确
 * - 真实放置（B 面板选择→点放置）→ 实体生成、金币扣除
 * - 怪物踩踏触发（地刺伤害 / 减速带减速 / 地雷爆炸 / 燃烧区 DoT）
 * - 击杀金币直接进背包（_noGoldDrop）
 * 前置：vite dev 已启动。用法：node tools/cdp-trap-e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9242;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-trap-'));
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
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
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

// 进入世界-122 防守地图（scene8），验证真实环境下的完整链路
const sceneEnter = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    const out = { smType: typeof SM, sceneBefore: SM && SM.currentScene };
    if (SM && SM.currentScene !== 'scene8') {
        try {
            out.switchRet = await SM.switchScene('scene8', p, 'explore');
        } catch (e) {
            out.switchErr = String(e && e.stack || e);
        }
    }
    const dsUrl = (perfs.find((u) => u.includes('/src/world/defense-system.js') && u.includes('?t='))
        || perfs.find((u) => u.includes('/src/world/defense-system.js')));
    const DS = (await import(dsUrl)).DefenseSystem;
    try {
        DS.setup(p);
        out.setupOk = true;
    } catch (e) {
        out.setupErr = String(e && e.stack || e);
    }
    out.scene = SM && SM.currentScene;
    out.defenseActive = !!(DS && DS.active);
    out.defenseKeys = DS ? Object.keys(DS).slice(0, 8) : null;
    out.px = p.x;
    out.py = p.y;
    return out;
})()`);
console.log('scene enter:', JSON.stringify(sceneEnter));
if (sceneEnter.scene !== 'scene8' || !sceneEnter.defenseActive) { edge.kill(); process.exit(3); }

const mods = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    return {
        trap: pick('world/defense-trap-system.js'),
        building: pick('world/building-system.js'),
        defense: pick('world/defense-system.js'),
        renderer: pick('world/renderer.js'),
    };
})()`);
const url = (name) => JSON.stringify(mods[name]);
console.log('modules:', JSON.stringify(mods));

// 1) 配置完整性：BUILD_ITEMS 含 24 个陷阱；TRAP_CONFIG 六档齐全
const cfg = await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    const Build = await import(${url('building')});
    const traps = Build.BUILD_ITEMS.filter((it) => it.kind === 'trap');
    const types = Object.keys(Trap.TRAP_CONFIG);
    const gradesOk = {};
    for (const t of types) {
        gradesOk[t] = Trap.TRAP_GRADES.every((g) => !!Trap.TRAP_CONFIG[t].grades[g]);
    }
    return {
        trapCount: traps.length,
        types,
        gradesOk,
        costs: traps.reduce((a, it) => { a[it.id] = it.cost; return a; }, {}),
    };
})()`);
console.log('config:', JSON.stringify(cfg));
if (cfg.trapCount !== 24 || !cfg.types.every((t) => cfg.gradesOk[t])) {
    console.error('CONFIG CHECK FAILED');
    errs.push('config check failed');
}

// 2) 实体渲染：创建 4 类陷阱实体，验证 spriteCfg 贴图键与防御结构标记
const ent = await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    const p = window.Game.player;
    const created = [];
    const types = ['spike', 'mine', 'tar', 'burn'];
    for (let i = 0; i < types.length; i++) {
        const id = 'trap_e2e_' + types[i];
        const t = new Trap.DefenseTrap(1250 + i * 100, 2048, { type: types[i], grade: 'D', id });
        window.Game.entities.set(id, t);
        created.push({
            id: t.id,
            tex: t.spriteCfg.idleKey,
            isTrap: !!t._isDefenseTrap,
            isStruct: !!t._isDefenseStructure,
            immovable: !!t.immovable,
            sell: t.sellValue,
            hp: t.maxHp,
            type: t.type,
            grade: t.grade,
        });
    }
    return created;
})()`);
console.log('entities:', JSON.stringify(ent));
await shot('trap_entities');

// 3) 真实点击陷阱 → 面板打开
const click = await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    const Renderer = (await import(${url('renderer')})).Renderer;
    const e = window.Game.entities.get('trap_e2e_spike');
    // 玩家挪到陷阱旁（点击交互要求 260px 内），等一帧让相机跟上
    window.Game.player.x = e.x - 40;
    window.Game.player.y = e.y;
    await new Promise((r) => setTimeout(r, 300));
    const pos = Renderer.worldToScreen(e.x, e.y);
    return { x: Math.round(pos.x), y: Math.round(pos.y - 20) };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: click.x, y: click.y });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: click.x, y: click.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: click.x, y: click.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 600));
const panel = await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    const p = Trap.DefenseTrapSystem._panel;
    return { open: p ? p.isOpen : false, trap: p && p.trap ? p.trap.id : null };
})()`);
console.log('trap panel:', JSON.stringify(panel));
await shot('trap_panel_open');
// 关闭面板
await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    if (Trap.DefenseTrapSystem._panel && Trap.DefenseTrapSystem._panel.isOpen) Trap.DefenseTrapSystem._panel.close();
    return true;
})()`);

// 4) 怪物踩踏触发：地刺伤害 / 减速带减速 / 燃烧区 DoT
const trig = await evalJs(`(async () => {
    const Trap = await import(${url('trap')});
    const Combatant = (await import('/src/entities/combatant.js')).Combatant;
    const mk = (id, x, y, hp) => {
        const m = new Combatant(x, y, { faction: 'enemy', hp, maxHp: hp, size: 16, collisionRadius: 16, name: 'test' });
        m._defenseMonster = true;
        m._noGoldDrop = true;
        m.rank = 'normal';
        m.maxSpeed = 200;
        m._baseSpeed = 200;
        m.id = id;
        window.Game.entities.set(id, m);
        return m;
    };
    const spike = window.Game.entities.get('trap_e2e_spike');
    const tar = window.Game.entities.get('trap_e2e_tar');
    const burn = window.Game.entities.get('trap_e2e_burn');
    const m1 = mk('trap_m1', spike.x + 10, spike.y, 500);
    const m2 = mk('trap_m2', tar.x + 5, tar.y, 500);
    const m3 = mk('trap_m3', burn.x + 5, burn.y, 500);
    spike._cooldown = 0;
    spike.update(16);
    spike.update(16);
    tar.update(16);
    for (let i = 0; i < 40; i++) burn.update(50);
    return {
        spikeDmg: 500 - m1.hp,
        m1Active: m1.active,
        m2Slowed: !!m2.statusEffects.find((s) => s.type === 'slow'),
        m2Speed: m2.maxSpeed,
        burnDmg: 500 - m3.hp,
    };
})()`);
console.log('trigger results:', JSON.stringify(trig));

// 5) B 面板真实放置：选 trap_mine_C → 点地图 → 实体生成 + 扣金币
const place = await evalJs(`(async () => {
    const Build = await import(${url('building')});
    const Trap = await import(${url('trap')});
    const Gold = (await import('/src/systems/gold-manager.js')).GoldManager;
    const p = window.Game.player;
    const before = Gold.getGold();
    Build.BuildingSystem.open();
    const item = Build.BUILD_ITEMS.find((it) => it.id === 'trap_mine_C');
    Build.BuildingSystem._selectItem(item);
    const px = 1750, py = 2048;
    const can = Build.BuildingSystem._canPlace(px, py);
    const near = [...window.Game.entities.values()].filter((e) => e.active && Math.hypot(e.x - px, e.y - py) < 80)
        .map((e) => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), d: Math.round(Math.hypot(e.x - px, e.y - py)) }));
    const wallOk = window.WallSystem ? window.WallSystem.canMoveTo(px, py, 60) : null;
    const placed = Build.BuildingSystem._place(px, py);
    const traps = [...window.Game.entities.values()].filter((e) => e._isDefenseTrap && e.grade === 'C' && e.type === 'mine');
    const after = Gold.getGold();
    Build.BuildingSystem.close();
    return {
        selectedName: item.name,
        canPlace: can,
        near,
        wallOk,
        px,
        py,
        placedOk: placed === undefined ? 'placed' : placed,
        goldBefore: before,
        goldAfter: after,
        goldDiff: before - after,
        mineCount: traps.length,
    };
})()`);
console.log('placement:', JSON.stringify(place));
await shot('trap_placed_mine');

// 6) 击杀金币直接进背包：清点一个怪 hp→0，等主循环结算
const killGold = await evalJs(`(async () => {
    const Gold = (await import('/src/systems/gold-manager.js')).GoldManager;
    const g0 = Gold.getGold();
    const m = window.Game.entities.get('trap_m1');
    if (m) { m.hp = 0; m.active = false; }
    return { g0 };
})()`);
await new Promise((r) => setTimeout(r, 1200));
const killGold2 = await evalJs(`(async () => {
    const Gold = (await import('/src/systems/gold-manager.js')).GoldManager;
    return { gold: Gold.getGold() };
})()`);
console.log('kill gold:', JSON.stringify({ before: killGold.g0, after: killGold2.gold }));

console.log('--- console errors ---');
console.log(errs.slice(0, 10).join('\n') || '(none)');
edge.kill();
process.exit(errs.length ? 3 : 0);
