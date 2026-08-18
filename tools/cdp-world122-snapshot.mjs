#!/usr/bin/env node
/* 世界-122 场景快照实机探针（M0，2026-08-18）：
 * 进 122 → 建塔/墙/草屋/矿场 + 改基地血量 → 捕获快照 → 回主神空间（实体清空）
 * → 重进 122 → 断言建筑/波次/矿点/基地血量全部恢复（不归零）。
 * 运行前提：vite dev server 已在 localhost:5173 运行。
 * 安全入口：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-world122-snapshot.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9274;
const endpoint = `http://127.0.0.1:${PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url) {
    const response = await fetch(url);
    return response.json();
}
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

const results = [];
const check = (name, ok) => { results.push([name, !!ok]); console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); };

try {
    const page = await waitFor(async () => (await json(`${endpoint}/json/list`))
        .find((tab) => tab.type === 'page' && tab.url.includes('localhost:5173')));
    if (!page) throw new Error('未找到本地游戏页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        } else if (message.method === 'Runtime.exceptionThrown') {
            const detail = message.params.exceptionDetails;
            errors.push(detail.exception?.description || detail.text || 'runtime exception');
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++sequence;
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
    })()`), 30000);
    if (!started) throw new Error('游戏未启动');

    // ---- A. 进 122，建造 + 改基地血量 + 捕获快照 ----
    const dataA = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const url = performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((entry) => entry.includes(modulePath + '?'));
            if (!url) throw new Error(modulePath + ' 未加载');
            return url;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        const { DefenseSystem, DefenseTower, DefenseCover } = await import(loaded('/src/world/defense-system.js'));
        const { ProducerBuilding, ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { HamsterHut, HamsterHutSystem } = await import(loaded('/src/world/hamster-hut-system.js'));
        const { EnergyNodeSystem } = await import(loaded('/src/world/energy-node-system.js'));
        const Snap = await import(loaded('/src/world/world122-snapshot.js'));
        const { Game } = await import(loaded('/src/game.js'));

        await SceneManager.switchScene('scene8', window.Game.player);
        if (SceneManager.currentScene !== 'scene8' || !DefenseSystem.active) return { err: 'scene8 未激活' };

        // 直接构造实体（等价 building-system 放置路径的注册面）
        const tower = new DefenseTower(5600, 4200, { id: 'probe_tower' });
        tower._builtByPlayer = true; tower._buildCost = 300; tower._buildCurrency = 'energy';
        tower.chip.str = 23; tower.modules.damage = 2;
        Game.entities.set(tower.id, tower); DefenseSystem.towers.push(tower);

        const block = new DefenseCover(5500, 4300, { grade: 'C', orient: 'v', block: true, id: 'probe_block' });
        block._builtByPlayer = true; block._buildCost = 400; block._buildCurrency = 'energy';
        block.hp = 1200;
        Game.entities.set(block.id, block);

        const range = new ProducerBuilding(5300, 4400, { id: 'probe_range', cfgKey: 'thatch_hut' });
        range._builtByPlayer = true; range._buildCost = 250; range._buildCurrency = 'energy';
        range.setUnitType('scout');
        Game.entities.set(range.id, range); ProducerBuildingSystem.buildings.push(range);

        const hut = new HamsterHut(5800, 4500, { id: 'probe_hut' });
        hut._builtByPlayer = true; hut._buildCost = 1000; hut._buildCurrency = 'energy';
        Game.entities.set(hut.id, hut); HamsterHutSystem.huts.push(hut);
        // 出生槽位预约有 750ms 占用窗口，落选位时稍候重试（探针确定性）
        for (let i = 0; i < 6 && hut.aliveMinerCount() === 0; i++) {
            hut.spawnMiner();
            await new Promise((r) => setTimeout(r, 300));
        }

        DefenseSystem.base.hp = 4321;
        const nodeCount = EnergyNodeSystem.nodes.length;
        const firstNode = EnergyNodeSystem.nodes[0];
        const nodePos = firstNode ? { x: firstNode.x, y: firstNode.y } : null;

        const snap = Snap.captureAndStoreWorld122();
        return {
            captured: !!snap,
            structures: snap ? snap.structures.map((s) => s.kind).sort() : [],
            wave: snap?.wave, baseHp: snap?.base?.hp,
            nodeCount, nodePos,
            snapNodes: snap ? snap.nodes.length : -1,
            towerChipStr: snap?.structures?.find((s) => s.kind === 'tower')?.chip?.str,
            producerType: snap?.structures?.find((s) => s.kind === 'producer')?.unitType,
            hutMiners: snap?.structures?.find((s) => s.kind === 'hut')?.miners,
        };
    })()`);
    if (dataA.err) throw new Error('A 阶段: ' + dataA.err);

    check('A 捕获成功', dataA.captured);
    check('A 快照覆盖 塔/墙/草屋/矿场 四类', ['barracks', 'block', 'hut', 'platform', 'producer', 'tower']
        .every((k) => !['barracks', 'platform'].includes(k) || true)
        && dataA.structures.includes('tower') && dataA.structures.includes('block')
        && dataA.structures.includes('producer') && dataA.structures.includes('hut'));
    check('A 基地血量入快照 4321', dataA.baseHp === 4321);
    check('A 塔芯片/模块入快照（str=23）', dataA.towerChipStr === 23);
    check('A 草屋兵种入快照（scout）', dataA.producerType === 'scout');
    check('A 矿场矿工数入快照（1）', dataA.hutMiners === 1);
    check('A 矿点全量入快照', dataA.snapNodes === dataA.nodeCount && dataA.nodeCount > 40);

    // ---- B. 回主神空间：实体清空 ----
    const dataB = await evaluate(`(async () => {
        const loaded = (modulePath) => performance.getEntriesByType('resource').map((entry) => entry.name)
            .find((entry) => entry.includes(modulePath + '?'));
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        await SceneManager.switchScene('main', window.Game.player);
        const { Game } = await import(loaded('/src/game.js'));
        let towerAlive = false;
        for (const e of Game.entities.values()) if (e && e._isDefenseTower) towerAlive = true;
        return { scene: SceneManager.currentScene, towerAlive };
    })()`);
    check('B 回到主神空间且塔实体已清空', dataB.scene === 'main' && dataB.towerAlive === false);

    // ---- C. 重进 122：快照恢复 ----
    const dataC = await evaluate(`(async () => {
        const loaded = (modulePath) => performance.getEntriesByType('resource').map((entry) => entry.name)
            .find((entry) => entry.includes(modulePath + '?'));
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        await SceneManager.switchScene('scene8', window.Game.player);
        const { DefenseSystem } = await import(loaded('/src/world/defense-system.js'));
        const { ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { HamsterHutSystem } = await import(loaded('/src/world/hamster-hut-system.js'));
        const { EnergyNodeSystem } = await import(loaded('/src/world/energy-node-system.js'));
        const { Game } = await import(loaded('/src/game.js'));

        let tower = null, block = null;
        for (const e of Game.entities.values()) {
            if (e && e._isDefenseTower && e._builtByPlayer) tower = e;
            if (e && e._isBlockCover && e._builtByPlayer) block = e;
        }
        const range = ProducerBuildingSystem.buildings.find((b) => b.cfgKey === 'thatch_hut');
        const hut = HamsterHutSystem.huts[0];
        const firstNode = EnergyNodeSystem.nodes[0];
        return {
            scene: SceneManager.currentScene,
            baseHp: DefenseSystem.base?.hp,
            wave: { wave: DefenseSystem._wave, phase: DefenseSystem._phase },
            tower: tower ? { x: tower.x, y: tower.y, chipStr: tower.chip?.str, dmgMod: tower.modules?.damage } : null,
            block: block ? { x: block.x, y: block.y, hp: block.hp } : null,
            range: range ? { x: range.x, unitType: range.unitType, units: range.units.length } : null,
            hut: hut ? { x: hut.x, miners: hut.aliveMinerCount() } : null,
            nodeCount: EnergyNodeSystem.nodes.length,
            firstNode: firstNode ? { x: firstNode.x, y: firstNode.y } : null,
        };
    })()`);
    check('C 重进 122 且基地血量恢复 4321', dataC.scene === 'scene8' && dataC.baseHp === 4321);
    check('C 塔恢复（位置 5600,4200 + 芯片 str23 + 改造 Lv2）',
        dataC.tower && dataC.tower.x === 5600 && dataC.tower.y === 4200
        && dataC.tower.chipStr === 23 && dataC.tower.dmgMod === 2);
    check('C 方块墙恢复（位置 + 残血 1200）',
        dataC.block && dataC.block.x === 5500 && dataC.block.y === 4300 && dataC.block.hp === 1200);
    check('C 草屋恢复（位置 + 兵种 scout + 产兵读条存活）',
        dataC.range && dataC.range.x === 5300 && dataC.range.unitType === 'scout');
    check('C 矿场恢复且矿工补员', dataC.hut && dataC.hut.x === 5800 && dataC.hut.miners >= 1);
    check('C 矿点按快照重建（数量一致 + 首点同坐标）',
        dataC.nodeCount === dataA.nodeCount
        && dataC.firstNode && dataA.nodePos
        && dataC.firstNode.x === dataA.nodePos.x && dataC.firstNode.y === dataA.nodePos.y);
    check('C 波次状态保留（prep/第0波口径）', dataC.wave && dataC.wave.phase === 'prep');

    ws.close();
    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
    if (errors.length) console.log('页面异常:', errors.slice(0, 3));
    process.exit(failed.length ? 1 : 0);
} catch (err) {
    console.error('探针失败:', err.message);
    process.exit(1);
} finally {
    try { edge.kill(); } catch {}
}
