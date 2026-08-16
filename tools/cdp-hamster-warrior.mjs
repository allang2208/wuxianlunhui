#!/usr/bin/env node
/* 仓鼠战士实机验证（2026-08-16）：
   - 进入世界-122 后自动生成仓鼠战士（300HP/120 移速/友方阵营可被怪锁定）；
   - AI：找最近 enemy → 走位 walk → 到位 attack（两段式动画：完整 1~24 帧 →
     第 6~24 帧循环）；每 2s 造成 50 伤害；能源矿点贴脸不攻击；
   - 无敌人时跟随玩家（到位 idle）；
   - 死亡：takeDamage 致死 → 播 dying 动画 → 自动从场景移除。
   用法：node tools/cdp-hamster-warrior.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9339);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-warrior-'));
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
await new Promise((r) => setTimeout(r, 7000));

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
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
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
let ok = false;
for (let i = 0; i < 150 && !ok; i++) {
    ok = await rawEval(`(async () => {
        try {
            if (!(window.Game && window.Game.isRunning && window.Game.player)) {
                const b = document.getElementById('startGameBtn');
                if (b) b.click();
                if (window.Game && typeof window.Game.start === 'function' && !window.Game.isRunning) {
                    window.Game.start().catch(() => {});
                }
                return null;
            }
            if (!(window.Game && window.Game.player && window.__phaserScene)) return null;
            window.__imp = async (name) => {
                const urls = performance.getEntriesByType('resource').map(e => e.name)
                    .filter(n => n.includes('/src/world/' + name + '.js'));
                const u = urls.find(n => n.includes('.js?')) || urls[0] || ('/src/world/' + name + '.js');
                return import(u);
            };
            const { SceneManager } = await window.__imp('scene-manager');
            window.__sm = SceneManager;
            return 'ready';
        } catch (e) { window.__bootErr = String(e && e.stack || e).slice(0, 300); return null; }
    })()`).catch(() => null);
    if (!ok) await sleep(500);
}
console.log('bootErr:', await rawEval(`window.__bootErr || null`).catch(() => null));
await rawEval(`(async () => {
    try {
        if (!Object.keys(window.__sm.scenes || {}).length) window.__sm.init();
        await window.__sm.switchScene('scene8', window.Game.player, 'explore');
        return { scene: window.__sm.currentScene };
    } catch (e) { return { err: String(e && e.stack || e).slice(0, 400) }; }
})()`);

let sceneReady = false;
for (let i = 0; i < 60 && !sceneReady; i++) {
    await sleep(600);
    sceneReady = await rawEval(`(async () => {
        const { DefenseSystem } = await window.__imp('defense-system');
        const { SceneManager } = await window.__imp('scene-manager');
        return !!(SceneManager.currentScene === 'scene8' && DefenseSystem.active && DefenseSystem.base);
    })()`).catch(() => false);
}
check('世界-122 已就绪', sceneReady);
if (!sceneReady) { console.error('scene8 not ready, abort'); await cleanup(1); }

// 冻结波次生成：探针用假敌人验证 AI，避免真实波次干扰确定性
await rawEval(`(async () => {
    const { DefenseSystem } = await window.__imp('defense-system');
    DefenseSystem._phase = 'prep';
    DefenseSystem._phaseTimer = 1e9;
    return true;
})()`).catch(() => false);

// ---------- A. 自动生成与属性 ----------
console.log('A. 世界-122 自动生成与属性');
const a = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(1200);
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    if (!w) return { err: 'no warrior' };
    const sp = window.__phaserScene._companionSprites && window.__phaserScene._companionSprites[w.id];
    return {
        id: w.id,
        inFriendly: Array.isArray(window.Game.friendlyUnits) && window.Game.friendlyUnits.includes(w),
        maxHp: w.data.maxHp, hp: w.data.hp,
        attrs: [w.data.str, w.data.dex, w.data.int, w.data.con, w.data.wis, w.data.luck],
        faction: w._faction, targetable: w._enemyTargetable, hittable: w.hittable,
        walkSpeed: w.aiConfig.walkSpeed, interval: w.aiConfig.attackInterval, dmg: w.aiConfig.attackDamage,
        anim: w._animState,
        spriteSize: sp ? [Math.round(sp.displayWidth), Math.round(sp.displayHeight)] : null,
        spriteY: sp ? Math.round(sp.y) : null, worldY: Math.round(w.y),
    };
})()`);
check('世界-122 自动生成仓鼠战士', !a.err && a.id, a.id || a.err);
check('注册进 entities + friendlyUnits', a.inFriendly === true);
check('生命值 = 300', a.maxHp === 300 && a.hp === 300, `hp=${a.hp}/${a.maxHp}`);
check('六维 力量20/敏捷12/智力3/体质15/精神3/幸运5',
    JSON.stringify(a.attrs) === JSON.stringify([20, 12, 3, 15, 3, 5]), JSON.stringify(a.attrs));
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 120 / 间隔 2000ms / 伤害 50', a.walkSpeed === 120 && a.interval === 2000 && a.dmg === 50,
    `spd=${a.walkSpeed} int=${a.interval} dmg=${a.dmg}`);
check('精灵已渲染（显示尺寸 226）', a.spriteSize && a.spriteSize[0] === 226 && a.spriteSize[1] === 226,
    JSON.stringify(a.spriteSize));

// ---------- B. 找最近敌人 → 走位 → 攻击（50/2s）+ 两段式动画 ----------
console.log('B. 索敌/攻击/动画两段式');
const b = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    const key = 'probe_warrior_enemy';
    window.Game.entities.delete(key);
    const dummy = {
        id: key, active: true, hittable: true, hp: 500, maxHp: 500,
        x: w.x + 300, y: w.y, _faction: 'enemy', _isEnergyNode: false,
        groundRadius: 26,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key, dummy);
    w.target = null; w._tacticalTarget = null; w._animState = 'idle';
    if (w._pathManager) w._pathManager._clearPath();
    let chaseSeen = false, attackSeen = false;
    let kStart = null, kLoop = null;
    const sp = window.__phaserScene._companionSprites[w.id];
    for (let i = 0; i < 32; i++) {
        await sleep(200);
        if (w._animState === 'walk') chaseSeen = true;
        if (w._animState === 'attack') attackSeen = true;
        const k = sp && sp.anims && sp.anims.currentAnim ? sp.anims.currentAnim.key : null;
        if (k === 'companion_hamster_warrior_attack_start') kStart = true;
        if (k === 'companion_hamster_warrior_attack') kLoop = true;
        if (attackSeen && dummy.hp < 500) break;
    }
    // 攻击中采样：应处于 attack 状态且命中一次
    const attacking = w._animState === 'attack';
    const hpAfterFirst = dummy.hp;
    // 再等 2.2s 验证第二次攻击（攻击间隔 2s）
    await sleep(2200);
    const hpAfterSecond = dummy.hp;
    const animKey = sp && sp.anims && sp.anims.currentAnim ? sp.anims.currentAnim.key : null;
    window.Game.entities.delete(key);
    return { chaseSeen, attackSeen, attacking, hpAfterFirst, hpAfterSecond, kStart, kLoop, animKey,
        targetWasEnemy: !!(w.target && w.target.id === key) };
})()`);
check('追击阶段走位（walk）', b.chaseSeen === true);
check('进入攻击范围站定攻击（attack 状态）', b.attackSeen === true && b.attacking === true,
    `attackSeen=${b.attackSeen}`);
check('首次命中造成 50 伤害', b.hpAfterFirst === 450, `hp=${b.hpAfterFirst}`);
check('2s 间隔第二次命中（累计 -100）', b.hpAfterSecond === 400, `hp=${b.hpAfterSecond}`);
check('攻击动画两段式：完整帧起步 → 第 6~24 帧循环',
    b.kStart === true && b.kLoop === true, `start=${b.kStart} loop=${b.kLoop} now=${b.animKey}`);
check('索敌目标是最近敌人（enemy 阵营）', b.targetWasEnemy === true);

// ---------- C. 能源矿点贴脸不攻击 ----------
console.log('C. 不攻击能源矿点');
const c = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    const key = 'probe_warrior_node';
    window.Game.entities.delete(key);
    const node = {
        id: key, active: true, hittable: true, hp: 500, maxHp: 500,
        x: w.x + 50, y: w.y, _faction: 'neutral', _isEnergyNode: true, _depleted: false,
        groundRadius: 45,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key, node);
    w.target = null; w._tacticalTarget = null; w._animState = 'idle';
    if (w._pathManager) w._pathManager._clearPath();
    await sleep(2600);
    const res = {
        nodeHp: node.hp,
        targetIsNode: !!(w.target && w.target._isEnergyNode),
        anim: w._animState,
    };
    window.Game.entities.delete(key);
    return res;
})()`);
check('矿点贴脸不攻击（hp 不变、不锁定矿点目标）',
    c.nodeHp === 500 && c.targetIsNode === false, `nodeHp=${c.nodeHp} anim=${c.anim}`);

// ---------- D. 无敌人跟随玩家（到位 idle） ----------
console.log('D. 无敌人跟随玩家');
const d = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    const p = window.Game.player;
    w.x = p.x - 400; w.y = p.y;
    w.target = null; w._tacticalTarget = null; w._animState = 'idle';
    if (w._pathManager) w._pathManager._clearPath();
    let walkSeen = false;
    for (let i = 0; i < 30; i++) {
        await sleep(200);
        if (w._animState === 'walk') walkSeen = true;
    }
    await sleep(600);
    const dist = Math.hypot(w.x - (p.x - 140), w.y - p.y);
    return { walkSeen, dist: Math.round(dist), anim: w._animState,
        followTarget: !!(w._tacticalTarget && Math.abs(w._tacticalTarget.x - (p.x - 140)) < 20) };
})()`);
check('无敌人时跟随玩家走位（walk）', d.walkSeen === true);
check('到达跟随点停步（idle，距离 ≈ followOffset 140）',
    d.anim === 'idle' && d.dist <= 60, `dist=${d.dist} anim=${d.anim}`);

// ---------- E. 死亡流程 ----------
console.log('E. 死亡：dying → 移除');
const e = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e2 => e2 && e2._isHamsterWarrior && e2.active);
    const id = w.id;
    w.takeDamage(9999, { _faction: 'enemy' }, 'physical', true);
    const stateAfter = w._animState;
    await sleep(1300);
    return {
        stateAfter,
        inEntities: window.Game.entities.has(id),
        inFriendly: Array.isArray(window.Game.friendlyUnits) && window.Game.friendlyUnits.some(u => u.id === id),
    };
})()`);
check('致死 → dying 状态', e.stateAfter === 'dying', `state=${e.stateAfter}`);
check('dying 播完自动从场景移除', e.inEntities === false && e.inFriendly === false,
    `entities=${e.inEntities} friendly=${e.inFriendly}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
