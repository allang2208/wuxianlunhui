#!/usr/bin/env node
/* 世界-124林地运行时探针：场景、草地地板、树木散布与返回门。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9271;
const CDP = `http://127.0.0.1:${PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try { const value = await fn(); if (value) return value; } catch {}
        await sleep(300);
    }
    return null;
}

const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    'http://localhost:5173/',
], { stdio: 'ignore' });

try {
    const page = await waitFor(async () => {
        const list = await (await fetch(`${CDP}/json/list`)).json();
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
            errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
        return result.result?.result?.value;
    };
    await send('Runtime.enable');
    const started = await waitFor(() => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        return false;
    })()`));
    if (!started) throw new Error('游戏未启动');

    const data = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const url = performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((entry) => entry.includes(modulePath + '?'));
            if (!url) throw new Error(modulePath + ' 未加载');
            return url;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        await SceneManager.switchScene('scene10', window.Game.player);
        const { Renderer } = await import(loaded('/src/world/renderer.js'));
        const { WallSystem } = await import(loaded('/src/world/wall-system.js'));
        const { getDungeonFloorProfile } = await import(loaded('/src/world/dungeon-floor-texture.js'));
        const portal = [...window.Game.entities.values()].find((entity) => entity?.targetScene === 'main');
        const trees = WallSystem.isoVisuals.filter((piece) => piece.tex.startsWith('obstacle_forest_pine_'));
        return {
            scene: SceneManager.currentScene,
            world: SceneManager.scenes.scene10,
            chunks: Renderer.terrainChunks,
            profile: getDungeonFloorProfile(),
            treeCount: trees.length,
            variants: [...new Set(trees.map((tree) => tree.tex))].length,
            portal: portal ? { target: portal.targetScene, x: Math.round(portal.x), y: Math.round(portal.y) } : null,
        };
    })()`);
    ws.close();
    const okay = data.scene === 'scene10'
        && data.world.width === 12288 && data.world.height === 8192
        && data.chunks?.chunkSize === 2048 && data.chunks?.diamond
        && data.profile?.tiles?.includes('floor_grass_forest_seamless')
        && data.profile?.deco?.textures?.includes('deco_grass_1')
        && data.treeCount === 55 && data.variants === 5
        && data.portal?.target === 'main'
        && errors.length === 0;
    console.log(JSON.stringify({ data, errors }, null, 2));
    if (!okay) throw new Error('世界-124林地运行时断言失败');
    console.log('世界-124林地运行时探针通过');
} finally {
    edge.kill();
}
