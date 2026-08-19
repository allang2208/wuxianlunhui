#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9391;
const endpoint = `http://127.0.0.1:${PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,900',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

try {
    let page = null;
    for (let attempt = 0; attempt < 60 && !page; attempt++) {
        try {
            const tabs = await (await fetch(`${endpoint}/json/list`)).json();
            page = tabs.find((tab) => tab.type === 'page' && tab.url.includes('localhost:5173'));
        } catch {}
        if (!page) await sleep(250);
    }
    if (!page) throw new Error('未找到游戏页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        } else if (message.method === 'Runtime.exceptionThrown') {
            errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (reply.result?.exceptionDetails) {
            throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text);
        }
        return reply.result?.result?.value;
    };
    await send('Runtime.enable');
    let ready = false;
    for (let attempt = 0; attempt < 180 && !ready; attempt++) {
        try {
            ready = await evaluate(`(async () => {
                if (!window.Game) return false;
                if (!window.Game.isRunning) {
                    const button = document.getElementById('startGameBtn');
                    if (button && getComputedStyle(button).display !== 'none') button.click();
                    else window.Game.start();
                    return false;
                }
                return !!window.__phaserScene;
            })()`);
        } catch {}
        if (!ready) await sleep(150);
    }
    if (!ready) throw new Error('游戏启动失败');

    const result = await evaluate(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const scene = window.__phaserScene;
        const { Camera } = await import('/src/world/camera.js');
        const { BuildingSinkEffect } = await import('/src/effects/building-sink.js');
        const { EffectManager } = await import('/src/effects/effect-manager.js');
        const { applyBuildingFootprint } = await import('/src/world/building-footprint.js');
        const x = Camera.x;
        const y = Camera.y + 120;
        const entity = {
            id: 'sink_mask_probe',
            x, y,
            active: true,
            hittable: true,
            spriteCfg: { size: 271, sizeH: 191, footOffsetY: 96 },
            footOffsetY: 96,
            _structureRenderDepth: y + 12,
        };
        applyBuildingFootprint(entity, 2);
        const sprite = scene.add.sprite(x, y - 96, 'thatch_hut');
        sprite.setOrigin(0.5, 0.5);
        sprite.setDisplaySize(271, 191);
        sprite.setDepth(y + 12);
        entity._phaserSprite = sprite;
        window.Game.entities.set(entity.id, entity);
        const effect = new BuildingSinkEffect(entity).start();
        EffectManager.add(effect);
        effect.update(850);
        const maskEntry = effect._clipMasks[0];
        const enabledFilters = sprite.filters;
        const buildingDust = effect._spawnedDust.filter((entry) =>
            entry && entry.visualScale > 1);
        const clipXs = effect._clipPolygon.map((point) => point.x);
        const spriteLeft = sprite._sinkBaseX - sprite.displayWidth * sprite.originX;
        const spriteRight = sprite._sinkBaseX + sprite.displayWidth * (1 - sprite.originX);
        const data = {
            active: effect.active,
            polygonMaskActive: effect._polygonMaskActive,
            maskCount: effect._clipMasks.length,
            maskInstallError: effect._maskInstallError,
            hasEnableFilters: typeof sprite.enableFilters === 'function',
            hasExternalFilters: !!enabledFilters?.external,
            hasAddMask: typeof enabledFilters?.external?.addMask === 'function',
            inverted: maskEntry?.mask?.invert === true,
            usesGameObjectMask: !!maskEntry?.mask?.maskGameObject,
            rectangularCropDisabled: sprite.isCropped === false,
            spriteMovedDown: sprite.y > y - 96,
            footprintVertexCount: effect._footprintProjection?.vertices?.length || 0,
            maskCoversVisualWidth: Math.min(...clipXs) <= spriteLeft
                && Math.max(...clipXs) >= spriteRight,
            reusedPlayerDust: buildingDust.length >= 2,
            dustScaleRange: buildingDust.every((entry) =>
                entry.visualScale >= 1.65 && entry.visualScale <= 2.6),
            dustLifeEnlarged: buildingDust.every((entry) => entry.lifeMultiplier === 1.5),
        };
        effect._finish();
        return data;
    })()`);

    const checks = [
        ['WebGL多边形Mask已激活', result.polygonMaskActive && result.maskCount > 0],
        ['Mask为反向隐藏模式', result.inverted],
        ['Mask来源为动态多边形GameObject', result.usesGameObjectMask],
        ['贴图下沉时未使用水平矩形crop', result.rectangularCropDisabled],
        ['贴图仍在原地垂直下沉', result.spriteMovedDown],
        ['Mask读取四点footprint投影', result.footprintVertexCount === 4],
        ['Mask左右延伸覆盖完整贴图宽度', result.maskCoversVisualWidth],
        ['建筑复用玩家奔跑同款DustEffect', result.reusedPlayerDust],
        ['建筑烟尘按footprint面积适度放大', result.dustScaleRange && result.dustLifeEnlarged],
        ['页面无运行时异常', errors.length === 0],
    ];
    console.log('  [详情]', JSON.stringify(result));
    for (const [name, ok] of checks) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    console.log(`\n结果: ${checks.filter(([, ok]) => ok).length} 通过, ${checks.filter(([, ok]) => !ok).length} 失败`);
    if (errors.length) console.log(errors.slice(0, 3));
    process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
} catch (error) {
    console.error('探针失败:', error.message);
    process.exitCode = 1;
} finally {
    try { edge.kill(); } catch {}
    await sleep(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
