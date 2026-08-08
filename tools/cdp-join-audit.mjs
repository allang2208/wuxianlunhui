#!/usr/bin/env node
/* 世界-122 基地菱形房 拼接缝审计 v2（2026-08-08）：
 * 用 sprite 世界包围盒 + 截图时刻的相机 scroll 精确换算屏幕坐标，
 * 对 TL/TR/LB/RB 四条边各截一张图，并把每个掩体件的屏幕框写到 JSON。
 * 用法：node tools/cdp-join-audit.mjs [outPrefix]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9267;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
const PREFIX = process.argv[2] || 'join_audit2';
fs.mkdirSync(OUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-join-audit2-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

for (let i = 0; i < 40; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        console.log('edge version:', (await r.json()).Browser);
        break;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
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
let page = null;
for (let i = 0; i < 30; i++) {
    try {
        const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        page = l.find((x) => x.type === 'page');
        if (page) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
}
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
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
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
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log('saved:', `${OUT_DIR}/${name}.png`);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173/' });
await new Promise((r) => setTimeout(r, 2500));

let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { console.error('not ready'); edge.kill(); process.exit(2); }

const entered = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const SM = (await import(pick('world/scene-manager.js'))).SceneManager;
    const p = window.Game.player;
    const out = { sceneBefore: SM.currentScene };
    if (SM.currentScene !== 'scene8') {
        try { await SM.switchScene('scene8', p, 'explore'); } catch (e) { out.err = String(e && e.stack || e); }
    }
    await new Promise((r) => setTimeout(r, 900));
    out.scene = SM.currentScene;
    return out;
})()`);
console.log('entered:', JSON.stringify(entered));

async function snapAt(label, wx, wy) {
    await evalJs(`(async () => {
        const perfs = performance.getEntriesByType('resource').map((e) => e.name);
        const pick = (name) => {
            const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
            return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
        };
        const Camera = (await import(pick('world/camera.js'))).Camera;
        const p = window.Game.player;
        p.x = ${wx}; p.y = ${wy};
        Camera.x = ${wx}; Camera.y = ${wy};
        await new Promise((r) => setTimeout(r, 350));
        Camera.x = ${wx}; Camera.y = ${wy};
        await new Promise((r) => setTimeout(r, 500));
        return true;
    })()`);
    const info = await evalJs(`(() => {
        const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
        const cam = scene ? scene.cameras.main : null;
        if (!cam) return { cam: null, items: [] };
        const covers = [...window.Game.entities.values()].filter((e) => e._isDefenseStructure && e._faceLine);
        const items = covers.map((e) => {
            const data = scene && scene._neutralSprites ? scene._neutralSprites.get(e) : null;
            const spr = data ? data.sprite : null;
            let b = null;
            if (spr && cam) {
                const bb = spr.getBounds();
                b = {
                    left: Math.round(bb.left), right: Math.round(bb.right),
                    top: Math.round(bb.top), bottom: Math.round(bb.bottom),
                    sL: Math.round(bb.left - cam.scrollX + cam.width / 2),
                    sR: Math.round(bb.right - cam.scrollX + cam.width / 2),
                    sT: Math.round(bb.top - cam.scrollY + cam.height / 2),
                    sB: Math.round(bb.bottom - cam.scrollY + cam.height / 2),
                };
            }
            return {
                id: e.id, orient: e.orient, tex: spr ? spr.texture.key : null,
                x: Math.round(e.x), y: Math.round(e.y), depth: Math.round(spr ? spr.depth * 10 : 0) / 10,
                face: e._faceLine.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) })),
                b,
            };
        });
        return {
            cam: { scrollX: Math.round(cam.scrollX * 10) / 10, scrollY: Math.round(cam.scrollY * 10) / 10, w: cam.width, h: cam.height },
            map: (() => {
                try {
                    const p00 = cam.getWorldPoint(0, 0);
                    const pc = cam.getWorldPoint(cam.width / 2, cam.height / 2);
                    return { p00: { x: Math.round(p00.x), y: Math.round(p00.y) }, pc: { x: Math.round(pc.x), y: Math.round(pc.y) } };
                } catch { return null; }
            })(),
            items,
        };
    })()`);
    await shot(`${PREFIX}_${label}`);
    return info;
}

const info = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const DefMod = await import(pick('world/defense-system.js'));
    const b = DefMod.DEFENSE_CONFIG.base;
    const room = DefMod.DEFENSE_CONFIG.room;
    return {
        base: { x: b.x, y: b.y },
        room: { rx: room.rx, ry: room.ry },
        top: { x: b.x, y: b.y - room.ry },
        right: { x: b.x + room.rx, y: b.y },
        bottom: { x: b.x, y: b.y + room.ry },
        left: { x: b.x - room.rx, y: b.y },
    };
})()`);
console.log('room:', JSON.stringify(info));

const TL = await snapAt('TL', info.top.x + 10, (info.top.y + info.left.y) / 2);
const TR = await snapAt('TR', info.top.x - 10, (info.top.y + info.right.y) / 2);
const LB = await snapAt('LB', info.bottom.x - 10, (info.bottom.y + info.left.y) / 2);
const RB = await snapAt('RB', info.bottom.x + 10, (info.bottom.y + info.right.y) / 2);
const TOP = await snapAt('corner_top', info.top.x + 10, info.top.y + 120);
const FULL = await snapAt('room_full', 900, 2048);
const CORNER_L = await snapAt('corner_L', 480, 2020);
const CORNER_R = await snapAt('corner_R', 1320, 2020);
const CORNER_B = await snapAt('corner_B', 900, 2280);

// 玩家放到左角附近，检查玩家 depth 与附近掩体 depth 的遮挡关系
const depthCheck = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = 480; p.y = 2030;
    Camera.x = 480; Camera.y = 2030;
    await new Promise((r) => setTimeout(r, 700));
    const scene = window.__phaserScene;
    const covers = [];
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine) continue;
        if (Math.abs(e.x - 388) < 200 && Math.abs(e.y - 2048) < 160) {
            const data = scene && scene._neutralSprites ? scene._neutralSprites.get(e) : null;
            const spr = data ? data.sprite : null;
            covers.push({ id: e.id, faceDepth: e._faceDepth, sprDepth: spr ? spr.depth : null, x: e.x, y: e.y });
        }
    }
    const playerSpr = scene && scene.playerSprite ? scene.playerSprite : null;
    return {
        player: { x: p.x, y: p.y, depth: playerSpr ? playerSpr.depth : null, foot: p.y },
        covers,
        cam: { x: Camera.x, y: Camera.y },
    };
})()`);
console.log('depth check at left corner:', JSON.stringify(depthCheck, null, 1));

// 沿左角从外到内走一圈，记录玩家 depth 与掩体 depth（遮挡关系）
const walk = await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    const scene = window.__phaserScene;
    const playerSpr = scene && scene.playerSprite ? scene.playerSprite : null;
    const out = [];
    const pts = [
        [300, 1990], [340, 2000], [370, 2010], [390, 2020], [410, 2030],
        [430, 2040], [460, 2050], [500, 2060], [550, 2070],
    ];
    for (const [px, py] of pts) {
        p.x = px; p.y = py;
        Camera.x = px; Camera.y = py;
        await new Promise((r) => setTimeout(r, 120));
        out.push({
            px, py,
            playerDepth: playerSpr ? Math.round(playerSpr.depth * 10) / 10 : null,
            playerSprY: playerSpr ? Math.round(playerSpr.y) : null,
        });
    }
    return out;
})()`);
console.log('walk around left corner:', JSON.stringify(walk));

// 画标记：在每个掩体 face 端点画红/蓝方块，再截一次 TL（校验坐标系）
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((e) => e.name);
    const pick = (name) => {
        const withT = perfs.find((u) => u.includes('/src/' + name) && u.includes('?t='));
        return withT || perfs.find((u) => u.includes('/src/' + name)) || null;
    };
    const Camera = (await import(pick('world/camera.js'))).Camera;
    const p = window.Game.player;
    p.x = ${info.top.x} + 10; p.y = (${info.top.y} + ${info.left.y}) / 2;
    Camera.x = p.x; Camera.y = p.y;
    await new Promise((r) => setTimeout(r, 500));
    return true;
})()`);
await evalJs(`(() => {
    const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
    if (!scene) return false;
    if (scene._joinDebugGfx) scene._joinDebugGfx.destroy();
    const g = scene.add.graphics();
    scene._joinDebugGfx = g;
    g.setDepth(99999);
    let i = 0;
    for (const e of window.Game.entities.values()) {
        if (!e._isDefenseStructure || !e._faceLine || e._faceLine.length !== 2) continue;
        for (const pt of e._faceLine) {
            g.fillStyle(i === 0 ? 0xff0000 : 0x0000ff, 1);
            g.fillRect(pt.x - 3, pt.y - 3, 6, 6);
            i++;
        }
    }
    return true;
})()`);
await new Promise((r) => setTimeout(r, 200));
{
    const info = await evalJs(`(() => {
        const scene = window.__phaserScene || (window.Game && window.Game._phaserGame && window.Game._phaserGame.scene ? window.Game._phaserGame.scene.scenes.find((s) => s.sys && s.sys.isActive()) : null);
        const cam = scene ? scene.cameras.main : null;
        return cam ? { scrollX: Math.round(cam.scrollX * 10) / 10, scrollY: Math.round(cam.scrollY * 10) / 10 } : null;
    })()`);
    await shot(`${PREFIX}_TL_markers`);
    console.log('markers cam:', JSON.stringify(info));
}

fs.writeFileSync(`${OUT_DIR}/${PREFIX}_data.json`, JSON.stringify({
    room: info,
    shots: { TL, TR, LB, RB, TOP, FULL, CORNER_L, CORNER_R, CORNER_B },
}, null, 1));
console.log('data written');
console.log('errs:', errs.slice(0, 5));
edge.kill();
process.exit(0);
