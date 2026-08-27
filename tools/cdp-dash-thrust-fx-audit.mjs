#!/usr/bin/env node
/**
 * 骑士长剑冲刺突击白线汇聚特效 Phaser 实机审计。
 *
 * 用法：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-dash-thrust-fx-audit.mjs
 * 可选标签：DASH_FX_AUDIT_LABEL=before/after，避免前后截图互相覆盖。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9257;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const LABEL = String(process.env.DASH_FX_AUDIT_LABEL || 'audit').replace(/[^a-z0-9_-]/gi, '_');
const OUT_DIR = 'tools/verify-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
let edge = null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const removeProfile = () => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
};
async function cleanup(code) {
    try { if (edge) edge.kill('SIGKILL'); } catch {}
    await sleep(1200);
    for (let i = 0; i < 5 && fs.existsSync(profile); i++) {
        removeProfile();
        if (fs.existsSync(profile)) await sleep(500);
    }
    if (code !== undefined) process.exit(code);
}
process.on('exit', () => {
    try { if (edge) edge.kill(); } catch {}
    removeProfile();
});

edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

async function fetchJson(url) {
    const response = await fetch(url);
    return response.json();
}
async function waitFor(fn, timeoutMs = 45000) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
        try {
            const value = await fn();
            if (value) return value;
        } catch {}
        await sleep(300);
    }
    return null;
}

const page = await waitFor(async () => {
    const pages = await fetchJson(`${CDP}/json/list`);
    return pages.find(target => target.type === 'page' && target.url.includes('localhost:5173'));
});
if (!page) {
    console.error('No Phaser page was exposed by the audit Edge instance.');
    await cleanup(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});
let seq = 0;
const pending = new Map();
ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
};
const send = (method, params = {}) => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
    for (let attempt = 0; attempt < 30; attempt++) {
        const response = await send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (response.error?.code === -32000
            && /Execution context was destroyed/i.test(response.error.message || '')) {
            await sleep(300);
            continue;
        }
        if (response.error) {
            throw new Error(`CDP Runtime.evaluate error: ${JSON.stringify(response.error)}`);
        }
        if (response.result?.exceptionDetails) {
            throw new Error(response.result.exceptionDetails.exception?.description
                || response.result.exceptionDetails.text
                || 'Runtime.evaluate failed');
        }
        if (!response.result?.result) {
            throw new Error(`CDP Runtime.evaluate returned no result: ${JSON.stringify(response)}`);
        }
        return response.result.result.value;
    }
    throw new Error('Phaser page kept navigating; no stable execution context was available.');
};
const screenshot = async name => {
    const response = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT_DIR}/dash_thrust_fx_${LABEL}_${name}.png`;
    fs.writeFileSync(file, Buffer.from(response.result.data, 'base64'));
    console.log(`saved=${file}`);
};

await send('Runtime.enable');
const boot = await evaluate(`(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let started = Date.now();
    while (!window.Game) {
        if (Date.now() - started > 30000) return 'no Game';
        await sleep(200);
    }
    if (!window.__phaserScene) {
        const button = document.getElementById('startGameBtn');
        if (button) button.click(); else window.Game.start();
    }
    started = Date.now();
    while (!(window.Game.player && window.__phaserScene)) {
        if (Date.now() - started > 60000) return 'no Phaser scene';
        await sleep(300);
    }
    await sleep(1800);
    return 'ready';
})()`);
console.log(`boot=${boot}`);
if (boot !== 'ready') await cleanup(1);

console.log('inject=' + await evaluate(`(() => {
    const player = window.Game.player;
    const scene = window.__phaserScene;
    player.equipments.weapon = {
        weaponId: 'weapon2', name: '骑士长剑', type: '单手剑', weaponType: 'sword',
        category: 'weapon_melee', weaponCategory: 'mainhand', animConfigKey: 'sword',
        equipSlot: 'weapon', rarity: 'uncommon', level: 5,
        attack: { range: 110, knockback: 20, attackInterval: 400, damageType: '物理' },
    };
    player.equipments.offhand = null;
    player.weaponMode = 'weapon';
    player._dashVisualStyle = 'thrust';
    scene.syncWeapon(player, player.weaponAnim || {});
    const bounds = scene.physics?.world?.bounds;
    window.__dashFxAuditAnchor = {
        x: Number(bounds?.centerX) || player.x,
        y: Number(bounds?.centerY) || player.y,
    };
    // 暂停逻辑更新，防止手工设置的冲刺状态被真实 DashSystem 推进或清空；
    // Scene 暂停时仍会渲染，后续逐样本直接调用武器与特效同步函数。
    scene.scene.pause();
    return scene.weaponSprite?.texture?.key || 'missing weapon sprite';
})()`));

const samples = [
    { name: 'right_p12', direction: 1, progress: 0.12 },
    { name: 'right_p30', direction: 1, progress: 0.30 },
    { name: 'right_p50', direction: 1, progress: 0.50 },
    { name: 'right_p72', direction: 1, progress: 0.72 },
    { name: 'left_p50', direction: -1, progress: 0.50 },
];

const reports = [];
for (const sample of samples) {
    const report = await evaluate(`(() => {
        const player = window.Game.player;
        const scene = window.__phaserScene;
        const progress = ${sample.progress};
        const direction = ${sample.direction};
        const anchor = window.__dashFxAuditAnchor || { x: player.x, y: player.y };
        // 以骑士长剑正式 dashDist=173 模拟真实水平冲刺位移；特效起点保持首次
        // 可见帧的世界位置，后续剑尖随玩家向前，才能审计真正的“身后→剑尖”。
        player.x = anchor.x + direction * progress * 173;
        player.y = anchor.y;
        player._isDashing = true;
        player._dashVisualStyle = 'thrust';
        player._dashDirection = { x: direction, y: 0 };
        player._dashTotalMs = 600;
        player._dashTimer = progress * 600;
        player.rotation = direction > 0 ? 0 : Math.PI;
        scene.cameras.main.setZoom(1);
        scene.cameras.main.centerOn(player.x, player.y - 35);
        scene.playerSprite.setPosition(player.x, player.y);
        scene.setPlayerAnimation('dash_attack_thrust', 600);
        scene.playerSprite.anims.pause();
        scene.playerSprite.anims.setProgress(progress);
        scene._syncSpecialWeaponAnim(player, 'sword', player.weaponAnim || {});
        const fx = scene._dashThrustConvergenceFx;
        fx.update(16.67, {
            active: true,
            progress,
            weaponSprite: scene.weaponSprite,
            mapMode: false,
            depth: scene.weaponSprite.depth - 0.01,
        });
        const pose = fx._resolveSwordPose(scene.weaponSprite);
        const effectProgress = Math.max(0, Math.min(1,
            (progress - fx.cfg.startProgress) / Math.max(0.001, 1 - fx.cfg.startProgress)));
        const lines = fx._buildLines(pose, effectProgress);
        const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const headDistances = lines.map(line => distance(line.points[line.points.length - 1], {
            x: pose.tipX, y: pose.tipY,
        }));
        const tailDistances = lines.map(line => distance(line.points[0], {
            x: pose.tipX, y: pose.tipY,
        }));
        return {
            direction,
            progress,
            effectProgress: +effectProgress.toFixed(3),
            lineCount: lines.length,
            weapon: {
                x: +scene.weaponSprite.x.toFixed(2), y: +scene.weaponSprite.y.toFixed(2),
                rotationDeg: +(scene.weaponSprite.rotation * 180 / Math.PI).toFixed(2),
                flipX: scene.weaponSprite.flipX,
                depth: +scene.weaponSprite.depth.toFixed(3),
            },
            tip: { x: +pose.tipX.toFixed(2), y: +pose.tipY.toFixed(2) },
            maxHeadToTip: +(Math.max(0, ...headDistances)).toFixed(2),
            meanTailToTip: +(tailDistances.reduce((sum, value) => sum + value, 0)
                / Math.max(1, tailDistances.length)).toFixed(2),
            fxDepth: +fx.coreGraphics.depth.toFixed(3),
            coreVisible: fx.coreGraphics.visible,
        };
    })()`);
    reports.push({ name: sample.name, ...report });
    console.log(JSON.stringify({ name: sample.name, ...report }));
    await sleep(180);
    await screenshot(sample.name);
}

await evaluate(`(() => {
    const player = window.Game.player;
    player._isDashing = false;
    player._dashVisualStyle = null;
    window.__phaserScene._dashThrustConvergenceFx.clear();
    return true;
})()`);
fs.writeFileSync(
    `${OUT_DIR}/dash_thrust_fx_${LABEL}_report.json`,
    JSON.stringify(reports, null, 2),
    'utf8'
);
await cleanup(0);
