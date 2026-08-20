#!/usr/bin/env node
/* 图鉴栏整改实机探针（2026-08-19）：
 * A. U 开图鉴 → 友军 tab → 8 卡片 → 民兵详情（六维/派生/攻击/产出建筑）；
 * B. 遮罩点击收回（面板 active 类摘除）；C. 截图目检友军栏目。
 * 运行前提：vite dev server 已在 localhost:5173 运行。
 * 安全入口：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-codex-ally.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9288;
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

    const started = await waitFor(() => evaluate(`(async () => {
        if (window.Game?.isRunning && window.Game.player) return true;
        const button = document.getElementById('startGameBtn');
        if (button && getComputedStyle(button).display !== 'none') button.click();
        return false;
    })()`), 30000);
    if (!started) throw new Error('游戏未启动');
    await sleep(1200);

    // ---- A. 图鉴友军栏目 ----
    const dataA = await evaluate(`(async () => {
        const { SystemUI } = await import('/src/ui/system-ui.js');
        const { CodexManager } = await import('/src/ui/codex-manager.js');
        SystemUI.open('codex');
        await new Promise((r) => setTimeout(r, 400));
        // 切友军 tab
        const allyTab = document.querySelector('.codex-main-tab[data-section="ally"]');
        if (!allyTab) return { err: '没有友军 tab' };
        allyTab.click();
        await new Promise((r) => setTimeout(r, 300));
        const cards = [...document.querySelectorAll('#codexAllyGrid .codex-card')];
        const names = cards.map((c) => c.querySelector('.cc-name')?.textContent);
        // 打开民兵详情
        CodexManager.openAllyDetail('hamster_militia');
        await new Promise((r) => setTimeout(r, 300));
        const detailText = document.getElementById('codexDetailBody')?.textContent || '';
        return {
            cardCount: cards.length, names,
            detailHas: {
                six: detailText.includes('六维属性'),
                derived: detailText.includes('物理攻击'),
                producer: detailText.includes('仓鼠草屋'),
                frame: detailText.includes('第 8 帧'),
                hp: detailText.includes('125'),
            },
        };
    })()`);
    if (dataA.err) throw new Error('A: ' + dataA.err);
    console.log('  [A 详情]', JSON.stringify(dataA.detailHas));
    check('A 友军栏目 8 张卡片（7 兵种 + 矿工）', dataA.cardCount === 8);
    check('A 民兵详情：六维/派生/产出建筑/判定帧/HP125 全到齐',
        Object.values(dataA.detailHas).every(Boolean));

    // 截图目检（友军栏目）
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const shotData = shot && (shot.data || (shot.result && shot.result.data));
    if (shotData) fs.writeFileSync('tools/verify-shots/codex-ally-2026-08-19.png', Buffer.from(shotData, 'base64'));

    // ---- B. 遮罩点击收回 ----
    const dataB = await evaluate(`(async () => {
        document.getElementById('panelOverlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        return {
            panelActive: document.getElementById('systemPanel').classList.contains('active'),
            overlayActive: document.getElementById('panelOverlay').classList.contains('active'),
        };
    })()`);
    check('B 点击图鉴栏外（遮罩）收回图鉴栏', dataB.panelActive === false && dataB.overlayActive === false);

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
