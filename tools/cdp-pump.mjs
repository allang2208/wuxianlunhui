// CDP 辅助：点开始 + 手动泵 N 帧（headless rAF 冻结时用 PhaserGame.game.step 驱动）
// 用法: node tools/cdp-pump.mjs [frames]  —— 打印就绪状态
const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';
const FRAMES = Number(process.argv[2] || 300);

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
            if (!window.Game) return { err: 'no Game' };
            if (!window.PhaserGame || !window.PhaserGame.game) return { err: 'no PhaserGame.game' };
            const G = window.PhaserGame.game;
            // 泵帧时 stub 渲染（headless SwiftShader 软渲染太慢），截图前用 unpatch 恢复
            if (!G.__renderPatched) {
                G.__renderPatched = true;
                G.__origRender = G.renderer.render;
                G.renderer.render = function () {};
                window.__unpatchRender = () => { G.renderer.render = G.__origRender; };
            }
            const pump = (n) => { const t = G.loop.time; for (let i = 0; i < n; i++) G.step(t + (i + 1) * 16.67, 16.67); };
            if (!window.__phaserScene) {
                const btn = document.getElementById('startGameBtn');
                if (btn) btn.click();
            }
            // 分批泵，给 DOM/计时器让路
            let left = ${FRAMES};
            while (left > 0 && !(window.Game.player && window.__phaserScene)) {
                pump(30); left -= 30;
                await sleep(50);
            }
            if (window.Game.player && window.__phaserScene) pump(left > 0 ? Math.min(left, 60) : 60);
            return {
                ready: !!(window.Game.player && window.__phaserScene),
                hasPlayer: !!window.Game.player,
                hasScene: !!window.__phaserScene,
                witch: !!(window.Game.entities && window.Game.entities.get('enemy_main_witch')),
            };
        })()`,
        returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1000));
    console.log(JSON.stringify(r.result.value));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
