// CDP 实机验证：冰墙特效（2026-08-02）
// 用法: node tools/cdp-icewall-verify.mjs <子命令>
//   boot   —— 进游戏，等玩家/场景就绪
//   spawn  —— 在玩家东侧 180px 生成一列冰墙，相机对准
//   shot <file> —— 截图
//   state  —— 冰墙/fx 池/粒子状态 JSON
// 环境：vite 5174 + Edge --remote-debugging-port=9224
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
    const p = window.Game.player;
    return { player: { x: Math.round(p.x), y: Math.round(p.y), hasIceWallSystem: !!p.iceWallSystem } };
})()`;

const SPAWN = `(async () => {
    const p = window.Game.player;
    if (!p || !p.iceWallSystem) return { err: 'no iceWallSystem' };
    const eff = { segmentCount: 5, segmentWidth: 48, segmentHeight: 64, segmentGap: 8, duration: 5 };
    const aimX = p.x + 180, aimY = p.y;
    p.iceWallSystem._spawnWall(p, aimX, aimY, eff);
    const cam = window.__phaserScene.cameras.main;
    cam.stopFollow(); cam.setZoom(1.6); cam.centerOn(aimX, aimY - 30);
    return { walls: p.iceWallSystem.getWalls().length, spawnAt: Date.now() };
})()`;

const STATE = `(() => {    const p = window.Game.player;
    const s = window.__phaserScene;
    const walls = p.iceWallSystem.getWalls().map(w => ({
        x: Math.round(w.x), y: Math.round(w.y),
        age: Math.round(w.age || 0), delay: w.spawnDelay, variant: w.variant,
        remaining: Math.round(w.remaining),
    }));
    const fx = (s._iceWallFx || []).map(f => ({
        tex: f.sprite && f.sprite.texture ? f.sprite.texture.key : null,
        visible: f.sprite ? f.sprite.visible : null,
        alpha: f.sprite ? +f.sprite.alpha.toFixed(2) : null,
        scaleY: f.sprite ? +f.sprite.scaleY.toFixed(3) : null,
        depth: f.sprite ? +f.sprite.depth.toFixed(1) : null,
        frostA: f.frost ? +f.frost.alpha.toFixed(2) : null,
        mistOn: f.mist ? f.mist.emitting : null,
    }));
    return {
        wallCount: walls.length, walls, fx,
        textures: ['ice_wall_segment_0', 'ice_wall_segment_1', 'ice_wall_segment_2', 'ice_wall_segment_3', 'ice_wall_frost', 'ice_shard'].map(k => s.textures.exists(k)),
        burstAlive: s._iceWallMistBurst ? s._iceWallMistBurst.getAliveParticleCount() : -1,
        shardAlive: s._iceWallShardBurst ? s._iceWallShardBurst.getAliveParticleCount() : -1,
    };
})()`;

// 清空现存冰墙（fx 池下一帧自动回收）
const CLEAR = `(() => {
    const p = window.Game.player;
    if (!p || !p.iceWallSystem) return { err: 'no iceWallSystem' };
    p.iceWallSystem._walls.length = 0;
    return { cleared: true };
})()`;

// 手动泵 N 帧（headless/后台 rAF 冻结时用 game.step 驱动；渲染 stub 加速，截图前 unpatch）
const PUMP = `(async (FRAMES) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const G = window.PhaserGame && window.PhaserGame.game;
    if (!G) return { err: 'no PhaserGame.game' };
    if (!G.__renderPatched) {
        G.__renderPatched = true;
        G.__origRender = G.renderer.render;
        G.renderer.render = function () {};
        window.__unpatchRender = () => { G.renderer.render = G.__origRender; G.__renderPatched = false; };
    }
    const pump = (n) => { const t = G.loop.time; for (let i = 0; i < n; i++) G.step(t + (i + 1) * 16.67, 16.67); };
    let left = FRAMES;
    while (left > 0) { const n = Math.min(left, 30); pump(n); left -= n; await sleep(20); }
    const p = window.Game.player;
    const w = p && p.iceWallSystem ? p.iceWallSystem.getWalls() : [];
    return { pumped: FRAMES, walls: w.length, age0: w[0] ? Math.round(w[0].age) : null, rem0: w[0] ? Math.round(w[0].remaining) : null };
})`;

const UNPATCH = `(() => { if (window.__unpatchRender) window.__unpatchRender(); return 1; })()`;

async function main() {
    const cmd = process.argv[2];
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    if (cmd === 'boot') {
        console.log(JSON.stringify(await ev(cdp, BOOT), null, 1));
    } else if (cmd === 'spawn') {
        console.log(JSON.stringify(await ev(cdp, SPAWN), null, 1));
    } else if (cmd === 'clear') {
        console.log(JSON.stringify(await ev(cdp, CLEAR), null, 1));
    } else if (cmd === 'pump') {
        console.log(JSON.stringify(await ev(cdp, `(${PUMP})(${Number(process.argv[3] || 60)})`), null, 1));
    } else if (cmd === 'unpatch') {
        console.log(JSON.stringify(await ev(cdp, UNPATCH), null, 1));
    } else if (cmd === 'state') {
        console.log(JSON.stringify(await ev(cdp, STATE), null, 1));
    } else if (cmd === 'shot') {
        await ev(cdp, UNPATCH);
        await shot(cdp, process.argv[3] || 'icewall.png');
    } else {
        console.log('usage: boot|spawn|clear|pump <frames>|unpatch|state|shot <file>');
    }
    cdp.close();
}

main().catch(e => { console.error(e); process.exit(1); });
