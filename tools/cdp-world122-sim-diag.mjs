#!/usr/bin/env node
/* M1 结算诊断探针：122 内建造 → 捕获 → 直接调 settleWorld122 看报告与快照细节 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9277;
const endpoint = `http://127.0.0.1:${PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url) { return (await fetch(url)).json(); }
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
    const page = await waitFor(async () => (await json(`${endpoint}/json/list`))
        .find((tab) => tab.type === 'page' && tab.url.includes('localhost:5173')));
    if (!page) throw new Error('未找到本地游戏页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
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

    const data = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const entries = performance.getEntriesByType('resource').map((entry) => entry.name);
            const url = entries.find((entry) => entry.includes(modulePath + '?'))
                || entries.find((entry) => entry.includes(modulePath));
            if (!url) throw new Error(modulePath + ' 未加载');
            return url;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        const { ProducerBuilding, ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { HamsterHut, HamsterHutSystem } = await import(loaded('/src/world/hamster-hut-system.js'));
        const { HamsterBarracks, HamsterBarracksSystem } = await import(loaded('/src/world/hamster-barracks-system.js'));
        const Snap = window.World122Snapshot;   // 走 window 挂载：资源表 URL 可能被贴图流逐出
        const Sim = window.World122Sim;
        const { Game } = await import(loaded('/src/game.js'));

        await SceneManager.switchScene('scene8', window.Game.player);

        const hut = new HamsterHut(5800, 4500, { id: 'diag_hut' });
        hut._builtByPlayer = true; Game.entities.set(hut.id, hut); HamsterHutSystem.huts.push(hut);
        for (let i = 0; i < 6 && hut.aliveMinerCount() === 0; i++) { hut.spawnMiner(); await new Promise((r) => setTimeout(r, 300)); }
        const wh = new ProducerBuilding(6100, 4500, { id: 'diag_wh', cfgKey: 'warehouse' });
        wh._builtByPlayer = true; Game.entities.set(wh.id, wh); ProducerBuildingSystem.buildings.push(wh);
        const bar = new HamsterBarracks(5600, 4500, { id: 'diag_bar' });
        bar._builtByPlayer = true; Game.entities.set(bar.id, bar); HamsterBarracksSystem.barracks.push(bar);

        const snap = Snap.captureWorld122();
        const hutEntry = snap.structures.find((s) => s.kind === 'hut');
        const whEntry = snap.structures.find((s) => s.kind === 'producer' && s.cfgKey === 'warehouse');
        const barEntry = snap.structures.find((s) => s.kind === 'barracks');
        const report = Sim.settleWorld122(snap, 180000, { commit: true });
        return {
            hutEntry, whEntry, barEntry,
            nodesSample: snap.nodes.slice(0, 2),
            report,
            after: {
                whStored: whEntry?.storedEnergy,
                barUnits: barEntry?.units,
                hutMiners: hutEntry?.miners,
                wave: snap.wave,
            },
        };
    })()`);
    console.log(JSON.stringify(data, null, 2));
    ws.close();
} catch (err) {
    console.error('探针失败:', err.message);
    process.exit(1);
} finally {
    try { edge.kill(); } catch {}
}
