#!/usr/bin/env node
/* 仓鼠矿工实机验证（2026-08-15）：
   - 进入世界-122 后自动生成、属性 200HP/80 移速、友方阵营可被怪锁定；
   - AI：找最近能源矿点 → 赶路 walk → 到位 mining（先完整 19 帧起步，再 5~19 帧循环）；
   - 攻击：每 2s 对矿点造成 100 伤害，绝不攻击其他单位（假敌人贴脸 hp 不变）；
   - 死亡：takeDamage 致死 → 播 dying 动画 → 自动从场景移除。
   用法：node tools/cdp-hamster-miner.mjs（需本地 vite dev server 5173）*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9334;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-hamster-'));
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
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 30000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
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

// ---------- 启动游戏 + 进 scene8 ----------
for (let i = 0; i < 60; i++) {
    const started = await rawEval(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (started) break;
    await sleep(500);
}
for (let i = 0; i < 90; i++) {
    const ok = await rawEval(`(async () => {
        try {
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
        } catch { return null; }
    })()`).catch(() => null);
    if (ok) break;
    await sleep(500);
}
console.log('boot: switch to scene8');
const swRes = await rawEval(`(async () => {
    try {
        if (!Object.keys(window.__sm.scenes || {}).length) window.__sm.init();
        await window.__sm.switchScene('scene8', window.Game.player, 'explore');
        return { scene: window.__sm.currentScene };
    } catch (e) { return { err: String(e && e.stack || e).slice(0, 400) }; }
})()`);
console.log('switch result:', JSON.stringify(swRes));

// 等仓鼠矿工生成
let minerReady = false;
for (let i = 0; i < 60 && !minerReady; i++) {
    await sleep(600);
    minerReady = await rawEval(`(() => {
        const m = window.Game && window.Game.entities && window.Game.entities.get('hamster_miner');
        return !!(m && m.active && (window.Game.friendlyUnits || []).includes(m));
    })()`).catch(() => false);
}
check('世界-122 生成仓鼠矿工（entities + friendlyUnits）', minerReady);
if (!minerReady) { console.error('miner not spawned, abort'); await cleanup(1); }

// ---------- A. 属性 / 阵营 / 寻最近矿点 ----------
console.log('A. 属性与索敌');
const a = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = window.Game.entities.get('hamster_miner');
    const p = window.Game.player;
    m.x = p.x + 100; m.y = p.y + 40; // 重置到玩家旁，避免残留旧路径
    m.target = null; m._tacticalTarget = null; m._animState = 'idle';
    await sleep(800);
    const node = m.target;
    const dist = node ? Math.round(Math.hypot(node.x - m.x, node.y - m.y)) : null;
    // 校验 target 确实是最近的能源节点
    let nearestId = null, bestD = Infinity;
    for (const e of window.Game.entities.values()) {
        if (e._isEnergyNode && e.active && !e._depleted) {
            const d = Math.hypot(e.x - m.x, e.y - m.y);
            if (d < bestD) { bestD = d; nearestId = e.id; }
        }
    }
    return {
        maxHp: m.data.maxHp, hp: m.data.hp, faction: m._faction,
        targetable: m._enemyTargetable, hittable: m.hittable,
        walkSpeed: m.aiConfig.walkSpeed, anim: m._animState,
        targetIsNode: !!(node && node._isEnergyNode),
        targetIsNearest: !!(node && node.id === nearestId),
        nodeDist: dist, player: { x: p.x, y: p.y },
    };
})()`);
check('生命值 = 200', a.maxHp === 200 && a.hp === 200, `hp=${a.hp}/${a.maxHp}`);
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 80', a.walkSpeed === 80);
check('AI 锁定最近能源节点（非单位）', a.targetIsNode === true && a.targetIsNearest === true,
    `dist=${a.nodeDist} anim=${a.anim}`);

// ---------- B. 采矿：动画两段式 + 每 2s 100 伤害 ----------
console.log('B. 采矿动画与伤害');
const b0 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = window.Game.entities.get('hamster_miner');
    // 直接贴到最近的节点旁边（node 半径 45 + miningRange 80 内）
    m.x = m.target.x + 30; m.y = m.target.y;
    m._tacticalTarget = null;
    await sleep(900);
    const sc = window.__phaserScene;
    const sprite = sc && sc._companionSprites ? sc._companionSprites['hamster_miner'] : null;
    return {
        anim: m._animState,
        targetIsNode: !!(m.target && m.target._isEnergyNode),
        spriteKey: sprite ? sprite.anims.currentAnim?.key : null,
        spritePlaying: sprite ? sprite.anims.isPlaying : false,
        nodeHp: m.target ? m.target.hp : null,
    };
})()`);
check('进入采矿态 mining', b0.anim === 'mining', `anim=${b0.anim}`);
check('采矿动画先播完整段（mining_start）', b0.spriteKey === 'companion_hamster_miner_mining_start' && b0.spritePlaying,
    `key=${b0.spriteKey}`);
const b1 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = window.Game.entities.get('hamster_miner');
    const node = m.target;
    // 采样 4.2s：记录每次掉血事件与间隔，验证「每 ~2s 正好 -100」
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
    const sprite = sc._companionSprites['hamster_miner'];
    return { events, spriteKey: sprite ? sprite.anims.currentAnim?.key : null };
})()`);
check('每 2s 造成 100 伤害（采样到 ≥2 次、每次恰好 -100、间隔 1700~2400ms）',
    b1.events.length >= 2
    && b1.events.every(e => e.drop === 100)
    && b1.events.slice(1).every((e, i) => e.gap >= 1700 && e.gap <= 2400),
    JSON.stringify(b1.events));
check('完整段播完后切 5~19 帧循环段（mining）', b1.spriteKey === 'companion_hamster_miner_mining', `key=${b1.spriteKey}`);

// ---------- C. 绝不攻击其他单位 ----------
console.log('C. 只打矿点不打单位');
const c = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = window.Game.entities.get('hamster_miner');
    const dummyKey = 'probe_dummy_enemy';
    window.Game.entities.delete(dummyKey);
    const dummy = {
        id: dummyKey, active: true, hittable: true, hp: 500, maxHp: 500,
        x: m.x + 40, y: m.y, _faction: 'enemy', _isEnergyNode: false,
        takeDamage(dmg) { this.hp -= dmg; },
    };
    window.Game.entities.set(dummyKey, dummy);
    const nodeBefore = m.target ? m.target.hp : null;
    await sleep(2500);
    const res = {
        dummyHp: dummy.hp,
        targetIsNode: !!(m.target && m.target._isEnergyNode),
        nodeHp: m.target ? m.target.hp : null,
        nodeBefore,
    };
    window.Game.entities.delete(dummyKey);
    return res;
})()`);
check('假敌人贴脸 2.5s 血量不变（不打单位）', c.dummyHp === 500, `dummy hp=${c.dummyHp}`);
check('目标仍为能源节点且持续造成伤害', c.targetIsNode === true && c.nodeBefore !== null && c.nodeHp < c.nodeBefore,
    `node ${c.nodeBefore}→${c.nodeHp}`);

// ---------- D. 死亡：dying 动画 + 移除 ----------
console.log('D. 死亡流程');
const d = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const m = window.Game.entities.get('hamster_miner');
    m.takeDamage(999, { _faction: 'enemy' }, 'physical', true);
    const sc = window.__phaserScene;
    await sleep(350); // 等渲染帧切到 dying 动画
    const sprite = sc._companionSprites['hamster_miner'];
    const dyingKey = sprite ? sprite.anims.currentAnim?.key : null;
    await sleep(1500);
    return {
        hp: m.data.hp, dying: m._dying, anim: m._animState,
        dyingKey,
        stillInEntities: window.Game.entities.has('hamster_miner'),
        stillInFriendly: (window.Game.friendlyUnits || []).some(u => u._isHamsterMiner),
        spriteGone: !sc._companionSprites || !sc._companionSprites['hamster_miner'],
    };
})()`);
check('受击致死 → dying 状态', d.hp === 0 && d.dying === true && d.anim === 'dying');
check('播 dying 动画', d.dyingKey === 'companion_hamster_miner_dying', `key=${d.dyingKey}`);
check('动画播完自动移除（entities/friendlyUnits/精灵）',
    d.stillInEntities === false && d.stillInFriendly === false && d.spriteGone === true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
