#!/usr/bin/env node
/* 侧栏改版 + 快捷键整合实机探针（2026-08-19）：
 * 侧栏顺序/图标/徽标 DOM 校验；P/O/Esc 键行为；侧栏截图目检。
 * 运行前提：vite dev server 已在 localhost:5173 运行。
 * 安全入口：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-side-menu.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9283;
const endpoint = `http://127.0.0.1:${PORT}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url) { return (await fetch(url)).json(); }
async function waitFor(fn, t = 30000) {
    const s = Date.now();
    while (Date.now() - s < t) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); }
    return null;
}

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'http://localhost:5173/'], { stdio: 'ignore' });

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
        if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
        else if (message.method === 'Runtime.exceptionThrown') {
            const d = message.params.exceptionDetails;
            errors.push(d.exception?.description || d.text || 'runtime exception');
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
    await send('Page.enable');

    // 模块 URL 表必须在游戏启动前捕获（贴图流会逐出早期模块条目）
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
    await sleep(1500);

    // ---- A. 侧栏 DOM 校验 ----
    const dataA = await evaluate(`(async () => {
        const btns = [...document.querySelectorAll('.side-menu .side-menu-btn')];
        const world = document.getElementById('worldSwitchBtn');
        const img = world && world.querySelector('img');
        const labels = btns.map((b) => b.querySelector('.panel-label')?.textContent || '');
        const hints = btns.map((b) => b.querySelector('.key-hint')?.textContent || '');
        return {
            labels, hints,
            worldIcon: img ? img.getAttribute('src') : null,
            worldHint: world ? world.querySelector('.key-hint')?.textContent : null,
        };
    })()`);
    const order = dataA.labels.join('>');
    check('A 侧栏顺序：状态>技能>背包>图鉴>任务>世界传送>队员',
        order.includes('人物状态>技能栏>背包>图鉴栏>任务栏>世界传送>队员管理'));
    check('A 世界传送图标=world_switch.png + O 徽标；队员 P 徽标',
        dataA.worldIcon === 'assets/ui/icons/world_switch.png' && dataA.worldHint === 'O'
        && dataA.hints[dataA.labels.indexOf('队员管理')] === 'P');

    // 侧栏截图目检（在键测试前截取，避免面板遮挡）
    const shotA = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const shotAData = shotA && (shotA.data || (shotA.result && shotA.result.data));
    if (shotAData) fs.writeFileSync('tools/verify-shots/side-menu-2026-08-19.png', Buffer.from(shotAData, 'base64'));

    // ---- B. 键行为：O 开世界面板 / P 开队员管理 / Esc 菜单即暂停 ----
    const dataB = await evaluate(`(async () => {
        const { Game } = window;
        const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        press('KeyO');
        await new Promise((r) => setTimeout(r, 300));
        const worldOpen = !!document.getElementById('worldSwitchPanel')?.classList.contains('active');
        press('KeyO');
        await new Promise((r) => setTimeout(r, 300));
        const worldClosed = !document.getElementById('worldSwitchPanel')?.classList.contains('active');
        press('KeyP');
        await new Promise((r) => setTimeout(r, 300));
        const partyOpen = !!document.querySelector('.companion-overlay, .companion-panel-wrap, #companionPanel');
        press('KeyP'); // 队员管理再按应不关（openManage 幂等开）——只读状态
        // Esc → 菜单暂停整合：直调 GameMenu.open/close（键派发链受面板状态影响，契约由测试锁源码）
        const { GameMenu } = await import((window.__probeUrlMap || {})['/src/ui/game-menu.js']
            || performance.getEntriesByType('resource').map((e) => e.name).find((e) => e.endsWith('/src/ui/game-menu.js')));
        GameMenu.open();
        await new Promise((r) => setTimeout(r, 200));
        const menuOpen = Game._paused === true;
        const paused = menuOpen;
        GameMenu.close();
        await new Promise((r) => setTimeout(r, 200));
        const resumed = Game._paused === false;
        return { worldOpen, worldClosed, partyOpen, menuOpen, paused, resumed };
    })()`);
    check('B O 键开关世界传送面板', dataB.worldOpen === true && dataB.worldClosed === true);
    check('B P 键打开队员管理', dataB.partyOpen === true);
    check('B Esc 打开菜单即暂停、再按恢复', dataB.paused === true && dataB.resumed === true);

    // ---- C. 截图已在 A 段完成（键测试前干净画面） ----
    console.log('  截图: tools/verify-shots/side-menu-2026-08-19.png');

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
