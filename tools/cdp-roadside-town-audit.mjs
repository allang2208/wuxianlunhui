#!/usr/bin/env node
/* World-122 adaptive roadside visual/performance audit. Run through tools/cdp-run.ps1. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9362;
const APP_URL = 'http://127.0.0.1:5174/';
const OUTPUT_DIR = path.resolve('tools/_tmp_roadside-town-audit');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-roadside-town-'));
const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--force-device-scale-factor=1',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
edge.stderr?.on('data', (chunk) => process.stderr.write(`[edge] ${chunk}`));
edge.on('exit', (code, signal) => console.error(`[edge-exit] code=${code} signal=${signal}`));

const cleanup = () => {
    try { edge.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs = 45000) {
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

await delay(9000);
const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const list = await response.json();
    return list.find((entry) => entry.type === 'page');
});
if (!page) throw new Error('no CDP page');
const browserInfo = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return response.json();
});
if (!browserInfo?.webSocketDebuggerUrl) throw new Error('no browser CDP socket');

const ws = new WebSocket(browserInfo.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});
let seq = 0;
let sessionId = null;
const pending = new Map();
const browserErrors = [];
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
    } else if (message.method === 'Runtime.exceptionThrown') {
        browserErrors.push(message.params.exceptionDetails.exception?.description
            || message.params.exceptionDetails.text);
    } else if (message.method === 'Runtime.consoleAPICalled'
        && ['error', 'assert'].includes(message.params.type)) {
        browserErrors.push(message.params.args
            .map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
};
ws.onclose = (event) => console.error(`[cdp-close] code=${event.code} reason=${event.reason || ''}`);
ws.onerror = (event) => console.error(`[cdp-error] ${event.message || 'websocket error'}`);
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
    }, 20000);
    pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
const screenshot = async (name) => {
    const response = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
    });
    const target = path.join(OUTPUT_DIR, name);
    fs.writeFileSync(target, Buffer.from(response.result.data, 'base64'));
    return target;
};

const attached = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
sessionId = attached.result?.sessionId || null;
if (!sessionId) throw new Error('failed to attach page target');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
});
await send('Page.navigate', { url: APP_URL });
console.log('[audit] CDP ready');
await delay(5000);

let started = false;
for (let attempt = 0; attempt < 80 && !started; attempt++) {
    started = await evalJs(`(() => {
        if (window.Game?.isRunning && window.Game.player) return true;
        document.getElementById('startGameBtn')?.click();
        return false;
    })()`).catch(() => false);
    if (!started) await delay(500);
}
if (!started) throw new Error('game did not start');
console.log('[audit] game started');

console.log('[audit] creating 80-building scenario');
const setup = await evalJs(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // A fresh navigation loads the canonical Vite module URLs. Importing an
    // older HMR timestamp here would create a second singleton instance and
    // make audit stats observe a different RoadsideDecorationSystem.
    const findModule = (part) => import(new URL(part, location.origin).href);
    const SceneManager = window.SceneManager
        || (await findModule('/src/world/scene-manager.js')).SceneManager;
    await SceneManager.switchScene('scene8', window.Game.player);
    for (let attempt = 0; attempt < 120 && !window.__phaserScene?.cameras?.main; attempt++) {
        await wait(100);
    }
    const scene = window.__phaserScene;
    if (!scene?.cameras?.main) throw new Error('GameScene not ready');
    const { BuildingSystem } = await findModule('/src/world/building-system.js');
    const { BuildingRoadSystem } = await findModule('/src/world/building-road-system.js');
    const { RoadsideDecorationSystem } = await findModule('/src/world/roadside-decoration-system.js');
    const { ProducerBuilding } = await findModule('/src/world/producer-building-system.js');
    const EnvironmentLightingSystem = window.EnvironmentLightingSystem
        || (await findModule('/src/world/environment-lighting-system.js')).EnvironmentLightingSystem;
    const { WorldWeatherSystem } = await findModule('/src/world/world-weather-system.js');
    const { PerformanceMonitor } = await findModule('/src/systems/performance-monitor.js');
    const { FogOfWarSystem } = await findModule('/src/world/fog-of-war-system.js');
    const { Camera } = await findModule('/src/world/camera.js');

    window.__roadsideAudit = {
        BuildingRoadSystem,
        RoadsideDecorationSystem,
        EnvironmentLightingSystem,
        WorldWeatherSystem,
        PerformanceMonitor,
        FogOfWarSystem,
        Camera,
        scene,
    };
    let style = document.getElementById('roadsideAuditStyle');
    if (!style) {
        style = document.createElement('style');
        style.id = 'roadsideAuditStyle';
        style.textContent = 'body.roadside-audit-canvas:not(.roadside-audit-performance) > :not(#gameContainer):not(script):not(style){display:none!important}'
            + 'body.roadside-audit-performance > :not(#gameContainer):not(#devToolPanel):not(script):not(style){display:none!important}'
            + 'body.roadside-audit-canvas #gameContainer > :not(canvas):not(:has(canvas)){display:none!important}'
            + 'body.roadside-audit-canvas #modularBadge{display:none!important}';
        document.head.appendChild(style);
    }
    window.__roadsideAudit.setCanvasOnly = (enabled) => {
        document.body.classList.toggle('roadside-audit-canvas', enabled);
    };

    BuildingRoadSystem.reset(scene);
    window.Game._observerMode = true;
    for (const entity of window.Game.entities.values()) {
        if (entity && entity !== window.Game.player) entity.active = false;
    }
    for (const unit of window.Game.friendlyUnits || []) {
        if (unit && unit !== window.Game.player) unit.active = false;
    }
    if (window.Game.player) window.Game.player.active = false;
    scene._syncHud = () => {};
    scene._setMinimapLayersVisible = () => {};
    const hideAuditHud = () => {
        for (const displayObject of [
            scene.worldHudGraphics,
            scene.screenHudGraphics,
            scene._minimapStaticGraphics,
            scene._minimapDynamicGraphics,
            scene._fogMinimapLayer,
            scene.minimapTitle,
            scene.playerSprite,
            scene.weaponSprite,
            scene.offhandWeaponSprite,
        ]) displayObject?.setVisible?.(false);
        for (const roleTexts of scene._entityHudTexts?.values?.() || []) {
            roleTexts.forEach((text) => text.setVisible(false));
        }
    };
    hideAuditHud();
    scene.events.on('postupdate', hideAuditHud);
    for (const canvas of document.querySelectorAll('#gameContainer canvas')) {
        if (canvas !== scene.game.canvas) canvas.style.display = 'none';
    }
    scene._syncBuildingStaffingWarning = (_entity, data) => {
        data.staffingWarningVisible = false;
        data.staffingWarningGraphics?.setVisible?.(false);
    };
    const types = [
        'house', 'thatch_hut', 'hamster_barracks', 'blacksmith', 'church',
        'research_institute', 'warehouse', 'market', 'steam_power_plant', 'bank',
        'bakery', 'armory', 'field_hospital', 'tavern', 'economic_workshop',
    ];
    const created = [];
    const bases = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 10; col++) {
            const index = row * 10 + col;
            // Five-cell spacing leaves a one-cell street connector between the
            // authoritative 4x4 reservations instead of forming a paved slab.
            const baseI = -20 + col * 5;
            const baseJ = -15 + row * 5;
            const [cellX, cellY] = BuildingSystem._blockCellCenter(baseI, baseJ);
            const anchor = BuildingSystem._snapBuildingGrid(cellX, cellY + 96, 2);
            const cfgKey = types[index % types.length];
            const entity = new ProducerBuilding(anchor.x, anchor.y, {
                id: 'roadside_audit_' + index,
                cfgKey,
                mirror: (row + col) % 3 === 0,
            });
            entity._cfg.spawnEnabled = false;
            entity._economyWorking = index % 4 !== 0;
            entity._assignedWorkers = 999;
            window.Game.entities.set(entity.id, entity);
            if (!BuildingRoadSystem.attach(entity, { scene, allowOverlap: false })) {
                window.Game.entities.delete(entity.id);
                throw new Error('failed to attach audit building ' + index);
            }
            created.push(entity);
            bases.push({ baseI, baseJ, row, col });
        }
    }
    // Each row is continuous; one vertical spine connects all eight rows.
    // 960 perimeter roads + 79 links = 1039 logical road cells.
    for (const base of bases) {
        if (base.col < 9) BuildingRoadSystem.addManualRoad(base.baseI + 3, base.baseJ + 1, {
            scene,
            force: true,
            refundable: false,
        });
        if (base.col === 4 && base.row < 7) {
            BuildingRoadSystem.addManualRoad(base.baseI + 1, base.baseJ + 3, {
                scene,
                force: true,
                refundable: false,
            });
        }
    }
    EnvironmentLightingSystem.configure({ startPhase: 0.25, animateSun: false });
    RoadsideDecorationSystem.sync({
        scene,
        roadTiles: BuildingRoadSystem._roadTiles,
        buildings: created,
        roadRevision: BuildingRoadSystem.getTopologyRevision(),
        full: true,
    });
    await wait(4500);
    RoadsideDecorationSystem.syncViewport(scene.cameras.main.worldView, { force: true });
    const xs = created.map((entity) => entity.x);
    const ys = created.map((entity) => entity.y);
    const center = {
        x: (Math.min(...xs) + Math.max(...xs)) * 0.5,
        y: (Math.min(...ys) + Math.max(...ys)) * 0.5,
    };
    const close = created[34];
    const fogGrid = FogOfWarSystem.getGrid('scene8');
    if (fogGrid) {
        fogGrid.explored.fill(1);
        fogGrid.visible.fill(1);
        fogGrid.nextVisible.fill(1);
        fogGrid.revision += 1;
        fogGrid.active = false;
    }
    for (const otherScene of scene.game.scene.getScenes(true)) {
        if (otherScene === scene) continue;
        for (const camera of otherScene.cameras?.cameras || []) camera.setVisible(false);
    }
    scene.cameras.main.removeBounds?.();
    scene.cameras.main.stopFollow?.();
    Camera.x = center.x;
    Camera.y = center.y;
    window.__roadsideAudit.cameraState = { x: center.x, y: center.y, zoom: 0.7 };
    window.__roadsideAudit.setCamera = (x, y, zoom) => {
        window.__roadsideAudit.cameraState = { x, y, zoom };
        scene.cameras.main.setZoom(zoom);
        scene.cameras.main.centerOn(x, y);
    };
    scene._updateCamera = () => {
        const state = window.__roadsideAudit.cameraState;
        scene.cameras.main.setZoom(state.zoom);
        scene.cameras.main.centerOn(state.x, state.y);
    };
    window.__roadsideAudit.setCamera(center.x, center.y, 0.7);
    await wait(700);
    return {
        createdBuildings: created.length,
        roadTiles: BuildingRoadSystem._roadTiles.size,
        logicalRoadCells: RoadsideDecorationSystem.getStats().roadCells,
        center,
        close: { x: close.x, y: close.y },
        renderer: scene.game.renderer?.constructor?.name || 'unknown',
        stats: RoadsideDecorationSystem.getStats(),
    };
})()`);
console.log('[audit] scenario ready', JSON.stringify(setup));

await evalJs(`window.__roadsideAudit.setCanvasOnly(true)`);
await delay(500);
await screenshot('01-day-overview-1920x1080-z070.png');

await evalJs(`(() => {
    const audit = window.__roadsideAudit;
    audit.scene.cameras.main.stopFollow?.();
    audit.Camera.x = ${setup.close.x};
    audit.Camera.y = ${setup.close.y};
    audit.setCamera(${setup.close.x}, ${setup.close.y}, 1);
    audit.RoadsideDecorationSystem.syncViewport(audit.scene.cameras.main.worldView, { force: true });
})()`);
await delay(500);
await screenshot('02-road-roles-entrance-z100.png');

console.log('[audit] sampling 240-frame A/B');
const performanceResult = await evalJs(`(async () => {
    const audit = window.__roadsideAudit;
    const frames = (count) => new Promise((resolve) => {
        let remaining = count;
        const tick = () => {
            if (--remaining <= 0) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    audit.scene.cameras.main.stopFollow?.();
    audit.Camera.x = ${setup.center.x};
    audit.Camera.y = ${setup.center.y};
    audit.setCamera(${setup.center.x}, ${setup.center.y}, 0.7);
    audit.RoadsideDecorationSystem.syncViewport(audit.scene.cameras.main.worldView, { force: true });
    await frames(30);
    const sample = async (visible) => {
        for (const record of audit.RoadsideDecorationSystem._records.values()) {
            record.sprite?.setVisible?.(visible);
        }
        await frames(30);
        audit.PerformanceMonitor.reset();
        await frames(242);
        return audit.PerformanceMonitor.getSnapshot(240);
    };
    const withoutDecor = await sample(false);
    const rebuildBefore = audit.RoadsideDecorationSystem.getStats().rebuildCount;
    const withDecor = await sample(true);
    const rebuildAfter = audit.RoadsideDecorationSystem.getStats().rebuildCount;
    const stats = audit.RoadsideDecorationSystem.getStats();
    const averageDeltaMs = withDecor.averageRawDtMs - withoutDecor.averageRawDtMs;
    const p99DeltaMs = withDecor.p99RawDtMs - withoutDecor.p99RawDtMs;
    return {
        withoutDecor: {
            averageFps: withoutDecor.averageFps,
            averageRawDtMs: withoutDecor.averageRawDtMs,
            p99RawDtMs: withoutDecor.p99RawDtMs,
            averageFrameMs: withoutDecor.averageFrameMs,
        },
        withDecor: {
            averageFps: withDecor.averageFps,
            averageRawDtMs: withDecor.averageRawDtMs,
            p99RawDtMs: withDecor.p99RawDtMs,
            averageFrameMs: withDecor.averageFrameMs,
        },
        averageDeltaMs,
        p99DeltaMs,
        stableRebuildDelta: rebuildAfter - rebuildBefore,
        stats,
        renderTextureGate: averageDeltaMs >= 0.7 || p99DeltaMs >= 1.5
            || stats.activeGroundSprites > 240,
    };
})()`);
console.log('[audit] A/B ready', JSON.stringify(performanceResult));

await evalJs(`(() => {
    const audit = window.__roadsideAudit;
    audit.setCanvasOnly(true);
    document.body.classList.add('roadside-audit-performance');
    const panel = document.getElementById('devToolPanel');
    if (!panel?.classList.contains('active')) document.getElementById('devToolTrigger')?.click();
    panel?.querySelector('.dev-tool-tab[data-tab="performance"]')?.click();
    const windowSelect = document.getElementById('devPerformanceWindow');
    if (windowSelect) windowSelect.value = '240';
    document.getElementById('devPerformanceRefresh')?.click();
    if (panel) {
        panel.style.transformOrigin = 'top right';
        panel.style.transform = 'scale(0.86)';
    }
})()`);
await delay(700);
await screenshot('04-performance-panel-240frames.png');

await evalJs(`(async () => {
    const audit = window.__roadsideAudit;
    document.getElementById('devToolTrigger')?.click();
    document.body.classList.remove('roadside-audit-performance');
    audit.setCanvasOnly(true);
    audit.EnvironmentLightingSystem.configure({ startPhase: 0.75, animateSun: false });
    const current = audit.WorldWeatherSystem.getVisualState('scene8');
    if (!(current.active && current.intensityId === 'heavy')) {
        audit.WorldWeatherSystem.debugToggle('scene8', 'heavy', {
            currentSceneId: 'scene8',
            loading: false,
        });
    }
    await new Promise((resolve) => setTimeout(resolve, 3200));
    audit.RoadsideDecorationSystem.updateDynamic({
        daylight: 0,
        rainState: { active: true, intensityId: 'heavy' },
        worldTimeMs: performance.now(),
        buildings: audit.RoadsideDecorationSystem._lastSyncPayload?.buildings,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
})()`);
await screenshot('03-night-heavy-rain-same-area.png');

const report = {
    appUrl: APP_URL,
    viewport: { width: 1920, height: 1080 },
    overviewZoom: 0.7,
    closeupZoom: 1,
    setup,
    performance: performanceResult,
    browserErrors,
    blockingBrowserErrors: browserErrors.filter((message) => (
        !message.includes('[TechnologySystem] 科技配置校验失败')
    )),
    screenshots: [
        '01-day-overview-1920x1080-z070.png',
        '02-road-roles-entrance-z100.png',
        '03-night-heavy-rain-same-area.png',
        '04-performance-panel-240frames.png',
    ],
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
cleanup();
process.exit(report.blockingBrowserErrors.length ? 1 : 0);
