// CDP 辅助：泵帧直到 GameScene 就绪 → 生成巫婆 → 注入测试件（幂等）
// 用法: node tools/cdp-witch-ready.mjs
const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

(async () => {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page' && t.url.includes(URL_SUB));
    if (!page) throw new Error('no page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await new Promise(r => ws.addEventListener('open', r));
    await send('Runtime.enable');
    const r = await send('Runtime.evaluate', {
        expression: `(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            if (window.__witchTest && window.Game && window.Game.entities && window.Game.entities.get('enemy_main_witch')) {
                return { ok: true, reused: true };
            }
            let t0 = Date.now();
            while (!(window.PhaserGame && window.PhaserGame.game)) {
                if (Date.now() - t0 > 60000) return { err: 'no PhaserGame.game' };
                const btn = document.getElementById('startGameBtn');
                if (btn) btn.click();
                await sleep(500);
            }
            const G = window.PhaserGame.game;
            // 逻辑泵：Game.update 驱动实体/投射物/毒区/死亡计时（rAF 冻结时手动推进），
            // scene.update 驱动 Phaser 动画/补间；两者同步推进 = 一帧
            const pump = (n) => {
                const t = G.loop.time;
                for (let i = 0; i < n; i++) {
                    // 玩家未创建前（boot 阶段）只推进 Phaser 场景
                    if (window.Game.player) window.Game.update(16.67);
                    G.scene.update(t + (i + 1) * 16.67, 16.67);
                }
            };
            // 声音钩子
            if (!window.__soundHooked) {
                window.__soundHooked = true;
                window.__soundLog = [];
                const origPlay = Audio.prototype.play;
                Audio.prototype.play = function () {
                    try { window.__soundLog.push(this.src); } catch (_) {}
                    return origPlay.call(this);
                };
            }
            // 泵帧直到 GameScene 就绪（BootScene 资产加载是真实异步，边加载边泵）
            t0 = Date.now();
            while (!window.__phaserScene) {
                if (Date.now() - t0 > 240000) return { err: 'no __phaserScene after 240s pump' };
                pump(10);
                await sleep(30);
            }
            // 等玩家创建
            t0 = Date.now();
            while (!window.Game.player) {
                if (Date.now() - t0 > 60000) return { err: 'no player' };
                pump(10);
                await sleep(30);
            }
            pump(30);
            if (!window.Game.entities.get('enemy_main_witch')) window.Game.spawnMainWitch();
            window.__witchTest = {
                pump,
                pumpUntil(cond, maxFrames = 600) {
                    for (let i = 0; i < maxFrames; i++) {
                        this.pump(1);
                        if (cond()) return { ok: true, frames: i + 1 };
                    }
                    return { ok: false, frames: maxFrames };
                },
                renderFrames(n = 2) {
                    // 截图前用完整 G.step 画 n 帧（含渲染器）
                    const t = G.loop.time;
                    for (let i = 0; i < n; i++) G.step(t + (i + 1) * 16.67, 16.67);
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
            window.__witchTest.pump(30); // 伴生煮锅生成
            const w = window.Game.entities.get('enemy_main_witch');
            let ck = null;
            for (const [k] of window.Game.entities) { if (k.startsWith('cauldron_')) { ck = k; break; } }
            return { ok: true, rebooted: true, witch: !!w, cauldronKey: ck };
        })()`,
        returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
    console.log(JSON.stringify(r.result.value));
    process.exit(0);
})().catch(e => { console.error(String(e).slice(0, 800)); process.exit(1); });
