// CDP 实机取证 v2：双持手枪副手向左开火错位
// 用法: CDP_PORT=9223 node tools/cdp-offhand-probe.mjs [out.json]
// 前提: vite :5173 + headless Edge --remote-debugging-port（游戏页面已打开）
// v2: 不走页内动态 import（HMR 时间戳会造成模块双实例）；鼠标用 CDP 真实事件，
//     受控开火显式传 targetX/targetY（沿贴图 rotation 方向 2000px）。
import fs from 'node:fs';

const OUT = process.argv[2] || 'tools/cdp-offhand-result.json';
const PORT = Number(process.env.CDP_PORT || 9223);

async function getPageTarget() {
    for (let i = 0; i < 30; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const list = await res.json();
            const page = list.find(t => t.type === 'page' && t.url.includes('localhost:5199'));
            if (page) return page;
        } catch (_e) { /* retry */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('no CDP page target');
}

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
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
                if (msg.error) rej(new Error(JSON.stringify(msg.error)));
                else res(msg.result);
            }
        });
        ws.addEventListener('error', reject);
    });
}

async function ev(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 1500));
    return r.result.value;
}

const INSTALL = `(async () => {
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
    await sleep(1500);
    const p = window.Game.player;
    const mk = () => ({
        weaponId: 'weapon19', name: 'Beretta 93R', type: '手枪',
        category: 'weapon_ranged', rarity: 'uncommon', level: 8,
        weaponCategory: 'mainhand', weaponType: 'pistol', isTwoHanded: false,
        equipSlot: 'weapon',
        attack: { range: 700, knockback: 0, attackInterval: 225, damageType: '物理', projectileSpeed: 800 },
        attackKey: 'beretta93r', offhandAttackKey: 'beretta93rOffhand', animConfigKey: 'beretta93r',
        fireSound: 'assets/sounds/weapons/beretta93r_fire.mp3', isDarkGold: true,
        ammoConfig: { max: 999, reloadTime: 1500 }, fireMode: 'fullAuto',
        attackFormula: { base: 8, enhanceFlat: 0.75, attrs: [{ key: 'dex', base: 0.5, perEnhance: 0.1 }, { key: 'wis', base: 0.5, perEnhance: 0.15 }] },
        spreadParams: { startDelay: 0, maxTime: 0, maxAngle: 0 }
    });
    p.weaponMode = 'weapon';
    p.equipments.weapon = mk();
    p.equipments.offhand = mk();
    if (p.calculateCombatStats) p.calculateCombatStats();
    p.gameStartCooldown = 0;
    p.weaponSwitchCooldown = 0;
    if (p.data) { p.data.hp = 999999; p.data.maxHp = 999999; }

    window.__refill = () => {
        for (const slot of ['weapon', 'offhand']) {
            if (p._hasAmmo(slot)) { /* init */ }
            p._ammoState[slot].current = 999;
            p._ammoState[slot].reloading = false;
        }
        p._currentSpreadFactor = 0; p._currentSpreadMaxAngle = 0;
        p._currentSpreadFactorOff = 0; p._currentSpreadMaxAngleOff = 0;
        p.weaponSwitchCooldown = 0;
        p.gameStartCooldown = 0;
    };

    const grab = spr => spr ? {
        x: +spr.x.toFixed(2), y: +spr.y.toFixed(2),
        rotDeg: +(spr.rotation * 180 / Math.PI).toFixed(2),
        flipY: spr.flipY, flipX: spr.flipX,
        displayWidth: +spr.displayWidth.toFixed(2), displayHeight: +spr.displayHeight.toFixed(2),
        scaleX: +spr.scaleX.toFixed(4), scaleY: +spr.scaleY.toFixed(4),
        tex: spr.texture && spr.texture.key, visible: spr.visible
    } : null;

    window.__sample = () => {
        const s = window.__phaserScene;
        const mM = p._getMuzzleWorldPosition('main');
        const mO = p._getMuzzleWorldPosition('offhand');
        const rd = v => v == null ? null : +v.toFixed(2);
        return {
            aimDeg: s._effectiveAim != null ? +(s._effectiveAim * 180 / Math.PI).toFixed(2) : null,
            frozenAim: !!s._frozenAimActive,
            player: { x: rd(p.x), y: rd(p.y) },
            main: grab(s.weaponSprite),
            off: grab(s.offhandWeaponSprite),
            muzzleMain: mM ? { x: rd(mM.x), y: rd(mM.y), angDeg: +(mM.angle * 180 / Math.PI).toFixed(2) } : null,
            muzzleOff: mO ? { x: rd(mO.x), y: rd(mO.y), angDeg: +(mO.angle * 180 / Math.PI).toFixed(2) } : null
        };
    };

    // 受控开火：target 沿对应贴图当前 rotation 方向 2000px（不依赖 Renderer/Input 模块）
    window.__fire = (hand) => {
        const s = window.__phaserScene;
        window.__refill();
        const spr = hand === 'offhand' ? s.offhandWeaponSprite : s.weaponSprite;
        const m = p._getMuzzleWorldPosition(hand);
        if (!spr || !m) return { err: 'no sprite/muzzle' };
        const tx = m.x + Math.cos(spr.rotation) * 2000;
        const ty = m.y + Math.sin(spr.rotation) * 2000;
        const before = new Set(s.projectilesGroup.getChildren());
        p.rangedFireData = {
            targetX: tx, targetY: ty, entities: [],
            fireMainHand: hand === 'main', fireOffhand: hand === 'offhand',
            mainSlot: 'weapon', offhandSlot: 'offhand'
        };
        p._fireRanged(hand);
        const news = s.projectilesGroup.getChildren().filter(c => !before.has(c));
        return {
            muzzle: { x: +m.x.toFixed(2), y: +m.y.toFixed(2) },
            sprRot: +(spr.rotation * 180 / Math.PI).toFixed(2),
            spawns: news.map(c => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), rotDeg: +(c.rotation * 180 / Math.PI).toFixed(2) }))
        };
    };

    // 世界点 → client 坐标（GameScene: scrollX = Camera.x - viewW/2，与 Renderer.screenToWorld 同口径）
    window.__clientForWorld = (wx, wy) => {
        const s = window.__phaserScene;
        const cam = s.cameras.main;
        return { x: wx - cam.scrollX, y: wy - cam.scrollY };
    };
    // 当前鼠标对应的世界点（游戏 update 用同一公式）
    window.__mouseWorldFromClient = (cx, cy) => {
        const s = window.__phaserScene;
        const cam = s.cameras.main;
        return { x: cx + cam.scrollX, y: cy + cam.scrollY };
    };

    // 全场景子弹跟踪 n 帧：只报告窗口内新出现的子弹（首见位置 + 位移角）
    window.__trackAll = (frames) => new Promise(res => {
        const s = window.__phaserScene;
        const before = new Set(s.projectilesGroup.getChildren());
        const seen = new Map();
        let n = 0;
        const step = () => {
            for (const c of s.projectilesGroup.getChildren()) {
                if (before.has(c)) continue;
                if (!seen.has(c)) seen.set(c, []);
                seen.get(c).push({ x: c.x, y: c.y });
            }
            if (++n < frames) requestAnimationFrame(step);
            else {
                const out = [];
                for (const pts of seen.values()) {
                    if (pts.length >= 2) {
                        const a = pts[0], b = pts[pts.length - 1];
                        out.push({
                            sx: +a.x.toFixed(2), sy: +a.y.toFixed(2),
                            moveDeg: +(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(2)
                        });
                    } else if (pts.length === 1) {
                        out.push({ sx: +pts[0].x.toFixed(2), sy: +pts[0].y.toFixed(2), moveDeg: null });
                    }
                }
                res(out);
            }
        };
        requestAnimationFrame(step);
    });

    // 画布中心（client 坐标），供 CDP 派生鼠标事件
    window.__canvasCenter = () => {
        const c = document.getElementById('gameCanvas') || document.querySelector('canvas');
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    };
    return { ok: true, player: { x: p.x, y: p.y } };
})()`;

