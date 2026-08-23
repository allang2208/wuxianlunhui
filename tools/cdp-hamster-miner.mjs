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
    '/assets/enemies/red_wolf_king/attack.png',
    '/assets/enemies/red_wolf_king/running.png',
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

// 冻结波次生成：探针专注物流/寻路边界链路，避免 30s 后随机怪干扰
// （敌人优先是矿工设计行为——被怪贴脸会先交战，会打乱 J 等阶段的确定性）
await rawEval(`(async () => {
    const { DefenseSystem } = await window.__imp('defense-system');
    DefenseSystem._phase = 'prep';
    DefenseSystem._phaseTimer = 1e9;
    return true;
})()`).catch(() => false);

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
        miner = hut.miners[0] || hut.spawnMiner(); // 只用自动生成的一只，避免双矿工交错攻击
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
        minerSize: (window.__phaserScene._companionSprites[miner.id]
            ? [Math.round(window.__phaserScene._companionSprites[miner.id].displayWidth),
                Math.round(window.__phaserScene._companionSprites[miner.id].displayHeight)] : null),
        groundRadius: miner.groundRadius,
    };
})()`);
check('经仓鼠小屋生成矿工', !a.err && a.minerId, a.minerId || a.err);
check('生命值 = 200', a.maxHp === 200 && a.hp === 200, `hp=${a.hp}/${a.maxHp}`);
check('阵营 companion + 可被怪锁定', a.faction === 'companion' && a.targetable === true && a.hittable === true);
check('移速 = 80', a.walkSpeed === 80);
check('贴图缩小 25%（显示 99）', a.minerSize && a.minerSize[0] === 99 && a.minerSize[1] === 99,
    JSON.stringify(a.minerSize));
check('碰撞体积缩小 25%（groundRadius 19.5）', a.groundRadius === 19.5, `r=${a.groundRadius}`);
check('AI 锁定最近能源节点（非单位）', a.targetIsNode === true && a.targetIsNearest === true,
    `anim=${a.anim}`);

// 小屋名字去重：HUD 名字文本里不应再出现「仓鼠小屋」（只保留中立标签一条）
const hutLabel = await rawEval(`(() => {
    const sc = window.__phaserScene;
    let hudNames = 0;
    if (sc && sc._entityHudTexts) {
        for (const [key, text] of sc._entityHudTexts.entries()) {
            if (key.role === 'name' && text.visible && (text.text || '').includes('仓鼠小屋')) hudNames++;
        }
    }
    let neutralLabels = 0;
    if (sc && sc._neutralSprites) {
        for (const [, data] of sc._neutralSprites.entries()) {
            if (data.label && data.label.visible && (data.label.text || '').includes('仓鼠小屋')) neutralLabels++;
        }
    }
    return { hudNames, neutralLabels };
})()`).catch(e => ({ err: String(e).slice(0, 120) }));
check('小屋名字不重复（HUD 名字 0 条，仅保留中立标签 1 条）',
    hutLabel.hudNames === 0 && hutLabel.neutralLabels === 1,
    JSON.stringify(hutLabel));

// ---------- A2. 出生在基地房内 → 自动寻路绕门洞出基地（root-fix 长期回归） ----------
console.log('A2. 出生房内自动出基地');
const a2 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    // 重置到小屋门口（房内），清目标让它自然寻路出基地
    miner.x = hut.x + 40; miner.y = hut.y + 20;
    miner.target = null; miner._tacticalTarget = null; miner._animState = 'idle';
    if (miner._pathManager) miner._pathManager._clearPath();
    let pmValidSeen = false, miningSeen = false, maxJump = 0, maxDistFromHut = 0;
    let prevX = miner.x, prevY = miner.y;
    for (let i = 0; i < 44; i++) {
        await sleep(250);
        const jump = Math.hypot(miner.x - prevX, miner.y - prevY);
        if (jump > maxJump) maxJump = jump;
        prevX = miner.x; prevY = miner.y;
        const pm = miner._pathManager;
        if (pm && pm.hasValidPath()) pmValidSeen = true;
        if (miner._animState === 'mining') miningSeen = true;
        const d = Math.hypot(miner.x - hut.x, miner.y - hut.y);
        if (d > maxDistFromHut) maxDistFromHut = d;
        if (miningSeen) break;
    }
    return {
        pmValidSeen, miningSeen,
        maxJump: Math.round(maxJump), maxDistFromHut: Math.round(maxDistFromHut),
        pos: [Math.round(miner.x), Math.round(miner.y)],
    };
})()`);
check('出生在基地房内：自动寻路出基地（pmValid 生效、无传送跳变、离开小屋>150px）',
    a2.pmValidSeen === true && a2.maxJump < 60 && a2.maxDistFromHut > 150,
    JSON.stringify(a2));

