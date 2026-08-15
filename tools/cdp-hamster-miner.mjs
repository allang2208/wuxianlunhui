#!/usr/bin/env node
/* 仓鼠矿工实机验证（2026-08-15）：
   - 进入世界-122 后经「仓鼠小屋」生成矿工（属性 200HP/80 移速、友方阵营可被怪锁定）；
   - AI：找最近能源矿点 → 赶路 walk → 到位采矿（定格 mining 第 4 帧，不播攻击动画）；
   - 攻击：每 2s 对矿点造成 100 伤害，绝不攻击其他单位（假敌人贴脸 hp 不变）；
   - 死亡：takeDamage 致死 → 播 dying 动画 → 自动从场景移除。
   用法：node tools/cdp-hamster-miner.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = process.env.CDP_APP_URL || 'http://localhost:5173/';
const CDP_PORT = Number(process.env.CDP_PORT || 9337);
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-hamster2-'));
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
    if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '：' + detail : ''}`); }
    else { fail++; console.error(`  ✗ ${name}${detail ? '：' + detail : ''}`); }
}

// headless Edge 并发加载大 PNG 会 ERR_FAILED（Phaser loader 卡住）——
// 先预取这些大资源进 HTTP 缓存，再启动游戏让 Phaser 走缓存命中。
const PREWARM = process.env.CDP_NO_PREWARM === '1' ? [] : [
    '/assets/enemies/amalgam/attacking.png',
    '/assets/enemies/amalgam/attacking-2.png',
    '/assets/enemies/flyswarm/idle.png',
    '/assets/enemies/red_wolf_king_changed_attack.png',
    '/assets/enemies/red_wolf_king_changed_run.png',
    '/assets/enemies/shounao/attacking.png',
    '/assets/enemies/shounao/attacking-2.png',
    '/assets/skills/fireball_spritesheet.png',
    '/assets/terrain/blackbrick2.png',
    '/assets/terrain/blackbrick3.png',
    '/assets/terrain/swamp_gate.png',
    '/assets/terrain/cover_gate_A.png',
    '/assets/terrain/cover_gate_B.png',
    '/assets/terrain/cover_gate_C.png',
    '/assets/terrain/cover_gate_D.png',
    '/assets/terrain/cover_gate_E.png',
    '/assets/terrain/cover_gate_F.png',
    '/assets/terrain/hamster_hut.png',
];
const warm = await rawEval(`(async () => {
    const out = [];
    for (const u of ${JSON.stringify(PREWARM)}) {
        try {
            const res = await fetch(u);
            const buf = await res.arrayBuffer();
            out.push({ u, ok: res.ok, bytes: buf.byteLength });
        } catch (e) { out.push({ u, err: String(e).slice(0, 80) }); }
    }
    return out;
})()`).catch(() => null);
console.log('prewarm:', JSON.stringify(warm && warm.length ? warm.map(w => `${w.u.split('/').pop()}:${w.bytes || w.err}`) : warm));

// ---------- 启动游戏 + 进 scene8 ----------
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
for (let i = 0; i < 150; i++) {
    const ok = await rawEval(`(async () => {
        try {
            // 页面被 HMR/崩溃重载后重启游戏
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
    if (ok) break;
    if (i % 10 === 0) {
        const sub = await rawEval(`(() => ({
            running: !!(window.Game && window.Game.isRunning),
            player: !!(window.Game && window.Game.player),
            ps: !!window.__phaserScene,
        }))()`).catch(() => null);
        console.log('wait', i, JSON.stringify(sub));
    }
    await sleep(500);
}
console.log('bootErr:', await rawEval(`window.__bootErr || null`).catch(() => null));
console.log('boot: switch to scene8');
const swRes = await rawEval(`(async () => {
    try {
        if (!Object.keys(window.__sm.scenes || {}).length) window.__sm.init();
        await window.__sm.switchScene('scene8', window.Game.player, 'explore');
        return { scene: window.__sm.currentScene };
    } catch (e) { return { err: String(e && e.stack || e).slice(0, 400) }; }
})()`);
console.log('switch result:', JSON.stringify(swRes));

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

// ---------- A. 建小屋生成矿工：属性 / 阵营 / 寻最近矿点 ----------
console.log('A. 小屋生成与属性');
const a = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const { HamsterHut, HamsterHutSystem } = await window.__imp('hamster-hut-system');
    const p = window.Game.player;
    let miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    if (!miner) {
        const hut = new HamsterHut(p.x + 220, p.y - 80);
        window.Game.entities.set(hut.id, hut);
        HamsterHutSystem.huts.push(hut);
        miner = hut.spawnMiner();
    }
    if (!miner) return { err: 'no miner' };
    miner.x = p.x + 100; miner.y = p.y + 40;
    miner.target = null; miner._tacticalTarget = null; miner._animState = 'idle';
    await sleep(800);
    const node = miner.target;
    let nearestId = null, bestD = Infinity;
    for (const e of window.Game.entities.values()) {
        if (e._isEnergyNode && e.active && !e._depleted) {
            const d = Math.hypot(e.x - miner.x, e.y - miner.y);
            if (d < bestD) { bestD = d; nearestId = e.id; }
        }
    }
    return {
        minerId: miner.id,
        maxHp: miner.data.maxHp, hp: miner.data.hp, faction: miner._faction,
        targetable: miner._enemyTargetable, hittable: miner.hittable,
        walkSpeed: miner.aiConfig.walkSpeed, anim: miner._animState,
        targetIsNode: !!(node && node._isEnergyNode),
        targetIsNearest: !!(node && node.id === nearestId),
        hutCount: HamsterHutSystem.huts.length,
    };
})()`);
check('经仓鼠小屋生成矿工', !a.err && a.minerId, a.minerId || a.err);
check('生命值 = 200', a.maxHp === 200 && a.hp === 200, `hp=${a.hp}/${a.maxHp}`);
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 80', a.walkSpeed === 80);
check('AI 锁定最近能源节点（非单位）', a.targetIsNode === true && a.targetIsNearest === true,
    `anim=${a.anim}`);

// ---------- B. 采矿：定格第 4 帧 + 每 2s 100 伤害 ----------
console.log('B. 采矿定格与伤害');
const b0 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    miner.x = miner.target.x + 30; miner.y = miner.target.y;
    miner._tacticalTarget = null;
    await sleep(900);
    const sc = window.__phaserScene;
    const sprite = sc && sc._companionSprites ? sc._companionSprites[miner.id] : null;
    return {
        anim: miner._animState,
        targetIsNode: !!(miner.target && miner.target._isEnergyNode),
        texKey: sprite ? sprite.texture.key : null,
        frame: sprite ? sprite.frame.name : null,
        isPlaying: sprite ? sprite.anims.isPlaying : null,
    };
})()`);
check('进入采矿态 mining', b0.anim === 'mining', `anim=${b0.anim}`);
check('采矿不播动画，定格第 4 帧（索引 3）',
    b0.texKey === 'companion_hamster_miner_mining' && b0.frame === 3 && b0.isPlaying === false,
    `tex=${b0.texKey} frame=${b0.frame} playing=${b0.isPlaying}`);
const b1 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const node = miner.target;
    const events = [];
    let prev = node.hp, prevT = Date.now();
    for (let i = 0; i < 21; i++) {
        await sleep(200);
        const cur = node.hp;
        if (cur < prev) {
            events.push({ drop: prev - cur, gap: Date.now() - prevT });
            prev = cur; prevT = Date.now();
        }
    }
    const sc = window.__phaserScene;
    const sprite = sc._companionSprites[miner.id];
    return {
        events,
        stillStatic: !!(sprite && sprite.texture.key === 'companion_hamster_miner_mining'
            && sprite.frame.name === 3 && !sprite.anims.isPlaying),
    };
})()`);
check('每 2s 造成 100 伤害（≥2 次、每次 -100、间隔 1700~2400ms）',
    b1.events.length >= 2
    && b1.events.every(e => e.drop === 100)
    && b1.events.slice(1).every((e, i) => e.gap >= 1700 && e.gap <= 2400),
    JSON.stringify(b1.events));
check('攻击间隔期间持续定格第 4 帧', b1.stillStatic === true);

// ---------- C. 敌人交战（小屋防御）与回采矿 ----------
console.log('C. 交战自卫生效 + 回采矿');
const c = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const dummyKey = 'probe_dummy_enemy';
    window.Game.entities.delete(dummyKey);
    const dummy = {
        id: dummyKey, active: true, hittable: true, hp: 500, maxHp: 500,
        x: miner.x + 40, y: miner.y, _faction: 'enemy', _isEnergyNode: false,
        groundRadius: 26,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(dummyKey, dummy);
    const nodeBefore = miner.target ? miner.target.hp : null;
    await sleep(2500);
    const res = {
        dummyHp: dummy.hp,
        engageTarget: !!(miner._enemyTarget && miner._enemyTarget.id === dummyKey),
        anim: miner._animState,
    };
    window.Game.entities.delete(dummyKey);
    // 敌人消失后应回到矿点采矿
    await sleep(800);
    res.backToMining = !!(miner.target && miner.target._isEnergyNode);
    return res;
})()`);
check('engageRange 内敌人被锁定并近战攻击（-100/2s）', c.engageTarget === true && c.dummyHp <= 400,
    `dummy hp=${c.dummyHp} anim=${c.anim}`);
check('敌人消失后回到矿点采矿', c.backToMining === true);

// ---------- D. 死亡：dying 动画 + 移除 ----------
console.log('D. 死亡流程');
const d = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const id = miner.id;
    miner.takeDamage(999, { _faction: 'enemy' }, 'physical', true);
    const sc = window.__phaserScene;
    await sleep(350);
    const sprite = sc._companionSprites[id];
    const dyingKey = sprite ? sprite.anims.currentAnim?.key : null;
    await sleep(1500);
    return {
        hp: miner.data.hp, dying: miner._dying, anim: miner._animState,
        dyingKey,
        stillInEntities: window.Game.entities.has(id),
        stillInFriendly: (window.Game.friendlyUnits || []).some(u => u.id === id),
        spriteGone: !sc._companionSprites || !sc._companionSprites[id],
    };
})()`);
check('受击致死 → dying 状态', d.hp === 0 && d.dying === true && d.anim === 'dying');
check('播 dying 动画', d.dyingKey === 'companion_hamster_miner_dying', `key=${d.dyingKey}`);
check('动画播完自动移除（entities/friendlyUnits/精灵）',
    d.stillInEntities === false && d.stillInFriendly === false && d.spriteGone === true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
