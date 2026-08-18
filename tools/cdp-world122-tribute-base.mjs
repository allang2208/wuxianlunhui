#!/usr/bin/env node
/* 世界-122基地献祭运行时探针：进入地图、点基地、献祭隔离测试祭品并验证30分钟效果。 */
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
        const { DefenseSystem } = await import(loaded('/src/world/defense-system.js'));
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
        const screen = Renderer.worldToScreen(DefenseSystem.base.x, DefenseSystem.base.y);
        const clicked = DefenseSystem.tryInteract(screen.x, screen.y, window.Game.player);
        World122TributeSystem._sacrifice(slot);
        const entry = World122TributeSystem.serialize()[0];
        const panelStyle = getComputedStyle(document.getElementById('world122BasePanel'));
        const panelText = document.getElementById('world122BasePanel').textContent;
        const church = new ProducerBuilding(5300, 4096, { cfgKey: 'church', id: 'church_probe' });
        ProducerBuildingSystem._ensurePanel().openFor(church, window.Game.player);
        const churchText = document.getElementById('producerBuildingPanel').textContent;
        return {
            scene: SceneManager.currentScene,
            clicked,
            panelOpen: World122TributeSystem._panel?.isOpen,
            entries: World122TributeSystem.serialize().length,
            expiresInMs: entry ? entry.expiresAt - Date.now() : 0,
            atkMul: getTributeEffects().atkPercent,
            panelPosition: { top: panelStyle.top, right: panelStyle.right, transform: panelStyle.transform },
            panelText,
            church: {
                inBuildMenu: BUILD_ITEMS.some((item) => item.id === 'church'),
                spawnEnabled: church.spawnEnabled,
                text: churchText,
            },
            base: { hp: DefenseSystem.base.hp, maxHp: DefenseSystem.base.maxHp },
        };
    })()`);
    ws.close();

    const okay = data.scene === 'scene8'
        && data.clicked === true
        && data.panelOpen === true
        && data.entries === 1
        && data.expiresInMs > 1790000
        && data.expiresInMs <= 1800000
        && data.atkMul === 1.1
        && data.panelPosition.top === '26px'
        && data.panelPosition.right === '26px'
        && data.panelPosition.transform === 'none'
        && data.panelText.includes('耐久')
        && data.panelText.includes('物理防御')
        && data.panelText.includes('魔法防御')
        && data.panelText.includes('4×4 菱形格')
        && data.church.inBuildMenu
        && data.church.spawnEnabled === false
        && data.church.text.includes('教堂')
        && data.church.text.includes('耐久 2500 / 2500（100%）')
        && data.church.text.includes('物理防御：80')
        && data.church.text.includes('魔法防御：120')
        && data.church.text.includes('该建筑暂未配置额外功能。')
        && !data.church.text.includes('特殊能力（读条升级，全局生效）')
        && data.base.hp > 0
        && errors.length === 0;
    console.log(JSON.stringify({ data, errors }, null, 2));
    if (!okay) throw new Error('世界-122基地献祭运行时断言失败');
    console.log('世界-122基地献祭运行时探针通过');
} finally {
    edge.kill();
}
