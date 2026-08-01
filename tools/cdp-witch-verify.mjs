// CDP 实机验证：巫婆 + 煮锅（2026-08-01）
// 用法: CDP_PORT=9224 node tools/cdp-witch-verify.mjs <子命令>
//   boot        —— 进游戏 → spawnMainWitch → 报告巫婆/煮锅实体与坐标
//   magic       —— 强制远程魔法攻击：第 5 帧附近截图 + 投射物统计
//   venom       —— 强制投掷毒液瓶：飞行中/毒液区截图 + 玩家中毒层数
//   death       —— 击杀巫婆：死亡动画中截图 → 定格 → 淡出后确认 sprite 销毁
//   cauldron    —— 触发煮锅投掷：双瓶 + 毒液区截图
//   shot <file> <wx> <wy> [zoom] —— 相机对准世界坐标截图
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

async function shot(cdp, file) {
    const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('tools/verify-shots', { recursive: true });
    fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(data.data, 'base64'));
    console.log('saved tools/verify-shots/' + file);
}

const BOOT = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let t0 = Date.now();
    while (!window.Game) { if (Date.now() - t0 > 30000) return { err: 'no Game' }; await sleep(200); }
    if (!window.__phaserScene) {
        const btn = document.getElementById('startGameBtn');
        if (btn) btn.click(); else window.Game.start();
    }
    t0 = Date.now();
    while (!(window.Game.player && window.__phaserScene)) {
        if (Date.now() - t0 > 90000) return { err: 'no player/scene' };
        await sleep(400);
    }
    await sleep(1200);
    if (typeof window.Game.spawnMainWitch !== 'function') return { err: 'no spawnMainWitch' };
    window.Game.spawnMainWitch();
    await sleep(1500); // 等伴生煮锅生成
    const witch = window.Game.entities.get('enemy_main_witch');
    let cauldron = null, ck = null;
    for (const [k, e] of window.Game.entities) {
        if (k.startsWith('cauldron_')) { cauldron = e; ck = k; break; }
    }
    if (!witch) return { err: 'no witch entity' };
    // 玩家传送到巫婆西侧 350px（进入 800px 射程）
    const p = window.Game.player;
    p.x = witch.x - 350; p.y = witch.y;
    await sleep(500);
    return {
        witch: { x: Math.round(witch.x), y: Math.round(witch.y), hp: witch.hp, active: witch.active, anim: witch._animState, texture: witch._getTextureKey() },
        cauldron: cauldron ? { key: ck, x: Math.round(cauldron.x), y: Math.round(cauldron.y), hp: cauldron.hp, immune: cauldron.hasStatusEffect('statusImmune') } : null,
        player: { x: Math.round(p.x), y: Math.round(p.y) },
        camFollow: !!window.__phaserScene.cameras.main._follow,
    };
})()`;

const WITCH_STATE = `(() => {
    const w = window.Game.entities.get('enemy_main_witch');
    const s = window.__phaserScene;
    const projectiles = s.children.list.filter(c => c.texture && c.texture.key === 'projectile_poison_maggot').length;
    const bottles = s.children.list.filter(c => c.texture && c.texture.key === 'enemy_witch_projectile').length;
    const p = window.Game.player;
    let cauldron = null;
    for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { cauldron = e; break; } }
    return {
        witch: w ? { anim: w._animState, attack: w._attackType, texture: w._getTextureKey(), spriteFrame: w._phaserSprite ? w._phaserSprite.frame.name : null, active: w.active, zones: (w._venomZones || []).length } : null,
        cauldron: cauldron ? { zones: (cauldron._venomZones || []).length, bottleTimer: Math.round(cauldron._bottleTimer) } : null,
        projectiles, bottles,
        playerPoison: p ? (p._poisonStacks || 0) : null,
        playerHp: p ? Math.round(p.hp) : null,
    };
})()`;

// 强制下一次攻击为远程魔法（毒液瓶冷却拉长）
const FORCE_MAGIC = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const w = window.Game.entities.get('enemy_main_witch');
    if (!w || !w.active) return { err: 'no witch' };
    w._venomCd = 60000; w._magicCd = 0;
    // 等攻击触发（预警 ~500ms 内）
    const t0 = Date.now();
    while (w._attackType !== 'magic') { if (Date.now() - t0 > 8000) return { err: 'magic not triggered', state: w._animState }; await sleep(50); }
    // 等到第 5 帧出手（duration 1500 × 5/14 ≈ 536ms），在 400~700ms 窗口抓投射物
    await sleep(620);
    return ${WITCH_STATE};
})()`;

// 强制下一次攻击为投掷毒液瓶
const FORCE_VENOM = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const w = window.Game.entities.get('enemy_main_witch');
    if (!w || !w.active) return { err: 'no witch' };
    w._magicCd = 60000; w._venomCd = 0;
    const t0 = Date.now();
    while (w._attackType !== 'venom') { if (Date.now() - t0 > 8000) return { err: 'venom not triggered', state: w._animState }; await sleep(50); }
    // 第 9 帧出手（1500 × 9/18 = 750ms），抓飞行中的毒液瓶
    await sleep(950);
    return ${WITCH_STATE};
})()`;

const VENOM_ZONE_WAIT = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 等瓶落地（flyDuration 1500）+ 毒液区扩散
    await sleep(1800);
    return ${WITCH_STATE};
})()`;