async function waitFrames(cdp, n) {
    await ev(cdp, `new Promise(r => { let i = 0; const s = () => { if (++i < ${n}) requestAnimationFrame(s); else r('ok'); }; requestAnimationFrame(s); })`);
}

async function main() {
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    const boot = await ev(cdp, INSTALL);
    console.log('BOOT:', JSON.stringify(boot));
    if (!boot || boot.err) process.exit(1);

    const result = {};
    for (const [label, sdx] of [['LEFT', -400], ['RIGHT', 400]]) {
        // 世界目标点（玩家左/右 400px）→ client 坐标 → CDP 移动鼠标
        const p0 = await ev(cdp, '({x: window.Game.player.x, y: window.Game.player.y})');
        let ctr = await ev(cdp, `window.__clientForWorld(${p0.x + sdx}, ${p0.y})`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ctr.x, y: ctr.y, button: 'none' });
        await waitFrames(cdp, 20);
        // 相机 aimOffset 会随鼠标偏移，二次校正
        ctr = await ev(cdp, `window.__clientForWorld(${p0.x + sdx}, ${p0.y})`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ctr.x, y: ctr.y, button: 'none' });
        await waitFrames(cdp, 20);
        const mouseWorld = await ev(cdp, `window.__mouseWorldFromClient(${ctr.x}, ${ctr.y})`);
        const pre = await ev(cdp, 'window.__sample()');
        // 受控路径：主/副手各一发，显式 target 沿贴图方向
        const fireMain = await ev(cdp, `window.__fire('main')`);
        const trackAfterMain = await ev(cdp, 'window.__trackAll(8)');
        const fireOff = await ev(cdp, `window.__fire('offhand')`);
        const trackAfterOff = await ev(cdp, 'window.__trackAll(8)');
        // 真实路径：CDP 按住右键 20 帧（副手全自动），再左键 20 帧（主手）
        const trackRealOffP = ev(cdp, 'window.__trackAll(22)');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctr.x, y: ctr.y, button: 'right', buttons: 2, clickCount: 1 });
        await waitFrames(cdp, 18);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctr.x, y: ctr.y, button: 'right', buttons: 0, clickCount: 1 });
        const realOff = await trackRealOffP;
        const trackRealMainP = ev(cdp, 'window.__trackAll(22)');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctr.x, y: ctr.y, button: 'left', buttons: 1, clickCount: 1 });
        await waitFrames(cdp, 18);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctr.x, y: ctr.y, button: 'left', buttons: 0, clickCount: 1 });
        const realMain = await trackRealMainP;
        const post = await ev(cdp, 'window.__sample()');
        result[label] = { mouseWorld, pre, fireMain, trackAfterMain, fireOff, trackAfterOff, realOff, realMain, post };
    }

    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    cdp.close();
}

main().catch(e => { console.error(e); process.exit(1); });