// ---------- A3. 基地门对矿工双向感应：门外也能触发开门（门卡死回归） ----------
// 2026-08-16 用户实测：仓鼠小屋建在基地附近，矿工过基地门卡死左右摆动。
// 根因：门感应中心用了精灵中心 _cx/_cy（等距贴图偏移 ~74px 偏入门内），
// 门外单位被关门段挡在 150px 检测半径外，永远触发不了开门 → 顶门 + 卡死看门狗摆动。
// 修复：感应中心改为门洞物理中心（_gateSeg 中点），门内外两侧 150px 均生效。
console.log('A3. 基地门双向感应（门外开门回归）');
const a3 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const { DefenseSystem } = await window.__imp('defense-system');
    const gate = DefenseSystem && DefenseSystem.gate;
    if (!gate || !gate._gateSeg) return { err: 'no base gate' };
    const seg = gate._gateSeg;
    const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
    const ux = (seg.x2 - seg.x1) / (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1);
    const uy = (seg.y2 - seg.y1) / (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1);
    const nx = -uy, ny = ux; // 门外法线
    const detectOk = Math.abs((gate._detectX ?? 0) - mx) < 1 && Math.abs((gate._detectY ?? 0) - my) < 1;
    // 强制关门，确保从「门外侧触发开门」是本次修复的真实效果（不搭 A2 已开门状态）
    if (gate.state !== 'closed' && typeof gate.setPassable === 'function') {
        gate.setPassable(false);
        gate.state = 'closed';
        gate._closeTimer = 0;
    }
    // 用矿工本尊测门外感应：放到门外侧 100px（贴关门面），不动它，观察门是否自动开
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const minerX0 = miner.x, minerY0 = miner.y;
    miner.x = mx + nx * 100; miner.y = my + ny * 100;
    miner.target = null; miner._tacticalTarget = null; miner._animState = 'idle';
    if (miner._pathManager) miner._pathManager._clearPath();
    const blocking = () => !!(window.WallSystem && window.WallSystem.isoSegments
        && window.WallSystem.isoSegments.includes(seg));
    const before = { state: gate.state, blocking: blocking() };
    let opened = false;
    for (let i = 0; i < 8; i++) {
        await sleep(200);
        if (gate.state === 'open' || gate.state === 'opening') { opened = true; break; }
    }
    const after = { state: gate.state, blocking: blocking() };
    // 还原矿工（避免影响后续阶段）
    miner.x = minerX0; miner.y = minerY0;
    miner.target = null; miner._tacticalTarget = null;
    if (miner._pathManager) miner._pathManager._clearPath();
    await sleep(700); // 等 AI tick 重新锁定最近矿点，避免后续阶段 target 为空
    return { detectOk, before, after, opened,
        detectCenter: [Math.round(gate._detectX), Math.round(gate._detectY)],
        segMid: [Math.round(mx), Math.round(my)],
        spriteCenter: [Math.round(gate._cx), Math.round(gate._cy)] };
})()`);
check('基地门感应中心 = 门洞物理中心（非精灵中心，修复回归锚点）',
    a3.detectOk === true, JSON.stringify(a3 && a3.detectCenter));
check('矿工站门外侧 100px（关门面）→ 门自动打开',
    a3.opened === true && a3.after && a3.after.blocking === false,
    JSON.stringify(a3 && { before: a3.before, after: a3.after, opened: a3.opened }));

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
    // 复位挥锄状态：确保采样窗口内下一次命中播 mining_start（首挥完整段），
    // 避免矿工此前已在挖矿导致首挥落在采样窗口外（2026-08-16 探针加固）
    if (sprite) {
        sprite.setData('miningSwing', false);
        sprite.setData('hamsterMining', false); // 首挥标记也复位：确保采样窗口内播 mining_start
    }
    miner._miningSwing = false;
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
    const sc = window.__phaserScene;
    const sprite = sc._companionSprites[miner.id];
    // 朝右走：起点在节点左侧，清路径强制重算（与 A2 同口径）
    miner.x = node.x - 260; miner.y = node.y + 40;
    miner._tacticalTarget = { x: node.x, y: node.y };
    miner._animState = 'idle';
    if (miner._pathManager) miner._pathManager._clearPath();
    if (sprite.anims.isPlaying) sprite.anims.stop();
    sprite.setData('hamsterWalk', false); // 强制复位起步标记，消除 idle 帧竞态
    await sleep(350);
    const k1 = sprite.anims.isPlaying ? sprite.anims.currentAnim.key : null;
    const anim1 = miner._animState; // 起步时刻状态（行走两段式判定用，末尾可能已到矿点采矿）
    await sleep(1300);
    const k2 = sprite.anims.isPlaying ? sprite.anims.currentAnim.key : null;
    // 连续采样 2s：断言「移动时始终朝向移动方向」——vx>0 必朝右、vx<0 必朝左，不倒退。
    // 固定时刻采样会撞上寻路绕障转向瞬间，改按不变量校验（2026-08-15 探针加固）。
    const rightSamples = [];
    for (let i = 0; i < 10; i++) {
        await sleep(200);
        rightSamples.push({ vx: Math.round(miner.vx), flipX: !!sprite.flipX, anim: miner._animState });
        if (miner._animState === 'mining') break;
    }
    const rightMoved = rightSamples.some(s => s.vx > 5);
    const rightFacingOk = rightSamples.filter(s => s.vx > 5).every(s => !s.flipX);
    const rightNoBackward = rightSamples.filter(s => s.vx < -5).every(s => s.flipX);
    // 反向：起点在节点右侧朝左走
    miner.x = node.x + 260; miner.y = node.y - 40;
    miner._tacticalTarget = { x: node.x, y: node.y };
    miner._animState = 'idle';
    if (miner._pathManager) miner._pathManager._clearPath();
    sprite.setData('hamsterWalk', false);
    if (sprite.anims.isPlaying) sprite.anims.stop();
    await sleep(500);
    const leftSamples = [];
    for (let i = 0; i < 10; i++) {
        await sleep(200);
        leftSamples.push({ vx: Math.round(miner.vx), flipX: !!sprite.flipX, anim: miner._animState });
        if (miner._animState === 'mining') break;
    }
    const leftMoved = leftSamples.some(s => s.vx < -5);
    const leftFacingOk = leftSamples.filter(s => s.vx < -5).every(s => s.flipX);
    const leftNoBackward = leftSamples.filter(s => s.vx > 5).every(s => !s.flipX);
    return {
        anim: anim1, k1, k2,
        rightMoved, rightFacingOk, rightNoBackward,
        leftMoved, leftFacingOk, leftNoBackward,
        rightSamples, leftSamples,
    };
})()`);
check('静止→移动先播完整 walking（walk_start）', bw.anim === 'walk' && bw.k1 === 'companion_hamster_miner_walk_start',
    `anim=${bw.anim} k1=${bw.k1}`);