const KILL_WITCH = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const w = window.Game.entities.get('enemy_main_witch');
    if (!w) return { err: 'no witch' };
    w.takeDamage(999999, window.Game.player, 'physical', true);
    await sleep(800); // 死亡动画中段（1500ms 共 17 帧）
    return ${WITCH_STATE};
})()`;

const DEATH_HOLD = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1200); // 动画播完 → 定格段
    const w = window.Game.entities.get('enemy_main_witch');
    return { corpse: w ? { anim: w._animState, sprite: !!(w._phaserSprite && w._phaserSprite.active), corpseTimer: Math.round(w._corpseTimer), alpha: w._phaserSprite ? w._phaserSprite.alpha : null } : null };
})()`;

const DEATH_FADE = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1800); // 定格 1s + 淡出 0.3s 之后
    const w = window.Game.entities.get('enemy_main_witch');
    return { spriteGone: w ? !(w._phaserSprite && w._phaserSprite.active) : null, active: w ? w.active : null };
})()`;

const TRIGGER_CAULDRON = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let c = null;
    for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c = e; break; } }
    if (!c) return { err: 'no cauldron' };
    c._bottleTimer = 100;
    await sleep(1200); // 出手 + 瓶飞行中
    return ${WITCH_STATE};
})()`;

const CAULDRON_ZONE = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1800); // 落地成区
    return ${WITCH_STATE};
})()`;

async function main() {
    const cmd = process.argv[2];
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    if (cmd === 'boot') {
        console.log(JSON.stringify(await ev(cdp, BOOT), null, 1));
    } else if (cmd === 'state') {
        console.log(JSON.stringify(await ev(cdp, WITCH_STATE), null, 1));
    } else if (cmd === 'magic') {
        console.log(JSON.stringify(await ev(cdp, FORCE_MAGIC), null, 1));
        await ev(cdp, `(() => { const w = window.Game.entities.get('enemy_main_witch'); const cam = window.__phaserScene.cameras.main; cam.stopFollow(); cam.setZoom(1); cam.centerOn(w.x - 100, w.y - 50); return 1; })()`);
        await shot(cdp, 'witch-magic-projectiles.png');
    } else if (cmd === 'venom') {
        console.log(JSON.stringify(await ev(cdp, FORCE_VENOM), null, 1));
        await ev(cdp, `(() => { const w = window.Game.entities.get('enemy_main_witch'); const cam = window.__phaserScene.cameras.main; cam.stopFollow(); cam.setZoom(1); cam.centerOn(w.x - 150, w.y - 50); return 1; })()`);
        await shot(cdp, 'witch-venom-flight.png');
        console.log(JSON.stringify(await ev(cdp, VENOM_ZONE_WAIT), null, 1));
        await shot(cdp, 'witch-venom-zone.png');
    } else if (cmd === 'death') {
        console.log(JSON.stringify(await ev(cdp, KILL_WITCH), null, 1));
        await ev(cdp, `(() => { const w = window.Game.entities.get('enemy_main_witch'); const cam = window.__phaserScene.cameras.main; cam.stopFollow(); cam.setZoom(1); cam.centerOn(w.x, w.y - 50); return 1; })()`);
        await shot(cdp, 'witch-death-anim.png');
        console.log(JSON.stringify(await ev(cdp, DEATH_HOLD), null, 1));
        await shot(cdp, 'witch-death-hold.png');
        console.log(JSON.stringify(await ev(cdp, DEATH_FADE), null, 1));
        await shot(cdp, 'witch-death-faded.png');
    } else if (cmd === 'cauldron') {
        console.log(JSON.stringify(await ev(cdp, TRIGGER_CAULDRON), null, 1));
        await ev(cdp, `(() => { let c=null; for (const [k,e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c=e; break; } } const cam = window.__phaserScene.cameras.main; cam.stopFollow(); cam.setZoom(1); cam.centerOn(c.x, c.y - 50); return 1; })()`);
        await shot(cdp, 'cauldron-bottles.png');
        console.log(JSON.stringify(await ev(cdp, CAULDRON_ZONE), null, 1));
        await shot(cdp, 'cauldron-zone.png');
    } else if (cmd === 'shot') {
        const [file, wx, wy, zoom] = process.argv.slice(3);
        await ev(cdp, `(async () => {
            const cam = window.__phaserScene.cameras.main;
            cam.stopFollow(); cam.setZoom(${Number(zoom) || 1}); cam.centerOn(${Number(wx)}, ${Number(wy)});
            await new Promise(r => { let i = 0; const s = () => { if (++i < 4) requestAnimationFrame(s); else r(0); }; requestAnimationFrame(s); });
            return 1;
        })()`);
        await shot(cdp, file);
    } else {
        console.log('usage: boot|state|magic|venom|death|cauldron|shot');
    }
    cdp.close();
}

main().catch(e => { console.error(e); process.exit(1); });
