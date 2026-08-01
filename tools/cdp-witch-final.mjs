// CDP 实机验证（收尾）：毒液区落地 + 煮锅双区 + 死亡定格/淡出截图
// 抛物线投射物走 Phaser tween（真实 rAF 驱动），这里用 captureScreenshot BeginFrame 泵真实帧。
// 用法: CDP_PORT=9224 node tools/cdp-witch-final.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

async function main() {
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
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
        return r.result.value;
    };
    // 真实帧泵：每次 captureScreenshot = 1 BeginFrame = rAF 触发（Game.loop + Phaser loop 自然推进）
    const realPump = async (n) => {
        for (let i = 0; i < n; i++) {
            await send('Page.captureScreenshot', { format: 'jpeg', quality: 20 });
        }
    };
    const shots = new Map();
    const shot = async (file) => {
        const data = await send('Page.captureScreenshot', { format: 'png' });
        shots.set(file, data.data);
        console.log('captured', file);
    };
    const report = {};

    // ---------- 1. 巫婆毒液区：重生 → 强制攻击 2 → 真实帧泵到落地 ----------
    report.venomZone = await ev(`(() => {
        const T = window.__witchTest;
        if (!window.Game.entities.get('enemy_main_witch')) window.Game.spawnMainWitch();
        T.pump(10);
        const w = T.witch();
        T.resetPlayer(w.x - 400, w.y);
        T.clearProjs('enemy_witch_projectile');
        w._magicCd = 999999; w._venomCd = 0; w._attackType = null;
        // 双泵推进到毒液瓶出手
        const r = T.pumpUntil(() => w._attackType === 'venom' && T.projs('enemy_witch_projectile').length >= 1, 600);
        return { bottleFired: r.ok, frames: r.frames };
    })()`);
    console.log('bottle:', JSON.stringify(report.venomZone));
    // 真实帧泵：tween 完成（1.5s ≈ 90 帧）→ 落地成区
    for (let round = 0; round < 6; round++) {
        await realPump(30);
        const z = await ev(`(() => { const w = window.Game.entities.get('enemy_main_witch'); return { zones: (w._venomZones || []).length }; })()`);
        if (z.zones >= 1) break;
    }
    report.venomZoneLanding = await ev(`(() => {
        const w = window.Game.entities.get('enemy_main_witch');
        const z = (w._venomZones || [])[0];
        return z ? { landed: true, radius: z.radius, timerRemainMs: Math.round(z.timer) } : { landed: false };
    })()`);
    console.log('zoneLanding:', JSON.stringify(report.venomZoneLanding));

    // ---------- 2. 玩家站进毒区：真实帧泵验证伤害 + 叠毒 ----------
    report.zoneTick = await ev(`(() => {
        const T = window.__witchTest;
        const w = T.witch();
        const z = (w._venomZones || [])[0];
        if (!z) return { err: 'no zone' };
        T.resetPlayer(z.x, z.y);
        const p = window.Game.player;
        window.__zoneTickProbe = { hp0: p.hp, poison0: p._poisonStacks || 0, zx: z.x, zy: z.y };
        return { ok: true, hp0: Math.round(p.hp) };
    })()`);
    await realPump(60); // ~1s，≥2 次 tick
    report.zoneTickAfter = await ev(`(() => {
        const p = window.Game.player;
        const pr = window.__zoneTickProbe;
        return {
            hpLost: Math.round(pr.hp0 - p.hp),
            poisonStacks: p._poisonStacks || 0,
            playerInZone: Math.round(Math.hypot(p.x - pr.zx, p.y - pr.zy)),
        };
    })()`);
    console.log('zoneTick:', JSON.stringify(report.zoneTickAfter));
    await ev(`(() => { const T = window.__witchTest; const w = T.witch(); const z = (w._venomZones || [])[0]; if (z) T.centerCam(z.x, z.y - 10, 1.1); return 1; })()`);
    await realPump(2);
    await shot('witch-atk2-venom-zone.png');

    // ---------- 3. 煮锅双毒区 ----------
    report.cauldronZones = await ev(`(() => {
        const T = window.__witchTest;
        let c = null;
        for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c = e; break; } }
        if (!c) return { err: 'no cauldron' };
        T.resetPlayer(c.x - 400, c.y);
        T.clearProjs('enemy_witch_projectile');
        c._bottleTimer = 50;
        const r = T.pumpUntil(() => T.projs('enemy_witch_projectile').length >= 2, 200);
        return { bottleCount: r.ok ? 2 : T.projs('enemy_witch_projectile').length, frames: r.frames };
    })()`);
    console.log('cauldronBottles:', JSON.stringify(report.cauldronZones));
    for (let round = 0; round < 6; round++) {
        await realPump(30);
        const z = await ev(`(() => { let c = null; for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c = e; break; } } return { zones: c ? (c._venomZones || []).length : -1 }; })()`);
        if (z.zones >= 2) break;
    }
    report.cauldronZonesAfter = await ev(`(() => {
        let c = null;
        for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c = e; break; } }
        return { zones: c ? (c._venomZones || []).length : -1, radii: c ? (c._venomZones || []).map(z => z.radius) : [] };
    })()`);
    console.log('cauldronZones:', JSON.stringify(report.cauldronZonesAfter));
    await ev(`(() => { const T = window.__witchTest; let c = null; for (const [k, e] of window.Game.entities) { if (k.startsWith('cauldron_')) { c = e; break; } } const z = (c._venomZones || [])[0]; T.centerCam(z ? (c.x + z.x) / 2 : c.x, z ? z.y - 10 : c.y - 40, 1.0); return 1; })()`);
    await realPump(2);
    await shot('cauldron-two-zones.png');

    // ---------- 4. 死亡定格/淡出截图（重生巫婆再击杀，带守卫） ----------
    await ev(`(() => {
        const T = window.__witchTest;
        window.Game.spawnMainWitch();
        T.pump(10);
        const w = T.witch();
        T.centerCam(w.x, w.y - 40, 1.4);
        w.takeDamage(999999, window.Game.player, 'physical', true);
        T.pump(75); // 死亡动画后段（双泵同时推进动画与死亡计时）
        return 1;
    })()`);
    await realPump(2);
    await shot('witch-death-anim.png');
    report.deathHold = await ev(`(() => {
        const T = window.__witchTest;
        const w = T.witch();
        if (!w) return { err: 'witch removed early' };
        T.pump(50); // 动画播完 → 定格段
        return {
            frame: w._phaserSprite ? w._phaserSprite.frame.name : null,
            sprite: !!(w._phaserSprite && w._phaserSprite.active),
            corpseTimer: Math.round(w._corpseTimer),
            anim: w._animState,
        };
    })()`);
    console.log('deathHold:', JSON.stringify(report.deathHold));
    await realPump(2);
    await shot('witch-death-hold.png');
    report.deathFade = await ev(`(() => {
        const T = window.__witchTest;
        const w = T.witch();
        if (!w) return { removed: true, note: '淡出完成后实体被 game 清理（符合既有死亡流程）' };
        T.pump(110); // 定格 1s + 淡出 0.3s 之后
        return { spriteGone: !(w._phaserSprite && w._phaserSprite.active), active: w.active };
    })()`);
    console.log('deathFade:', JSON.stringify(report.deathFade));
    await realPump(2);
    await shot('witch-death-faded.png');

    // ---------- 5. 伴生唯一 key ----------
    report.companionKeys = await ev(`(() => {
        const keys = [];
        for (const [k] of window.Game.entities) { if (k.startsWith('cauldron_')) keys.push(k); }
        return { cauldronCount: keys.length, keys: keys.slice(0, 6) };
    })()`);
    console.log('companionKeys:', JSON.stringify(report.companionKeys));

    fs.mkdirSync('tools/verify-shots', { recursive: true });
    for (const [file, b64] of shots) {
        fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(b64, 'base64'));
    }
    console.log(`\n${shots.size} screenshots written`);
    console.log('==== REPORT ====');
    console.log(JSON.stringify(report, null, 1));
    process.exit(0);
}

main().catch(e => { console.error(String(e).slice(0, 1500)); process.exit(1); });