check('起步后循环第 3~12 帧（walk）', bw.k2 === 'companion_hamster_miner_walk', `k2=${bw.k2}`);
check('移动始终朝向移动方向（vx>0 朝右、vx<0 朝左，不倒退）',
    bw.rightMoved === true && bw.rightFacingOk === true && bw.rightNoBackward === true
    && bw.leftMoved === true && bw.leftFacingOk === true && bw.leftNoBackward === true,
    `rightMoved=${bw.rightMoved} rightFacing=${bw.rightFacingOk}/${bw.rightNoBackward} leftMoved=${bw.leftMoved} leftFacing=${bw.leftFacingOk}/${bw.leftNoBackward}`);

// ---------- C. 只采矿（不攻击其他单位）回归：敌人贴脸也不还手 ----------
// 2026-08-16 用户口径回归：矿工只能对能源矿点攻击，不参与基地防御；
// 被怪贴脸仍继续采矿（怪可击杀它，但它不还手）。
console.log('C. 只采矿（无视敌人）+ 回采矿');
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
        targetStillNode: !!(miner.target && miner.target._isEnergyNode),
        anim: miner._animState,
        nodeDamaged: nodeBefore !== null && miner.target && miner.target.hp < nodeBefore,
    };
    window.Game.entities.delete(dummyKey);
    // 敌人消失后应回到矿点采矿
    await sleep(800);
    res.backToMining = !!(miner.target && miner.target._isEnergyNode);
    return res;
})()`);
check('敌人贴脸不还手（dummy hp 不变、不锁定敌人目标）',
    c.engageTarget === false && c.dummyHp === 500,
    `dummy hp=${c.dummyHp} anim=${c.anim}`);
check('敌人贴脸期间继续采矿（目标仍是矿点、矿点持续掉血）',
    c.targetStillNode === true && c.nodeDamaged === true,
    `target=${c.targetStillNode} nodeDamaged=${c.nodeDamaged}`);
check('敌人消失后回到矿点采矿', c.backToMining === true);

// ---------- E. 隐藏背包物流：采矿拾取 → 满后回屋卸货（idle 2s + 门开关） → 背包扩容 ----------
console.log('E. 背包物流与扩容');
const e0 = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const countDrops = () => [...window.Game.entities.values()]
        .filter(e => e && e.itemData && e.itemData.category === 'energy').length;
    // 采矿一小段时间：能量应直接装填隐藏背包（自身不产生地面掉落）
    const dropsBefore = countDrops();
    const carried0 = miner._energyCarried;
    miner.x = miner.target.x + 30; miner.y = miner.target.y;
    miner._tacticalTarget = null;
    await sleep(4500);
    return {
        carried0, carried1: miner._energyCarried, capacity: miner._energyCapacity,
        dropsBefore, dropsAfter: countDrops(),
    };
})()`);
check('采矿能量直接装填隐藏背包（自身不掉落地）', e0.carried1 > e0.carried0 && e0.dropsAfter <= e0.dropsBefore,
    `carried ${e0.carried0}→${e0.carried1} drops ${e0.dropsBefore}→${e0.dropsAfter}`);

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

