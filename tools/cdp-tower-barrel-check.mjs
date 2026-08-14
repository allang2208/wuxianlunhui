#!/usr/bin/env node
/* 防御塔"枪管插进机械臂"验证：建 demo_tower + 挂 PKM → dump 武器精灵
 * （crop/origin/scale/位置）+ 多角度截图。枪管模式：只渲染前 1/3 枪管段，
 * 切口端（origin x=0）对齐臂尖，枪管从机械臂/钩子伸出。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9307;
const OUT_DIR = 'Y:/工作/无尽轮回/scratch/world122/barrel';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-barrel-'));
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); await r.json(); break; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
}
async function waitFor(fn, t = 30000, s = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > t) return null;
        await new Promise((r) => setTimeout(r, s));
    }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const page = await waitFor(async () => {
    const l = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    return l && l.find((x) => x.type === 'page');
});
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250)}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = `${OUT_DIR}/${name}.png`;
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    console.log('saved', p);
}
const sceneApi = `(window.SceneManager || (await import('/src/world/scene-manager.js')).SceneManager)`;

await send('Runtime.enable');
await send('Page.enable');
let ready = false;
for (let i = 0; i < 50; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

await evalJs(`(async () => {
    const sm = ${sceneApi};
    if (typeof sm.init === 'function' && (!sm.scenes || !sm.scenes.scene8)) sm.init();
    await sm.switchScene('scene8', window.Game.player);
    return true;
})()`);
await evalJs(`(async () => {
    const raw = window.DefenseSystem || (await import('/src/world/defense-system.js')).DefenseSystem;
    const ds = raw.DefenseSystem || raw;
    if (!ds.active && window.Game && window.Game.player) ds.setup(window.Game.player);
    return ds.active;
})()`);
// 就绪重试：vite 热更新可能让页面中途重载，等待 window.Game.entities 可用
for (let i = 0; i < 30; i++) {
    const ok = await evalJs(`!!(window.Game && window.Game.entities && window.Game.entities.set)`);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
}

// 霰弹两项校验放最前（就绪后立即跑，避免被 vite 热重载打断）
console.log('--- shotgun ammo/reload checks ---');
console.log(JSON.stringify(await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const out = {};
    // Super90：单发装填、一次击发扣 1、333ms 间隔
    {
        const t = new DefenseTower(1200, 1900, { id: 's90_test' });
        window.Game.entities.set('s90_test', t);
        t.aimAngle = 0.5;
        t._updateAim = () => {};
        t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.super90)));
        const st = t._ammoState.weapon;
        out.s90_init = { max: st.max, current: st.current };
        t._fireBlast(1500, 1800, window.Game.entities, 6);
        out.s90_afterBlast = { current: st.current, cooldown: t.attacks[t._attackKey].cooldown, maxCd: t.attacks[t._attackKey].maxCooldown };
        for (let i = 0; i < 20 && !st.reloading; i++) t._fireBlast(1500, 1800, window.Game.entities, 6);
        const perShell = [];
        for (let i = 0; i < 10 && st.reloading; i++) { t._updateReload(400); perShell.push(st.current); }
        out.s90_reload = { emptied: st.current === 0 || perShell[0] === 1, perShell, full: st.current, reloading: st.reloading };
        window.Game.entities.delete('s90_test');
    }
    // SAIGA-12K：整匣 12、4 弹丸/击发扣 1、150ms、整匣换弹
    {
        const t = new DefenseTower(1200, 1950, { id: 's12_test' });
        window.Game.entities.set('s12_test', t);
        t.aimAngle = 0.5;
        t._updateAim = () => {};
        t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.saiga12k)));
        const st = t._ammoState.weapon;
        out.s12_init = { max: st.max, current: st.current };
        const orig = t.fireProjectile.bind(t);
        let pellets = 0;
        t.fireProjectile = (tx, ty, ents, cfg) => { pellets++; return orig(tx, ty, ents, cfg); };
        t._fireBlast(1500, 1800, window.Game.entities, t.weaponItem.pelletCount || 4);
        t.fireProjectile = orig;
        out.s12_afterBlast = { current: st.current, pellets, cooldown: t.attacks[t._attackKey].cooldown, maxCd: t.attacks[t._attackKey].maxCooldown };
        for (let i = 0; i < 20 && !st.reloading; i++) t._fireBlast(1500, 1800, window.Game.entities, 4);
        t._updateReload(1999);
        out.s12_midReload = { current: st.current, reloading: st.reloading };
        t._updateReload(1);
        out.s12_afterReload = { current: st.current, reloading: st.reloading };
        window.Game.entities.delete('s12_test');
    }
    return out;
})()`), null, 1));

await evalJs(`(async () => {
    const { DefenseTower } = await import('/src/world/defense-system.js');
    const t = new DefenseTower(1300, 1850, { id: 'demo_tower' });
    window.Game.entities.set('demo_tower', t);
    t.aimAngle = 0.5;
    t._updateAim = () => {};
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.pkm)));
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 900))`);

const dumpExpr = `(async () => {
    const mod = await import('/src/world/defense-system.js');
    const V = mod.DEFENSE_TOWER_VISUAL;
    const scene = window.__phaserScene;
    const t = window.Game.entities.get('demo_tower');
    const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
    const w = sp ? sp.weapon : null;
    return {
        barrelCfg: V.weapon.barrel && V.weapon.barrel.pkm,
        weapon: w ? {
            tex: w.texture.key,
            isCropped: w.isCropped,
            frame: [w.frame.width, w.frame.height],
            origin: [w.originX, w.originY],
            x: +w.x.toFixed(2), y: +w.y.toFixed(2),
            disp: [w.displayWidth, w.displayHeight],
            rot: +w.rotation.toFixed(4),
            scale: [w.scaleX, w.scaleY],
            flipY: w.flipY,
            depth: w.depth,
        } : null,
        camera: scene ? (() => { const c = scene.cameras.main; return [c.scrollX, c.scrollY, c.zoom]; })() : null,
        tower: t ? { x: t.x, y: t.y, aim: +t.aimAngle.toFixed(3) } : null,
    };
})()`;

console.log('--- barrel dump (aim=0.5) ---');
console.log(JSON.stringify(await evalJs(dumpExpr), null, 1));

// 全武器截取校验：逐个装载 barrel 配置里的武器，确认 sprite 被裁剪
console.log('--- all-weapon barrel check ---');
console.log(JSON.stringify(await evalJs(`(async () => {
    const mod = await import('/src/world/defense-system.js');
    const V = mod.DEFENSE_TOWER_VISUAL;
    const { DefenseTower } = mod;
    const scene = window.__phaserScene;
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    const out = [];
    for (const wid of Object.keys(V.weapon.barrel || {})) {
        const item = Object.values(eq.equipment).find((e) => e && e.weaponId === wid);
        if (!item) { out.push({ wid, item: 'missing' }); continue; }
        const t = new DefenseTower(1200, 1850, { id: 'barrel_' + wid });
        window.Game.entities.set('barrel_' + wid, t);
        t.aimAngle = 0.5;
        t._updateAim = () => {};
        t.equipWeapon(JSON.parse(JSON.stringify(item)));
        await new Promise((r) => setTimeout(r, 60));
        const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
        const w = sp ? sp.weapon : null;
        out.push({
            wid, type: item.weaponType,
            tex: w ? w.texture.key : null,
            cropped: w ? w.isCropped : null,
            origin: w ? [w.originX, w.originY] : null,
            scale: w ? +w.scaleX.toFixed(4) : null,
            cfg: V.weapon.barrel[wid],
        });
        window.Game.entities.delete('barrel_' + wid);
    }
    return out;
})()`), null, 1));

// 开火位置校验：塔与枪口之间放掩体段，塔开火 → 弹丸应在枪管尖端，而非塔脚
console.log('--- muzzle position check ---');
console.log(JSON.stringify(await evalJs(`(async () => {
    const t = window.Game.entities.get('demo_tower');
    const WallSystem = (await import('/src/world/wall-system.js')).WallSystem;
    // 塔在 (1300,1850)，aim=0 枪口 ≈ (1413, 1615)；在 x=1390 放一条掩体段挡在中间
    const seg = { x1: 1390, y1: 1550, x2: 1390, y2: 1850, halfThick: 26, _cover: true };
    WallSystem.isoSegments.push(seg);
    t.aimAngle = 0;
    t._updateAim = () => {};
    const orig = t.fireProjectile.bind(t);
    let spawn = null;
    t.fireProjectile = (tx, ty, ents, cfg) => { spawn = { x: Math.round(t.x), y: Math.round(t.y) }; return orig(tx, ty, ents, cfg); };
    t._fireShot(1800, 1615, []);
    t.fireProjectile = orig;
    const i = WallSystem.isoSegments.indexOf(seg);
    if (i >= 0) WallSystem.isoSegments.splice(i, 1);
    return { towerFoot: [1300, 1850], muzzleSpawn: spawn, atBarrelTip: !!spawn && spawn.x > 1380 && spawn.y < 1700 };
})()`), null, 1));

async function snap(aim, name) {
    const info = await evalJs(`(async () => {
        const t = window.Game.entities.get('demo_tower');
        if (t) t.aimAngle = ${aim};
        const scene = window.__phaserScene;
        const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
        const w = sp ? sp.weapon : null;
        const cam = scene ? scene.cameras.main : null;
        return {
            weapon: w ? {
                x: +w.x.toFixed(2), y: +w.y.toFixed(2),
                isCropped: w.isCropped,
                origin: [w.originX, w.originY],
                scale: [w.scaleX, w.scaleY],
                frame: [w.frame.width, w.frame.height],
                crop: w._crop ? [w._crop.x, w._crop.y, w._crop.width, w._crop.height] : null,
            } : null,
            cam: cam ? [cam.scrollX, cam.scrollY, cam.zoom] : null,
        };
    })()`);
    console.log(`[snap] ${name} aim=${aim}`, JSON.stringify(info));
    await evalJs(`new Promise((r) => setTimeout(r, 400))`);
    const cam2 = await evalJs(`(() => { const c = window.__phaserScene.cameras.main; return [c.scrollX, c.scrollY, c.zoom]; })()`);
    await shot(name);
    console.log(`[snap-after] ${name} cam2=`, JSON.stringify(cam2));
}
// 锁定相机：停 _updateCamera 并居中塔（否则玩家/相机漂移导致截图位置不可复现）
await evalJs(`(async () => {
    const scene = window.__phaserScene;
    if (scene) {
        scene._updateCamera = () => {};
        const cam = scene.cameras.main;
        cam.centerOn(1300, 1850);
        cam.setZoom(1);
    }
    const p = window.Game.player;
    if (p) { p.x = 1300; p.y = 1850; }
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 400))`);
await snap(0, 'barrel-aim0');
await snap(0.5, 'barrel-aim05');
await snap(2.5, 'barrel-aim25');

// 换能量机枪/Super90 各截一张（验证大裁剪框的枪管形态）
await evalJs(`(async () => {
    const t = window.Game.entities.get('demo_tower');
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.energy_lmg)));
    t.aimAngle = 0;
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 400))`);
await shot('barrel-energy');
await evalJs(`(async () => {
    const t = window.Game.entities.get('demo_tower');
    const eq = await fetch('/data/equipment.json').then((r) => r.json());
    t.equipWeapon(JSON.parse(JSON.stringify(eq.equipment.super90)));
    t.aimAngle = 0;
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 400))`);
await shot('barrel-super90');

// 武器可见性定位：停同步 + 隐藏武器 → 与 barrel-aim0 差异即武器实际渲染位置
await evalJs(`(async () => {
    const scene = window.__phaserScene;
    const t = window.Game.entities.get('demo_tower');
    const sp = scene._defenseSprites.get(t);
    scene._syncDefenseTowers = () => {};
    t.aimAngle = 0;
    sp.weapon.setVisible(false);
    return true;
})()`);
await evalJs(`new Promise((r) => setTimeout(r, 300))`);
await shot('weapon-off');

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close();
edge.kill();
console.log('done');
