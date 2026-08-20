#!/usr/bin/env node
/* 世界-122 城墙楼梯实景取证：读取四方向吸附、独立Collider、Sprite锚点、墙顶接口和图层。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9341;
const endpoint = `http://127.0.0.1:${PORT}`;
const gameUrl = process.env.GAME_URL || 'http://localhost:5173/';
const gameHost = new URL(gameUrl).host;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-wall-stair-'));
const outDir = path.resolve('tools/verify-shots');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

async function waitFor(fn, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try { const result = await fn(); if (result) return result; } catch {}
        await sleep(300);
    }
    return null;
}

const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1920,1080',
    '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader',
    `--user-data-dir=${profile}`, gameUrl,
], { stdio: 'ignore' });

try {
    const page = await waitFor(async () => {
        const response = await fetch(`${endpoint}/json/list`);
        const pages = await response.json();
        return pages.find((tab) => tab.type === 'page' && tab.url.includes(gameHost));
    });
    if (!page) throw new Error('未找到本地游戏页');
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
            const details = message.params.exceptionDetails;
            const description = details.exception?.description
                || details.text
                || 'runtime exception';
            const location = details.url
                ? ` @ ${details.url}:${(details.lineNumber ?? 0) + 1}:${(details.columnNumber ?? 0) + 1}`
                : '';
            errors.push(`${description}${location}`);
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
            expression, awaitPromise: true, returnByValue: true,
        });
        if (result.result?.exceptionDetails) {
            throw new Error(result.result.exceptionDetails.exception?.description
                || result.result.exceptionDetails.text);
        }
        return result.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');

    const started = await waitFor(() => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        if (window.Game && !window.Game.isRunning && typeof window.Game.start === 'function') {
            try { await window.Game.start(); } catch (error) {
                window.__wallStairStartError = error?.stack || error?.message || String(error);
            }
        }
        return false;
    })()`));
    if (!started) {
        const state = await evaluate(`({
            readyState: document.readyState,
            hasGame: !!window.Game,
            running: !!window.Game?.isRunning,
            hasPlayer: !!window.Game?.player,
            startError: window.__wallStairStartError || null,
            bodyText: document.body?.innerText?.slice(0, 300) || '',
        })`);
        throw new Error(`游戏启动失败: ${JSON.stringify(state)}; runtime=${JSON.stringify(errors.slice(0, 5))}`);
    }

    let sceneReady = null;
    let lastSceneState = null;
    for (let attempt = 0; attempt < 3 && !sceneReady; attempt++) {
        await evaluate(`(async () => {
            const url = performance.getEntriesByType('resource').map(e => e.name)
                .find(n => n.includes('/src/world/scene-manager.js'));
            const { SceneManager } = await import(url);
            await SceneManager.switchScene('scene8', window.Game.player, 'explore');
            return true;
        })()`);
        sceneReady = await waitFor(() => evaluate(`(async () => {
            const resources = performance.getEntriesByType('resource').map(e => e.name);
            const url = resources.find(n => n.includes('/src/world/defense-system.js'));
            const sceneUrl = resources.find(n => n.includes('/src/world/scene-manager.js'));
            if (!url || !sceneUrl) return null;
            const { DefenseSystem } = await import(url);
            const { SceneManager } = await import(sceneUrl);
            const coverCount = Array.from(window.Game?.entities?.values?.() || [])
                .filter(e => e?._isDefenseCover && e.active && e._faceLine).length;
            const state = {
                defenseActive: !!DefenseSystem.active,
                coverCount,
                currentScene: SceneManager.currentScene,
                entityCount: window.Game?.entities?.size || 0,
                player: !!window.Game?.player,
                hasPhaserScene: !!window.__phaserScene,
            };
            window.__lastWallStairSceneState = state;
            return state.defenseActive && state.entityCount > 0 && state.hasPhaserScene ? state : null;
        })()`), 12000);
        lastSceneState = await evaluate('window.__lastWallStairSceneState || null');
    }
    if (!sceneReady) {
        throw new Error(`世界-122防守墙体初始化超时: ${JSON.stringify(lastSceneState)}`);
    }
    await sleep(1000);

    const setup = await evaluate(`(async () => {
        const resources = performance.getEntriesByType('resource').map(e => e.name);
        const find = (part) => resources.find(n => n.includes(part));
        const defense = await import(find('/src/world/defense-system.js'));
        const building = await import(find('/src/world/building-system.js'));
        const wallModule = await import(find('/src/world/wall-system.js'));
        const { DefenseSystem, WallStaircase, DefenseCover } = defense;
        const { BuildingSystem, BUILD_ITEMS } = building;
        const { WallSystem } = wallModule;
        const wallSet = new Set(Array.from(window.Game.entities.values())
            .filter(e => e?._isDefenseCover && e.active && e._faceLine));
        for (const segment of WallSystem.isoSegments || []) {
            if (segment?._owner?._isDefenseCover && segment._owner.active) wallSet.add(segment._owner);
        }
        let walls = Array.from(wallSet);
        if (!walls.length) {
            const gridUrl = new URL('/src/world/gate4-grid.js', location.origin).href;
            const { BLOCK_GRID, blockCellOf, blockCellCenter } = await import(gridUrl);
            const [ci, cj] = blockCellOf(8200, 3600);
            const createChain = (name, dir, mirror, oi, oj) => {
                const created = [];
                for (let k = -2; k <= 2; k++) {
                    const gi = oi + (dir === 'e1' ? k : 0);
                    const gj = oj + (dir === 'e2' ? k : 0);
                    const [x, y] = blockCellCenter(gi, gj);
                    const id = 'cdp_' + name + '_' + k;
                    const cover = new DefenseCover(x, y, {
                        id, block: true, grade: 'C', orient: 'v', mirror,
                    });
                    window.Game.entities.set(id, cover);
                    created.push(cover);
                }
                return created;
            };
            const vChain = createChain('wall_v', 'e2', false, ci, cj);
            const hChain = createChain('wall_h', 'e1', true, ci + 20, cj);
            walls = [...vChain, ...hChain];
        }
        const testWalls = [
            walls.find(e => e._isBlockCover && !e._facingLeft),
            walls.find(e => e._isBlockCover && e._facingLeft),
        ].filter(Boolean);
        const item = BUILD_ITEMS.find(it => it.kind === 'platform');
        const candidates = [];
        for (const testWall of testWalls) {
            const [a, b] = testWall._faceLine;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len;
            for (const side of [1, -1]) {
                BuildingSystem._placing = { item, mirror: false };
                BuildingSystem._snapEnabled = true;
                const px = mx + nx * 240 * side;
                const py = my + ny * 240 * side;
                const snap = BuildingSystem._snapFiringPlatformGrid(px, py);
                const ok = !!snap && BuildingSystem._canPlaceFiringPlatformFootprint(snap.x, snap.y, snap);
                candidates.push({
                    wallId: testWall.id,
                    wallMirror: !!testWall._facingLeft,
                    side, ok,
                    dir: snap?.dir, ascendingSign: snap?.ascendingSign,
                    x: snap?.x, y: snap?.y,
                    attachPoint: snap?.attachPoint,
                    segments: snap?.segments,
                    visualSegments: snap?.visualSegments,
                    snappedWallId: snap?.wall?.id,
                    snap,
                });
            }
        }
        const layerAudit = [];
        for (const candidate of candidates) {
            if (!candidate.snap) continue;
            const candidateSnap = candidate.snap;
            const temp = new WallStaircase(candidateSnap.x, candidateSnap.y, {
                id: 'cdp_layer_audit_' + layerAudit.length,
                dir: candidateSnap.dir,
                ascendingSign: candidateSnap.ascendingSign,
                wall: candidateSnap.wall,
                walls: candidateSnap.walls,
                attachPoint: candidateSnap.attachPoint,
                targetTopZ: candidateSnap.targetTopZ,
                segmentCount: candidateSnap.segmentCount,
                segments: candidateSnap.segments,
            });
            const wallDepth = Number(candidateSnap.wall._structureRenderDepth)
                || Number(candidateSnap.wall._faceDepth);
            const stairDepths = temp.segments.map((_segment, index) =>
                temp.renderDepthForSegment(index));
            const behindWall = candidateSnap.ascendingSign === 1;
            layerAudit.push({
                dir: candidateSnap.dir,
                ascendingSign: candidateSnap.ascendingSign,
                behindWall,
                wallDepth,
                stairDepths,
                correct: behindWall
                    ? stairDepths.every(depth => depth < wallDepth)
                    : stairDepths.every(depth => depth > wallDepth),
            });
            temp.destroy();
        }
        const chosen = candidates.find(c =>
            c.ok && c.dir === 'e1' && c.ascendingSign === 1
        ) || candidates.find(c => c.ok) || candidates.find(c => c.snap);
        if (!chosen?.snap) throw new Error('四方向均没有楼梯吸附候选');
        const snap = chosen.snap;
        const wall = snap.wall;
        const id = 'cdp_wall_stair_inspect';
        const old = window.Game.entities.get(id);
        if (old?.destroy) old.destroy();
        const stair = new WallStaircase(snap.x, snap.y, {
            id,
            dir: snap.dir,
            ascendingSign: snap.ascendingSign,
            wall: snap.wall,
            walls: snap.walls,
            attachPoint: snap.attachPoint,
            targetTopZ: snap.targetTopZ,
            segmentCount: snap.segmentCount,
            segments: snap.segments,
        });
        window.Game.entities.set(id, stair);
        DefenseSystem.platforms.push(stair);
        const turnBase = window.Game.entities.get('cdp_wall_v_0');
        let turnWall = window.Game.entities.get('cdp_wall_turn_e1');
        if (turnBase && !turnWall) {
            turnWall = new DefenseCover(turnBase.x + 64, turnBase.y + 32, {
                id: 'cdp_wall_turn_e1',
                block: true,
                grade: 'C',
                orient: 'v',
                mirror: false,
            });
            window.Game.entities.set(turnWall.id, turnWall);
        }
        const diamondDefs = [
            ['cdp_diamond_top', 10400, 3000],
            ['cdp_diamond_right', 10464, 3032],
            ['cdp_diamond_bottom', 10400, 3064],
            ['cdp_diamond_left', 10336, 3032],
        ];
        for (const [wallId, wx, wy] of diamondDefs) {
            if (window.Game.entities.has(wallId)) continue;
            const diamondWall = new DefenseCover(wx, wy, {
                id: wallId,
                block: true,
                grade: 'C',
                orient: 'v',
                mirror: false,
            });
            window.Game.entities.set(wallId, diamondWall);
        }
        window.__stairProbe = { stair, wall, defense };
        const topSegment = snap.segments[snap.segments.length - 1];
        const outward = { x: topSegment.x - wall.x, y: topSegment.y - wall.y };
        BuildingSystem._placing = { item, mirror: false };
        BuildingSystem._snapEnabled = true;
        const oppositeHover = {
            x: wall.x - outward.x * 2.5,
            y: wall.y - outward.y * 2.5,
        };
        const oppositeSnap = BuildingSystem._snapFiringPlatformGrid(
            oppositeHover.x,
            oppositeHover.y
        );
        const oppositeOk = !!oppositeSnap
            && BuildingSystem._canPlaceFiringPlatformFootprint(
                oppositeSnap.x,
                oppositeSnap.y,
                oppositeSnap
            );
        const oppositeVector = { x: -outward.x, y: -outward.y };
        const sameWallSegments = [];
        for (let index = 0; index < snap.segmentCount; index++) {
            const fromWall = snap.segmentCount - index;
            sameWallSegments.push({
                index,
                x: Math.round(wall.x + oppositeVector.x * fromWall),
                y: Math.round(wall.y + oppositeVector.y * fromWall),
                baseZ: index * (snap.targetTopZ / snap.segmentCount),
                topZ: (index + 1) * (snap.targetTopZ / snap.segmentCount),
            });
        }
        const sameWallOpposite = {
            x: sameWallSegments[0].x,
            y: sameWallSegments[0].y,
            grid: true,
            dir: snap.dir,
            ascendingSign: -snap.ascendingSign,
            outwardSign: snap.ascendingSign,
            wall,
            walls: defense.collectConnectedWalkableWalls(wall, window.Game.entities),
            attachPoint: {
                x: wall.x + oppositeVector.x * 0.5,
                y: wall.y + oppositeVector.y * 0.5,
            },
            targetTopZ: snap.targetTopZ,
            segmentCount: snap.segmentCount,
            segments: sameWallSegments,
            cost: snap.cost,
        };
        const sameWallOppositeOk = BuildingSystem._canPlaceFiringPlatformFootprint(
            sameWallOpposite.x,
            sameWallOpposite.y,
            sameWallOpposite
        );
        window.__stairProbe.oppositePlacement = {
            hover: oppositeHover,
            ok: oppositeOk,
            dir: oppositeSnap?.dir,
            ascendingSign: oppositeSnap?.ascendingSign,
            wallId: oppositeSnap?.wall?.id,
            segments: oppositeSnap?.segments,
            sameWall: {
                wallId: wall.id,
                ok: sameWallOppositeOk,
                dir: sameWallOpposite.dir,
                ascendingSign: sameWallOpposite.ascendingSign,
                attachPoint: sameWallOpposite.attachPoint,
                segments: sameWallOpposite.segments,
            },
        };
        BuildingSystem._placing = null;
        const scene = window.__phaserScene;
        scene.cameras.main.centerOn(snap.attachPoint.x, snap.attachPoint.y - 90);
        return {
            wall: { id: wall.id, x: wall.x, y: wall.y, faceLine: wall._faceLine, depth: wall._faceDepth },
            candidates: candidates.map(({ snap: _snap, ...rest }) => rest),
            layerAudit,
            chosen: { dir: snap.dir, ascendingSign: snap.ascendingSign, attachPoint: snap.attachPoint },
        };
    })()`);
    await sleep(1500);

    const runtime = await evaluate(`(async () => {
        const { stair, wall, defense, oppositePlacement } = window.__stairProbe;
        const resources = performance.getEntriesByType('resource').map(e => e.name);
        const url = resources.find(n => n.includes('/src/world/defense-system.js'));
        const wallUrl = resources.find(n => n.includes('/src/world/wall-system.js'));
        const inputUrl = resources.find(n => n.includes('/src/ui/input.js'));
        const { WallSystem } = await import(wallUrl);
        const { Input } = await import(inputUrl);
        const { default: SpatialPartitionSystem } = await import(
            '/src/systems/spatial-partition-system.js'
        );
        const { resolveRtsMoveDestination } = await import('/src/ai/rts-command-utils.js');
        const {
            getWallStairVariant,
            wallStairAnchorOffset,
            blockWallTopWalkGeometry,
            blockWallTopConnectorGeometry,
            blockWallFootprintSupportAt,
            blockWallTopRoute,
        } = await import(url);
        const scene = window.__phaserScene;
        const data = scene._neutralSprites.get(stair);
        const variant = getWallStairVariant(stair.dir, stair.ascendingSign);
        const driftWallA = new defense.DefenseCover(11000, 3000, {
            id: 'cdp_drift_wall_a',
            block: true,
            grade: 'C',
            orient: 'v',
            mirror: false,
        });
        const driftWallB = new defense.DefenseCover(11065, 3032, {
            id: 'cdp_drift_wall_b',
            block: true,
            grade: 'C',
            orient: 'v',
            mirror: false,
        });
        window.Game.entities.set(driftWallA.id, driftWallA);
        window.Game.entities.set(driftWallB.id, driftWallB);
        const freeWall = new defense.DefenseCover(11300, 3000, {
            id: 'cdp_free_wall',
            block: true,
            grade: 'C',
            orient: 'v',
            mirror: false,
        });
        window.Game.entities.set(freeWall.id, freeWall);
        const driftWallRoute = blockWallTopRoute(
            driftWallA,
            driftWallB,
            window.Game.entities
        ).map((wall) => wall.id);
        const rows = stair.segments.map((segment, index) => {
            const partName = index === stair.segments.length - 1 ? 'upper' : 'lower';
            const surface = wallStairAnchorOffset(variant, partName, 'surface');
            const entry = wallStairAnchorOffset(variant, partName, 'entry');
            const exit = wallStairAnchorOffset(variant, partName, 'exit');
            const visual = stair.visualSegments[index];
            const sprite = data?.segmentSprites?.[index];
            const surfaceZ = (segment.baseZ + segment.topZ) * 0.5;
            return {
                index, partName,
                segment: {
                    x: segment.x, y: segment.y, baseZ: segment.baseZ, topZ: segment.topZ,
                    collider: segment.collider ? {
                        x: segment.collider.x, y: segment.collider.y,
                        z: segment.collider.z, radius: segment.collider.radius,
                        height: segment.collider.height,
                    } : null,
                },
                visual,
                sprite: sprite ? {
                    x: sprite.x, y: sprite.y,
                    displayWidth: sprite.displayWidth, displayHeight: sprite.displayHeight,
                    texture: sprite.texture.key, depth: sprite.depth,
                } : null,
                expectedSurface: { x: segment.x, y: segment.y - surfaceZ },
                actualSurface: { x: visual.x + surface.x, y: visual.y + surface.y },
                entry: { x: visual.x + entry.x, y: visual.y + entry.y },
                exit: { x: visual.x + exit.x, y: visual.y + exit.y },
            };
        });
        const lower = rows[0], upper = rows[rows.length - 1];
        const wallTop = { x: stair.attachPoint.x, y: stair.attachPoint.y - stair.targetTopZ };
        const player = window.Game.player;
        const playerSprite = scene.playerSprite;
        const savedPlayer = player && playerSprite ? {
            x: player.x, y: player.y, z: player.z,
            surfaceKind: player._surfaceKind,
            surfaceRef: player._surfaceRef,
            surfaceWall: player._surfaceWall,
            surfaceWalls: player._surfaceWalls,
            platformRef: player._platformRef,
            platformLift: player._platformLift,
            surfaceRenderDepth: player._surfaceRenderDepth,
            vx: player.vx,
            vy: player.vy,
            isDodging: player.isDodging,
            dodgeTimer: player.dodgeTimer,
            dodgeCooldown: player.dodgeCooldown,
            dodgeDirection: player.dodgeDirection ? { ...player.dodgeDirection } : null,
        } : null;
        const depthSweep = [];
        if (savedPlayer) {
            for (let segmentIndex = 0; segmentIndex < stair.segments.length; segmentIndex++) {
                const segment = stair.segments[segmentIndex];
                const walk = stair.visualSegments[segmentIndex].walkSurface;
                for (let stepIndex = 1; stepIndex <= stair.stepCountPerSegment; stepIndex++) {
                    const progress = (stepIndex - 0.5) / stair.stepCountPerSegment;
                    const x = walk.entry.x + (walk.exit.x - walk.entry.x) * progress;
                    const y = walk.entry.y + (walk.exit.y - walk.entry.y) * progress;
                    player.x = x;
                    player.y = y;
                    player.z = segment.baseZ;
                    defense.DefenseSystem._updatePlatformStates(16);
                    scene._syncBodiesToPhysics();
                    scene._syncWallStaircaseLayers(window.Game);
                    scene._updateDynamicDepths();
                    const stairDepths = (data?.segmentSprites || []).map(sprite => sprite.depth);
                    const maxStairDepth = Math.max(...stairDepths);
                    depthSweep.push({
                        segmentIndex,
                        stepIndex,
                        x,
                        y,
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        platformRefId: player._platformRef?.id || null,
                        surfaceRenderDepth: player._surfaceRenderDepth,
                        unitRenderDepth: player._platformRef?.unitRenderDepth?.(),
                        sceneActualDepth: scene._staircaseActualMaxDepth?.(player._platformRef),
                        staircaseRootDepth: stair._structureRenderDepth,
                        staircaseActualMaxField: stair._actualMaxRenderDepth,
                        playerDepth: playerSprite.depth,
                        stairDepths,
                        maxStairDepth,
                        clearOfStair: playerSprite.depth > maxStairDepth,
                    });
                }
            }
            Object.assign(player, savedPlayer);
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        const blockWalk = blockWallTopWalkGeometry(wall);
        const stairConnectorAudit = (() => {
            const connector = stair.wallConnectorSurface();
            return connector ? {
                hull: connector.hull,
                sideRails: connector.sideRails,
                entry: connector.entry,
                exit: connector.exit,
            } : null;
        })();
        const wallClickChecks = [];
        const stairToWallSweep = [];
        const crossWallSweeps = [];
        const wallBoundaryClampChecks = [];
        const physicalStairToWallSweep = [];
        const highSpeedSurfaceSweeps = [];
        const realInputSweeps = [];
        let watchdogRecoveryAudit = null;
        let crowdHeightAudit = null;
        let stairGroupAudit = null;
        let friendlyStairRouteAudit = null;
        let stairWallAcrossAudit = null;
        let postCollisionSurfaceAudit = null;
        let platformOrderAudit = null;
        let stairDownAcrossAudit = null;
        let stairDownCollisionAudit = null;
        let adjacentWallTarget = null;
        let farWallTarget = null;
        if (blockWalk) {
            const topZ = wall._wallTopZ;
            const points = [
                { key: 'center', ...blockWalk.center },
                ...blockWalk.vertices.map(point => ({ key: point.key, x: point.x, y: point.y })),
            ];
            for (const point of points) {
                const resolved = defense.DefenseSystem.resolveSurfaceTarget(point.x, point.y - topZ);
                const rawSupport = blockWallFootprintSupportAt(
                    player || { groundRadius: 30 },
                    point.x,
                    point.y,
                    window.Game.entities,
                    wall
                );
                const resolvedSupport = resolved?.surfaceKind === 'wall_walk'
                    ? blockWallFootprintSupportAt(
                        player || { groundRadius: 30 },
                        resolved.x,
                        resolved.y,
                        window.Game.entities,
                        wall
                    )
                    : null;
                wallClickChecks.push({
                    key: point.key,
                    ground: { x: point.x, y: point.y },
                    screen: { x: point.x, y: point.y - topZ },
                    resolved,
                    matchesWall: resolved?.surfaceKind === 'wall_walk'
                        && resolved?.wallId === wall.id,
                    rawFootprintSupported: !!rawSupport,
                    resolvedFootprintSupported: !!resolvedSupport,
                    clampDistance: resolved
                        ? Math.hypot(resolved.x - point.x, resolved.y - point.y)
                        : null,
                });
            }
            if (savedPlayer) {
                const from = stair.visualSegments[stair.visualSegments.length - 1].walkSurface.exit;
                const to = blockWalk.center;
                player._surfaceKind = 'stairs';
                player._platformRef = stair;
                player._surfaceWall = wall;
                player._surfaceWalls = stair.walls;
                player.z = stair.targetTopZ;
                player._platformLift = stair.targetTopZ;
                for (let index = 0; index <= 12; index++) {
                    const t = index / 12;
                    player.x = from.x + (to.x - from.x) * t;
                    player.y = from.y + (to.y - from.y) * t;
                    defense.DefenseSystem._updatePlatformStates(16);
                    stairToWallSweep.push({
                        index,
                        t,
                        x: player.x,
                        y: player.y,
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        keptElevation: player.z >= stair.targetTopZ - 0.001
                            && player._surfaceKind !== 'ground',
                    });
                }
                Object.assign(player, savedPlayer);
                scene._syncBodiesToPhysics();
                scene._updateDynamicDepths();
            }
        }
        if (savedPlayer) {
            const pairs = [
                ['e2_pos', 'cdp_wall_v_-1', 'cdp_wall_v_0'],
                ['e2_neg', 'cdp_wall_v_0', 'cdp_wall_v_-1'],
                ['e1_pos', 'cdp_wall_h_-1', 'cdp_wall_h_0'],
                ['e1_neg', 'cdp_wall_h_0', 'cdp_wall_h_-1'],
            ];
            for (const [label, fromId, toId] of pairs) {
                const fromWall = window.Game.entities.get(fromId);
                const toWall = window.Game.entities.get(toId);
                const fromGeometry = blockWallTopWalkGeometry(fromWall);
                const toGeometry = blockWallTopWalkGeometry(toWall);
                const connector = blockWallTopConnectorGeometry(fromWall, toWall);
                const samples = [];
                if (fromGeometry && toGeometry && connector) {
                    player._surfaceKind = 'wall_walk';
                    player._surfaceWall = fromWall;
                    player._surfaceWalls = defense.collectConnectedWalkableWalls(
                        fromWall,
                        window.Game.entities
                    );
                    player._platformRef = null;
                    player.z = fromWall._wallTopZ;
                    player._platformLift = fromWall._wallTopZ;
                    for (let index = 0; index <= 24; index++) {
                        const t = index / 24;
                        const wantedX = fromGeometry.center.x
                            + (toGeometry.center.x - fromGeometry.center.x) * t;
                        const wantedY = fromGeometry.center.y
                            + (toGeometry.center.y - fromGeometry.center.y) * t;
                        player.x = wantedX;
                        player.y = wantedY;
                        defense.DefenseSystem._updatePlatformStates(16);
                        samples.push({
                            index,
                            t,
                            wantedX,
                            wantedY,
                            actualX: player.x,
                            actualY: player.y,
                            positionError: Math.hypot(player.x - wantedX, player.y - wantedY),
                            z: player.z,
                            surfaceKind: player._surfaceKind,
                            surfaceWallId: player._surfaceWall?.id || null,
                            passed: player.z >= fromWall._wallTopZ - 0.001
                                && player._surfaceKind === 'wall_walk'
                                && Math.hypot(player.x - wantedX, player.y - wantedY) < 0.01,
                        });
                    }
                }
                crossWallSweeps.push({
                    label,
                    fromId,
                    toId,
                    hasConnector: !!connector,
                    samples,
                    passed: samples.length === 25 && samples.every(sample => sample.passed)
                        && samples[samples.length - 1]?.surfaceWallId === toId,
                });
            }
            const adjacentWall = window.Game.entities.get('cdp_wall_v_0');
            const adjacentGeometry = blockWallTopWalkGeometry(adjacentWall);
            if (adjacentWall && adjacentGeometry) {
                adjacentWallTarget = defense.DefenseSystem.resolveSurfaceTarget(
                    adjacentGeometry.center.x,
                    adjacentGeometry.center.y - adjacentWall._wallTopZ
                );
            }
            const farWall = window.Game.entities.get('cdp_wall_v_2');
            const farGeometry = blockWallTopWalkGeometry(farWall);
            if (farWall && farGeometry) {
                farWallTarget = defense.DefenseSystem.resolveSurfaceTarget(
                    farGeometry.center.x,
                    farGeometry.center.y - farWall._wallTopZ
                );
            }
            Object.assign(player, savedPlayer);
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        if (savedPlayer && blockWalk) {
            for (const point of blockWalk.vertices) {
                const dx = point.x - blockWalk.center.x;
                const dy = point.y - blockWalk.center.y;
                const length = Math.hypot(dx, dy) || 1;
                const wanted = {
                    x: point.x + dx / length * 10,
                    y: point.y + dy / length * 10,
                };
                player._surfaceKind = 'wall_walk';
                player._surfaceWall = wall;
                player._surfaceWalls = defense.collectConnectedWalkableWalls(
                    wall,
                    window.Game.entities
                );
                player._platformRef = null;
                player.z = wall._wallTopZ;
                player._platformLift = wall._wallTopZ;
                player.x = wanted.x;
                player.y = wanted.y;
                defense.DefenseSystem._updatePlatformStates(16);
                const support = blockWallFootprintSupportAt(
                    player,
                    player.x,
                    player.y,
                    window.Game.entities,
                    player._surfaceWall
                );
                wallBoundaryClampChecks.push({
                    key: point.key,
                    wanted,
                    actual: { x: player.x, y: player.y },
                    clampDistance: Math.hypot(player.x - wanted.x, player.y - wanted.y),
                    z: player.z,
                    surfaceKind: player._surfaceKind,
                    footprintSupported: !!support,
                    passed: player._surfaceKind === 'wall_walk'
                        && player.z >= wall._wallTopZ - 0.001
                        && !!support,
                });
            }
            Object.assign(player, savedPlayer);
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        if (savedPlayer && blockWalk) {
            const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
            const runInputCase = async (
                name,
                start,
                keyCodes,
                frames,
                dodgeDirection = null,
                keySchedule = null
            ) => {
                const resolveTrace = [];
                const originalResolve = WallSystem.resolve;
                WallSystem.resolve = function(...args) {
                    const rawTarget = { x: args[2], y: args[3] };
                    const result = originalResolve.apply(this, args);
                    const ignore = args[5];
                    if (ignore?.surfaceEntity === player) {
                        resolveTrace.push({
                            from: { x: args[0], y: args[1] },
                            rawTarget,
                            projectedTarget: ignore._surfaceProjectedTarget,
                            surfaceProjected: !!ignore._surfaceProjected,
                            result: { x: result.x, y: result.y },
                            surfaceKind: player._surfaceKind,
                            surfaceWallId: player._surfaceWall?.id || null,
                        });
                    }
                    return result;
                };
                Input.keys.clear();
                player.x = start.x;
                player.y = start.y;
                player.z = start.z;
                player.vx = 0;
                player.vy = 0;
                player._surfaceKind = start.surfaceKind;
                player._surfaceWall = start.wall || wall;
                player._surfaceWalls = start.wall
                    ? defense.collectConnectedWalkableWalls(start.wall, window.Game.entities)
                    : stair.walls;
                player._platformRef = start.platform || null;
                player._platformLift = start.z;
                player._surfaceSafeX = undefined;
                player._surfaceSafeY = undefined;
                player.isDodging = !!dodgeDirection;
                player.dodgeTimer = dodgeDirection ? 300 : 0;
                player.dodgeCooldown = 0;
                if (dodgeDirection) player.dodgeDirection = { ...dodgeDirection };
                defense.DefenseSystem._updatePlatformStates(16);
                for (const code of keyCodes) Input.keys.add(code);
                const rows = [];
                for (let frame = 0; frame < frames; frame++) {
                    if (typeof keySchedule === 'function') {
                        Input.keys.clear();
                        for (const code of keySchedule(frame) || []) Input.keys.add(code);
                    }
                    await waitFrame();
                    const surfaceWallDepth = Math.max(
                        -Infinity,
                        ...(player._surfaceWalls || [])
                            .map((surfaceWall) => Number(surfaceWall?._faceDepth))
                            .filter(Number.isFinite)
                    );
                    rows.push({
                        frame,
                        activeKeys: Array.from(Input.keys),
                        x: player.x,
                        y: player.y,
                        z: player.z,
                        vx: player.vx,
                        vy: player.vy,
                        surfaceKind: player._surfaceKind,
                        surfaceRefId: player._surfaceRef?.id || null,
                        surfaceWallId: player._surfaceWall?.id || null,
                        platformRefId: player._platformRef?.id || null,
                        surfaceRenderDepth: Number.isFinite(player._surfaceRenderDepth)
                            ? player._surfaceRenderDepth
                            : null,
                        surfaceWallDepth: Number.isFinite(surfaceWallDepth)
                            ? surfaceWallDepth
                            : null,
                        playerDepth: scene.playerSprite?.depth ?? null,
                        sweepClamped: !!player._surfaceSweepClamped,
                        boundarySlid: !!player._surfaceBoundarySlid,
                        boundaryInset: Number(player._surfaceBoundaryInset) || 0,
                        stuckFrames: Number(player._surfaceStuckFrames) || 0,
                        emergencyRecovered: !!player._surfaceEmergencyRecovered,
                        emergencyDistance: Number(player._surfaceEmergencyDistance) || 0,
                        surfaceCandidateCount: Number(player._surfaceCandidateCount) || 0,
                        sharedSeam: !!player._surfaceWasSharedSeam,
                        elevatedPatch: player._elevatedNavigationPatch || null,
                        elevatedBridge: !!player._elevatedNavigationBridge,
                        moveAxes: (player._surfaceMoveAxes || []).map(axis => ({
                            x: axis.x,
                            y: axis.y,
                        })),
                    });
                }
                Input.keys.clear();
                player.isDodging = false;
                WallSystem.resolve = originalResolve;
                const frameSteps = rows.slice(1).map((row, index) =>
                    Math.hypot(
                        row.x - rows[index].x,
                        row.y - rows[index].y
                    ));
                const wallSwitches = rows.slice(1).flatMap((row, index) => {
                    const previous = rows[index];
                    if (row.surfaceWallId === previous.surfaceWallId) return [];
                    return [{
                        frame: row.frame,
                        fromWallId: previous.surfaceWallId,
                        toWallId: row.surfaceWallId,
                        distance: frameSteps[index],
                    }];
                });
                let maxConsecutiveZeroFrames = 0;
                let zeroStreak = 0;
                for (let index = 1; index < rows.length; index++) {
                    const distance = Math.hypot(
                        rows[index].x - rows[index - 1].x,
                        rows[index].y - rows[index - 1].y
                    );
                    zeroStreak = distance < 0.05 ? zeroStreak + 1 : 0;
                    maxConsecutiveZeroFrames = Math.max(maxConsecutiveZeroFrames, zeroStreak);
                }
                return {
                    name,
                    keys: keyCodes,
                    rows,
                    displacement: rows.length
                        ? Math.hypot(rows[rows.length - 1].x - start.x, rows[rows.length - 1].y - start.y)
                        : 0,
                    groundFrames: rows.filter(row => row.surfaceKind === 'ground').length,
                    zeroMoveFrames: rows.filter((row, index) => index > 0
                        && Math.hypot(row.x - rows[index - 1].x, row.y - rows[index - 1].y) < 0.05).length,
                    maxFrameStep: frameSteps.length ? Math.max(...frameSteps) : 0,
                    maxConsecutiveZeroFrames,
                    emergencyRecoveries: rows.filter((row) => row.emergencyRecovered).length,
                    wallSwitches,
                    elevatedLayerViolations: rows.filter((row) =>
                        (row.surfaceKind === 'wall_walk' || row.surfaceKind === 'stairs')
                        && Number.isFinite(row.surfaceRenderDepth)
                        && Number.isFinite(row.playerDepth)
                        && row.playerDepth < row.surfaceRenderDepth + 0.9
                    ).length,
                    surfaceKindChanges: rows.slice(1).flatMap((row, index) =>
                        row.surfaceKind === rows[index].surfaceKind ? [] : [{
                            frame: row.frame,
                            from: rows[index].surfaceKind,
                            to: row.surfaceKind,
                        }]),
                    resolveTrace,
                };
            };
            const upperWalk = stair.visualSegments[stair.visualSegments.length - 1].walkSurface;
            const stairStart = {
                x: upperWalk.entry.x + (upperWalk.exit.x - upperWalk.entry.x) * 0.72,
                y: upperWalk.entry.y + (upperWalk.exit.y - upperWalk.entry.y) * 0.72,
                z: stair.segments[stair.segments.length - 1].baseZ,
                surfaceKind: 'stairs',
                wall,
                platform: stair,
            };
            const toWall = {
                x: blockWalk.center.x - stairStart.x,
                y: blockWalk.center.y - stairStart.y,
            };
            const toWallLength = Math.hypot(toWall.x, toWall.y) || 1;
            realInputSweeps.push(await runInputCase(
                'stair_to_wall_keyd',
                stairStart,
                ['KeyD'],
                36
            ));
            realInputSweeps.push(await runInputCase(
                'stair_to_wall_dodge',
                stairStart,
                [],
                28,
                { x: toWall.x / toWallLength, y: toWall.y / toWallLength }
            ));
            realInputSweeps.push(await runInputCase(
                'wall_to_stair_aw',
                {
                    x: blockWalk.center.x,
                    y: blockWalk.center.y,
                    z: wall._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall,
                    platform: null,
                },
                ['KeyA', 'KeyW'],
                40
            ));
            const neighbor = window.Game.entities.get('cdp_wall_v_-1');
            const neighborGeometry = blockWallTopWalkGeometry(neighbor);
            const wallToNeighbor = {
                x: neighborGeometry.center.x - blockWalk.center.x,
                y: neighborGeometry.center.y - blockWalk.center.y,
            };
            const wallToNeighborLength = Math.hypot(wallToNeighbor.x, wallToNeighbor.y) || 1;
            realInputSweeps.push(await runInputCase(
                'wall_to_neighbor_dodge',
                {
                    x: blockWalk.center.x,
                    y: blockWalk.center.y,
                    z: wall._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall,
                    platform: null,
                },
                [],
                28,
                {
                    x: wallToNeighbor.x / wallToNeighborLength,
                    y: wallToNeighbor.y / wallToNeighborLength,
                }
            ));
            realInputSweeps.push(await runInputCase(
                'wall_to_neighbor_as',
                {
                    x: blockWalk.center.x,
                    y: blockWalk.center.y,
                    z: wall._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall,
                    platform: null,
                },
                ['KeyA', 'KeyS'],
                48
            ));
            realInputSweeps.push(await runInputCase(
                'wall_to_neighbor_a',
                {
                    x: blockWalk.center.x,
                    y: blockWalk.center.y,
                    z: wall._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall,
                    platform: null,
                },
                ['KeyA'],
                48
            ));
            realInputSweeps.push(await runInputCase(
                'wall_to_neighbor_s',
                {
                    x: blockWalk.center.x,
                    y: blockWalk.center.y,
                    z: wall._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall,
                    platform: null,
                },
                ['KeyS'],
                48
            ));
            realInputSweeps.push(await runInputCase(
                'neighbor_to_wall_dw',
                {
                    x: neighborGeometry.center.x,
                    y: neighborGeometry.center.y,
                    z: neighbor._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: neighbor,
                    platform: null,
                },
                ['KeyD', 'KeyW'],
                48
            ));
            realInputSweeps.push(await runInputCase(
                'neighbor_to_wall_d',
                {
                    x: neighborGeometry.center.x,
                    y: neighborGeometry.center.y,
                    z: neighbor._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: neighbor,
                    platform: null,
                },
                ['KeyD'],
                48
            ));
            realInputSweeps.push(await runInputCase(
                'neighbor_to_wall_w',
                {
                    x: neighborGeometry.center.x,
                    y: neighborGeometry.center.y,
                    z: neighbor._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: neighbor,
                    platform: null,
                },
                ['KeyW'],
                48
            ));
            const driftGeometryA = blockWallTopWalkGeometry(driftWallA);
            realInputSweeps.push(await runInputCase(
                'drift_wall_ds',
                {
                    x: driftGeometryA.center.x,
                    y: driftGeometryA.center.y,
                    z: driftWallA._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: driftWallA,
                    platform: null,
                },
                ['KeyD', 'KeyS'],
                30
            ));
            const freeGeometry = blockWallTopWalkGeometry(freeWall);
            for (const [name, key] of [
                ['free_surface_w', 'KeyW'],
                ['free_surface_a', 'KeyA'],
                ['free_surface_s', 'KeyS'],
                ['free_surface_d', 'KeyD'],
            ]) {
                realInputSweeps.push(await runInputCase(
                    name,
                    {
                        x: freeGeometry.center.x,
                        y: freeGeometry.center.y,
                        z: freeWall._wallTopZ,
                        surfaceKind: 'wall_walk',
                        wall: freeWall,
                        platform: null,
                    },
                    [key],
                    3
                ));
            }
            const turnBase = window.Game.entities.get('cdp_wall_v_0');
            const turnGeometry = blockWallTopWalkGeometry(turnBase);
            realInputSweeps.push(await runInputCase(
                'wall_turn_ds',
                {
                    x: turnGeometry.center.x,
                    y: turnGeometry.center.y,
                    z: turnBase._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: turnBase,
                    platform: null,
                },
                ['KeyD', 'KeyS'],
                34
            ));
            const diamondTop = window.Game.entities.get('cdp_diamond_top');
            const diamondRight = window.Game.entities.get('cdp_diamond_right');
            const diamondBottom = window.Game.entities.get('cdp_diamond_bottom');
            const diamondLeft = window.Game.entities.get('cdp_diamond_left');
            const diamondTopGeometry = blockWallTopWalkGeometry(diamondTop);
            const diamondRightGeometry = blockWallTopWalkGeometry(diamondRight);
            const diamondBottomGeometry = blockWallTopWalkGeometry(diamondBottom);
            const diamondLeftGeometry = blockWallTopWalkGeometry(diamondLeft);
            realInputSweeps.push(await runInputCase(
                'diamond_bottom_to_top_w',
                {
                    x: diamondBottomGeometry.center.x,
                    y: diamondBottomGeometry.center.y,
                    z: diamondBottom._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondBottom,
                    platform: null,
                },
                ['KeyW'],
                100
            ));
            realInputSweeps.push(await runInputCase(
                'diamond_left_to_top_dw',
                {
                    x: diamondLeftGeometry.center.x,
                    y: diamondLeftGeometry.center.y,
                    z: diamondLeft._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondLeft,
                    platform: null,
                },
                ['KeyD', 'KeyW'],
                36
            ));
            realInputSweeps.push(await runInputCase(
                'diamond_right_to_top_aw',
                {
                    x: diamondRightGeometry.center.x,
                    y: diamondRightGeometry.center.y,
                    z: diamondRight._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondRight,
                    platform: null,
                },
                ['KeyA', 'KeyW'],
                36
            ));
            const diamondDodge = {
                x: diamondTopGeometry.center.x - diamondBottomGeometry.center.x,
                y: diamondTopGeometry.center.y - diamondBottomGeometry.center.y,
            };
            const diamondDodgeLength = Math.hypot(diamondDodge.x, diamondDodge.y) || 1;
            realInputSweeps.push(await runInputCase(
                'diamond_bottom_to_top_dodge',
                {
                    x: diamondBottomGeometry.center.x,
                    y: diamondBottomGeometry.center.y,
                    z: diamondBottom._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondBottom,
                    platform: null,
                },
                [],
                28,
                {
                    x: diamondDodge.x / diamondDodgeLength,
                    y: diamondDodge.y / diamondDodgeLength,
                }
            ));
            realInputSweeps.push(await runInputCase(
                'diamond_direction_recovery',
                {
                    x: diamondBottomGeometry.center.x,
                    y: diamondBottomGeometry.center.y,
                    z: diamondBottom._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondBottom,
                    platform: null,
                },
                [],
                125,
                null,
                (frame) => {
                    if (frame < 25) return ['KeyW'];
                    if (frame < 50) return ['KeyD'];
                    if (frame < 75) return ['KeyS'];
                    if (frame < 100) return ['KeyA'];
                    return ['KeyW'];
                }
            ));
            const stressDirections = [
                ['KeyW'],
                ['KeyD'],
                ['KeyS'],
                ['KeyA'],
                ['KeyW', 'KeyD'],
                ['KeyS', 'KeyD'],
                ['KeyS', 'KeyA'],
                ['KeyW', 'KeyA'],
            ];
            realInputSweeps.push(await runInputCase(
                'diamond_direction_stress',
                {
                    x: diamondBottomGeometry.center.x,
                    y: diamondBottomGeometry.center.y,
                    z: diamondBottom._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondBottom,
                    platform: null,
                },
                [],
                192,
                null,
                (frame) => stressDirections[Math.floor(frame / 8) % stressDirections.length]
            ));
            player.x = diamondLeftGeometry.center.x;
            player.y = diamondLeftGeometry.center.y;
            player.z = diamondLeft._wallTopZ;
            player._surfaceKind = 'wall_walk';
            player._surfaceWall = diamondLeft;
            player._surfaceWalls = defense.collectConnectedWalkableWalls(
                diamondLeft,
                window.Game.entities
            );
            player._platformRef = null;
            player._platformLift = player.z;
            player._surfaceSafeX = player.x;
            player._surfaceSafeY = player.y;
            player._surfaceInputIntent = { x: 0, y: -1 };
            player._surfaceStuckFrames = 1;
            const watchdogBefore = { x: player.x, y: player.y };
            defense.DefenseSystem._updatePlatformStates(16);
            watchdogRecoveryAudit = {
                recovered: !!player._surfaceEmergencyRecovered,
                distance: Math.hypot(
                    player.x - watchdogBefore.x,
                    player.y - watchdogBefore.y
                ),
                surfaceKind: player._surfaceKind,
                surfaceWallId: player._surfaceWall?.id || null,
                ground: player._surfaceKind === 'ground',
            };
            const crowdEntities = [];
            const addCrowdEntity = (id, x, y, z, withSprite = false) => {
                const collider = {
                    x,
                    y,
                    z,
                    height: 40,
                    get bottomZ() { return this.z; },
                    get topZ() { return this.z + this.height; },
                };
                const entity = {
                    id,
                    x,
                    y,
                    z,
                    active: true,
                    faction: 'enemy',
                    _faction: 'enemy',
                    groundRadius: 18,
                    collisionRadius: 18,
                    collisionShape: 'circle',
                    noCollision: false,
                    noSeparation: true,
                    collider,
                    size: 36,
                    update() {},
                };
                if (withSprite && scene.playerSprite?.texture?.key) {
                    entity._phaserSprite = scene.add.sprite(x, y, scene.playerSprite.texture.key);
                    entity._phaserSprite.setDisplaySize(36, 36);
                }
                window.Game.entities.set(id, entity);
                crowdEntities.push(entity);
                return entity;
            };
            const resetPlayerOnCrowdWall = () => {
                player.x = diamondLeftGeometry.center.x;
                player.y = diamondLeftGeometry.center.y;
                player.z = diamondLeft._wallTopZ;
                player._surfaceKind = 'wall_walk';
                player._surfaceWall = diamondLeft;
                player._surfaceWalls = defense.collectConnectedWalkableWalls(
                    diamondLeft,
                    window.Game.entities
                );
                player._platformRef = null;
                player._platformLift = player.z;
                player._surfaceSafeX = player.x;
                player._surfaceSafeY = player.y;
                player._surfaceInputIntent = { x: 0, y: 0 };
                player.collider?.syncPosition?.();
                defense.DefenseSystem._updatePlatformStates(16);
                scene._syncBodiesToPhysics();
                scene._updateDynamicDepths();
            };
            resetPlayerOnCrowdWall();
            const elevatedBefore = { x: player.x, y: player.y };
            for (let index = 0; index < 12; index++) {
                addCrowdEntity(
                    'cdp_ground_crowd_' + index,
                    player.x - 6 - (index % 3),
                    player.y + (index - 5.5) * 0.7,
                    0,
                    true
                );
            }
            SpatialPartitionSystem.forceRebuild(window.Game.entities);
            window.Game.resolveCollisions();
            scene._updateDynamicDepths();
            const lowerDepths = crowdEntities
                .map((entity) => entity._phaserSprite?.depth)
                .filter(Number.isFinite);
            const elevatedDisplacement = Math.hypot(
                player.x - elevatedBefore.x,
                player.y - elevatedBefore.y
            );
            const elevatedDepthClear = !lowerDepths.length
                || scene.playerSprite.depth > Math.max(...lowerDepths);
            realInputSweeps.push(await runInputCase(
                'crowd_shift_dw',
                {
                    x: diamondLeftGeometry.center.x,
                    y: diamondLeftGeometry.center.y,
                    z: diamondLeft._wallTopZ,
                    surfaceKind: 'wall_walk',
                    wall: diamondLeft,
                    platform: null,
                },
                ['ShiftLeft', 'KeyD', 'KeyW'],
                30
            ));
            for (const entity of crowdEntities.splice(0)) {
                entity._phaserSprite?.destroy();
                window.Game.entities.delete(entity.id);
            }
            resetPlayerOnCrowdWall();
            const sameLevelBefore = { x: player.x, y: player.y };
            addCrowdEntity(
                'cdp_same_level_crowd',
                player.x - 6,
                player.y,
                player.z,
                false
            );
            SpatialPartitionSystem.forceRebuild(window.Game.entities);
            window.Game.resolveCollisions();
            const sameLevelDisplacement = Math.hypot(
                player.x - sameLevelBefore.x,
                player.y - sameLevelBefore.y
            );
            crowdHeightAudit = {
                elevatedDisplacement,
                elevatedDepthClear,
                playerDepth: scene.playerSprite.depth,
                maxLowerDepth: lowerDepths.length ? Math.max(...lowerDepths) : null,
                sameLevelDisplacement,
            };
            for (const entity of crowdEntities.splice(0)) {
                entity._phaserSprite?.destroy();
                window.Game.entities.delete(entity.id);
            }
            SpatialPartitionSystem.forceRebuild(window.Game.entities);
            const friendlyWalk = stair.visualSegments[0].walkSurface;
            const friendly = {
                id: 'cdp_friendly_stair_route',
                x: friendlyWalk.entry.x,
                y: friendlyWalk.entry.y,
                z: 0,
                active: true,
                _faction: 'player',
                faction: 'player',
                groundRadius: 18,
                collisionRadius: 18,
                _surfaceKind: 'ground',
                _surfaceInputIntent: { x: 0, y: 0 },
            };
            friendly.collider = {
                x: friendly.x,
                y: friendly.y,
                z: friendly.z,
                height: 36,
                syncPosition() {
                    this.x = friendly.x;
                    this.y = friendly.y;
                    this.z = friendly.z;
                },
                get bottomZ() { return this.z; },
                get topZ() { return this.z + this.height; },
            };
            window.Game.friendlyUnits.push(friendly);
            defense.DefenseSystem._updatePlatformStates(16);
            const friendlyTarget = {
                x: blockWalk.center.x,
                y: blockWalk.center.y,
                z: wall._wallTopZ,
                surfaceKind: 'wall_walk',
                wallId: wall.id,
            };
            const friendlyCommand = {
                mode: 'move',
                point: {
                    ...friendlyTarget,
                    route: stair.routePoints(friendlyTarget),
                },
            };
            const friendlyRows = [];
            for (let frame = 0; frame < 320; frame++) {
                const move = resolveRtsMoveDestination(friendly, friendlyCommand);
                if (move.arrived) break;
                const dx = move.destination.x - friendly.x;
                const dy = move.destination.y - friendly.y;
                const distance = Math.hypot(dx, dy);
                if (distance > 1e-6) {
                    const step = Math.min(180 * 0.016, distance);
                    const resolved = WallSystem.resolve(
                        friendly.x,
                        friendly.y,
                        friendly.x + dx / distance * step,
                        friendly.y + dy / distance * step,
                        friendly.groundRadius,
                        WallSystem.ignoreForEntity?.(friendly) || null
                    );
                    friendly.x = resolved.x;
                    friendly.y = resolved.y;
                }
                friendly.collider.syncPosition();
                defense.DefenseSystem._updatePlatformStates(16);
                friendlyRows.push({
                    frame,
                    x: friendly.x,
                    y: friendly.y,
                    z: friendly.z,
                    surfaceKind: friendly._surfaceKind,
                    surfaceWallId: friendly._surfaceWall?.id || null,
                    platformRefId: friendly._platformRef?.id || null,
                    routeIndex: Number(friendlyCommand.routeIndex) || 0,
                });
            }
            const friendlyFinalMove = resolveRtsMoveDestination(friendly, friendlyCommand);
            friendlyStairRouteAudit = {
                routeLength: friendlyCommand.point.route.length,
                rows: friendlyRows,
                arrived: friendlyFinalMove.arrived,
                finalSurfaceKind: friendly._surfaceKind,
                finalWallId: friendly._surfaceWall?.id || null,
                finalZ: friendly.z,
                groundFrames: friendlyRows.filter((row) => row.surfaceKind === 'ground').length,
                belowGroundFrames: friendlyRows.filter((row) => row.z < -0.001).length,
                maxZeroStreak: (() => {
                    let max = 0;
                    let streak = 0;
                    for (let index = 1; index < friendlyRows.length; index++) {
                        const distance = Math.hypot(
                            friendlyRows[index].x - friendlyRows[index - 1].x,
                            friendlyRows[index].y - friendlyRows[index - 1].y
                        );
                        streak = distance < 0.05 ? streak + 1 : 0;
                        max = Math.max(max, streak);
                    }
                    return max;
                })(),
            };
            const friendlyIndex = window.Game.friendlyUnits.indexOf(friendly);
            if (friendlyIndex >= 0) window.Game.friendlyUnits.splice(friendlyIndex, 1);
            const topWalkSurface = stair.visualSegments[stair.visualSegments.length - 1].walkSurface;
            const topConnector = stair.wallConnectorSurface();
            const acrossCases = [];
            const downAcrossCases = [];
            for (const across of [0.1, 0.25, 0.5, 0.75, 0.9]) {
                const stairEdge = {
                    x: topWalkSurface.exitB.x
                        + (topWalkSurface.exitA.x - topWalkSurface.exitB.x) * across,
                    y: topWalkSurface.exitB.y
                        + (topWalkSurface.exitA.y - topWalkSurface.exitB.y) * across,
                };
                const wallEdge = {
                    x: topConnector.exitB.x
                        + (topConnector.exitA.x - topConnector.exitB.x) * across,
                    y: topConnector.exitB.y
                        + (topConnector.exitA.y - topConnector.exitB.y) * across,
                };
                player._surfaceKind = 'stairs';
                player._platformRef = stair;
                player._surfaceWall = wall;
                player._surfaceWalls = stair.walls;
                player._surfaceSafeX = stairEdge.x;
                player._surfaceSafeY = stairEdge.y;
                player.z = stair.targetTopZ;
                player._platformLift = player.z;
                const rowsAcross = [];
                for (let index = 0; index <= 18; index++) {
                    let px;
                    let py;
                    if (index <= 12) {
                        const t = index / 12;
                        px = stairEdge.x + (wallEdge.x - stairEdge.x) * t;
                        py = stairEdge.y + (wallEdge.y - stairEdge.y) * t;
                    } else {
                        const t = (index - 12) / 6;
                        px = wallEdge.x + (blockWalk.center.x - wallEdge.x) * t;
                        py = wallEdge.y + (blockWalk.center.y - wallEdge.y) * t;
                    }
                    player.x = px;
                    player.y = py;
                    defense.DefenseSystem._updatePlatformStates(16);
                    rowsAcross.push({
                        index,
                        x: player.x,
                        y: player.y,
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        platformRefId: player._platformRef?.id || null,
                        surfaceWallId: player._surfaceWall?.id || null,
                        elevatedPatch: player._elevatedNavigationPatch || null,
                        sharedSeam: !!player._surfaceWasSharedSeam,
                    });
                }
                acrossCases.push({
                    across,
                    rows: rowsAcross,
                    groundFrames: rowsAcross.filter((row) => row.surfaceKind === 'ground').length,
                    belowGroundFrames: rowsAcross.filter((row) => row.z < -0.001).length,
                    finalSurfaceKind: rowsAcross[rowsAcross.length - 1]?.surfaceKind,
                });
                const upperEntry = {
                    x: topWalkSurface.entryB.x
                        + (topWalkSurface.entryA.x - topWalkSurface.entryB.x) * across,
                    y: topWalkSurface.entryB.y
                        + (topWalkSurface.entryA.y - topWalkSurface.entryB.y) * across,
                };
                const upperInterior = {
                    x: upperEntry.x + (stairEdge.x - upperEntry.x) * 0.8,
                    y: upperEntry.y + (stairEdge.y - upperEntry.y) * 0.8,
                };
                const downIntentDx = topConnector.entry.x - blockWalk.center.x;
                const downIntentDy = topConnector.entry.y - blockWalk.center.y;
                const downIntentLength = Math.hypot(downIntentDx, downIntentDy) || 1;
                player._surfaceKind = 'wall_walk';
                player._platformRef = null;
                player._surfaceWall = wall;
                player._surfaceWalls = stair.walls;
                player._surfaceSafeX = blockWalk.center.x;
                player._surfaceSafeY = blockWalk.center.y;
                player._surfaceInputIntent = {
                    x: downIntentDx / downIntentLength,
                    y: downIntentDy / downIntentLength,
                };
                player.z = stair.targetTopZ;
                player._platformLift = player.z;
                const downRows = [];
                for (let index = 0; index <= 24; index++) {
                    let px;
                    let py;
                    if (index <= 6) {
                        const t = index / 6;
                        px = blockWalk.center.x + (wallEdge.x - blockWalk.center.x) * t;
                        py = blockWalk.center.y + (wallEdge.y - blockWalk.center.y) * t;
                    } else if (index <= 18) {
                        const t = (index - 6) / 12;
                        px = wallEdge.x + (stairEdge.x - wallEdge.x) * t;
                        py = wallEdge.y + (stairEdge.y - wallEdge.y) * t;
                    } else {
                        const t = (index - 18) / 6;
                        px = stairEdge.x + (upperInterior.x - stairEdge.x) * t;
                        py = stairEdge.y + (upperInterior.y - stairEdge.y) * t;
                    }
                    player.x = px;
                    player.y = py;
                    defense.DefenseSystem._updatePlatformStates(16);
                    downRows.push({
                        index,
                        x: player.x,
                        y: player.y,
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        surfaceRefId: player._surfaceRef?.id || null,
                        platformRefId: player._platformRef?.id || null,
                        candidateCount: player._surfaceCandidateCount || 0,
                    });
                }
                downAcrossCases.push({
                    across,
                    rows: downRows,
                    groundFrames: downRows.filter((row) => row.surfaceKind === 'ground').length,
                    belowGroundFrames: downRows.filter((row) => row.z < -0.001).length,
                    finalSurfaceKind: downRows[downRows.length - 1]?.surfaceKind,
                    surfaceChanges: downRows.slice(1).flatMap((row, index) =>
                        row.surfaceKind === downRows[index].surfaceKind ? [] : [{
                            frame: row.index,
                            from: downRows[index].surfaceKind,
                            to: row.surfaceKind,
                        }]),
                });
            }
            stairWallAcrossAudit = {
                wallTopZ: wall._wallTopZ,
                stairTopZ: stair.targetTopZ,
                heightDifference: Math.abs(stair.targetTopZ - wall._wallTopZ),
                connectorCenterHalfWidth: stair.walkWidth / 2 - defense.WALL_STAIR_CONFIG.edgeHalfThick,
                cases: acrossCases,
                passed: acrossCases.every((entry) =>
                    entry.groundFrames === 0
                    && entry.belowGroundFrames === 0
                    && entry.finalSurfaceKind === 'wall_walk'),
            };
            stairDownAcrossAudit = {
                cases: downAcrossCases,
                passed: downAcrossCases.every((entry) =>
                    entry.groundFrames === 0
                    && entry.belowGroundFrames === 0
                    && entry.finalSurfaceKind === 'stairs'),
            };
            const middleDown = downAcrossCases.find((entry) => entry.across === 0.5);
            if (middleDown?.rows?.length) {
                const startRow = middleDown.rows[8];
                player.x = startRow.x;
                player.y = startRow.y;
                player.z = startRow.z;
                player._surfaceKind = 'wall_walk';
                player._surfaceWall = wall;
                player._surfaceWalls = stair.walls;
                player._platformRef = null;
                player._platformLift = player.z;
                player._surfaceInputIntent = {
                    x: topConnector.entry.x - blockWalk.center.x,
                    y: topConnector.entry.y - blockWalk.center.y,
                };
                player.collider?.syncPosition?.();
                defense.DefenseSystem._updatePlatformStates(16);
                const beforePush = { x: player.x, y: player.y };
                const downPusher = addCrowdEntity(
                    'cdp_down_connector_pusher',
                    player.x - 6,
                    player.y,
                    player.z,
                    false
                );
                SpatialPartitionSystem.forceRebuild(window.Game.entities);
                window.Game.resolveCollisions();
                defense.DefenseSystem.reconcileElevatedSurfaces();
                const afterReconcile = {
                    x: player.x,
                    y: player.y,
                    z: player.z,
                    surfaceKind: player._surfaceKind,
                    platformRefId: player._platformRef?.id || null,
                };
                const continueRows = [];
                for (let frame = 0; frame < 30; frame++) {
                    const dx = topConnector.entry.x - player.x;
                    const dy = topConnector.entry.y - player.y;
                    const distance = Math.hypot(dx, dy);
                    if (distance > 1e-6) {
                        const step = Math.min(4, distance);
                        const resolved = WallSystem.resolve(
                            player.x,
                            player.y,
                            player.x + dx / distance * step,
                            player.y + dy / distance * step,
                            player.groundRadius,
                            WallSystem.ignoreForEntity?.(player) || null
                        );
                        player.x = resolved.x;
                        player.y = resolved.y;
                    }
                    player._surfaceInputIntent = {
                        x: topConnector.entry.x - blockWalk.center.x,
                        y: topConnector.entry.y - blockWalk.center.y,
                    };
                    defense.DefenseSystem._updatePlatformStates(16);
                    window.Game.resolveCollisions();
                    defense.DefenseSystem.reconcileElevatedSurfaces();
                    continueRows.push({
                        frame,
                        x: player.x,
                        y: player.y,
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        platformRefId: player._platformRef?.id || null,
                        elevatedPatch: player._elevatedNavigationPatch || null,
                        elevatedBridge: !!player._elevatedNavigationBridge,
                    });
                    if (player._surfaceKind === 'stairs') break;
                }
                window.Game.entities.delete(downPusher.id);
                const downPusherIndex = crowdEntities.indexOf(downPusher);
                if (downPusherIndex >= 0) crowdEntities.splice(downPusherIndex, 1);
                SpatialPartitionSystem.forceRebuild(window.Game.entities);
                stairDownCollisionAudit = {
                    pushDistance: Math.hypot(
                        afterReconcile.x - beforePush.x,
                        afterReconcile.y - beforePush.y
                    ),
                    afterReconcile,
                    continueRows,
                    finalSurfaceKind: continueRows[continueRows.length - 1]?.surfaceKind
                        || afterReconcile.surfaceKind,
                    ground: afterReconcile.surfaceKind === 'ground'
                        || continueRows.some((row) => row.surfaceKind === 'ground'),
                };
            }
            const stairGroup = [stair];
            for (let groupIndex = 1; groupIndex <= 2; groupIndex++) {
                const groupWall = window.Game.entities.get(
                    groupIndex === 1 ? 'cdp_wall_v_-1' : 'cdp_wall_v_0'
                );
                const offsetX = (-64 - 5 / Math.sqrt(1.25)) * groupIndex;
                const offsetY = (32 + 2.5 / Math.sqrt(1.25)) * groupIndex;
                const groupStair = new defense.WallStaircase(
                    stair.x + offsetX,
                    stair.y + offsetY,
                    {
                        id: 'cdp_stair_group_' + groupIndex,
                        dir: stair.dir,
                        ascendingSign: stair.ascendingSign,
                        wall: groupWall,
                        walls: defense.collectConnectedWalkableWalls(
                            groupWall,
                            window.Game.entities
                        ),
                        attachPoint: {
                            x: stair.attachPoint.x + offsetX,
                            y: stair.attachPoint.y + offsetY,
                        },
                        targetTopZ: stair.targetTopZ,
                        segmentCount: stair.segmentCount,
                        segments: stair.segments.map((segment) => ({
                            x: segment.x + offsetX,
                            y: segment.y + offsetY,
                        })),
                    }
                );
                window.Game.entities.set(groupStair.id, groupStair);
                defense.DefenseSystem.platforms.push(groupStair);
                stairGroup.push(groupStair);
            }
            const groupVersionBefore = Number(defense.DefenseSystem._wallStairGroupVersion) || 0;
            for (const groupStair of stairGroup) {
                delete groupStair._sharedStairSurfaces;
                delete groupStair._sharedRailSegments;
                delete groupStair._wallStairGroupVersion;
            }
            defense.DefenseSystem._wallStairGroupCheckTimer = 0;
            defense.DefenseSystem.update(0);
            const groupVersionAfter = Number(defense.DefenseSystem._wallStairGroupVersion) || 0;
            scene._syncNeutralEntities(window.Game);
            scene._syncWallStaircaseLayers(window.Game);
            const lowerProgress = 0.55;
            const lowerPoint = (groupStair) => {
                const surface = groupStair.visualSegments[0].walkSurface;
                const entry = {
                    x: (surface.entryA.x + surface.entryB.x) * 0.5,
                    y: (surface.entryA.y + surface.entryB.y) * 0.5,
                };
                const exit = {
                    x: (surface.exitA.x + surface.exitB.x) * 0.5,
                    y: (surface.exitA.y + surface.exitB.y) * 0.5,
                };
                return {
                    x: entry.x + (exit.x - entry.x) * lowerProgress,
                    y: entry.y + (exit.y - entry.y) * lowerProgress,
                };
            };
            const groupStart = lowerPoint(stairGroup[0]);
            const groupEnd = lowerPoint(stairGroup[2]);
            const expectedGroupStep = Math.min(
                stair.stepCountPerSegment,
                Math.floor(lowerProgress * stair.stepCountPerSegment) + 1
            );
            const expectedGroupZ = stair.segments[0].baseZ
                + (stair.segments[0].topZ - stair.segments[0].baseZ)
                    * expectedGroupStep / stair.stepCountPerSegment;
            const lateralRows = [];
            const lateralGridRows = [];
            player._surfaceKind = 'stairs';
            player._platformRef = stairGroup[0];
            player._surfaceWall = stairGroup[0].wall;
            player._surfaceWalls = stairGroup[0].walls;
            player.z = expectedGroupZ;
            player._platformLift = expectedGroupZ;
            for (let index = 0; index <= 48; index++) {
                const t = index / 48;
                player.x = groupStart.x + (groupEnd.x - groupStart.x) * t;
                player.y = groupStart.y + (groupEnd.y - groupStart.y) * t;
                defense.DefenseSystem._updatePlatformStates(16);
                lateralRows.push({
                    index,
                    x: player.x,
                    y: player.y,
                    z: player.z,
                    surfaceKind: player._surfaceKind,
                    platformRefId: player._platformRef?.id || null,
                    sharedSeam: !!player._surfaceWasSharedSeam,
                });
            }
            for (let segmentIndex = 0; segmentIndex < stair.segmentCount; segmentIndex++) {
                for (const progress of [0.15, 0.5, 0.85]) {
                    const startSurface = stairGroup[0].visualSegments[segmentIndex].walkSurface;
                    const endSurface = stairGroup[2].visualSegments[segmentIndex].walkSurface;
                    const pointAt = (surface) => ({
                        x: (surface.entryA.x + surface.entryB.x) * 0.5
                            + ((surface.exitA.x + surface.exitB.x)
                                - (surface.entryA.x + surface.entryB.x)) * 0.5 * progress,
                        y: (surface.entryA.y + surface.entryB.y) * 0.5
                            + ((surface.exitA.y + surface.exitB.y)
                                - (surface.entryA.y + surface.entryB.y)) * 0.5 * progress,
                    });
                    const startPoint = pointAt(startSurface);
                    const endPoint = pointAt(endSurface);
                    const segment = stairGroup[0].segments[segmentIndex];
                    const stepIndex = Math.min(
                        stair.stepCountPerSegment,
                        Math.floor(progress * stair.stepCountPerSegment) + 1
                    );
                    const expectedZ = segment.baseZ
                        + (segment.topZ - segment.baseZ) * stepIndex / stair.stepCountPerSegment;
                    player._surfaceKind = 'stairs';
                    player._platformRef = stairGroup[0];
                    player._surfaceWall = stairGroup[0].wall;
                    player._surfaceWalls = stairGroup[0].walls;
                    player.z = expectedZ;
                    player._platformLift = expectedZ;
                    for (let index = 0; index <= 32; index++) {
                        const t = index / 32;
                        player.x = startPoint.x + (endPoint.x - startPoint.x) * t;
                        player.y = startPoint.y + (endPoint.y - startPoint.y) * t;
                        defense.DefenseSystem._updatePlatformStates(16);
                        lateralGridRows.push({
                            segmentIndex,
                            progress,
                            index,
                            z: player.z,
                            expectedZ,
                            surfaceKind: player._surfaceKind,
                            elevatedPatch: player._elevatedNavigationPatch || null,
                            sharedSeam: !!player._surfaceWasSharedSeam,
                        });
                    }
                }
            }
            realInputSweeps.push(await runInputCase(
                'stair_group_as',
                {
                    x: groupStart.x,
                    y: groupStart.y,
                    z: expectedGroupZ,
                    surfaceKind: 'stairs',
                    wall: stairGroup[0].wall,
                    platform: stairGroup[0],
                },
                ['KeyA', 'KeyS'],
                70
            ));
            const platformOrder = [...defense.DefenseSystem.platforms];
            defense.DefenseSystem.platforms.reverse();
            const reversedCase = await runInputCase(
                'stair_group_as_reversed',
                {
                    x: groupStart.x,
                    y: groupStart.y,
                    z: expectedGroupZ,
                    surfaceKind: 'stairs',
                    wall: stairGroup[0].wall,
                    platform: stairGroup[0],
                },
                ['KeyA', 'KeyS'],
                70
            );
            realInputSweeps.push(reversedCase);
            defense.DefenseSystem.platforms.splice(
                0,
                defense.DefenseSystem.platforms.length,
                ...platformOrder
            );
            platformOrderAudit = {
                finalPlatformRefId: reversedCase.rows[reversedCase.rows.length - 1]?.platformRefId,
                groundFrames: reversedCase.groundFrames,
                maxZeroStreak: reversedCase.maxConsecutiveZeroFrames,
                layerViolations: reversedCase.elevatedLayerViolations,
            };
            const collisionSeam = stairGroup[0]._sharedStairSurfaces.find((seam) =>
                seam.segmentIndex === 0 && !seam.connector);
            if (collisionSeam) {
                player.x = collisionSeam.entry.x
                    + (collisionSeam.exit.x - collisionSeam.entry.x) * lowerProgress;
                player.y = collisionSeam.entry.y
                    + (collisionSeam.exit.y - collisionSeam.entry.y) * lowerProgress;
                player.z = expectedGroupZ;
                player._surfaceKind = 'stairs';
                player._platformRef = stairGroup[0];
                player._surfaceWall = stairGroup[0].wall;
                player._surfaceWalls = stairGroup[0].walls;
                player._platformLift = player.z;
                player._surfaceSafeX = player.x;
                player._surfaceSafeY = player.y;
                player.collider?.syncPosition?.();
                defense.DefenseSystem._updatePlatformStates(16);
                const beforeCollision = {
                    x: player.x,
                    y: player.y,
                    surfaceKind: player._surfaceKind,
                    surfaceRefId: player._surfaceRef?.id || null,
                    platformRefId: player._platformRef?.id || null,
                    candidateCount: player._surfaceCandidateCount || 0,
                    sharedSeam: !!player._surfaceWasSharedSeam,
                };
                const pusher = addCrowdEntity(
                    'cdp_same_level_stair_pusher',
                    player.x - 6,
                    player.y,
                    player.z,
                    false
                );
                SpatialPartitionSystem.forceRebuild(window.Game.entities);
                window.Game.resolveCollisions();
                const displacement = Math.hypot(
                    player.x - beforeCollision.x,
                    player.y - beforeCollision.y
                );
                defense.DefenseSystem.reconcileElevatedSurfaces();
                postCollisionSurfaceAudit = {
                    displacement,
                    beforeCollision,
                    finalSurfaceKind: player._surfaceKind,
                    finalSurfaceRefId: player._surfaceRef?.id || null,
                    finalPlatformRefId: player._platformRef?.id || null,
                    finalZ: player.z,
                    ground: player._surfaceKind === 'ground',
                    platformMatchesSurface: player._surfaceRef === player._platformRef,
                };
                window.Game.entities.delete(pusher.id);
                const pusherIndex = crowdEntities.indexOf(pusher);
                if (pusherIndex >= 0) crowdEntities.splice(pusherIndex, 1);
                SpatialPartitionSystem.forceRebuild(window.Game.entities);
            }
            stairGroupAudit = {
                stairCount: stairGroup.length,
                centerOffsetErrors: stairGroup.slice(1).map((groupStair, index) => {
                    const previous = stairGroup[index];
                    return Math.hypot(
                        (groupStair.segments[0].x - previous.segments[0].x) - (-64),
                        (groupStair.segments[0].y - previous.segments[0].y) - 32
                    );
                }),
                autoRebuiltLegacyInstances: groupVersionAfter > groupVersionBefore
                    && stairGroup.every((groupStair) =>
                        Array.isArray(groupStair._sharedStairSurfaces)
                        && Array.isArray(groupStair._sharedRailSegments)),
                sharedSurfaceCounts: stairGroup.map((groupStair) =>
                    groupStair._sharedStairSurfaces?.length || 0),
                sharedRailCounts: stairGroup.map((groupStair) =>
                    groupStair._sharedRailSegments?.length || 0),
                edgeCounts: stairGroup.map((groupStair) =>
                    groupStair._edgeSegs?.length || 0),
                lateralRows,
                lateralPassed: lateralRows.every((row) => row.surfaceKind === 'stairs'),
                multiLevelPassed: lateralGridRows.every((row) =>
                    row.surfaceKind === 'stairs'
                    && Math.abs(row.z - row.expectedZ) < 0.001),
                lateralGridRows,
            };
            const removeGroupStair = (groupStair) => {
                groupStair._unregisterEdgeSegs?.();
                groupStair.active = false;
                const platformIndex = defense.DefenseSystem.platforms.indexOf(groupStair);
                if (platformIndex >= 0) defense.DefenseSystem.platforms.splice(platformIndex, 1);
                defense.DefenseSystem.rebuildWallStairGroups();
            };
            removeGroupStair(stairGroup[2]);
            stairGroupAudit.afterRemoveThird = {
                activeCount: defense.DefenseSystem.platforms.filter((candidate) =>
                    candidate?.active && candidate._isWallStaircase
                    && (candidate === stairGroup[0] || candidate === stairGroup[1])).length,
                sharedSurfaceCounts: stairGroup.slice(0, 2).map((groupStair) =>
                    groupStair._sharedStairSurfaces?.length || 0),
                edgeCounts: stairGroup.slice(0, 2).map((groupStair) =>
                    groupStair._edgeSegs?.length || 0),
            };
            removeGroupStair(stairGroup[1]);
            stairGroupAudit.afterRemoveSecond = {
                sharedSurfaceCount: stairGroup[0]._sharedStairSurfaces?.length || 0,
                edgeCount: stairGroup[0]._edgeSegs?.length || 0,
            };
            Object.assign(player, savedPlayer);
            if (savedPlayer.dodgeDirection) player.dodgeDirection = { ...savedPlayer.dodgeDirection };
            Input.keys.clear();
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        if (savedPlayer && blockWalk) {
            const upperWalk = stair.visualSegments[stair.visualSegments.length - 1].walkSurface;
            const start = {
                x: upperWalk.entry.x + (upperWalk.exit.x - upperWalk.entry.x) * 0.75,
                y: upperWalk.entry.y + (upperWalk.exit.y - upperWalk.entry.y) * 0.75,
            };
            const baseAngle = Math.atan2(
                blockWalk.center.y - start.y,
                blockWalk.center.x - start.x
            );
            for (const distance of [10, 20, 40, 80, 120]) {
                for (const angleOffsetDeg of [-20, 0, 20]) {
                    player.x = start.x;
                    player.y = start.y;
                    player.z = stair.segments[stair.segments.length - 1].baseZ;
                    player._surfaceKind = 'stairs';
                    player._platformRef = stair;
                    player._surfaceWall = wall;
                    player._surfaceWalls = stair.walls;
                    player._platformLift = player.z;
                    player._surfaceSafeX = undefined;
                    player._surfaceSafeY = undefined;
                    defense.DefenseSystem._updatePlatformStates(16);
                    const angle = baseAngle + angleOffsetDeg * Math.PI / 180;
                    const wanted = {
                        x: player.x + Math.cos(angle) * distance,
                        y: player.y + Math.sin(angle) * distance,
                    };
                    const ignore = WallSystem.ignoreForEntity(player);
                    const moved = WallSystem.resolve(
                        player.x,
                        player.y,
                        wanted.x,
                        wanted.y,
                        player.groundRadius,
                        ignore
                    );
                    player.x = moved.x;
                    player.y = moved.y;
                    defense.DefenseSystem._updatePlatformStates(16);
                    highSpeedSurfaceSweeps.push({
                        distance,
                        angleOffsetDeg,
                        wanted,
                        actual: { x: player.x, y: player.y },
                        z: player.z,
                        surfaceKind: player._surfaceKind,
                        sweepClamped: !!player._surfaceSweepClamped,
                        remainingToWallCenter: Math.hypot(
                            blockWalk.center.x - player.x,
                            blockWalk.center.y - player.y
                        ),
                        passed: player._surfaceKind !== 'ground'
                            && player.z >= stair.segments[stair.segments.length - 1].baseZ
                            && Number.isFinite(player.x)
                            && Number.isFinite(player.y),
                    });
                }
            }
            Object.assign(player, savedPlayer);
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        if (savedPlayer && blockWalk) {
            const upperWalk = stair.visualSegments[stair.visualSegments.length - 1].walkSurface;
            player.x = upperWalk.entry.x + (upperWalk.exit.x - upperWalk.entry.x) * 0.82;
            player.y = upperWalk.entry.y + (upperWalk.exit.y - upperWalk.entry.y) * 0.82;
            player.z = stair.segments[stair.segments.length - 1].baseZ;
            player._surfaceKind = 'stairs';
            player._platformRef = stair;
            player._surfaceWall = wall;
            player._surfaceWalls = stair.walls;
            player._platformLift = player.z;
            defense.DefenseSystem._updatePlatformStates(16);
            for (let frame = 0; frame < 160; frame++) {
                const dx = blockWalk.center.x - player.x;
                const dy = blockWalk.center.y - player.y;
                const distance = Math.hypot(dx, dy);
                if (distance <= 1) break;
                const step = Math.min(4, distance);
                const wanted = {
                    x: player.x + dx / distance * step,
                    y: player.y + dy / distance * step,
                };
                const ignore = WallSystem.ignoreForEntity(player);
                const canMove = WallSystem.canMoveTo(
                    wanted.x,
                    wanted.y,
                    player.groundRadius,
                    ignore
                );
                const pathBlocked = WallSystem.blocked(
                    player.x,
                    player.y,
                    wanted.x,
                    wanted.y,
                    ignore
                );
                const nearest = WallSystem._nearestBlockingSeg?.(
                    wanted.x,
                    wanted.y,
                    player.groundRadius,
                    ignore
                );
                const moved = WallSystem.resolve(
                    player.x,
                    player.y,
                    wanted.x,
                    wanted.y,
                    player.groundRadius,
                    ignore
                );
                const before = { x: player.x, y: player.y };
                player.x = moved.x;
                player.y = moved.y;
                defense.DefenseSystem._updatePlatformStates(16);
                physicalStairToWallSweep.push({
                    frame,
                    wanted,
                    actual: { x: player.x, y: player.y },
                    moveDistance: Math.hypot(player.x - before.x, player.y - before.y),
                    remaining: Math.hypot(blockWalk.center.x - player.x, blockWalk.center.y - player.y),
                    z: player.z,
                    surfaceKind: player._surfaceKind,
                    platformRefId: player._platformRef?.id || null,
                    surfaceWallId: player._surfaceWall?.id || null,
                    canMove,
                    pathBlocked,
                    nearestBlockingSeg: nearest ? {
                        x1: nearest.x1,
                        y1: nearest.y1,
                        x2: nearest.x2,
                        y2: nearest.y2,
                        halfThick: nearest.halfThick,
                        stairEdge: !!nearest._stairEdge,
                        cover: !!nearest._cover,
                        ownerId: nearest._owner?.id || null,
                    } : null,
                    dropped: player._surfaceKind === 'ground' || player.z < stair.targetTopZ - 35,
                });
            }
            Object.assign(player, savedPlayer);
            scene._syncBodiesToPhysics();
            scene._updateDynamicDepths();
        }
        return {
            stair: {
                id: stair.id, x: stair.x, y: stair.y, dir: stair.dir,
                ascendingSign: stair.ascendingSign, targetTopZ: stair.targetTopZ,
                segmentCount: stair.segmentCount, wallCount: stair.walls.length,
            },
            rows,
            errors: {
                surface0: Math.hypot(
                    lower.actualSurface.x - lower.expectedSurface.x,
                    lower.actualSurface.y - lower.expectedSurface.y),
                surface1: Math.hypot(
                    upper.actualSurface.x - upper.expectedSurface.x,
                    upper.actualSurface.y - upper.expectedSurface.y),
                segmentGap: Math.hypot(lower.exit.x - upper.entry.x, lower.exit.y - upper.entry.y),
                wallGap: Math.hypot(upper.exit.x - wallTop.x, upper.exit.y - wallTop.y),
            },
            wall: {
                id: wall.id, depth: wall._faceDepth,
                structureDepth: wall._structureRenderDepth,
                topWalk: blockWalk ? {
                    center: blockWalk.center,
                    vertices: blockWalk.vertices,
                    edgeTolerance: blockWalk.edgeTolerance,
                    stairAttachTolerance: blockWalk.stairAttachTolerance,
                } : null,
                sprite: scene._neutralSprites.get(wall)?.sprite ? {
                    x: scene._neutralSprites.get(wall).sprite.x,
                    y: scene._neutralSprites.get(wall).sprite.y,
                    texture: scene._neutralSprites.get(wall).sprite.texture.key,
                    depth: scene._neutralSprites.get(wall).sprite.depth,
                } : null,
            },
            depthSweep,
            wallClickChecks,
            stairToWallSweep,
            stairConnectorAudit,
            oppositePlacement,
            crossWallSweeps,
            wallBoundaryClampChecks,
            physicalStairToWallSweep,
            highSpeedSurfaceSweeps,
            realInputSweeps,
            watchdogRecoveryAudit,
            crowdHeightAudit,
            stairGroupAudit,
            friendlyStairRouteAudit,
            stairWallAcrossAudit,
            stairDownAcrossAudit,
            stairDownCollisionAudit,
            postCollisionSurfaceAudit,
            platformOrderAudit,
            adjacentWallTarget,
            farWallTarget,
            driftWallRoute,
        };
    })()`);

    let screenshot = null;
    try {
        const shot = await send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
        });
        if (shot?.result?.data) {
            screenshot = path.join(outDir, 'wall-stair-live.png');
            fs.writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
        }
    } catch (error) {
        console.warn('[wall-stair-probe] 截图失败，逻辑报告仍会保存:', error?.message || error);
    }
    if (!runtime) {
        errors.push('semantic: runtime report missing');
    } else {
        const groupAudit = runtime.stairGroupAudit;
        if (!groupAudit?.lateralPassed || !groupAudit?.multiLevelPassed) {
            errors.push('semantic: stair group lateral coverage failed');
        }
        if (!runtime.stairWallAcrossAudit?.passed) {
            errors.push('semantic: stair-wall across-width transition failed');
        }
        if (!runtime.stairDownAcrossAudit?.passed) {
            errors.push('semantic: wall-to-stair across-width transition failed');
        }
        if (runtime.stairDownCollisionAudit?.ground
            || runtime.stairDownCollisionAudit?.finalSurfaceKind !== 'stairs') {
            errors.push('semantic: wall-to-stair post-collision transition failed');
        }
        if (!runtime.friendlyStairRouteAudit?.arrived
            || runtime.friendlyStairRouteAudit?.groundFrames > 0
            || runtime.friendlyStairRouteAudit?.belowGroundFrames > 0) {
            errors.push('semantic: friendly stair route failed');
        }
        if (runtime.postCollisionSurfaceAudit?.ground
            || !runtime.postCollisionSurfaceAudit?.platformMatchesSurface) {
            errors.push('semantic: post-collision surface reconciliation failed');
        }
        if (runtime.platformOrderAudit?.groundFrames > 0
            || runtime.platformOrderAudit?.maxZeroStreak > 2
            || runtime.platformOrderAudit?.layerViolations > 0) {
            errors.push('semantic: platform order stability failed');
        }
        if (runtime.crowdHeightAudit?.elevatedDisplacement > 0.001
            || !runtime.crowdHeightAudit?.elevatedDepthClear
            || !(runtime.crowdHeightAudit?.sameLevelDisplacement > 0)) {
            errors.push('semantic: crowd height isolation failed');
        }
    }
    const report = { setup, runtime, errors, screenshot };
    fs.writeFileSync(path.join(outDir, 'wall-stair-live.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    try { edge.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
