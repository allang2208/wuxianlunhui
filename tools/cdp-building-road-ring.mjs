#!/usr/bin/env node
/* World-122 building road ring runtime probe. Run through tools/cdp-run.ps1. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9359;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-building-road-'));
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
    for (let attempt = 0; attempt < 100 && !window.__phaserScene?.textures; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.__phaserScene?.textures) throw new Error('GameScene not ready after scene8 switch');
    const { BuildingSystem, BUILD_ITEMS } = await findModule('/src/world/building-system.js');
    const { BuildingRoadSystem } = await findModule('/src/world/building-road-system.js');

    const item = BUILD_ITEMS.find((entry) => entry.kind === 'tower');
    BuildingSystem._placing = { item, mirror: false };
    const candidates = [
        [6200, 3900], [6600, 3900], [7000, 3900], [6200, 4400], [7000, 4400],
    ];
    let snap = null;
    for (const [x, y] of candidates) {
        const next = BuildingSystem._snapBuildingGrid(x, y, 2);
        if (BuildingSystem._canPlace(next.x, next.y)) {
            snap = next;
            break;
        }
    }
    if (!snap) throw new Error('no valid 4x4 candidate');

    BuildingSystem._ensureRoadPreview(window.__phaserScene);
    const validStatus = BuildingSystem._buildingRoadPlacementStatus(snap.x, snap.y);
    BuildingSystem._updateRoadPreview(snap.x, snap.y, validStatus, validStatus.ok);
    const previewBefore = BuildingSystem._roadPreview.map((sprite) => ({
        visible: sprite.visible,
        frame: Number(sprite.frame?.name),
        tint: sprite.tintTopLeft,
        width: sprite.displayWidth,
        height: sprite.displayHeight,
    }));

    const oldFree = !!window.Game._devInfiniteResources;
    window.Game._devInfiniteResources = true;
    BuildingSystem._place(snap.x, snap.y);
    window.Game._devInfiniteResources = oldFree;
    const tower = Array.from(window.Game.entities.values()).find((entity) =>
        entity?._isDefenseTower && entity?._buildingRoadLayout
        && Math.abs(entity.x - snap.x) < 1 && Math.abs(entity.y - snap.y) < 1
    );
    if (!tower) throw new Error('tower with roads was not created');

    const overlapSnap = BuildingSystem._snapBuildingGrid(snap.x + 128, snap.y + 64, 2);
    const overlapStatus = BuildingSystem._buildingRoadPlacementStatus(overlapSnap.x, overlapSnap.y);
    BuildingSystem._updateRoadPreview(
        overlapSnap.x,
        overlapSnap.y,
        overlapStatus,
        overlapStatus.ok
    );
    const redPreviewCount = BuildingSystem._roadPreview.filter((sprite) =>
        sprite.visible && sprite.tintTopLeft === 0xff5555
    ).length;
    const roadSprites = Array.from(BuildingRoadSystem._roadTiles.values())
        .map((record) => record.sprite)
        .filter(Boolean);
    const output = {
        textureExists: window.__phaserScene.textures.exists('building_road_tiles'),
        validStatus: validStatus.ok,
        reservationCount: tower._buildingRoadLayout.reservationCells.length,
        roadCellCount: tower._buildingRoadLayout.roadCells.length,
        ownerCount: BuildingRoadSystem._owners.size,
        roadSpriteCount: roadSprites.length,
        roadFrames: roadSprites.map((sprite) => Number(sprite.frame?.name)),
        roadSizes: roadSprites.map((sprite) => [sprite.displayWidth, sprite.displayHeight]),
        previewBefore,
        overlapOk: overlapStatus.ok,
        overlapInvalidCount: Array.from(overlapStatus.validByKey.values()).filter((ok) => !ok).length,
        redPreviewCount,
    };

    tower._removeBuildingRoads?.();
    tower.active = false;
    window.Game.entities.delete(tower.id);
    BuildingSystem._clearRoadPreview();
    BuildingSystem._placing = null;
    return output;
})()`);

const pass = result?.textureExists
    && result.validStatus
    && result.reservationCount === 16
    && result.roadCellCount === 12
    && result.ownerCount === 1
    && result.roadSpriteCount === 12
    && result.roadFrames.every((frame) => frame >= 0 && frame <= 3)
    && result.roadSizes.every(([w, h]) => Math.abs(w - 130) < 0.1 && Math.abs(h - 65) < 0.1)
    && result.previewBefore.length === 12
    && result.previewBefore.every((sprite) => sprite.visible)
    && result.overlapOk === false
    && result.overlapInvalidCount > 0
    && result.redPreviewCount > 0;

console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(result));
if (errors.length) console.log('console errors:', errors.join('\n'));
ws.close();
cleanup();
process.exit(pass && errors.length === 0 ? 0 : 1);
