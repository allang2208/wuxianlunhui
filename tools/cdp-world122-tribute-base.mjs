#!/usr/bin/env node
/* 世界-122位面祭坛运行时探针：进入地图、放置独立祭坛、献祭测试祭品并验证30分钟效果。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9270;
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

    const data = await evaluate(`(async () => {
        const loaded = (modulePath) => {
            const url = performance.getEntriesByType('resource').map((entry) => entry.name)
                .find((entry) => entry.includes(modulePath + '?'));
            if (!url) throw new Error(modulePath + ' 未加载');
            return url;
        };
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        await SceneManager.switchScene('scene8', window.Game.player);
        const { World122TributeSystem } = await import(loaded('/src/world/world122-tribute-system.js'));
        const { EquipManager } = await import(loaded('/src/ui/equip-manager.js'));
        const { ProducerBuilding, ProducerBuildingSystem } = await import(loaded('/src/world/producer-building-system.js'));
        const { BUILD_ITEMS } = await import(loaded('/src/world/building-system.js'));
        const { Renderer } = await import(loaded('/src/world/renderer.js'));
        const { getTributeEffects } = await import(loaded('/src/config/tribute-effects.js'));
        const slot = 9876;
        EquipManager.backpackItems.push({
            _id: 'cdp_world122_tribute',
            slot,
            name: '探针祭品',
            category: 'tribute',
            icon: '🧪',
            effects: { atkPercent: 10 },
            stats: [{ name: '攻击力', value: '+10%' }],
        });
        const altar = new ProducerBuilding(window.Game.player.x + 80, window.Game.player.y, {
            cfgKey: 'plane_altar', id: 'plane_altar_probe',
        });
        window.Game.entities.set(altar.id, altar);
        ProducerBuildingSystem.buildings.push(altar);
        const screen = Renderer.worldToScreen(altar.x, altar.y);
        const clicked = ProducerBuildingSystem.tryInteract(screen.x, screen.y, window.Game.player);
        World122TributeSystem._sacrifice(slot);
        const entry = World122TributeSystem.serialize()[0];
        const panelStyle = getComputedStyle(document.getElementById('world122BasePanel'));
        const panelText = document.getElementById('world122BasePanel').textContent;
        const church = new ProducerBuilding(5300, 4096, { cfgKey: 'church', id: 'church_probe' });
        ProducerBuildingSystem._ensurePanel().openFor(church, window.Game.player);
        const churchText = document.getElementById('producerBuildingPanel').textContent;
        const altarSnapshot = {
            scene: SceneManager.currentScene,
            clicked,
            panelOpen: World122TributeSystem._panel?.isOpen,
            entries: World122TributeSystem.serialize().length,
            expiresInMs: entry ? entry.expiresAt - Date.now() : 0,
            atkMul: getTributeEffects().atkPercent,
            panelPosition: { top: panelStyle.top, right: panelStyle.right, transform: panelStyle.transform },
            panelText,
            altar: { hp: altar.hp, maxHp: altar.maxHp },
        };
        return {
            altarSnapshot,
            altarInBuildMenu: BUILD_ITEMS.some((item) => item.id === 'plane_altar'),
            church: {
                inBuildMenu: BUILD_ITEMS.some((item) => item.id === 'church'),
                spawnEnabled: church.spawnEnabled,
                text: churchText,
            },
        };
    })()`);
    ws.close();

    const altar = data.altarSnapshot;
    const okay = altar.scene === 'scene8'
        && altar.clicked === true
        && altar.panelOpen === true
        && altar.entries === 1
        && altar.expiresInMs > 1790000
        && altar.expiresInMs <= 1800000
        && altar.atkMul === 1.1
        && altar.panelPosition.top === '0px'
        && altar.panelPosition.right === '0px'
        && altar.panelText.includes('位面祭坛')
        && altar.panelText.includes('耐久')
        && altar.panelText.includes('物理防御')
        && altar.panelText.includes('魔法防御')
        && altar.panelText.includes('2×2 菱形格')
        && data.altarInBuildMenu
        && data.church.inBuildMenu
        && data.church.text.includes('教堂')
        && data.church.text.includes('耐久 2500 / 2500（100%）')
        && data.church.text.includes('仓鼠牧师')
        && altar.altar.hp > 0
        && errors.length === 0;
    console.log(JSON.stringify({ data, errors }, null, 2));
    if (!okay) throw new Error('世界-122位面祭坛献祭运行时断言失败');
    console.log('世界-122位面祭坛献祭运行时探针通过');
} finally {
    edge.kill();
}
