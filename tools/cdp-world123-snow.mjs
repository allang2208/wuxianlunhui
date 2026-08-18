#!/usr/bin/env node
/* 世界-123运行时探针：安全无头Edge进入雪原，检查分块地面、三层雪纹理和返回门。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9269;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchJson(url, timeoutMs = 4000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: ctrl.signal });
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}
async function waitFor(check, timeoutMs = 30000, stepMs = 300) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const value = await check();
            if (value) return value;
        } catch { /* app may still be loading */ }
        await sleep(stepMs);
    }
    return null;
}

const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1600,900',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

try {
    const page = await waitFor(async () => {
        const list = await fetchJson(`${CDP}/json/list`);
        return list.find((tab) => tab.type === 'page' && tab.url.includes('localhost:5173'));
    });
    if (!page) throw new Error('未找到本地游戏页面');

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
            errors.push(message.params.exceptionDetails.text || 'runtime exception');
        } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.result?.exceptionDetails) {
            throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
        }
        return result.result?.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    const started = await waitFor(async () => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        return false;
    })()`), 30000, 500);
    if (!started) throw new Error('游戏未成功启动');

    const switched = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const resource = performance.getEntriesByType('resource')
                .map((entry) => entry.name)
                .find((url) => url.includes(modulePath + '?'));
            if (!resource) throw new Error(modulePath + ' 未加载');
            return resource;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        await SceneManager.switchScene('scene9', window.Game.player);
        const { Renderer } = await import(loaded('/src/world/renderer.js'));
        const { WallSystem } = await import(loaded('/src/world/wall-system.js'));
        const { getDungeonFloorProfile } = await import(loaded('/src/world/dungeon-floor-texture.js'));
        const portal = [...window.Game.entities.values()]
            .find((entity) => entity && entity.targetScene === 'main');
        return {
            scene: SceneManager.currentScene,
            world: { width: SceneManager.scenes.scene9.width, height: SceneManager.scenes.scene9.height },
            chunks: Renderer.terrainChunks,
            profile: getDungeonFloorProfile(),
            scatterConfig: SceneManager.scenes.scene9.snowPineScatter,
            pineGeo: WallSystem._geoForTex('obstacle_snow_pine_01'),
            wallCounts: { walls: WallSystem.walls.length, segments: WallSystem.isoSegments.length },
            scatterWalls: WallSystem.walls
                .filter((wall) => (wall._scatterSource?.tex || '').startsWith('obstacle_snow_pine_'))
                .map((wall) => wall._scatterSource.tex),
            isoVisualSample: WallSystem.isoVisuals.slice(0, 10).map((piece) => piece.tex),
            snowPines: WallSystem.isoVisuals
                .filter((piece) => piece.tex.startsWith('obstacle_snow_pine_'))
                .map((piece) => piece.tex),
            returnPortal: portal ? { x: Math.round(portal.x), y: Math.round(portal.y), target: portal.targetScene } : null,
        };
    })()`);
    ws.close();

    const textures = switched.profile?.tiles || [];
    const patches = switched.profile?.surfacePatches || [];
    const okay = switched.scene === 'scene9'
        && switched.world?.width === 12288
        && switched.world?.height === 8192
        && switched.chunks?.chunkSize === 2048
        && switched.chunks?.diamond
        && textures.includes('floor_snow_fresh_seamless')
        && patches.some((patch) => patch.texture === 'floor_snow_packed_seamless')
        && patches.some((patch) => patch.texture === 'floor_snow_wind_seamless')
        && switched.profile?.deco?.textures?.length === 5
        && switched.profile.deco.textures.every((texture) => texture.startsWith('deco_snow_'))
        && switched.profile.deco.size === 55
        && switched.profile.deco.perChunk === 14
        && Number.isInteger(switched.profile.deco.seed)
        && switched.snowPines.length === 38
        && switched.snowPines.length > 0
        && new Set(switched.snowPines).size === 5
        && switched.returnPortal?.target === 'main'
        && errors.length === 0;
    console.log(JSON.stringify({ switched, errors }, null, 2));
    if (!okay) throw new Error('世界-123运行时断言失败');
    console.log('世界-123运行时探针通过');
} finally {
    edge.kill();
}
