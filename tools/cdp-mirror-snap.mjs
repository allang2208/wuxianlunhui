#!/usr/bin/env node
/* 验证镜像(F)后拼接吸附 + 碰撞体积跟随视觉 + 摆放判定(线段模型)修复误判。
 * 用法：node tools/cdp-mirror-snap.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9233;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
// ???????? profile?2026-08-08?CDP ????? C ??
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });
console.log(`edge pid=${edge.pid}`);
await new Promise((r) => setTimeout(r, 7000));

async function fetchJson(url) { const r = await fetch(url); return r.json(); }
async function waitFor(fn, t = 25000) {
    const t0 = Date.now();
    for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > t) return null; await new Promise(r => setTimeout(r, 300)); }
}
const page = await waitFor(async () => (await fetchJson(`${CDP}/json/list`)).find(t => t.type === 'page' && t.url.includes('localhost:5173')));
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
};
await send('Runtime.enable');

let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(async () => {
        if (window.Game && window.Game.isRunning && window.Game.player) return true;
        const b = document.getElementById('startGameBtn');
        if (b && getComputedStyle(b).display !== 'none') b.click();
        return false;
    })()`).catch(() => false);
    if (!started) await new Promise(r => setTimeout(r, 500));
}
for (let i = 0; i < 50; i++) {
    const ok = await evalJs(`(async () => {
        let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
        if (!u) u = '/src/world/scene-manager.js';
        try { const { SceneManager } = await import(u); window.__sm = SceneManager; return SceneManager.currentScene || null; } catch { return null; }
    })()`).catch(() => null);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
}
await evalJs(`(async () => { await window.__sm.switchScene('scene8', window.Game.player); return true; })()`);
await new Promise((r) => setTimeout(r, 1200));

const result = await evalJs(`(async () => {
    let u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/building-system.js?'));
    if (!u) u = '/src/world/building-system.js';
    const bm = await import(u);
    const BS = bm.BuildingSystem;
    if (BS.active) BS.close();
    const out = {};
    const covers = [];
    for (const e of window.Game.entities.values()) {
        if (e && e.grade !== undefined && e.active) covers.push(e);
    }
    // 空旷锚：放到房间外，避免延续方向撞到房间墙（干净验证镜像吸附本身）
    const dc = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?')) || '/src/world/defense-system.js');
    const anchor = new dc.DefenseCover(1700, 1950, { grade: 'D', orient: 'h', id: 'probe_anchor_h' });
    window.Game.entities.set('probe_anchor_h', anchor);
    const hAnchor = anchor;

    // ---- 1) 镜像吸附：v 掩体 + F 镜像 → 有效朝向 h，应同向吸附到 h 掩体端 ----
    const itemV = bm.BUILD_ITEMS.find(i => i.id === 'cover_D_v');
    const eff = (o, m) => m ? (o === 'v' ? 'h' : 'v') : o;
    BS._selectItem(itemV);
    BS._placing.mirror = true; // F 镜像
    const eEff = eff(hAnchor.orient, hAnchor._facingLeft);
    const hSnap = eEff === 'h' ? bm.COVER_SNAP.h : bm.COVER_SNAP.v;
    // 目标：新件 R 端贴既有 h 的 L 端（同向延续）
    const targetX = hAnchor.x + hSnap.L.x - hSnap.R.x;
    const targetY = hAnchor.y + hSnap.L.y - hSnap.R.y;
    const snap = BS._snapPosition(targetX, targetY);
    out.mirrorSnap = {
        anchor: { x: Math.round(hAnchor.x), y: Math.round(hAnchor.y), orient: hAnchor.orient },
        placingEff: eff('v', true),
        target: { x: Math.round(targetX), y: Math.round(targetY) },
        snapped: snap ? { x: Math.round(snap.x), y: Math.round(snap.y), same: snap.same } : null,
        placeable: snap ? BS._canPlace(snap.x, snap.y) : false,
    };
    // 对照：不镜像（v），靠近 h 掩体应判为跨向（same=false 或吸附不同）
    BS._placing.mirror = false;
    const snapNoMirror = BS._snapPosition(targetX, targetY);
    out.noMirrorSnap = snapNoMirror ? { x: Math.round(snapNoMirror.x), y: Math.round(snapNoMirror.y), same: snapNoMirror.same } : null;
    BS._cancelPlacement();
    window.Game.entities.delete('probe_anchor_h');

    // ---- 2) 镜像碰撞体积：DefenseCover with mirror 应 h/v 互换 ----
    const cov = new dc.DefenseCover(1600, 2100, { grade: 'D', orient: 'v', mirror: true, id: 'probe_mirror' });
    out.mirrorCollision = { w: cov.collisionWidth, d: cov.collisionHeight, expect: '300x46 (h)' };
    const covNoMirror = new dc.DefenseCover(1650, 2100, { grade: 'D', orient: 'v', id: 'probe_nomirror' });
    out.noMirrorCollision = { w: covNoMirror.collisionWidth, d: covNoMirror.collisionHeight, expect: '46x300 (v)' };

    // ---- 3) 摆放判定：旧矩形模型误拒 vs 新线段模型放行 ----
    const footV = dc.COVER_FOOT.v;
    const rectOverlap = (a, b, tol) => a.minX < b.maxX - tol && a.maxX > b.minX + tol && a.minY < b.maxY - tol && a.maxY > b.minY + tol;
    const oldCanPlace = (x, y) => {
        const r = { minX: x - footV.w / 2, maxX: x + footV.w / 2, minY: y - footV.d / 2, maxY: y + footV.d / 2 };
        for (const e of covers) {
            const ew = e.collisionWidth || 46, ed = e.collisionHeight || 300;
            const er = { minX: e.x - ew / 2, maxX: e.x + ew / 2, minY: e.y - ed / 2, maxY: e.y + ed / 2 };
            if (rectOverlap(r, er, 8)) return false;
        }
        return true;
    };
    BS._selectItem(itemV);
    const fixed = [];
    let total = 0;
    for (let gx = 850; gx <= 1500; gx += 25) {
        for (let gy = 1950; gy <= 2400; gy += 25) {
            total++;
            const newOk = BS._canPlace(gx, gy);
            const oldOk = oldCanPlace(gx, gy);
            if (newOk && !oldOk) fixed.push({ x: gx, y: gy });
        }
    }
    BS._cancelPlacement();
    out.placementFix = { total, freedCount: fixed.length, samples: fixed.slice(0, 8) };
    // ---- 4) 回归：房间墙线重叠拒绝 + 门洞内自由放置（会穿两侧门柱，正确拒绝）+ 贴门柱端拼接 ----
    BS._selectItem(itemV);
    const wallHit = covers.find(e => e.orient === 'v' && Math.abs(e.x - 1300) < 5);
    out.overlapRejected = wallHit ? !BS._canPlace(wallHit.x + 10, wallHit.y + 10) : 'anchor missing';
    // 门洞中央放 209px 墙段会穿进两侧门柱墙段（真实 footprint 判定正确拒绝）
    out.doorGapRejected = !BS._canPlace(1166, 2134);
    // 空旷 v 锚：R 端外接一段（端-端拼接应放行）
    const vAnchor2 = new dc.DefenseCover(1700, 2100, { grade: 'D', orient: 'v', id: 'probe_anchor_v' });
    window.Game.entities.set('probe_anchor_v', vAnchor2);
    const vsnap = bm.COVER_SNAP.v;
    const postSnap = BS._snapPosition(vAnchor2.x + vsnap.R.x - vsnap.L.x, vAnchor2.y + vsnap.R.y - vsnap.L.y);
    out.postExtension = postSnap ? {
        x: Math.round(postSnap.x), y: Math.round(postSnap.y),
        same: postSnap.same, placeable: BS._canPlace(postSnap.x, postSnap.y),
    } : null;
    window.Game.entities.delete('probe_anchor_v');
    BS._cancelPlacement();
    return out;
})()`);
console.log(JSON.stringify(result, null, 2));
console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');
ws.close(); edge.kill();
console.log('done');
