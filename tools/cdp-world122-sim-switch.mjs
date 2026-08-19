#!/usr/bin/env node
/* 世界-122 后台结算（M1）+ 世界切换面板实机探针（2026-08-18）：
 * A. 进 122 建矿场/仓库/兵营/12 块墙 → 捕获快照并把 capturedAt 回拨 10 分钟；
 * B. 世界切换面板：按钮存在/打开/列表/122 行离线预估 → 前往 123；
 * C. 面板切回 122：断言后台结算生效（补员满 5/采矿入仓/波次推进或胜利）。
 * 运行前提：vite dev server 已在 localhost:5173 运行。
 * 安全入口：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-world122-sim-switch.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9276;
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

    // 模块 URL 表必须在游戏启动前捕获：启动后贴图/精灵流会把早期模块条目逐出资源缓冲
    const mapReady = await waitFor(() => evaluate(`(function(){
        if (!window.Game) return false;
        const m = {};
        for (const e of performance.getEntriesByType('resource')) {
            if (e.name.includes('/src/')) { try { m[new URL(e.name).pathname] = e.name; } catch {} }
        }
        if (Object.keys(m).length < 50) return false;
        window.__probeUrlMap = m;
        return true;
    })()`), 30000);
    if (!mapReady) throw new Error('模块 URL 表捕获失败');

    const started = await waitFor(() => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        return false;
    })()`), 30000);
    if (!started) throw new Error('游戏未启动');

    // ---- A. 进 122：建造 + 捕获 + 回拨 10 分钟 ----
    const dataA = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const m = window.__probeUrlMap || {};
            const url = m[modulePath]
                || performance.getEntriesByType('resource').map((entry) => entry.name)
                    .find((entry) => entry.endsWith(modulePath) || entry.includes(modulePath + '?'));
            if (!url) throw new Error(modulePath + ' 未加载');
            return url;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        const { DefenseCover } = await import(loaded('/src/world/defense-system.js'));
        const { ProducerBuilding, ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { HamsterHut, HamsterHutSystem } = await import(loaded('/src/world/hamster-hut-system.js'));
        const { HamsterBarracks, HamsterBarracksSystem } = await import(loaded('/src/world/hamster-barracks-system.js'));
        const Snap = await import(loaded('/src/world/world122-snapshot.js'));
        const { Game } = await import(loaded('/src/game.js'));

        await SceneManager.switchScene('scene8', window.Game.player);
        if (SceneManager.currentScene !== 'scene8') return { err: 'scene8 未进入' };

        // 12 块方块墙（防线承伤）+ 矿场 + 仓库 + 兵营
        for (let i = 0; i < 12; i++) {
            const b = new DefenseCover(5300 + (i % 6) * 130, 4300 + Math.floor(i / 6) * 130, { grade: 'C', orient: 'v', block: true, id: 'probe_w' + i });
            b._builtByPlayer = true; b._buildCost = 400; b._buildCurrency = 'energy';
            Game.entities.set(b.id, b);
        }
        const hut = new HamsterHut(5800, 4500, { id: 'probe_hut' });
        hut._builtByPlayer = true; Game.entities.set(hut.id, hut); HamsterHutSystem.huts.push(hut);
        for (let i = 0; i < 6 && hut.aliveMinerCount() === 0; i++) { hut.spawnMiner(); await new Promise((r) => setTimeout(r, 300)); }
        const wh = new ProducerBuilding(6100, 4500, { id: 'probe_wh', cfgKey: 'warehouse' });
        wh._builtByPlayer = true; Game.entities.set(wh.id, wh); ProducerBuildingSystem.buildings.push(wh);
        const bar = new HamsterBarracks(5600, 4500, { id: 'probe_bar' });
        bar._builtByPlayer = true; Game.entities.set(bar.id, bar); HamsterBarracksSystem.barracks.push(bar);

        const snap = Snap.captureAndStoreWorld122();
        if (!snap) return { err: '捕获失败' };
        return {
            structures: snap.structures.length,
            miners: snap.structures.find((s) => s.kind === 'hut')?.miners,
            barUnits: snap.structures.find((s) => s.kind === 'barracks')?.units,
        };
    })()`);
    if (dataA.err) throw new Error('A 阶段: ' + dataA.err);
    check('A 建造并捕获（12 墙 + 矿场 + 仓库 + 兵营）', dataA.structures === 15 && dataA.miners >= 1);

    // ---- B. 世界切换面板：按钮/打开/122 行离线预估/前往 123 ----
    const dataB = await evaluate(`(async () => {
        const loaded = (modulePath) => (window.__probeUrlMap || {})[modulePath]
            || performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((entry) => entry.endsWith(modulePath) || entry.includes(modulePath + '?'));
        const btn = document.getElementById('worldSwitchBtn');
        if (!btn) return { err: '侧边菜单没有世界传送按钮' };
        btn.click();
        await new Promise((r) => setTimeout(r, 400));
        const panel = document.getElementById('worldSwitchPanel');
        const rows = [...panel.querySelectorAll('.ws-row')].map((row) => row.textContent);
        const row122 = rows.find((t) => t.includes('世界-122')) || '';
        const go123 = [...panel.querySelectorAll('.ws-go')].find((b) => b.dataset.world === 'scene9');
        if (!go123) return { err: '没有 123 的前往按钮' };
        go123.click();
        await new Promise((r) => setTimeout(r, 2500));
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        // 到达 123 后：回拨 122 快照 10 分钟（离场捕获会覆盖 capturedAt，必须在走后才拨），
        // 再开面板看 122 行的离线预估
        const Snap = await import(loaded('/src/world/world122-snapshot.js'));
        const stored = Snap.getWorld122Snapshot();
        if (stored) stored.capturedAt -= 180000;
        document.getElementById('worldSwitchBtn').click();
        await new Promise((r) => setTimeout(r, 400));
        const rows2 = [...document.querySelectorAll('#worldSwitchPanel .ws-row')].map((row) => row.textContent);
        const row122outside = rows2.find((t) => t.includes('世界-122')) || '';
        return {
            panelOpen: panel.classList.contains('active'),
            rowCount: rows.length,
            row122,
            row122outside,
            sceneAfter: SceneManager.currentScene,
        };
    })()`);
    if (dataB.err) throw new Error('B 阶段: ' + dataB.err);
    check('B 面板打开且列出全部世界（≥4）', dataB.panelOpen && dataB.rowCount >= 4);
    check('B 在 122 内时该行显示「当前所在」', dataB.row122.includes('当前所在'));
    check('B 在 123 看 122 行：快照概况 + 离线预估', dataB.row122outside.includes('战况')
        && dataB.row122outside.includes('预估'));
    check('B 面板传送切换到世界-123', dataB.sceneAfter === 'scene9');

    // ---- C. 面板切回 122：后台结算生效 ----
    const dataC = await evaluate(`(async () => {
        const loaded = (modulePath) => (window.__probeUrlMap || {})[modulePath]
            || performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((entry) => entry.endsWith(modulePath) || entry.includes(modulePath + '?'));
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        // B 末面板是打开状态；C 里按当前状态决定是否需要再点开
        const panel0 = document.getElementById('worldSwitchPanel');
        if (!panel0.classList.contains('active')) {
            document.getElementById('worldSwitchBtn').click();
            await new Promise((r) => setTimeout(r, 400));
        }
        const go122 = [...document.querySelectorAll('.ws-go')].find((b) => b.dataset.world === 'scene8');
        go122.click();
        await new Promise((r) => setTimeout(r, 5000));
        const { HamsterBarracksSystem } = await import(loaded('/src/world/hamster-barracks-system.js'));
        const { HamsterHutSystem } = await import(loaded('/src/world/hamster-hut-system.js'));
        const { ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { DefenseSystem } = await import(loaded('/src/world/defense-system.js'));
        const bar = HamsterBarracksSystem.barracks[0];
        const hut = HamsterHutSystem.huts[0];
        const wh = ProducerBuildingSystem.buildings.find((b) => b.cfgKey === 'warehouse');
        const Snap = window.World122Snapshot;
        const { EnergyManager } = await import(loaded('/src/systems/energy-manager.js'));
        const snapAfter = Snap.getWorld122Snapshot();
        const snapWh = snapAfter ? snapAfter.structures.find((s) => s.cfgKey === 'warehouse') : null;
        let walls = 0;
        const { Game } = await import(loaded('/src/game.js'));
        for (const e of Game.entities.values()) if (e && e._isBlockCover) walls++;
        return {
            scene: SceneManager.currentScene,
            barUnits: bar ? bar.aliveUnitCount() : -1,
            barUnitsRaw: bar ? bar.units.length : -1,
            barTimer: bar ? Math.round(bar._spawnTimer) : -1,
            hutMiners: hut ? hut.aliveMinerCount() : -1,
            whStored: wh ? Math.round(wh.storedEnergy) : -1,
            snapWhStored: snapWh ? Math.round(snapWh.storedEnergy ?? -9) : -9,
            emTotal: EnergyManager ? Math.round(EnergyManager.getEnergy()) : -9,
            wave: DefenseSystem._wave,
            phase: DefenseSystem._phase,
            victory: DefenseSystem.victory,
            wallsAlive: walls,
        };
    })()`);
    console.log('  [C 详情]', JSON.stringify(dataC));
    check('C 切回世界-122', dataC.scene === 'scene8');
    check('C 后台补员满编（兵营 5 兵）', dataC.barUnits === 5);
    check('C 后台采矿入仓（仓库 >0）', dataC.whStored > 0);
    check('C 矿工存活', dataC.hutMiners >= 1);
    check('C 波次已推进（未胜利未败北，战斗进行中）', dataC.wave >= 2 && dataC.victory === false);
    check('C 防线有墙存活', dataC.wallsAlive > 0);

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