// ---------- F. 玩家背包满 → 小屋暂存 → 腾出后自动补入 ----------
console.log('F. 玩家背包满 → 小屋暂存');
const f = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    const eq = window.Game.EquipManager;
    const orig = JSON.parse(JSON.stringify(eq.backpackItems));
    // 满背包非能源物品（无能量堆叠、无空槽）→ EnergyManager.addEnergy 必失败
    eq.backpackItems.length = 0;
    for (let i = 0; i < 10; i++) {
        eq.backpackItems.push({ slot: i, name: '杂物' + i, category: 'material', stack: 999, maxStack: 999 });
    }
    miner._energyCarried = 500;
    miner.x = hut.x + 20; miner.y = hut.y + 60;
    miner._tacticalTarget = null; miner._animState = 'idle';
    hut.unloadMiner(miner);
    const storedAfterUnload = hut._storedEnergy;
    const carriedAfter = miner._energyCarried;
    // 原地还原玩家背包（有空间）→ 小屋 update 自动补入
    eq.backpackItems.length = 0;
    eq.backpackItems.push(...orig);
    await sleep(1200);
    const storedAfterPush = hut._storedEnergy;
    const energyGain = eq.backpackItems.filter(i => i && i.category === 'energy')
        .reduce((s, i) => s + (i.stack || 0), 0);
    return { storedAfterUnload, carriedAfter, storedAfterPush, energyGain };
})()`);
check('玩家背包满：卸货能量暂存小屋、矿工清零', f.storedAfterUnload >= 500 && f.carriedAfter === 0,
    JSON.stringify(f));
check('背包腾出后小屋自动补入玩家（暂存清零）', f.storedAfterPush === 0 && f.energyGain >= 500,
    JSON.stringify(f));

// ---------- G. 死亡丢能量 ----------
console.log('G. 死亡丢能量');
const g = await rawEval(`(async () => {
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    miner._energyCarried = 250;
    miner.takeDamage(9999, { _faction: 'enemy' }, 'physical', true);
    return { lostNow: miner._energyCarried, dying: miner._dying };
})()`);
check('死亡时携带能量清零（丢失不返还）', g.lostNow === 0 && g.dying === true, JSON.stringify(g));

// ---------- H. 死亡补员重生（加速计时，真实流程：开门→门口生成→关门） ----------
console.log('H. 死亡补员');
const h = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    await sleep(1500); // 等死亡移除
    const before = hut.aliveMinerCount();
    // 诊断：手动触发一次补员，捕获任何抛错
    let spawnErr = null;
    try {
        hut._doorState = 'closed';
        hut._spawnWithDoor();
    } catch (e) { spawnErr = String(e && e.stack || e).slice(0, 200); }
    await sleep(3000);
    const newMiner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    return { before, after: hut.aliveMinerCount(), newMiner: !!newMiner, door: hut._doorState, spawnErr,
        minerSeq: hut._minerSeq, miners: hut.miners.length };
})()`);
check('矿工死亡后小屋补员（开门生成新矿工）', h.before === 0 && h.after === 1 && h.newMiner === true && !h.spawnErr,
    JSON.stringify(h));

