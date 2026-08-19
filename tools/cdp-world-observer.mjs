#!/usr/bin/env node
/* 观察模式 + 指挥模式 RTS 化实机探针（2026-08-19）：
 * A. 主城面板前往 122 → 玩家不入场、指挥模式自动开、相机落基地；
 * B. 指挥模式功能：建仓出兵 → 双击同类复选 → Ctrl+2 编队 → 选中 → 轮盘统一指令（待命）→ 边缘平移；
 * C. 面板返回本体（主城）→ 玩家恢复入场、指挥模式关闭、观察模式退出。
 * 运行前提：vite dev server 已在 localhost:5173 运行。
 * 安全入口：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-world-observer.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9279;
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

    // ---- A. 主城 → 面板观察 122 ----
    const dataA = await evaluate(`(async () => {
        const loaded = (p) => {
            const u = (window.__probeUrlMap || {})[p]
                || performance.getEntriesByType('resource').map((e) => e.name).find((e) => e.endsWith(p) || e.includes(p + '?'));
            return u || p;
        };
        const { Game } = await import(loaded('/src/game.js'));
        const playerPos = { x: Game.player.x, y: Game.player.y };
        const { WorldSwitchPanel } = await import(loaded('/src/ui/world-switch-panel.js'));
        await WorldSwitchPanel._travel('scene8');
        const { RTSCommand } = await import(loaded('/src/ui/rts-command.js'));
        const { Camera } = await import(loaded('/src/world/camera.js'));
        const { DefenseSystem } = await import(loaded('/src/world/defense-system.js'));
        return {
            scene: (await import(loaded('/src/world/scene-manager.js'))).SceneManager.currentScene,
            observer: Game._observerMode, home: Game._observerHomeScene,
            playerInEntities: Game.entities.has('player'),
            playerPosKept: Game.player.x === playerPos.x && Game.player.y === playerPos.y,
            rtsEnabled: RTSCommand.enabled,
            camAtBase: Math.hypot(Camera.x - 4200, Camera.y - 4096) < 400,
            baseActive: DefenseSystem.active,
        };
    })()`);
    console.log('  [A 详情]', JSON.stringify(dataA));
    check('A 观察进入 122：玩家不入场 + 坐标未动 + 指挥模式自动开 + 相机落基地',
        dataA.scene === 'scene8' && dataA.observer === true && dataA.home === 'main'
        && dataA.playerInEntities === false && dataA.playerPosKept === true
        && dataA.rtsEnabled === true && dataA.camAtBase === true && dataA.baseActive === true);

    // ---- B. 指挥模式功能链 ----
    const dataB = await evaluate(`(async () => {
        const loaded = (p) => {
            const u = (window.__probeUrlMap || {})[p]
                || performance.getEntriesByType('resource').map((e) => e.name).find((e) => e.endsWith(p) || e.includes(p + '?'));
            return u || p;
        };
        const { Game } = await import(loaded('/src/game.js'));
        const { RTSCommand } = await import(loaded('/src/ui/rts-command.js'));
        const { Camera } = await import(loaded('/src/world/camera.js'));
        const { HamsterBarracks, HamsterBarracksSystem } = await import(loaded('/src/world/hamster-barracks-system.js'));
        const { HamsterWarrior } = await import(loaded('/src/entities/hamster-warrior.js'));
        let phaserScene = window.__phaserScene;
        for (let retry = 0; !phaserScene && retry < 60; retry++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            phaserScene = window.__phaserScene;
        }
        if (!phaserScene) throw new Error('Phaser 场景实例丢失');

        // 建两个战士（直构造，等价兵营产出实体面）
        const w1 = new HamsterWarrior(4600, 4050, { id: 'probe_w1' });
        const w2 = new HamsterWarrior(4700, 4100, { id: 'probe_w2' });
        for (const w of [w1, w2]) { Game.entities.set(w.id, w); Game.friendlyUnits.push(w); }

        // 双击同类复选（直接调方法；DOM 事件路径由契约测试锁定）
        RTSCommand._setSelection([{ kind: 'ally', ref: w1 }]);
        RTSCommand._selectSameTypeOnScreen(w1);
        const dblSel = RTSCommand._selection.length;

        // Ctrl+2 编队 → 清空 → 按 2 召回
        const ev = { code: 'Digit2', ctrlKey: true, shiftKey: false, target: document.body, preventDefault() {}, stopImmediatePropagation() {} };
        RTSCommand._onKeyDown(ev);
        RTSCommand._clearSelection();
        const grpSaved = (RTSCommand._groups.get('2') || []).length;
        RTSCommand._onKeyDown({ code: 'Digit2', ctrlKey: false, shiftKey: false, target: document.body, preventDefault() {}, stopImmediatePropagation() {} });
        const grpRecalled = RTSCommand._selection.length;

        // 真实长按中键 → 轮盘打开 → 悬停“巡逻” → 松开执行。
        const commandWheel = Game.CompanionCommandWheel;
        const wheelPoint = { x: 800, y: 450 };
        phaserScene.game.canvas.dispatchEvent(new MouseEvent('mousedown', {
            button: 1,
            buttons: 4,
            clientX: wheelPoint.x,
            clientY: wheelPoint.y,
            bubbles: true,
            cancelable: true,
            view: window,
        }));
        await new Promise((resolve) => setTimeout(resolve, commandWheel.LONG_PRESS_MS + 120));
        const wheelOpened = commandWheel._open && !!document.querySelector('.companion-wheel');
        const patrolItem = document.querySelector('.companion-wheel [data-cmd="patrol"]');
        if (patrolItem) patrolItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
        phaserScene.game.canvas.dispatchEvent(new MouseEvent('mouseup', {
            button: 1,
            buttons: 0,
            clientX: wheelPoint.x,
            clientY: wheelPoint.y,
            bubbles: true,
            cancelable: true,
            view: window,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const wheelIssued = w1._command?.mode === 'move' && w2._command?.mode === 'move';

        // 真实右键事件 → RTS 自有 pending 入口 → tick 下发 move，不依赖组队栏 selectedIds。
        const rightTarget = { x: 5000, y: 4200 };
        const rightScreen = Game.Renderer.worldToScreen(rightTarget.x, rightTarget.y);
        const rightStart = { x: w1.x, y: w1.y };
        document.body.dispatchEvent(new MouseEvent('mousedown', {
            button: 2,
            clientX: rightScreen.x,
            clientY: rightScreen.y,
            bubbles: true,
            cancelable: true,
            view: window,
        }));
        await new Promise((resolve) => setTimeout(resolve, 650));
        const rightMove = w1._command?.mode === 'move'
            && w2._command?.mode === 'move'
            && Math.hypot(w1._command.point.x - rightTarget.x, w1._command.point.y - rightTarget.y) < 2;
        const rightMoved = Math.hypot(w1.x - rightStart.x, w1.y - rightStart.y) > 1
            || Math.hypot(
                (w1._tacticalTarget?.x ?? w1.x) - rightTarget.x,
                (w1._tacticalTarget?.y ?? w1.y) - rightTarget.y
            ) < 2;

        // 轮盘统一出口：选中 2 战士下达待命
        const nCmd = RTSCommand.issueWheelCommand('hold', { x: 6000, y: 4000 });
        const cmdMode = w1._command?.mode;

        // 边缘平移：先发真实 mousemove（登记 _mouseSeen）→ 经 tick 全链路驱动（Input 模块未挂 window，注入同形对象）
        const camX0 = Camera.x;
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800, clientY: 450 }));
        RTSCommand.tick('scene8', { mouse: { x: window.innerWidth - 4, y: 450 } }, 500);
        const panned = Camera.x > camX0;
        RTSCommand.tick('scene8', { mouse: { x: 800, y: 450 } }, 16);

        // 左键点击小地图实际内容：镜头跳到对应世界位置，选中单位保持且不穿透成世界选择。
        const minimapRect = phaserScene.minimapClientRect();
        const minimapClick = {
            x: Math.round(minimapRect.left + minimapRect.width * 0.72),
            y: Math.round(minimapRect.top + minimapRect.height * 0.36),
        };
        const minimapExpected = phaserScene.minimapWorldPointAt(minimapClick.x, minimapClick.y);
        phaserScene.game.canvas.dispatchEvent(new MouseEvent('mousedown', {
            button: 0,
            clientX: minimapClick.x,
            clientY: minimapClick.y,
            bubbles: true,
            cancelable: true,
            view: window,
        }));
        phaserScene.game.canvas.dispatchEvent(new MouseEvent('mouseup', {
            button: 0,
            clientX: minimapClick.x,
            clientY: minimapClick.y,
            bubbles: true,
            cancelable: true,
            view: window,
        }));
        await new Promise((resolve) => setTimeout(resolve, 120));
        const minimapJumped = Math.hypot(Camera.x - minimapExpected.x, Camera.y - minimapExpected.y) < 2;
        const minimapSelectionKept = RTSCommand._selection.length === 2;

        // 轮盘可开判定（指挥模式有选中）
        const wheelOk = window.CompanionCommandWheel
            ? true : true; // 轮盘经 game.js 挂载不进 window；判定走契约测试

        return {
            dblSel, grpSaved, grpRecalled, wheelOpened, wheelIssued,
            rightMove, rightMoved, nCmd, cmdMode, panned,
            minimapJumped, minimapSelectionKept,
        };
    })()`);
    console.log('  [B 详情]', JSON.stringify(dataB));
    check('B 双击同类复选（选 1 → 全选 2）', dataB.dblSel === 2);
    check('B Ctrl+2 编队 → 清空 → 按 2 召回', dataB.grpSaved === 2 && dataB.grpRecalled === 2);
    check('B 真实长按中键打开轮盘并松开执行巡逻指令',
        dataB.wheelOpened === true && dataB.wheelIssued === true);
    check('B 真实右键事件下发 move 到全部 RTS 选中单位', dataB.rightMove === true);
    check('B 右键 move 被仓鼠 AI 实际消费并产生位移', dataB.rightMoved === true);
    check('B 轮盘统一指令下达仓鼠（hold 生效 2 单位）', dataB.nCmd === 2 && dataB.cmdMode === 'hold');
    check('B 边缘平移移动相机', dataB.panned === true);
    check('B 指挥模式点击小地图跳转镜头且保留单位选择',
        dataB.minimapJumped === true && dataB.minimapSelectionKept === true);

    // ---- C. 返回本体（主城） ----
    const dataC = await evaluate(`(async () => {
        const loaded = (p) => {
            const u = (window.__probeUrlMap || {})[p]
                || performance.getEntriesByType('resource').map((e) => e.name).find((e) => e.endsWith(p) || e.includes(p + '?'));
            return u || p;
        };
        const { Game } = await import(loaded('/src/game.js'));
        const { WorldSwitchPanel } = await import(loaded('/src/ui/world-switch-panel.js'));
        await WorldSwitchPanel._travel('main');
        const { RTSCommand } = await import(loaded('/src/ui/rts-command.js'));
        const { SceneManager } = await import(loaded('/src/world/scene-manager.js'));
        return {
            scene: SceneManager.currentScene,
            observer: Game._observerMode,
            playerInEntities: Game.entities.has('player'),
            rtsEnabled: RTSCommand.enabled,
        };
    })()`);
    check('C 返回本体：玩家恢复入场 + 观察/指挥模式退出',
        dataC.scene === 'main' && dataC.observer === false
        && dataC.playerInEntities === true && dataC.rtsEnabled === false);

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
