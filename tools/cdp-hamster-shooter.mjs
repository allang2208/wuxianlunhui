#!/usr/bin/env node
/* 仓鼠射手实机验证（2026-08-16）：
   - 进入世界-122 后自动生成仓鼠射手（150HP/150 移速/友方阵营可被怪锁定）；
   - AI：最近 enemy → 射程内站定 attack（13 帧动画，第 10 帧 ≈750ms 出膛），
     AimHelper.lead 提前量瞄准目标贴图中心，投射物（projective 箭矢）飞行命中
     每 2s 造成 60 物理伤害；能源矿点贴脸不攻击；
   - 无敌人时跟随玩家（到位 idle）；死亡：dying 动画 → 移除。
   用法：node tools/cdp-hamster-shooter.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9347);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-shooter-'));
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
await new Promise((r) => setTimeout(r, 8000));

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
    await rawEval(`(async () => {
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

async function evalRobust(expr) {
    try {
        return await rawEval(expr);
    } catch (err) {
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
async function findShooter() {
    return rawEval(`(async () => {
        if (!(window.Game && window.Game.isRunning && window.Game.player && window.__phaserScene)) return { reloaded: true };
        const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
        if (!s && !(window.__sm && window.__sm.currentScene === 'scene8')) return { reloaded: true };
        return { s: s ? { id: s.id, x: s.x, y: s.y, hp: s.data.hp } : null };
    })()`).catch(() => ({ reloaded: true }));
}
async function ensureShooter() {
    let r = await findShooter();
    if (r && r.reloaded) {
        sceneReady = await ensureScene8();
        r = await findShooter();
    }
    return r && r.s;
}

// ---------- A. 自动生成与属性 ----------
console.log('A. 世界-122 自动生成与属性');
await ensureShooter();
const a = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep2(1200);
    const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    if (!s) return { err: 'no shooter' };
    const sp = window.__phaserScene._companionSprites && window.__phaserScene._companionSprites[s.id];
    return {
        id: s.id,
        inFriendly: Array.isArray(window.Game.friendlyUnits) && window.Game.friendlyUnits.includes(s),
        maxHp: s.data.maxHp, hp: s.data.hp,
        attrs: [s.data.str, s.data.dex, s.data.int, s.data.con, s.data.wis, s.data.luck],
        faction: s._faction, targetable: s._enemyTargetable, hittable: s.hittable,
        walkSpeed: s.aiConfig.walkSpeed, interval: s.aiConfig.attackInterval, dmg: s.aiConfig.attackDamage,
        range: s.aiConfig.attackRange, projSpeed: s.aiConfig.projectileSpeed,
        spriteSize: sp ? [Math.round(sp.displayWidth), Math.round(sp.displayHeight)] : null,
        anim: s._animState,
    };
})()`);
check('世界-122 自动生成仓鼠射手', !a.err && a.id, a.id || a.err);
check('注册进 entities + friendlyUnits', a.inFriendly === true);
check('生命值 = 150', a.maxHp === 150 && a.hp === 150, `hp=${a.hp}/${a.maxHp}`);
check('六维 力量12/敏捷20/智力3/体质10/精神3/幸运10',
    JSON.stringify(a.attrs) === JSON.stringify([12, 20, 3, 10, 3, 10]), JSON.stringify(a.attrs));
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 150 / 间隔 2000ms / 伤害 60 / 射程 600 / 弹速 600',
    a.walkSpeed === 150 && a.interval === 2000 && a.dmg === 60 && a.range === 600 && a.projSpeed === 600,
    `spd=${a.walkSpeed} int=${a.interval} dmg=${a.dmg} range=${a.range} ps=${a.projSpeed}`);
check('精灵已渲染（显示尺寸 226）', a.spriteSize && a.spriteSize[0] === 226 && a.spriteSize[1] === 226,
    JSON.stringify(a.spriteSize));

// ---------- B1. 远程攻击：站定 → 第10帧出膛（≈750ms）→ 命中 60 物理 → 2s 第二发 ----------
console.log('B1. 远程攻击/出膛时机/中心瞄准/伤害');
const b1 = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    // 临时移走仓鼠战士：它也会锁定假敌人（50 伤害），会污染射手伤害断言
    const warrior = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    if (warrior) {
        warrior.active = false;
        window.Game.entities.delete(warrior.id);
        const wi = window.Game.friendlyUnits.indexOf(warrior);
        if (wi >= 0) window.Game.friendlyUnits.splice(wi, 1);
    }
    const key = 'probe_shooter_enemy';
    window.Game.entities.delete(key);
    const dummy = {
        id: key, active: true, hittable: true, hp: 500, maxHp: 500,
        x: s.x + 450, y: s.y, _faction: 'enemy', _isEnergyNode: false,
        groundRadius: 26, collisionRadius: 26, size: 40, vx: 0, vy: 0,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key, dummy);
    s.target = null; s._basic = null; s._animState = 'idle'; s._tacticalTarget = null;
    if (s._pathManager) s._pathManager._clearPath();
    if (s._ai) { s._ai._attackTimer = 0; s._ai._shotActive = false; }
    // 等游戏给假敌人创建贴图（enemy_circle），记录其贴图中心 Y
    let sprY = null;
    for (let i = 0; i < 20; i++) {
        await sleep2(100);
        if (dummy._phaserSprite && dummy._phaserSprite.active) { sprY = dummy._phaserSprite.y; break; }
    }
    // 等进入攻击状态
    let t0 = null;
    for (let i = 0; i < 40; i++) {
        await sleep2(50);
        if (s._ai && s._ai._shotActive) { t0 = Date.now(); break; }
    }
    if (t0 === null) return { err: 'no shot started', anim: s._animState, ai: !!s._ai };
    // 等投射物出膛，记录时机/瞄准点/角度
    let spawnDelay = null, aimY = null, angle = null, projTex = null, projW = null, projVisible = null, animDuringShot = null;
    for (let i = 0; i < 40; i++) {
        await sleep2(50);
        if (s._basic && s._basic.active) {
            spawnDelay = Date.now() - t0;
            aimY = s._basic.aimY;
            angle = s._basic.angle;
            animDuringShot = s._animState;
            const ps = window.__phaserScene._companionBasicSprites && window.__phaserScene._companionBasicSprites[s.id];
            if (ps) {
                projTex = ps.texture ? ps.texture.key : null;
                projW = Math.round(ps.displayWidth);
                projVisible = ps.visible;
            }
            break;
        }
    }
    // 等命中（-60）
    let hitHp = dummy.hp;
    for (let i = 0; i < 60; i++) {
        await sleep2(50);
        if (dummy.hp < 500) { hitHp = dummy.hp; break; }
    }
    // 等第二发（2s 间隔：t0+2000 开始第二发 → +750ms 出膛 → 飞行命中 ≈ t0+3.4s）
    await sleep2(Math.max(0, 3500 - (Date.now() - t0)));
    const hpAfterSecond = dummy.hp;
    window.Game.entities.delete(key);
    return {
        spawnDelay, aimY, angle, projTex, projW, projVisible, hitHp, hpAfterSecond,
        sprY, spriteExists: !!dummy._phaserSprite,
        animDuringShot,
    };
})()`);
check('进入射程站定攻击（attack，出膛时）', !b1.err && b1.animDuringShot === 'attack',
    b1.err || `anim=${b1.animDuringShot}`);
check('第 10 帧出膛 ≈750ms（实测 500~1100ms）',
    b1.spawnDelay !== null && b1.spawnDelay >= 500 && b1.spawnDelay <= 1100,
    `spawnDelay=${b1.spawnDelay}ms`);
check('瞄准目标贴图中心（aimY ≈ 敌人贴图中心 Y）',
    b1.spriteExists === true && b1.aimY !== null && Math.abs(b1.aimY - b1.sprY) < 8,
    `aimY=${Math.round(b1.aimY)} sprY=${Math.round(b1.sprY)}`);
check('箭矢贴图渲染（companion_hamster_shooter_projectile）',
    b1.projTex === 'companion_hamster_shooter_projectile', b1.projTex);
check('箭矢显示尺寸可见（帧 ≈252px，箭身 ≈72px，visible=true）',
    b1.projW !== null && b1.projW >= 200 && b1.projVisible === true,
    `displayW=${b1.projW} visible=${b1.projVisible}`);
check('命中造成 60 物理伤害（500 → 440）', b1.hitHp === 440, `hp=${b1.hitHp}`);
check('2s 间隔第二发（440 → 380）', b1.hpAfterSecond === 380, `hp=${b1.hpAfterSecond}`);

// ---------- B2. 提前量瞄准（目标带速度 → 弹道指向目标前方） ----------
console.log('B2. AimHelper 提前量（移动目标弹道超前）');
const b2 = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    const { AimHelper } = await import('/src/utils/aim-helper.js');
    // 与 B1 同口径：临时移走战士，避免它对移动假敌人补刀
    const warrior = [...window.Game.entities.values()].find(e => e && e._isHamsterWarrior && e.active);
    if (warrior) {
        warrior.active = false;
        window.Game.entities.delete(warrior.id);
        const wi = window.Game.friendlyUnits.indexOf(warrior);
        if (wi >= 0) window.Game.friendlyUnits.splice(wi, 1);
    }
    const key = 'probe_shooter_enemy2';
    window.Game.entities.delete(key);
    const dummy = {
        id: key, active: true, hittable: true, hp: 500, maxHp: 500,
        x: s.x + 450, y: s.y, _faction: 'enemy', _isEnergyNode: false,
        groundRadius: 26, collisionRadius: 26, size: 40, vx: 150, vy: 0,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key, dummy);
    s.target = null; s._basic = null; s._animState = 'idle'; s._tacticalTarget = null;
    if (s._pathManager) s._pathManager._clearPath();
    if (s._ai) { s._ai._attackTimer = 0; s._ai._shotActive = false; }
    let res = { err: 'no shot' };
    for (let i = 0; i < 60; i++) {
        await sleep2(100);
        if (s._basic && s._basic.active) {
            const b = s._basic;
            // 用页面内同一 AimHelper 从相同输入重算提前量，比对弹道角（直接验证“参考露娜算提前量”）
            const lead = AimHelper.lead(s.x, s.y, dummy.x, b.aimY, dummy.vx, dummy.vy, 600);
            const expectedAngle = Math.atan2(lead.y - s.y, lead.x - s.x);
            res = { angle: b.angle, expectedAngle, aimY: b.aimY, leadX: lead.x, targetX: dummy.x };
            break;
        }
    }
    window.Game.entities.delete(key);
    return res;
})()`);
check('弹道角 = AimHelper.lead 提前量重算角（±0.01rad）',
    !b2.err && Math.abs(b2.angle - b2.expectedAngle) < 0.01,
    `angle=${b2.angle?.toFixed(4)} expected=${b2.expectedAngle?.toFixed(4)} leadX=${Math.round(b2.leadX)} targetX=${Math.round(b2.targetX)}`);

// ---------- C. 能源矿点贴脸不攻击 ----------
console.log('C. 不攻击能源矿点');
const c = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    const key = 'probe_shooter_node';
    window.Game.entities.delete(key);
    const node = {
        id: key, active: true, hittable: true, hp: 500, maxHp: 500,
        x: s.x + 120, y: s.y, _faction: 'neutral', _isEnergyNode: true, _depleted: false,
        groundRadius: 45,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(key, node);
    s.target = null; s._basic = null; s._animState = 'idle'; s._tacticalTarget = null;
    if (s._pathManager) s._pathManager._clearPath();
    if (s._ai) { s._ai._attackTimer = 0; s._ai._shotActive = false; }
    await sleep2(2600);
    const res = { nodeHp: node.hp, targetIsNode: !!(s.target && s.target._isEnergyNode), anim: s._animState };
    window.Game.entities.delete(key);
    return res;
})()`);
check('矿点贴脸不攻击（hp 不变、不锁定矿点目标）',
    c.nodeHp === 500 && c.targetIsNode === false, `nodeHp=${c.nodeHp} anim=${c.anim}`);

// ---------- D. 无敌人跟随玩家（到位 idle） ----------
console.log('D. 无敌人跟随玩家');
const d = await evalRobust(`(async () => {
    const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
    const s = [...window.Game.entities.values()].find(e => e && e._isHamsterShooter && e.active);
    const p = window.Game.player;
    s.x = p.x - 400; s.y = p.y;
    s.target = null; s._tacticalTarget = null; s._animState = 'idle';
    if (s._pathManager) s._pathManager._clearPath();
    let walkSeen = false;
    let followTargetSeen = false;
    for (let i = 0; i < 30; i++) {
        await sleep2(200);
        if (s._animState === 'walk') walkSeen = true;
        if (s._tacticalTarget && Math.abs(s._tacticalTarget.x - (p.x - 140)) < 20) {
            followTargetSeen = true;
        }
    }
    s.x = p.x - 140; s.y = p.y;
    s.target = null; s._tacticalTarget = null; s._animState = 'walk';
    if (s._pathManager) s._pathManager._clearPath();
    await sleep2(600);
    return { walkSeen, followTarget: followTargetSeen, anim: s._animState, vx: Math.round(s.vx), vy: Math.round(s.vy) };
})()`);
check('无敌人时跟随玩家走位（walk）', d.walkSeen === true);
check('跟随点 = 玩家左 140px', d.followTarget === true);
check('到达跟随点停步（idle + 速度归零）', d.anim === 'idle' && d.vx === 0 && d.vy === 0,
    `anim=${d.anim} v=(${d.vx},${d.vy})`);

// ---------- E. 死亡流程 ----------
console.log('E. 死亡：dying → 移除');
await ensureShooter();
let e;
try {
    e = await evalRobust(`(async () => {
        const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
        const s = [...window.Game.entities.values()].find(e2 => e2 && e2._isHamsterShooter && e2.active);
        if (!s) return { err: 'no shooter' };
        const id = s.id;
        s.takeDamage(9999, { _faction: 'enemy' }, 'physical', true);
        const stateAfter = s._animState;
        await sleep2(1300);
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
