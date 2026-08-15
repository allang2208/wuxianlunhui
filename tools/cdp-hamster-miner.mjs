#!/usr/bin/env node
/* 仓鼠矿工实机验证（2026-08-15）：
   - 进入世界-122 后经「仓鼠小屋」生成矿工（属性 200HP/80 移速、友方阵营可被怪锁定）；
   - AI：找最近能源矿点 → 赶路 walk → 到位采矿（定格 mining 第 6 帧，不播攻击动画）；
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

// ---------- B. 采矿：定格第 6 帧 + 每 2s 100 伤害 ----------
console.log('B. 采矿挥锄 + 间隔定格 + 伤害');
const b0 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    miner.x = miner.target.x + 30; miner.y = miner.target.y;
    miner._tacticalTarget = null;
    await sleep(400);
    const sc = window.__phaserScene;
    const sprite = sc && sc._companionSprites ? sc._companionSprites[miner.id] : null;
    const node = miner.target;
    const events = [];
    let prev = node.hp, prevT = Date.now();
    const samples = [];
    for (let i = 0; i < 21; i++) {
        await sleep(200);
        const playing = !!sprite.anims.isPlaying;
        const key = playing ? sprite.anims.currentAnim.key
            : (sprite.texture.key + ':' + sprite.frame.name);
        const cur = node.hp;
        let drop = 0;
        if (cur < prev) {
            drop = prev - cur;
            events.push({ drop, gap: Date.now() - prevT });
            prev = cur; prevT = Date.now();
        }
        samples.push({ playing, key, drop });
    }
    return {
        events,
        anim: miner._animState,
        targetIsNode: !!(miner.target && miner.target._isEnergyNode),
        playingKeys: [...new Set(samples.filter(s => s.playing).map(s => s.key))],
        hasStaticFrame6: samples.some(s => !s.playing && s.key === 'companion_hamster_miner_mining:5'),
    };
})()`);
check('进入采矿态 mining', b0.anim === 'mining', `anim=${b0.anim}`);
check('攻击触发播挥锄：先完整段 mining_start、后续第 5~19 帧 mining',
    b0.playingKeys.includes('companion_hamster_miner_mining_start')
    && b0.playingKeys.includes('companion_hamster_miner_mining'),
    JSON.stringify(b0.playingKeys));
check('攻击间隔定格第 6 帧（非播放时 tex=mining frame=5）', b0.hasStaticFrame6 === true);
check('每 2s 造成 100 伤害（≥2 次、每次 -100、间隔 1700~2400ms）',
    b0.events.length >= 2
    && b0.events.every(e => e.drop === 100)
    && b0.events.slice(1).every((e, i) => e.gap >= 1700 && e.gap <= 2400),
    JSON.stringify(b0.events));

// ---------- B2. 行走两段式：起步完整 walking → 循环第 3~12 帧 ----------
console.log('B2. 行走两段式');
const bw = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const node = miner.target;
    miner.x = node.x - 260; miner.y = node.y + 40;
    miner._tacticalTarget = { x: node.x, y: node.y };
    miner._animState = 'idle';
    const sc = window.__phaserScene;
    const sprite = sc._companionSprites[miner.id];
    if (sprite.anims.isPlaying) sprite.anims.stop();
    sprite.setData('hamsterWalk', false); // 强制复位起步标记，消除 idle 帧竞态
    await sleep(350);
    const k1 = sprite.anims.isPlaying ? sprite.anims.currentAnim.key : null;
    await sleep(1300);
    const k2 = sprite.anims.isPlaying ? sprite.anims.currentAnim.key : null;
    // 向右走向矿点：贴图应朝右（不倒退）
    const rightMoving = miner.vx > 0;
    const rightFace = !sprite.flipX;
    // 反向：移到矿点右侧朝左走
    miner.x = node.x + 260; miner.y = node.y - 40;
    miner._tacticalTarget = { x: node.x, y: node.y };
    miner._animState = 'idle';
    sprite.setData('hamsterWalk', false);
    if (sprite.anims.isPlaying) sprite.anims.stop();
    await sleep(500);
    const leftMoving = miner.vx < 0;
    const leftFace = sprite.flipX;
    return { anim: miner._animState, k1, k2, rightMoving, rightFace, leftMoving, leftFace };
})()`);
check('静止→移动先播完整 walking（walk_start）', bw.anim === 'walk' && bw.k1 === 'companion_hamster_miner_walk_start',
    `anim=${bw.anim} k1=${bw.k1}`);
check('起步后循环第 3~12 帧（walk）', bw.k2 === 'companion_hamster_miner_walk', `k2=${bw.k2}`);
check('移动始终朝向移动方向（向右朝右、向左朝左，不倒退）',
    bw.rightMoving === true && bw.rightFace === true && bw.leftMoving === true && bw.leftFace === true,
    `right=${bw.rightMoving}/${bw.rightFace} left=${bw.leftMoving}/${bw.leftFace}`);

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

// ---------- E. 隐藏背包物流：采矿拾取 → 满后回屋卸货（idle 2s + 门开关） → 背包扩容 ----------
console.log('E. 背包物流与扩容');
const e0 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    // 采矿一小段时间，应自动拾取地面能源进隐藏背包
    const carried0 = miner._energyCarried;
    miner.x = miner.target.x + 30; miner.y = miner.target.y;
    miner._tacticalTarget = null;
    await sleep(4500);
    return { carried0, carried1: miner._energyCarried, capacity: miner._energyCapacity };
})()`);
check('采矿自动拾取能量进隐藏背包', e0.carried1 > e0.carried0,
    `carried ${e0.carried0}→${e0.carried1}`);

const e1 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    const energyGet = () => {
        const bp = window.Game && window.Game.EquipManager ? window.Game.EquipManager.backpackItems : [];
        return (bp || []).filter(i => i && i.category === 'energy').reduce((s, i) => s + (i.stack || 0), 0);
    };
    const energyBefore = energyGet();
    // 模拟背包满：塞满后传送回小屋门口
    miner._energyCarried = miner._energyCapacity;
    miner.x = hut.x + 40; miner.y = hut.y + 20;
    miner.target = null; miner._tacticalTarget = null; miner._animState = 'idle';
    await sleep(1000); // 应进入 return → 到门口 → unload
    const phase1 = miner._ai ? miner._ai._phase : null;
    const anim1 = miner._animState;
    const carried1 = miner._energyCarried;
    const door1 = hut._doorState;
    const energyGain = energyGet() - energyBefore;
    await sleep(2600); // 2s idle 结束后关门、重新出发
    const phase2 = miner._ai ? miner._ai._phase : null;
    const door2 = hut._doorState;
    return { phase1, anim1, carried1, door1, energyGain, phase2, door2 };
})()`);
check('背包满 → 回屋卸货（能量移交玩家、自身清零）',
    e1.carried1 === 0 && e1.energyGain >= 500,
    `carried=${e1.carried1} energyGain=${e1.energyGain}`);
check('卸货期间 idle + 门打开', e1.anim1 === 'idle' && (e1.door1 === 'open' || e1.door1 === 'opening'),
    `anim=${e1.anim1} door=${e1.door1}`);
check('2s 后门关闭并重新出发', e1.door2 === 'closed' && e1.phase2 === 'work',
    `door=${e1.door2} phase=${e1.phase2}`);

const e2 = await rawEval(`(async () => {
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    const before = hut.mults().backpackCapacity;
    window.Game._devInfiniteResources = true;
    const res = hut.upgradeModule('backpack');
    const after = hut.mults().backpackCapacity;
    const minerCap = miner._energyCapacity;
    window.Game._devInfiniteResources = false;
    return { ok: res.ok, before, after, minerCap };
})()`);
check('背包扩容升级：每级 +100（500 → 600）', e2.ok === true && e2.before === 500 && e2.after === 600 && e2.minerCap === 600,
    JSON.stringify(e2));

const e3 = await rawEval(`(async () => {
    try {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
        const hut = miner._hut;
        const { HamsterHutSystem } = await window.__imp('hamster-hut-system');
        const panel = HamsterHutSystem._ensurePanel();
        if (!panel.isOpen) panel.openFor(hut, window.Game.player);
        await sleep(600); // 等一次 500ms 实时刷新
        const statusEl = document.querySelector('#hhStatus');
        const statusText = statusEl ? statusEl.textContent : '';
        const hasLabel = statusText.includes('暂存能量');
        const timerActive = !!panel._refreshTimer;
        panel.close();
        const timerCleared = !panel._refreshTimer;
        return { hasLabel, timerActive, timerCleared, tail: statusText.slice(-220) };
    } catch (err) {
        return { hasLabel: false, err: String(err && err.stack || err).slice(0, 300) };
    }
})()`);
console.log('e3 raw:', JSON.stringify(e3));
check('小屋面板显示「暂存能量」+ 500ms 实时刷新定时器', e3 && e3.hasLabel === true && e3.timerActive === true
    && e3.timerCleared === true, JSON.stringify(e3));

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
