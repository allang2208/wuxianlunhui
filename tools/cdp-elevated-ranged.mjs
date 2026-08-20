#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9352;
const endpoint = `http://127.0.0.1:${PORT}`;
const gameUrl = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-elevated-ranged-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

async function waitFor(fn, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const value = await fn();
            if (value) return value;
        } catch {}
        await sleep(300);
    }
    return null;
}

const edge = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,720',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    `--user-data-dir=${profile}`,
    gameUrl,
], { stdio: 'ignore' });

try {
    const page = await waitFor(async () => {
        const pages = await (await fetch(`${endpoint}/json/list`)).json();
        return pages.find((tab) => tab.type === 'page');
    });
    if (!page) throw new Error('未找到游戏页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let seq = 0;
    const pending = new Map();
    const runtimeErrors = [];
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        } else if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            runtimeErrors.push(
                `${details.exception?.description || details.text || 'runtime exception'}`
                + (details.url
                    ? ` @ ${details.url}:${(details.lineNumber ?? 0) + 1}:${(details.columnNumber ?? 0) + 1}`
                    : '')
            );
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
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

    const started = await waitFor(() => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        if (window.Game && !window.Game.isRunning && typeof window.Game.start === 'function') {
            try { await window.Game.start(); } catch {}
        }
        return !!window.Game?.player;
    })()`));
    if (!started) throw new Error('游戏启动失败');

    const runtime = await evaluate(`(async () => {
        const root = location.origin;
        const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
        const moduleUrl = (part) =>
            resources.find((url) => url.includes(part) && !url.includes('?'))
            || resources.find((url) => url.includes(part))
            || (root + part);
        const elevated = await import(moduleUrl('/src/combat/elevated-ranged.js'));
        const magic = await import(moduleUrl('/src/utils/magic-craft-helper.js'));
        const { ProjectileFactory } = await import(moduleUrl('/src/utils/projectile-factory.js'));
        const { HamsterShooterAI } = await import(moduleUrl('/src/ai/hamster-shooter-ai.js'));
        const { HamsterPriestAI } = await import(moduleUrl('/src/ai/hamster-priest-ai.js'));
        const { WallSystem } = await import(moduleUrl('/src/world/wall-system.js'));
        const player = window.Game.player;
        const saved = {
            x: player.x,
            y: player.y,
            surfaceKind: player._surfaceKind,
            surfaceWall: player._surfaceWall,
            surfaceWalls: player._surfaceWalls,
            z: player.z,
            faction: player._faction,
        };
        const savedWalls = WallSystem.walls;
        const savedSegments = WallSystem.isoSegments;
        const nearOwner = { x: 5, y: 0 };
        const nearWall = {
            x: 0, y: -12, w: 10, h: 24, height: 125, _owner: nearOwner,
        };
        WallSystem.walls = [nearWall];
        WallSystem.isoSegments = [];
        player.x = -5;
        player.y = 0;
        player._surfaceKind = 'wall_walk';
        player._surfaceWall = nearOwner;
        player._surfaceWalls = [nearOwner];
        player.z = 125;
        player._faction = 'player';
        const rangeMultiplier = elevated.getElevatedRangedRangeMultiplier(player);
        const magicMultiplier = magic.getMagicRangeMultiplier(player);
        const projectile = ProjectileFactory.create({
            x: player.x,
            y: player.y,
            angle: 0,
            speed: 1000,
            maxRange: 1000,
            size: 4,
            damage: { min: 1, max: 1 },
            piercing: false,
            source: player,
            entities: window.Game.entities,
            noRender: true,
            z: 150,
            targetZ: 24,
            aimDistance: 1000,
        });
        const projectileRange = projectile.maxRange;
        for (let index = 0; index < 20 && projectile.active; index++) {
            projectile.update(16);
        }
        const nearWallProjectileActive = projectile.active;
        projectile.active = false;
        projectile._destroyPhaserSprite?.();

        const makeShooter = (surfaceKind) => ({
            id: 'cdp_shooter_' + surfaceKind,
            aiConfig: {
                attackRange: 600,
                engageRange: 900,
                attackInterval: 2000,
                projectileSpeed: 600,
            },
            animations: { attack: { frameRate: 12, frameCount: 13 } },
            data: { hp: 100 },
            _surfaceKind: surfaceKind,
            _faction: 'companion',
            x: -5,
            y: 0,
            z: surfaceKind === 'wall_walk' ? 125 : 0,
            vx: 0,
            vy: 0,
            active: true,
        });
        const enemy = {
            id: 'cdp_enemy',
            _faction: 'enemy',
            x: 695,
            y: 0,
            hp: 100,
            active: true,
        };
        const wallShooter = makeShooter('wall_walk');
        const wallAI = new HamsterShooterAI(wallShooter);
        wallAI._tick([enemy], null);
        const groundShooter = makeShooter('ground');
        const groundAI = new HamsterShooterAI(groundShooter);
        groundAI._tick([enemy], null);

        const priest = {
            id: 'cdp_priest',
            aiConfig: { castRange: 600 },
            data: { hp: 100 },
            _surfaceKind: 'wall_walk',
            _surfaceWall: nearOwner,
            _surfaceWalls: [nearOwner],
            _faction: 'companion',
            x: -5,
            y: 0,
            z: 125,
        };
        const priestAI = new HamsterPriestAI(priest);
        const priestCastRange = priestAI._castRange();
        const priestCanCastAt700 = priestAI._canCastAt(enemy);

        const farOwner = { x: 205, y: 0 };
        WallSystem.walls = [{
            x: 200, y: -12, w: 10, h: 24, height: 125, _owner: farOwner,
        }];
        const blockedShooter = makeShooter('wall_walk');
        blockedShooter._surfaceWall = nearOwner;
        blockedShooter._surfaceWalls = [nearOwner];
        const blockedAI = new HamsterShooterAI(blockedShooter);
        blockedAI._tick([enemy], null);
        const priestCanCastThroughFarWall = priestAI._canCastAt(enemy);

        const farProjectile = ProjectileFactory.create({
            x: player.x,
            y: player.y,
            angle: 0,
            speed: 1000,
            maxRange: 1000,
            size: 4,
            damage: { min: 1, max: 1 },
            piercing: false,
            source: player,
            entities: window.Game.entities,
            noRender: true,
            z: 150,
            targetZ: 24,
            aimDistance: 700,
        });
        for (let index = 0; index < 30 && farProjectile.active; index++) {
            farProjectile.update(16);
        }
        const farWallProjectileBlocked = !farProjectile.active
            && farProjectile.traveled < farProjectile.maxRange;
        farProjectile.active = false;
        farProjectile._destroyPhaserSprite?.();

        WallSystem.walls = savedWalls;
        WallSystem.isoSegments = savedSegments;
        player.x = saved.x;
        player.y = saved.y;
        player._surfaceKind = saved.surfaceKind;
        player._surfaceWall = saved.surfaceWall;
        player._surfaceWalls = saved.surfaceWalls;
        player.z = saved.z;
        player._faction = saved.faction;
        return {
            rangeMultiplier,
            magicMultiplier,
            projectileRange,
            wallShooterFiresAt700: wallAI._shotActive,
            groundShooterFiresAt700: groundAI._shotActive,
            blockedShooterFiresThroughFarWall: blockedAI._shotActive,
            wallEffectiveRange: wallAI._effectiveAttackRange(),
            groundEffectiveRange: groundAI._effectiveAttackRange(),
            priestCastRange,
            priestCanCastAt700,
            priestCanCastThroughFarWall,
            nearWallProjectileActive,
            farWallProjectileBlocked,
        };
    })()`);

    const errors = [...runtimeErrors];
    if (runtime.rangeMultiplier !== 1.2) errors.push('range multiplier mismatch');
    if (runtime.magicMultiplier !== 1.2) errors.push('magic multiplier mismatch');
    if (runtime.projectileRange !== 1200) errors.push('projectile range mismatch');
    if (!runtime.wallShooterFiresAt700 || runtime.groundShooterFiresAt700) {
        errors.push('friendly shooter decision range mismatch');
    }
    if (runtime.blockedShooterFiresThroughFarWall) {
        errors.push('friendly shooter LOS mismatch');
    }
    if (runtime.priestCastRange !== 720) errors.push('priest range mismatch');
    if (!runtime.priestCanCastAt700 || runtime.priestCanCastThroughFarWall) {
        errors.push('priest LOS mismatch');
    }
    if (!runtime.nearWallProjectileActive || !runtime.farWallProjectileBlocked) {
        errors.push('projectile wall height mismatch');
    }
    const report = { runtime, errors };
    console.log(JSON.stringify(report, null, 2));
    ws.close();
    if (errors.length) process.exitCode = 1;
} finally {
    try { edge.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
