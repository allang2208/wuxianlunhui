#!/usr/bin/env node
/* 仓鼠民兵实机验证（2026-08-17）：
   - 世界-122 中构造测试民兵（125HP/150 移速/友方阵营可被怪锁定）；
   - AI：找最近 enemy → 走位 walk → 到位挥击（攻击动画 15 帧单次播放，
     第 8 帧判定伤害：延迟 (8-1)/12 ≈ 583ms）；每 2s 造成 20 物理伤害；
     能源矿点贴脸不攻击；
   - 无敌人时跟随玩家（到位 idle）；
   - 死亡：takeDamage 致死 → 播 dying 动画（14 帧 @12fps ≈ 1167ms）→ 自动移除。
   用法：node tools/cdp-hamster-militia.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9339);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-militia-'));
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
await rawEval(`(() => { window.__probeErrs = []; window.addEventListener('error', (e) => {
    window.__probeErrs.push(String(e && e.message || e).slice(0, 200));
}); return true; })()`).catch(() => null);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---------- 启动游戏 + 进入 scene8（页面崩溃/重载后自愈重进） ----------
let bootedOnce = false;
async function ensureScene8() {
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
                if (!(window.Game && window.Game.isRunning && window.Game.player)) return null;
                if (!(window.Game.player && window.__phaserScene)) return null;
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
    if (!ok) return false;
    const sw = await rawEval(`(async () => {
        try {
            if (!Object.keys(window.__sm.scenes || {}).length) window.__sm.init();
            if (window.__sm.currentScene === 'scene8') return 'already';
            await window.__sm.switchScene('scene8', window.Game.player, 'explore');
            return window.__sm.currentScene;
        } catch (e) { return { err: String(e && e.stack || e).slice(0, 400) }; }
    })()`).catch(() => null);
    let sceneReady = false;
    for (let i = 0; i < 60 && !sceneReady; i++) {
        await sleep(600);
        sceneReady = await rawEval(`(async () => {
            const { DefenseSystem } = await window.__imp('defense-system');
            const { SceneManager } = await window.__imp('scene-manager');
            return !!(SceneManager.currentScene === 'scene8' && DefenseSystem.active && DefenseSystem.base);
        })()`).catch(() => false);
    }
    if (sceneReady) {
        // 冻结波次生成：探针用假敌人验证 AI，避免真实波次干扰确定性
        await rawEval(`(async () => {
            const { DefenseSystem } = await window.__imp('defense-system');
            DefenseSystem._phase = 'prep';
            DefenseSystem._phaseTimer = 1e9;
            return true;
        })()`).catch(() => false);
    }
    return sceneReady;
}

let sceneReady = await ensureScene8();
if (!bootedOnce) {
    check('世界-122 已就绪', sceneReady);
    bootedOnce = true;
}
if (!sceneReady) { console.error('scene8 not ready, abort'); await cleanup(1); }

// 民兵由「仓鼠兵营/草屋」生成——探针手动构造一只测试民兵（与 spawnUnit 同注册方式）
await rawEval(`(async () => {
    if ([...window.Game.entities.values()].some(e => e && e._isHamsterMilitia && e.active)) return 'exists';
    const { HamsterMilitia } = await import('/src/entities/hamster-militia.js');
    const p = window.Game.player;
    const w = new HamsterMilitia(p.x + 90, p.y - 30, { id: 'probe_militia' });
    window.Game.entities.set(w.id, w);
    if (!Array.isArray(window.Game.friendlyUnits)) window.Game.friendlyUnits = [];
    window.Game.friendlyUnits.push(w);
    return 'spawned';
})()`).catch(() => null);

async function findMilitia() {
    return rawEval(`(async () => {
        if (!(window.Game && window.Game.isRunning && window.Game.player && window.__phaserScene)) return { reloaded: true };
        const w = [...window.Game.entities.values()].find(e => e && e._isHamsterMilitia && e.active);
        if (!w && !(window.__sm && window.__sm.currentScene === 'scene8')) return { reloaded: true };
        return { w: w ? {
            id: w.id, x: w.x, y: w.y, hp: w.data.hp,
            anim: w._animState,
            inFriendly: Array.isArray(window.Game.friendlyUnits) && window.Game.friendlyUnits.includes(w),
        } : null };
    })()`).catch(() => ({ reloaded: true }));
}
async function ensureMilitia() {
    let s = await findMilitia();
    if (s && s.reloaded) {
        sceneReady = await ensureScene8();
        s = await findMilitia();
    }
    return s && s.w;
}

async function evalRobust(expr) {
    try {
        return await rawEval(expr);
    } catch (err) {
        console.log('eval retry:', String(err && err.message || err).slice(0, 120));
        const state = await rawEval(`(() => !!(
            window.Game && window.Game.isRunning && window.Game.player && window.__phaserScene
            && window.__sm && window.__sm.currentScene === 'scene8'))()`).catch(() => false);
        if (state) return { probeErr: String(err && err.message || err).slice(0, 200) };
        const ok2 = await ensureScene8();
        if (!ok2) return { probeErr: 'scene8 re-enter failed', orig: String(err && err.message || err).slice(0, 200) };
        try {
            return await rawEval(expr);
        } catch (err2) {
            return { probeErr: String(err2 && err2.message || err2).slice(0, 200) };
        }
    }
}

// ---------- A. 生成与属性 ----------
console.log('A. 世界-122 民兵生成与属性');
await ensureMilitia();
const a = await evalRobust(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(1200);
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterMilitia && e.active);
    if (!w) return { err: 'no militia' };
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
    };
})()`);
check('世界-122 生成仓鼠民兵', !a.err && a.id, a.id || a.err);
check('注册进 entities + friendlyUnits', a.inFriendly === true);
check('生命值 = 125', a.maxHp === 125 && a.hp === 125, `hp=${a.hp}/${a.maxHp}`);
check('六维 力量8/敏捷10/智力3/体质6/精神3/幸运7',
    JSON.stringify(a.attrs) === JSON.stringify([8, 10, 3, 6, 3, 7]), JSON.stringify(a.attrs));
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 150 / 间隔 2000ms / 伤害 20', a.walkSpeed === 150 && a.interval === 2000 && a.dmg === 20,
    `spd=${a.walkSpeed} int=${a.interval} dmg=${a.dmg}`);
check('精灵已渲染（显示尺寸 226）', a.spriteSize && a.spriteSize[0] === 226 && a.spriteSize[1] === 226,
    JSON.stringify(a.spriteSize));

// ---------- B. 找最近敌人 → 走位 → 挥击（20/2s）+ 单次播放动画 + 第 8 帧出伤 ----------
console.log('B. 索敌/攻击/动画单次播放');
await ensureMilitia();
const b = await evalRobust(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterMilitia && e.active);
    const key = 'probe_militia_enemy';
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
    const sp = window.__phaserScene._companionSprites[w.id];
    let firstHitAt = null;
    const t0 = Date.now();
    for (let i = 0; i < 32; i++) {
        await sleep(200);
        if (w._animState === 'walk') chaseSeen = true;
        if (w._animState === 'attack') attackSeen = true;
        if (attackSeen && firstHitAt === null && dummy.hp < 500) firstHitAt = Date.now() - t0;
        if (attackSeen && dummy.hp < 500) break; // 命中即跳出走位循环
    }
    const attacking = w._animState === 'attack';
    const hpAfterFirst = dummy.hp;
    // 动画契约：单次播放（无 _start 两段式），攻击期间 key = companion_hamster_militia_attack
    let kSeen = false, kStartSeen = false, kSeenAt = null;
    const animT0 = Date.now();
    for (let i = 0; i < 26; i++) {
        await sleep(100);
        const k = sp && sp.anims && sp.anims.currentAnim ? sp.anims.currentAnim.key : null;
        if (k === 'companion_hamster_militia_attack') { if (!kSeen) kSeenAt = Date.now() - animT0; kSeen = true; }
        if (k && k.includes('_start')) kStartSeen = true;
    }
    // 再等 1.2s 验证第二次攻击（攻击间隔 2s）
    await sleep(1200);
    const hpAfterSecond = dummy.hp;
    const targetWasEnemy = !!(w.target && w.target.id === key);
    const animKey = sp && sp.anims && sp.anims.currentAnim ? sp.anims.currentAnim.key : null;
    // 目标死亡 → 离开攻击；再刷新敌人 → 再次进入攻击重播单次动画
    dummy.hp = 0;
    dummy.active = false;
    await sleep(600);
    const leftAttack = w._animState !== 'attack';
    const key2 = 'probe_militia_enemy2';
    const dummy2 = {
        id: key2, active: true, hittable: true, hp: 500, maxHp: 500,
        x: w.x + 45, y: w.y, _faction: 'enemy', _isEnergyNode: false,
        groundRadius: 26,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key2, dummy2);
    let reAttacked = false;
    let kAgain = false;
    for (let i = 0; i < 20; i++) {
        await sleep(120);
        const k = sp && sp.anims && sp.anims.currentAnim ? sp.anims.currentAnim.key : null;
        if (k === 'companion_hamster_militia_attack') kAgain = true;
        if (w._animState === 'attack') reAttacked = true;
    }
    window.Game.entities.delete(key);
    window.Game.entities.delete(key2);
    return { chaseSeen, attackSeen, attacking, hpAfterFirst, hpAfterSecond, kSeen, kStartSeen,
        kSeenAt, animKey, leftAttack, kAgain, reAttacked, targetWasEnemy, firstHitAt };
})()`);
check('追击阶段走位（walk）', b.chaseSeen === true);
check('进入攻击范围站定挥击（attack 状态）', b.attackSeen === true && b.attacking === true,
    `attackSeen=${b.attackSeen}`);
check('首次命中造成 20 伤害', b.hpAfterFirst === 480, `hp=${b.hpAfterFirst}`);
check('第 8 帧出伤时序（约 583ms，窗口 450~900ms）',
    b.firstHitAt !== null && b.firstHitAt >= 450 && b.firstHitAt <= 900, `firstHitAt=${b.firstHitAt}ms`);
check('2s 间隔第二次命中（累计 -40）', b.hpAfterSecond === 460, `hp=${b.hpAfterSecond}`);
check('攻击动画单次播放（companion_hamster_militia_attack，无两段式 _start）',
    b.kSeen === true && b.kStartSeen === false, `kSeen=${b.kSeen} kStart=${b.kStartSeen} now=${b.animKey}`);
check('索敌目标是最近敌人（enemy 阵营）', b.targetWasEnemy === true);
check('目标死亡离开攻击；再进攻击重播单次动画',
    b.leftAttack === true && b.kAgain === true && b.reAttacked === true,
    `left=${b.leftAttack} kAgain=${b.kAgain} reAttacked=${b.reAttacked}`);

// ---------- C. 能源矿点贴脸不攻击 ----------
console.log('C. 不攻击能源矿点');
await ensureMilitia();
const c = await evalRobust(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterMilitia && e.active);
    const key = 'probe_militia_node';
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
await ensureMilitia();
const d = await evalRobust(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const w = [...window.Game.entities.values()].find(e => e && e._isHamsterMilitia && e.active);
    const p = window.Game.player;
    // 远离玩家 → 应朝跟随点（玩家左 140px）走位
    w.x = p.x - 400; w.y = p.y;
    w.target = null; w._tacticalTarget = null; w._animState = 'idle';
    if (w._pathManager) w._pathManager._clearPath();
    let walkSeen = false;
    for (let i = 0; i < 30; i++) {
        await sleep(200);
        if (w._animState === 'walk') walkSeen = true;
    }
    const followTarget = !!(w._tacticalTarget && Math.abs(w._tacticalTarget.x - (p.x - 140)) < 20);
    // 直接放到跟随点 → 应在 0.6s 内停步 idle（到点清路径归零速度）
    w.x = p.x - 140; w.y = p.y;
    w.target = null; w._tacticalTarget = null; w._animState = 'walk';
    if (w._pathManager) w._pathManager._clearPath();
    await sleep(600);
    return { walkSeen, followTarget, anim: w._animState, vx: Math.round(w.vx), vy: Math.round(w.vy) };
})()`);
check('无敌人时跟随玩家走位（walk）', d.walkSeen === true);
check('跟随点 = 玩家左 140px', d.followTarget === true);
check('到达跟随点停步（idle + 速度归零）', d.anim === 'idle' && d.vx === 0 && d.vy === 0,
    `anim=${d.anim} v=(${d.vx},${d.vy})`);

// ---------- E. 死亡流程 ----------
console.log('E. 死亡：dying → 移除');
await ensureMilitia();
let e;
try {
    e = await evalRobust(`(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const w = [...window.Game.entities.values()].find(e2 => e2 && e2._isHamsterMilitia && e2.active);
        if (!w) return { err: 'no militia' };
        const id = w.id;
        w.takeDamage(9999, { _faction: 'enemy' }, 'physical', true);
        const stateAfter = w._animState;
        await sleep(1400);
        return {
            stateAfter,
            inEntities: window.Game.entities.has(id),
            inFriendly: Array.isArray(window.Game.friendlyUnits) && window.Game.friendlyUnits.some(u => u.id === id),
        };
    })()`);
} catch (err) { e = { probeErr: String(err && err.stack || err).slice(0, 400) }; }
console.log('E result:', JSON.stringify(e));
check('致死 → dying 状态', e.stateAfter === 'dying', `state=${e.stateAfter}`);
check('dying 播完自动从场景移除', e.inEntities === false && e.inFriendly === false,
    `entities=${e.inEntities} friendly=${e.inFriendly}`);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
