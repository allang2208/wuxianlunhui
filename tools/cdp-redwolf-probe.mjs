#!/usr/bin/env node
/* 红狼王渲染诊断探针（2026-08-07）：
 * - 检查主神空间红狼王实体是否存在、Phaser sprite 是否创建、纹理键/可见性/尺寸
 * - 检查 10 个红狼王纹理键是否注册成功
 * - 截图（把红狼王临时拉到玩家旁边）
 * 前置：vite dev 已启动。用法：node tools/cdp-redwolf-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9243;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = path.join(process.cwd(), 'tools', 'verify-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-rw-'));
const gpuArgs = process.env.RW_NO_DISABLE_GPU === '1' ? [] : ['--disable-gpu'];
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    ...gpuArgs,
    `--user-data-dir=${profile}`, 'http://localhost:5173/',
], { stdio: 'ignore' });

async function waitFor(fn, t = 40000, s = 400) {
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
    const l = await fetchJson(`${CDP}/json/list`);
    return l && l.find((x) => x.type === 'page' && x.url.includes('localhost:5173'));
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
        errs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
        errs.push(`[console.warn] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (m.method === 'Log.entryAdded') {
        errs.push(`[log] ${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ? '(' + m.params.entry.url + ':' + m.params.entry.lineNumber + ')' : ''}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text} :: ${r.result.exceptionDetails.exception?.description || ''}`);
    return r.result?.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

// 重新加载页面，从加载起完整捕获异常/警告
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1500));

let ready = false;
for (let i = 0; i < 90; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await new Promise((r) => setTimeout(r, 500));
}
console.log('ready:', ready);
if (!ready) { edge.kill(); process.exit(2); }

// 等主神空间红狼王生成
let wolf = null;
for (let i = 0; i < 30; i++) {
    wolf = await evalJs(`(() => {
        const e = window.Game && window.Game.entities.get('enemy_main_red_wolf');
        return e ? { name: e.name, x: e.x, y: e.y, active: e.active, faction: e._faction } : null;
    })()`);
    if (wolf) break;
    await new Promise((r) => setTimeout(r, 500));
}
console.log('wolf entity:', JSON.stringify(wolf));

// 等 Phaser GameScene 真正就绪（BootScene 资源加载完成）
let phaserReady = false;
for (let i = 0; i < 120; i++) {
    const r = await evalJs(`!!(window.__phaserScene && window.__phaserScene.sys && window.__phaserScene.sys.isActive())`);
    if (r) { phaserReady = true; break; }
    await new Promise((r2) => setTimeout(r2, 500));
}
console.log('phaser ready:', phaserReady);
if (!phaserReady) { edge.kill(); process.exit(3); }

const detail = await evalJs(`(() => {
    const out = {};
    // Phaser 状态
    out.phaser = {
        hasGame: !!(window.PhaserGame && window.PhaserGame.game),
        isReady: !!(window.PhaserGame && window.PhaserGame.isReady),
        scene: !!window.__phaserScene,
        sceneClass: window.__phaserScene ? window.__phaserScene.constructor.name : null,
        canvasCount: document.querySelectorAll('canvas').length,
        canvasIds: Array.from(document.querySelectorAll('canvas')).map((c) => c.id),
    };
    if (window.PhaserGame && window.PhaserGame.game) {
        try {
            out.phaser.scenes = window.PhaserGame.game.scene.getScenes(true).map((s) => s.constructor.name + ':' + s.scene.key + ':' + (s.sys.isActive() ? 'active' : 'inactive'));
        } catch (e2) { out.phaser.scenesErr = String(e2); }
        try {
            out.phaser.allScenes = window.PhaserGame.game.scene.getScenes(false).map((s) => {
                const st = s.sys.settings;
                return s.constructor.name + ':' + s.scene.key + ':status=' + st.status + ':active=' + s.sys.isActive() + ':visible=' + s.sys.isVisible();
            });
        } catch (e3) { out.phaser.allScenesErr = String(e3); }
        out.phaser.isBooted = window.PhaserGame.game.isBooted;
        out.phaser.isRunning = window.PhaserGame.game.isRunning;
        out.phaser.sceneReadyFlag = !!window.__phaserSceneReady;
    }
    const e = window.Game && window.Game.entities.get('enemy_main_red_wolf');
    if (e) {
        const sp = e._phaserSprite;
        out.hasSprite = !!sp;
        if (sp) {
            out.spriteActive = sp.active;
            out.textureKey = sp.texture && sp.texture.key;
            out.frameName = sp.frame && sp.frame.name;
            out.visible = sp.visible;
            out.alpha = sp.alpha;
            out.x = sp.x; out.y = sp.y;
            out.displayW = sp.displayWidth; out.displayH = sp.displayHeight;
            out.scaleX = sp.scaleX; out.scaleY = sp.scaleY;
            out.depth = sp.depth;
            out.flipX = sp.flipX;
            out.renderable = sp.renderable;
            out.frameW = sp.frame && sp.frame.width;
            out.frameH = sp.frame && sp.frame.height;
        }
        out.animState = e._animState;
        out.animFrame = e._animFrame;
        out.spritesKeys = e._sprites ? Object.keys(e._sprites) : null;
        out.texKeyFn = typeof e._getTextureKey === 'function' ? e._getTextureKey() : null;
        out.isTransforming = e._isTransforming;
        out.isTransformed = e._isTransformed;
        out.footOffsetY = e.footOffsetY;
    }
    const scene = window.__phaserScene;
    const keys = [
        'enemy_red_wolf_king_idle', 'enemy_red_wolf_king_pacing', 'enemy_red_wolf_king_run',
        'enemy_red_wolf_king_pounce_claw', 'enemy_red_wolf_king_pounce_bite',
        'enemy_red_wolf_king_change', 'enemy_red_wolf_king_howl',
        'enemy_red_wolf_king_transformed_idle', 'enemy_red_wolf_king_changed_run',
        'enemy_red_wolf_king_changed_attack', 'enemy_circle'
    ];
    out.textureExists = {};
    if (scene && scene.textures) {
        for (const k of keys) out.textureExists[k] = scene.textures.exists(k);
    }
    out.player = window.Game.player ? { x: window.Game.player.x, y: window.Game.player.y } : null;
    out.scene = scene ? scene.constructor.name : null;
    out.entitiesKeys = window.Game.entities ? Array.from(window.Game.entities.keys()).filter((k) => k.includes('enemy_main')) : null;
    return out;
})()`);
console.log('detail:', JSON.stringify(detail, null, 2));

// BootScene.create 执行进度标记检查（判断是否在 scene.start 之前中断）
const boot = await evalJs(`(() => {
    const g = window.PhaserGame && window.PhaserGame.game;
    const bs = g && g.scene.getScene('BootScene');
    const out = {
        muzzlePoints: !!window.__weaponMuzzlePoints,
        enemyCircleTex: !!(g && g.textures.exists('enemy_circle')),
        texPlayerIdle: !!(g && g.textures.exists('player_idle')),
        texPlayerWalk: !!(g && g.textures.exists('player_walk')),
        texPlayerRun: !!(g && g.textures.exists('player_run')),
        animPlayerWalk: !!(g && g.anims.exists('player_walk')),
        animPlayerRun: !!(g && g.anims.exists('player_run')),
        texEnemySpider: !!(g && g.textures.exists('enemy_spider')),
        texCount: g ? Object.keys(g.textures.list || {}).length : 0,
        texSample: g ? Object.keys(g.textures.list || {}).slice(0, 30) : [],
        bootStatus: bs ? bs.sys.settings.status : null,
        bootActive: bs ? bs.sys.isActive() : null,
        bootVisible: bs ? bs.sys.isVisible() : null,
        bootSleeping: bs ? bs.sys.isSleeping() : null,
        textureMissingCount: (g && g.textures.get('__MISSING')) ? Object.keys(g.textures.get('__MISSING').frames || {}).length : 0,
    };
    if (bs && bs.load) {
        const L = bs.load;
        out.loader = {
            isLoading: typeof L.isLoading === 'function' ? L.isLoading() : null,
            total: L.total, completed: L.completed, failed: L.failed,
            queue: L.queue ? L.queue.size : null,
            list: L.list ? L.list.size : null,
            inflight: L.inflight ? L.inflight.size : null,
        };
        if (L.queue && L.queue.size) {
            out.loader.queuedFiles = Array.from(L.queue).slice(0, 20).map((f) => f.key + ' ' + f.url + ' type=' + f.type);
        }
        if (L.inflight && L.inflight.size) {
            out.loader.inflightFiles = Array.from(L.inflight).slice(0, 40).map((f) => f.key + ' ' + f.url + ' type=' + f.type);
        }
    }
    return out;
})()`);
console.log('boot progress:', JSON.stringify(boot));

// 攻击链路验证：近咬→pounceBite、飞扑→pounceClaw、贴图帧数/网格
const atk = await evalJs(`(async () => {
    const out = {};
    const scene = window.__phaserScene;
    const e = window.Game && window.Game.entities.get('enemy_main_red_wolf');
    if (!scene || !e) return { missing: true };
    try {
        const mod = await import('/data/animation-config.json?import');
        out.runtimeConfigAttackTypes = mod.default && mod.default.redWolfKing
            ? Object.keys(mod.default.redWolfKing.animation.attackTypes)
            : null;
    } catch (err) {
        out.runtimeConfigErr = String(err);
    }
    const tex = (k) => {
        const t = scene.textures.get(k);
        if (!t) return null;
        const names = t.getFrameNames ? t.getFrameNames() : [];
        const src = t.getSourceImage ? t.getSourceImage() : null;
        return { frameCount: names.length, srcW: src ? src.width : 0, srcH: src ? src.height : 0 };
    };
    out.tex = {
        pounceBite: tex('enemy_red_wolf_king_pounce_bite'),
        pounceClaw: tex('enemy_red_wolf_king_pounce_claw'),
        pacing: tex('enemy_red_wolf_king_pacing'),
    };
    out.attackTypesKeys = e._attackTypes ? Object.keys(e._attackTypes) : null;
    out.attackTypesBite = e._attackTypes && e._attackTypes.bite;
    out.attackTypesPounce = e._attackTypes && e._attackTypes.pounce;
    out.frameLayoutKeys = e._frameLayouts ? Object.keys(e._frameLayouts) : null;
    out.frameLayoutBite = e._frameLayouts && e._frameLayouts.pounceBite;
    out.frameDurBite = e._frameDurations && e._frameDurations.bite;
    try { e._endBite(); } catch (_) {}
    try { e._endPounce(); } catch (_) {}
    e._startBite();
    out.bite = {
        attackType: e._attackType,
        texKey: e._getTextureKey(),
        biteTimer: e._biteTimer,
        biteState: e._biteState,
        frameCount: e._getStateFrameCount(),
    };
    try { e._endBite(); } catch (_) {}
    try { e._endPounce(); } catch (_) {}
    e._startPounce();
    out.pounce = {
        attackType: e._attackType,
        texKey: e._getTextureKey(),
        pounceTimer: e._pounceTimer,
        pounceState: e._pounceState,
        frameCount: e._getStateFrameCount(),
    };
    return out;
})()`);
console.log('attack wiring:', JSON.stringify(atk, null, 2));
await new Promise((r) => setTimeout(r, 700));
await shot('redwolf_probe_bite');
try { await evalJs(`(() => { const e = window.Game.entities.get('enemy_main_red_wolf'); try { e._endBite(); } catch (_) {} try { e._endPounce(); } catch (_) {} })()`); } catch (_) {}

// 变身验证：压低 HP 触发变身 → 红狼人形态贴图
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (e) { e.hp = e.maxHp * 0.3; e._transformTriggered = false; e._isTransforming = false; e._isTransformed = false; }
})()`);
await new Promise((r) => setTimeout(r, 800));
const midTransform = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return null;
    const hpBefore = e.hp;
    e.takeDamage(100, null, 'physical', true);
    const hpAfter = e.hp;
    return {
        isTransforming: e._isTransforming,
        frozenForCast: e._frozenForCast,
        hpBefore, hpAfter, damageTaken: hpBefore - hpAfter,
        vx: e.vx, vy: e.vy,
    };
})()`);
console.log('mid-transform:', JSON.stringify(midTransform));
await new Promise((r) => setTimeout(r, 5200));
const transf = await evalJs(`(async () => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (!e) return null;
    const sp = e._phaserSprite;
    let moduleCheck = null;
    try {
        const perfs = performance.getEntriesByType('resource').map((n) => n.name);
        const pick = (n) => perfs.find((u) => u.includes('/src/' + n) && u.includes('?t=')) || perfs.find((u) => u.includes('/src/' + n));
        const mod = await import(pick('config/animation-config.js'));
        moduleCheck = {
            cfgRenderKeys: mod.ANIMATION_CONFIG && mod.ANIMATION_CONFIG.redWolfKing ? Object.keys(mod.ANIMATION_CONFIG.redWolfKing.render) : null,
            sameObject: mod.ANIMATION_CONFIG && mod.ANIMATION_CONFIG.redWolfKing === e._animCfg,
        };
    } catch (err) {
        moduleCheck = { err: String(err) };
    }
    return {
        isTransforming: e._isTransforming,
        isTransformed: e._isTransformed,
        frozenForCast: e._frozenForCast,
        howlTimer: e._howlTimer,
        animState: e._animState,
        texKeyFn: e._getTextureKey(),
        spriteTexture: sp && sp.texture ? sp.texture.key : null,
        displayW: sp ? sp.displayWidth : null,
        displayH: sp ? sp.displayHeight : null,
        phaserOptionsSpriteSize: (typeof e._getPhaserOptions === 'function' && e._getPhaserOptions()) ? e._getPhaserOptions().spriteSize : null,
        animCfgRender: e._animCfg && e._animCfg.render ? Object.keys(e._animCfg.render) : null,
        transformedSpriteSizeCfg: e._animCfg && e._animCfg.render ? e._animCfg.render.transformedSpriteSize : null,
        moduleCheck,
        hpPct: e.maxHp ? Math.round(100 * e.hp / e.maxHp) : null,
    };
})()`);
console.log('transform state:', JSON.stringify(transf));
await shot('redwolf_probe_transformed');
await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    if (e) {
        e._animState = 'idle';
        try { e._endBite(); } catch (_) {}
        try { e._endPounce(); } catch (_) {}
    }
})()`);
await new Promise((r) => setTimeout(r, 500));
const idleTex = await evalJs(`(() => {
    const e = window.Game.entities.get('enemy_main_red_wolf');
    const sp = e && e._phaserSprite;
    return { animState: e._animState, texKey: e._getTextureKey(), spriteTex: sp ? sp.texture.key : null };
})()`);
console.log('humanoid idle state:', JSON.stringify(idleTex));
await shot('redwolf_probe_transformed_idle');

// 尝试手动重启 GameScene，捕获 create 阶段异常
const restart = await evalJs(`(async () => {
    const g = window.PhaserGame && window.PhaserGame.game;
    if (!g) return { noGame: true };
    const collected = [];
    window.__rwProbeErrors = collected;
    const push = (label, e) => collected.push(label + ': ' + String(e && e.stack || e));
    const onErr = (ev) => push('window.onerror', ev.message);
    const onRej = (ev) => push('unhandledrejection', ev.reason);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    try {
        g.scene.stop('BootScene');
        g.scene.stop('GameScene');
        g.scene.stop('HudScene');
    } catch (e) { push('stop', e); }
    await new Promise((r) => setTimeout(r, 300));
    try {
        g.scene.start('GameScene');
    } catch (e) { push('start', e); }
    await new Promise((r) => setTimeout(r, 2500));
    const sc = g.scene.getScene('GameScene');
    const out = {
        errs: collected,
        gameStatus: sc ? sc.sys.settings.status : null,
        ready: !!window.__phaserScene,
        readyFlag: !!window.__phaserSceneReady,
    };
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    return out;
})()`);
console.log('restart attempt:', JSON.stringify(restart, null, 2));

// 把红狼王拉到玩家旁边再截图
await evalJs(`(() => {
    const e = window.Game && window.Game.entities.get('enemy_main_red_wolf');
    const p = window.Game.player;
    if (e && p) { e.x = p.x + 140; e.y = p.y - 40; }
})()`);
await new Promise((r) => setTimeout(r, 1200));
await shot('redwolf_probe_live');

// 也把通用 Enemy 圆形占位（红狼王配置）生成一只对比
await evalJs(`(async () => {
    const perfs = performance.getEntriesByType('resource').map((n) => n.name);
    const pick = (n) => perfs.find((u) => u.includes('/' + n) && u.includes('?t=')) || perfs.find((u) => u.includes('/' + n));
    const enemyMod = await import(pick('entities/enemy.js'));
    const cfgMod = await import(pick('data/enemy-config.json'));
    const p = window.Game.player;
    const cfg = JSON.parse(JSON.stringify(cfgMod.default.redWolfKing || {}));
    const circle = new enemyMod.Enemy(p.x + 260, p.y - 40, cfg);
    window.Game.entities.set('probe_redwolf_circle', circle);
    return { made: true, key: circle._getTextureKey ? circle._getTextureKey() : 'no-_getTextureKey' };
})()`);
await new Promise((r) => setTimeout(r, 800));
await shot('redwolf_probe_circle');

console.log('console errors:', errs.length ? errs : 'none');
edge.kill();