// ---------- J. 真实回屋寻路（矿工自己走回小屋卸货，无传送跳变） ----------
console.log('J. 真实回屋寻路');
const j = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const miner = [...window.Game.entities.values()].find(e => e && e._isHamsterMiner && e.active);
    const hut = miner._hut;
    // 传送到基地外（门洞附近开阔处），背包塞满 → 应自己走回小屋卸货
    miner._energyCarried = miner._energyCapacity;
    miner.x = 1350; miner.y = 2150;
    miner._tacticalTarget = null; miner._animState = 'idle';
    let prevX = miner.x, prevY = miner.y, maxJump = 0;
    let arrived = false, carriedAtArrival = null;
    for (let i = 0; i < 56; i++) {
        await sleep(250);
        const jump = Math.hypot(miner.x - prevX, miner.y - prevY);
        if (jump > maxJump) maxJump = jump;
        prevX = miner.x; prevY = miner.y;
        if (!arrived && Math.hypot(miner.x - hut.x, miner.y - hut.y) <= 90) {
            arrived = true;
            carriedAtArrival = miner._energyCarried;
        }
        if (arrived && miner._energyCarried === 0) break;
    }
    return {
        maxJump: Math.round(maxJump),
        arrived,
        carriedAtArrival,
        carriedNow: miner._energyCarried,
        dist: Math.round(Math.hypot(miner.x - hut.x, miner.y - hut.y)),
    };
})()`);
check('矿工从矿点自己走回小屋卸货（无传送，maxJump < 60）',
    j.arrived === true && j.maxJump < 60 && j.carriedNow === 0,
    JSON.stringify(j));

// ---------- K. 多矿工（数量模块）并发卸货 ----------
console.log('K. 多矿工并发');
const k = await rawEval(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const { HamsterHutSystem } = await window.__imp('hamster-hut-system');
    const hut = HamsterHutSystem.huts.find(h => h && h.active);
    if (!hut) return { err: 'no hut' };
    const before = hut.aliveMinerCount();
    window.Game._devInfiniteResources = true;
    const up = hut.upgradeModule('count');
    window.Game._devInfiniteResources = false;
    await sleep(3000); // 开门动画生成第二只
    const miners = hut.miners.filter(m => m && m.active && !m._dying && m.data.hp > 0);
    const playerEnergyBefore = (window.Game.EquipManager.backpackItems || [])
        .filter(i => i && i.category === 'energy').reduce((s, i) => s + (i.stack || 0), 0);
    for (let idx = 0; idx < miners.length; idx++) {
        const m = miners[idx];
        m._energyCarried = 400;
        m.x = hut.x + (idx === 0 ? 20 : -20);
        m.y = hut.y + 60;
        m._tacticalTarget = null; m._animState = 'idle';
    }
    if (miners[0]) hut.unloadMiner(miners[0]);
    if (miners[1]) hut.unloadMiner(miners[1]);
    await sleep(500);
    const carriedNow = miners.map(m => m._energyCarried);
    const stored = hut._storedEnergy;
    const playerEnergyAfter = (window.Game.EquipManager.backpackItems || [])
        .filter(i => i && i.category === 'energy').reduce((s, i) => s + (i.stack || 0), 0);
    return { up: up.ok, before, after: hut.aliveMinerCount(), carriedNow, stored,
        gain: playerEnergyAfter - playerEnergyBefore };
})()`);
check('数量模块升级生成第二只矿工', k.up === true && k.after === 2, JSON.stringify(k));
check('两只矿工并发卸货（各自清零、能量不丢：入玩家或暂存）',
    k.carriedNow.length === 2 && k.carriedNow.every(v => v === 0) && (k.gain + k.stored) >= 800,
    JSON.stringify(k));

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

// ---------- I. 小屋被毁：暂存丢失、矿工随拆、从系统移除 ----------
console.log('I. 小屋被毁');
const i = await rawEval(`(async () => {
    const { HamsterHutSystem } = await window.__imp('hamster-hut-system');
    const hut = HamsterHutSystem.huts.find(h => h && h.active);
    if (!hut) return { err: 'no hut' };
    hut._storedEnergy = 300;
    hut.takeDamage(99999, { _faction: 'enemy' }, 'physical', true);
    // 小屋沉陷死亡（2026-08-16 推广）：BuildingSinkEffect 播完才置 active=false +
    // 从 entities 移除，这里轮询等待沉陷完成（与 D 阶段等待 dying 同口径）
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let hutGone = false;
    for (let k = 0; k < 25; k++) {
        await sleep(200);
        if (!window.Game.entities.has(hut.id)) { hutGone = true; break; }
    }
    return {
        hutGone,
        inSystem: !HamsterHutSystem.huts.includes(hut),
        minersGone: hut.miners.every(m => !m || !m.active),
        active: hut.active,
    };
})()`);
check('小屋被毁：暂存丢失、矿工随拆、从系统移除',
    i.hutGone === true && i.inSystem === true && i.minersGone === true && i.active === false,
    JSON.stringify(i));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await cleanup(fail ? 1 : 0);
