// CDP 验证：煮锅 7 烟雾排布 + 毒液瓶 ×5 尺寸（2026-08-02 三项调整）
// 用法: CDP_PORT=9224 node tools/cdp-witch-adjust.mjs
import fs from 'node:fs';

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
    const send = (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, (r) => { if (r && r.error) rej(new Error(JSON.stringify(r.error))); else res(r); });
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    await new Promise(r => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Page.enable');
    const ev = async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1200));
        return r.result.value;
    };
    const realPump = async (n) => {
        for (let i = 0; i < n; i++) await send('Page.captureScreenshot', { format: 'jpeg', quality: 20 });
    };
    const report = {};

    // ---------- 0. 配置读回 + 烟雾 emitter 排布 ----------
    report.config = await ev(`(() => {
        const T = window.__witchTest;
        const c = T.cauldron();
        const w = T.witch();
        T.pump(5); // 确保 _ensureSmoke 已惰性创建
        const ems = (c._smokeEmitters || []).map(e => ({ x: Math.round(e.x), y: Math.round(e.y), depth: Math.round(e.depth) }));
        return {
            intervalMs: c._bottleInterval,
            cauldronBottleSize: c.config.attackSkills.bottle.projectileSize,
            witchVenomSize: w.config.attackSkills.venom.projectileSize,
            smokeCount: ems.length,
            smokeEmitters: ems,
            cauldronPos: [Math.round(c.x), Math.round(c.y)],
        };
    })()`);
    console.log('config:', JSON.stringify(report.config, null, 1));

    // ---------- 1. 触发煮锅双瓶 + 真实帧推进 tween，截图 ----------
    report.bottles = await ev(`(() => {
        const T = window.__witchTest;
        const c = T.cauldron();
        T.resetPlayer(c.x - 400, c.y);
        T.clearProjs('enemy_witch_projectile');
        c._bottleTimer = 50;
        const r = T.pumpUntil(() => T.projs('enemy_witch_projectile').length >= 2, 200);
        const b = T.projs('enemy_witch_projectile');
        return {
            triggered: r.ok, frames: r.frames,
            count: b.length,
            displaySize: b.length ? [Math.round(b[0].displayWidth), Math.round(b[0].displayHeight)] : null,
        };
    })()`);
    console.log('bottles:', JSON.stringify(report.bottles));
    // 真实帧推进抛物线（tween 需真实 rAF），瓶飞至中程
    await realPump(30);
    // 相机对准煮锅 + 瓶区域
    await ev(`(() => {
        const T = window.__witchTest;
        const c = T.cauldron();
        const b = T.projs('enemy_witch_projectile');
        const bx = b.length ? b[0].x : c.x - 200;
        const by = b.length ? b[0].y : c.y - 100;
        T.centerCam((c.x + bx) / 2, (c.y + by) / 2 - 40, 1.1);
        return 1;
    })()`);
    await realPump(2);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('tools/verify-shots', { recursive: true });
    fs.writeFileSync('tools/verify-shots/cauldron-smoke-row-big-bottle.png', Buffer.from(shot.data, 'base64'));
    console.log('saved tools/verify-shots/cauldron-smoke-row-big-bottle.png');

    console.log('==== REPORT ====');
    console.log(JSON.stringify(report, null, 1));
    process.exit(0);
})().catch(e => { console.error(String(e).slice(0, 1200)); process.exit(1); });
