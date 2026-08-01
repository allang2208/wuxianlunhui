// CDP 实机验证：巫婆 + 煮锅（确定性逐帧版 v2，2026-08-01）
// 背景：headless Edge 的 rAF 不触发（页面冻结），游戏循环静止；
// 用 window.PhaserGame.game.step(time, delta) 手动逐帧推进做确定性验证。
// 注意：截图先存内存、脚本结束时一次性写盘——写入 tools/verify-shots/ 会触发 vite 页面重载。
// 用法: CDP_PORT=9224 node tools/cdp-witch-verify2.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

async function getPageTarget() {
    for (let i = 0; i < 30; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find(t => t.type === 'page' && t.url.includes(URL_SUB));
            if (page) return page;
        } catch (_e) { /* retry */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('no CDP page target');
}

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0; const pending = new Map();
        ws.addEventListener('open', () => resolve({
            send(method, params = {}) {
                return new Promise((res, rej) => {
                    const mid = ++id;
                    pending.set(mid, { res, rej });
                    ws.send(JSON.stringify({ id: mid, method, params }));
                });
            },
            close() { ws.close(); }
        }));
        ws.addEventListener('message', ev => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const { res, rej } = pending.get(msg.id);
                pending.delete(msg.id);
                msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
            }
        });
        ws.addEventListener('error', reject);
    });
}

async function ev(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 2000));
    return r.result.value;
}

// 截图存内存，结束统一写盘（避免 vite watch 触发页面重载）
const shots = new Map();
async function shot(cdp, file) {
    const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
    shots.set(file, data.data);
    console.log('captured', file);
}

