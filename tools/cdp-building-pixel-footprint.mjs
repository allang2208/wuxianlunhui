#!/usr/bin/env node
/* 世界-122 普通建筑像素 footprint 运行时探针。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9347;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-footprint-'));
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,900',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

const cleanup = () => {
    try { edge.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const value = await fn();
            if (value) return value;
        } catch {}
        await delay(300);
    }
    return null;
}

const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await response.json();
    return list.find((entry) => entry.type === 'page');
});
if (!page) {
    console.error('FAIL no page');
    cleanup();
    process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});
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
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
};
const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
    const response = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (response.result?.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.exception?.description
            || response.result.exceptionDetails.text);
    }
    return response.result?.result?.value;
};

await send('Runtime.enable');
let started = false;
for (let i = 0; i < 60 && !started; i++) {
    started = await evalJs(`(() => {
        if (window.Game?.isRunning && window.Game.player) return true;
        document.getElementById('startGameBtn')?.click();
        return false;
    })()`).catch(() => false);
    if (!started) await delay(500);
}
if (!started) throw new Error('game not started');
const sceneReady = await waitFor(() => evalJs(`(() => !!(
    window.__phaserScene
    && window.__phaserScene.sys?.settings?.key === 'GameScene'
    && typeof window.__phaserScene._syncNeutralEntities === 'function'
))()`), 30000);
if (!sceneReady) throw new Error('GameScene not ready');

const result = await evalJs(`(async () => {
    const findModule = async (part) => {
        const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
        const url = urls.find((entry) => entry.includes(part) && entry.includes('?'))
            || urls.find((entry) => entry.includes(part));
        if (!url) throw new Error('module not loaded: ' + part);
        return import(url);
    };
    const { SceneManager } = await findModule('/src/world/scene-manager.js');
    await SceneManager.switchScene('scene8', window.Game.player);
    const producerMod = await findModule('/src/world/producer-building-system.js');
    const barracksMod = await findModule('/src/world/hamster-barracks-system.js');
    const isoMod = await findModule('/src/physics/iso-footprint.js');
    const samples = [
        new producerMod.ProducerBuilding(3000, 1800, { id: 'pixel_fit_warehouse', cfgKey: 'warehouse' }),
        new producerMod.ProducerBuilding(3400, 1800, { id: 'pixel_fit_shooting', cfgKey: 'shooting_range' }),
        new barracksMod.HamsterBarracks(3800, 1800, { id: 'pixel_fit_barracks' }),
    ];
    for (const entity of samples) window.Game.entities.set(entity.id, entity);
    producerMod.ProducerBuildingSystem.buildings.push(samples[0], samples[1]);
    barracksMod.HamsterBarracksSystem.barracks.push(samples[2]);
    const beforeSync = samples.map((entity) => ({
        id: entity.id,
        active: entity.active,
        hasPhaserSprite: !!entity._phaserSprite,
        skipNeutral: !!entity._skipNeutralSprite,
        texture: entity.spriteCfg?.idleKey,
        textureExists: window.__phaserScene?.textures?.exists(entity.spriteCfg?.idleKey),
    }));
    window.__phaserScene?._syncNeutralEntities?.(window.Game);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      beforeSync,
      sceneType: window.__phaserScene?.constructor?.name,
      sceneKey: window.__phaserScene?.sys?.settings?.key,
      hasSyncNeutral: typeof window.__phaserScene?._syncNeutralEntities === 'function',
      neutralSize: window.__phaserScene?._neutralSprites?.size,
      samples: samples.map((entity) => {
        const sprite = window.__phaserScene?._neutralSprites?.get(entity)?.sprite;
        const vertices = isoMod.isoFootprintVertices(entity);
        const front = vertices.find((point) => point.key === 'front');
        return {
            id: entity.id,
            fitted: Array.isArray(entity._pixelFootprintLocal),
            visualOffsetX: entity._visualFootOffsetX,
            spriteX: sprite?.x,
            entityX: entity.x,
            colliderX: entity.collider?.x,
            colliderY: entity.collider?.y,
            width: entity.collisionWidth,
            height: entity.collisionHeight,
            frontX: front?.x,
            frontY: front?.y,
        };
      }),
    };
})()`);

const expected = {
    pixel_fit_warehouse: { width: [260, 270], height: [128, 136], visual: [0, 3] },
    pixel_fit_shooting: { width: [280, 294], height: [160, 172], visual: [-4, 0] },
    pixel_fit_barracks: { width: [255, 266], height: [145, 155], visual: [-10, -6] },
};
let failed = 0;
console.log('diag', JSON.stringify(result?.beforeSync), {
    sceneType: result?.sceneType,
    sceneKey: result?.sceneKey,
    hasSyncNeutral: result?.hasSyncNeutral,
    neutralSize: result?.neutralSize,
});
for (const sample of result?.samples || []) {
    const exp = expected[sample.id];
    const ok = sample.fitted
        && sample.width >= exp.width[0] && sample.width <= exp.width[1]
        && sample.height >= exp.height[0] && sample.height <= exp.height[1]
        && sample.visualOffsetX >= exp.visual[0] && sample.visualOffsetX <= exp.visual[1]
        && Math.abs(sample.spriteX - (sample.entityX + sample.visualOffsetX)) < 0.6
        && Math.abs(sample.colliderX - sample.entityX) < 0.1
        && Math.abs(sample.frontX - sample.entityX) < 0.1
        && Math.abs(sample.frontY - 1800) < 0.1;
    console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(sample));
    if (!ok) failed++;
}
if (errors.length) {
    console.log('console errors:', errors.join('\n'));
    failed += errors.length;
}
ws.close();
cleanup();
process.exit(failed ? 1 : 0);
