// CDP 实机验证：巫婆 + 煮锅（阶段执行，需先跑 cdp-witch-ready.mjs）
// 用法: CDP_PORT=9224 node tools/cdp-witch-stages.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

async function getPageTarget() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page' && t.url.includes(URL_SUB));
    if (!page) throw new Error('no page');
    return page;
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

async function main() {
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    const report = {};

    const ready = await ev(cdp, `({ ok: !!window.__witchTest, witch: !!(window.Game && window.Game.entities && window.Game.entities.get('enemy_main_witch')) })`);
    console.log('ready:', JSON.stringify(ready));
    if (!ready.ok || !ready.witch) throw new Error('not ready: run tools/cdp-witch-ready.mjs first');

    // ---------- 0. 基准确认 ----------
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
        T.clearProjs('projectile_poison_maggot');
        w._venomCd = 999999; w._magicCd = 0; w._attackType = null;
        if (window.__soundLog) window.__soundLog.length = 0;
        const r = T.pumpUntil(() => w._attackType === 'magic' && T.projs('projectile_poison_maggot').length >= 3, 600);
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

    // ---------- 2. 攻击 2：第 9 帧毒液瓶（第 8 帧 throwing.mp3） ----------
    report.venomFlight = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.resetPlayer(w.x - 400, w.y);
        T.clearProjs('enemy_witch_projectile');
        w._magicCd = 999999; w._venomCd = 0; w._attackType = null;
        if (window.__soundLog) window.__soundLog.length = 0;
        const r = T.pumpUntil(() => w._attackType === 'venom' && T.projs('enemy_witch_projectile').length >= 1, 600);
        const bottles = T.projs('enemy_witch_projectile');
        T.pump(30); // 飞行 0.5s（每秒 360° → 转半圈）
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

    // ---------- 2b. 绿雾毒区 + 叠毒 ----------
    report.venomZone = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        const p = window.Game.player;
        const r = T.pumpUntil(() => (w._venomZones || []).length >= 1, 200);
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

    // ---------- 3. 煮锅：30s 双瓶 + 双毒区 ----------
    report.cauldron = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const c = T.cauldron();
        if (!c) return { err: 'no cauldron' };
        T.resetPlayer(c.x - 400, c.y);
        T.clearProjs('enemy_witch_projectile');
        c._bottleTimer = 50;
        const r = T.pumpUntil(() => T.projs('enemy_witch_projectile').length >= 2, 200);
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

    // ---------- 4. 死亡三段式 ----------
    report.death = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        const c = T.cauldron();
        T.resetPlayer(c ? c.x - 500 : w.x - 500, w.y + 300);
        w.takeDamage(999999, window.Game.player, 'physical', true);
        T.pump(45);
        const midFrame = w._phaserSprite ? w._phaserSprite.frame.name : null;
        const r = T.pumpUntil(() => w._deathAnimTimer <= 0, 200);
        const lastFrame = w._phaserSprite ? w._phaserSprite.frame.name : null;
        T.pump(70); // 定格 1s
        const spriteAfterHold = !!(w._phaserSprite && w._phaserSprite.active);
        const alphaAfterHold = w._phaserSprite ? w._phaserSprite.alpha : null;
        const frameAfterHold = w._phaserSprite ? w._phaserSprite.frame.name : null;
        T.pump(40); // 淡出 0.3s 之后
        const spriteAfterFade = !!(w._phaserSprite && w._phaserSprite.active);
        return {
            midFrame, deathAnimFinished: r.ok, frames: r.frames,
            lastFrame, animState: w._animState, tex: w._getTextureKey(),
            spriteAfterHold, alphaAfterHold, frameAfterHold, spriteAfterFade,
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
        T.pump(75);
        T.renderFrames(2);
        return 1;
    })()`);
    await shot(cdp, 'witch-death-anim.png');
    report.deathHoldShot = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.pump(40);
        T.renderFrames(2);
        return { frame: w._phaserSprite ? w._phaserSprite.frame.name : null, sprite: !!(w._phaserSprite && w._phaserSprite.active), corpseTimer: Math.round(w._corpseTimer) };
    })()`);
    await shot(cdp, 'witch-death-hold.png');
    report.deathFade = await ev(cdp, `(() => {
        const T = window.__witchTest;
        const w = T.witch();
        T.pump(100);
        T.renderFrames(2);
        return { spriteGone: !(w._phaserSprite && w._phaserSprite.active) };
    })()`);
    await shot(cdp, 'witch-death-faded.png');
    console.log('deathHold:', JSON.stringify(report.deathHoldShot), 'deathFade:', JSON.stringify(report.deathFade));

    // ---------- 5. 伴生唯一 key ----------
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

main().catch(e => { console.error(String(e).slice(0, 1500)); process.exit(1); });