// 页面就绪保证：页面被 vite 重载后重新进游戏 + 生成巫婆 + 注入测试件
// （headless rAF 冻结：boot/进游戏全程用 PhaserGame.game.step 手动泵帧，泵帧时 stub 渲染提速）
const ENSURE_READY = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 已就绪则直接返回
    if (window.__witchTest && window.Game && window.Game.entities && window.Game.entities.get('enemy_main_witch')) {
        return { ok: true, reused: true };
    }
    let t0 = Date.now();
    while (!window.Game) { if (Date.now() - t0 > 60000) return { err: 'no Game' }; await sleep(300); }
    // 等 PhaserGame.game 就绪（vite 冷加载 + Phaser 初始化需要时间）；
    // 若 wrapper 存在但 game 未创建（尚未 init），先点开始触发初始化
    t0 = Date.now();
    let clicked = false;
    while (!(window.PhaserGame && window.PhaserGame.game)) {
        if (Date.now() - t0 > 120000) return { err: 'no PhaserGame.game after 120s', hasPG: !!window.PhaserGame };
        if (!clicked && Date.now() - t0 > 8000) {
            clicked = true;
            const btn = document.getElementById('startGameBtn');
            if (btn) btn.click();
        }
        await sleep(500);
    }
    const G = window.PhaserGame.game;
    // 声音钩子：playFile 走 new Audio(path).play()，钩 Audio.prototype.play 记录 src
    if (!window.__soundHooked) {
        window.__soundHooked = true;
        window.__soundLog = [];
        const origPlay = Audio.prototype.play;
        Audio.prototype.play = function () {
            try { window.__soundLog.push(this.src); } catch (_) {}
            return origPlay.call(this);
        };
    }
    // 泵帧时 stub 渲染（SwiftShader 软渲染太慢），截图前 __unpatchRender 恢复
    if (!G.__renderPatched) {
        G.__renderPatched = true;
        G.__origRender = G.renderer.render;
        G.renderer.render = function () {};
        window.__unpatchRender = () => { G.renderer.render = G.__origRender; };
    }
    const pump = (n) => { const t = G.loop.time; for (let i = 0; i < n; i++) G.step(t + (i + 1) * 16.67, 16.67); };
    if (!window.__phaserScene) {
        const btn = document.getElementById('startGameBtn');
        if (btn) btn.click(); else if (typeof window.Game.start === 'function') window.Game.start();
    }
    // 手动泵帧直到玩家与 GameScene 就绪（含玩家死亡回菜单后的重开）
    t0 = Date.now();
    while (!(window.Game.player && window.__phaserScene)) {
        if (Date.now() - t0 > 120000) return { err: 'no player/scene after pump' };
        pump(30);
        await sleep(10);
        // 若停在菜单（场景全灭），再次点击开始
        if (!window.__phaserScene) {
            const btn2 = document.getElementById('startGameBtn');
            if (btn2 && btn2.offsetParent !== null) btn2.click();
            else if (typeof window.Game.start === 'function' && !window.Game.player) window.Game.start();
        }
    }
    pump(60);
    window.Game.spawnMainWitch();
    // 注入测试件
    window.__witchTest = {
        pump,
        pumpUntil(cond, maxFrames = 600) {
            for (let i = 0; i < maxFrames; i++) {
                this.pump(1);
                if (cond()) return { ok: true, frames: i + 1 };
            }
            return { ok: false, frames: maxFrames };
        },
        // 截图前准备：恢复渲染并画 2 帧
        renderFrames(n = 2) {
            window.__unpatchRender();
            pump(n);
            G.renderer.render = function () {};
        },
        witch() { return window.Game.entities.get('enemy_main_witch'); },
        cauldron() {
            for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) return e; }
            return null;
        },
        projs(texKey) {
            return window.__phaserScene.children.list.filter(c => c.texture && c.texture.key === texKey && c.active);
        },
        clearProjs(texKey) {
            for (const c of this.projs(texKey)) { c.active = false; c.visible = false; }
        },
        resetPlayer(x, y) {
            const p = window.Game.player;
            p.maxHp = Math.max(p.maxHp, 100000);
            p.hp = 100000;
            p._poisonStacks = 0; p._poisonTimer = 0; p._poisonTickTimer = 0;
            if (x !== undefined) { p.x = x; p.y = y; }
        },
        centerCam(x, y, zoom = 1) {
            const cam = window.__phaserScene.cameras.main;
            cam.stopFollow(); cam.setZoom(zoom); cam.centerOn(x, y);
        },
    };
    // 伴生煮锅生成（首次 update）
    window.__witchTest.pump(30);
    return { ok: true, rebooted: true };
})()`;

async function main() {
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const report = {};

    // 从干净状态开始（上一会话玩家可能已死亡回菜单）
    await cdp.send('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, 3000));
    console.log('ready:', JSON.stringify(await ev(cdp, ENSURE_READY)));

    // ---------- 0. 基准确认：巫婆/煮锅实体与面板数值 ----------
    report.entities = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch(), c = T.cauldron();
        return {
            witch: w ? { x: Math.round(w.x), y: Math.round(w.y), hp: w.hp, atk: w.data.atk, matk: w.data.matk, def: w.data.def, mdef: w.data.mdef, crit: w.data.crit, speed: w.maxSpeed, rank: w.rank } : null,
            cauldron: c ? { x: Math.round(c.x), y: Math.round(c.y), hp: c.hp, matk: c.data.matk, immune: c.hasStatusEffect('statusImmune'), speed: c.maxSpeed } : null,
        };
    })()`);
    console.log('entities:', JSON.stringify(report.entities));

    // ---------- 1. 攻击 1：第 5 帧三投射物 + attacking.mp3 ----------
    report.magic = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.resetPlayer(w.x - 400, w.y);
        T.clearProjs('projectile_poison_maggot'); // 清残留，只数本次
        w._venomCd = 999999; w._magicCd = 0; w._attackType = null;
        if (window.__soundLog) window.__soundLog.length = 0;
        // 推进到魔法攻击出手（第 5 帧事件发射投射物）
        const r = T.pumpUntil(() => w._attackType === 'magic' && T.projs('projectile_poison_maggot').length >= 3, 900);
        const projs = T.projs('projectile_poison_maggot');
        return {
            triggered: r.ok, frames: r.frames,
            projectileCount: projs.length,
            witchFrame: w._phaserSprite ? w._phaserSprite.frame.name : null,
            anim: w._animState, attack: w._attackType,
            frozenDuringAttack: w._attackAnimTimer > 0 && w.vx === 0 && w.vy === 0,
            sounds: window.__soundLog ? window.__soundLog.filter(s => s.includes('witch')) : [],
        };
    })()`);
    console.log('magic:', JSON.stringify(report.magic));
    await ev(cdp, `(() => { const T = window.__witchTest; const w = T.witch(); const p = T.projs('projectile_poison_maggot'); const cx = p.length ? p[0].x : w.x - 200; const cy = p.length ? p[0].y : w.y; T.centerCam((w.x + cx) / 2, (w.y + cy) / 2 - 20, 1.6); T.renderFrames(2); return 1; })()`);
    await shot(cdp, 'witch-atk1-projectiles.png');

    // ---------- 2. 攻击 2：第 9 帧毒液瓶（第 8 帧 throwing.mp3）+ 绿雾毒区 + 叠毒 ----------
    report.venomFlight = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.resetPlayer(w.x - 400, w.y);
        T.clearProjs('enemy_witch_projectile');
        w._magicCd = 999999; w._venomCd = 0; w._attackType = null;
        if (window.__soundLog) window.__soundLog.length = 0;
        // 推进到毒液瓶出手（第 9 帧事件）
        const r = T.pumpUntil(() => w._attackType === 'venom' && T.projs('enemy_witch_projectile').length >= 1, 900);
        const bottles = T.projs('enemy_witch_projectile');
        // 推进 30 帧（0.5s）让瓶飞行并旋转（每秒 360° → 半圈）
        T.pump(30);
        return {
            triggered: r.ok, frames: r.frames,
            bottleCount: bottles.length,
            bottleRotation: bottles.length ? Math.round(bottles[0].rotation * 100) / 100 : null,
            sounds: window.__soundLog ? window.__soundLog.filter(s => s.includes('witch')) : [],
        };
    })()`);
    console.log('venomFlight:', JSON.stringify(report.venomFlight));
    await ev(cdp, `(() => { const T = window.__witchTest; const w = T.witch(); const b = T.projs('enemy_witch_projectile'); const cx = b.length ? b[0].x : w.x - 200; const cy = b.length ? b[0].y : w.y - 80; T.centerCam((w.x + cx) / 2, cy, 1.4); T.renderFrames(2); return 1; })()`);
    await shot(cdp, 'witch-atk2-bottle-flight.png');

    // 推进到落地成区，玩家站进毒区验证伤害 + 叠毒
    report.venomZone = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        const p = window.Game.player;
        const r = T.pumpUntil(() => (w._venomZones || []).length >= 1, 300);
        const zone = (w._venomZones || [])[0];
        if (!zone) return { err: 'no zone', frames: r.frames };
        T.resetPlayer(zone.x, zone.y);
        const hpBefore = p.hp;
        T.pump(75); // ~1.25s，2 次 tick
        return {
            zoneCreated: r.ok, frames: r.frames,
            zoneRadius: zone.radius, zoneTimerRemainMs: Math.round(zone.timer),
            poisonAfter: p._poisonStacks || 0,
            hpLost: Math.round(hpBefore - p.hp),
        };
    })()`);
    console.log('venomZone:', JSON.stringify(report.venomZone));
    await ev(cdp, `(() => { const T = window.__witchTest; const w = T.witch(); const z = (w._venomZones || [])[0]; if (z) T.centerCam(z.x, z.y - 10, 1.1); T.renderFrames(2); return 1; })()`);
    await shot(cdp, 'witch-atk2-venom-zone.png');

    // ---------- 3. 煮锅：每 30s 双瓶 + 双毒区 ----------
    report.cauldron = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const c = T.cauldron();
        if (!c) return { err: 'no cauldron' };
        T.resetPlayer(c.x - 400, c.y);
        T.clearProjs('enemy_witch_projectile');
        c._bottleTimer = 50; // 下一帧即触发（真实周期 30s，见 interval）
        const r = T.pumpUntil(() => T.projs('enemy_witch_projectile').length >= 2, 300);
        const bottles = T.projs('enemy_witch_projectile');
        T.pump(120); // 落地成双毒区
        return {
            triggered: r.ok, frames: r.frames,
            bottleCount: bottles.length,
            zonesAfterLanding: (c._venomZones || []).length,
            intervalMs: c._bottleInterval,
            timerResetTo: Math.round(c._bottleTimer),
        };
    })()`);
    console.log('cauldron:', JSON.stringify(report.cauldron));
    await ev(cdp, `(() => { const T = window.__witchTest; const c = T.cauldron(); const z = (c._venomZones || [])[0]; T.centerCam(z ? (c.x + z.x) / 2 : c.x, z ? z.y - 10 : c.y - 40, 1.0); T.renderFrames(2); return 1; })()`);
    await shot(cdp, 'cauldron-two-zones.png');

    // ---------- 4. 死亡三段式：动画播完停最后一帧 → 定格 1s → 淡出销毁 ----------
    report.death = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        const c = T.cauldron();
        T.resetPlayer(c ? c.x - 500 : w.x - 500, w.y + 300); // 玩家拉远
        w.takeDamage(999999, window.Game.player, 'physical', true);
        T.pump(45); // 死亡动画中段（约第 8 帧）
        const midFrame = w._phaserSprite ? w._phaserSprite.frame.name : null;
        const r = T.pumpUntil(() => w._deathAnimTimer <= 0, 300);
        const lastFrame = w._phaserSprite ? w._phaserSprite.frame.name : null;
        // 定格段 1s（60 帧）后 sprite 应仍在且不透明
        T.pump(70);
        const spriteAfterHold = !!(w._phaserSprite && w._phaserSprite.active);
        const alphaAfterHold = w._phaserSprite ? w._phaserSprite.alpha : null;
        const frameAfterHold = w._phaserSprite ? w._phaserSprite.frame.name : null;
        // 淡出段 0.3s（~20 帧）后 sprite 应销毁
        T.pump(40);
        const spriteAfterFade = !!(w._phaserSprite && w._phaserSprite.active);
        return {
            midFrame,
            deathAnimFinished: r.ok, frames: r.frames,
            lastFrame, animState: w._animState, tex: w._getTextureKey(),
            spriteAfterHold, alphaAfterHold, frameAfterHold,
            spriteAfterFade,
        };
    })()`);
    console.log('death:', JSON.stringify(report.death));

    // 死亡过程截图：重新生成巫婆再击杀（同时验证伴生唯一 key 不覆盖）
    await ev(cdp, `(() => {
        const T = window.__witchTest;
        window.Game.spawnMainWitch();
        T.pump(30);
        const w = T.witch();
        T.centerCam(w.x, w.y - 40, 1.4);
        w.takeDamage(999999, window.Game.player, 'physical', true);
        T.pump(75); // 死亡动画后段
        T.renderFrames(2);
        return 1;
    })()`);
    await shot(cdp, 'witch-death-anim.png');
    report.deathHoldShot = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.pump(40); // 动画播完 → 定格段
        T.renderFrames(2);
        return { frame: w._phaserSprite ? w._phaserSprite.frame.name : null, sprite: !!(w._phaserSprite && w._phaserSprite.active), corpseTimer: Math.round(w._corpseTimer) };
    })()`);
    await shot(cdp, 'witch-death-hold.png');
    report.deathFade = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.pump(100); // 定格 1s + 淡出 0.3s 之后
        T.renderFrames(2);
        return { spriteGone: !(w._phaserSprite && w._phaserSprite.active) };
    })()`);
    await shot(cdp, 'witch-death-faded.png');
    console.log('deathHold:', JSON.stringify(report.deathHoldShot), 'deathFade:', JSON.stringify(report.deathFade));

    // ---------- 5. 伴生唯一 key（两次 spawnMainWitch 后两口锅并存） ----------
    report.companionKeys = await ev(cdp, `(() => {
        const keys = [];
        for (const [k] of window.Game.entities) { if (k.startsWith('cauldron_')) keys.push(k); }
        return { cauldronCount: keys.length, keys: keys.slice(0, 5) };
    })()`);
    console.log('companionKeys:', JSON.stringify(report.companionKeys));

    // ---------- 统一写盘 ----------
    fs.mkdirSync('tools/verify-shots', { recursive: true });
    for (const [file, b64] of shots) {
        fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(b64, 'base64'));
    }
    console.log(`\n${shots.size} screenshots written to tools/verify-shots/`);
    console.log('==== REPORT ====');
    console.log(JSON.stringify(report, null, 1));
    cdp.close();
}

main().catch(e => { console.error(e); process.exit(1); });
