#!/usr/bin/env node
/* 铁匠对话交互规则验证（2026-08-11）：
 *  1) 点击对话框外部不再关闭对话（只有「再见」按钮和 ESC 可关闭）
 *  2) 子界面（商店/强化/附魔/改造）打开时：ESC 只退回对话主界面，再按一次 ESC 才退出对话
 * 前置：vite dev 已起。用法：node tools/cdp-dialogue-esc-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9241;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dlg-'));
process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, 'http://localhost:5173/?dialogueEscProbe=1',
], { stdio: 'ignore' });

async function waitFor(fn, t = 30000, s = 300) {
    const t0 = Date.now();
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* retry */ }
        if (Date.now() - t0 > t) return null;
        await new Promise((r) => setTimeout(r, s));
    }
}
async function fetchJson(u, t = 4000) {
    const c = new AbortController();
    const s = setTimeout(() => c.abort(), t);
    try { const r = await fetch(u, { signal: c.signal }); return await r.json(); }
    finally { clearTimeout(s); }
}
const page = await waitFor(async () => {
    const l = await fetchJson(`${CDP}/json/list`);
    return l && l.find((x) => x.type === 'page' && x.url.includes('localhost:5173'));
});
if (!page) { console.error('no page'); edge.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
        errs.push(`[exception] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
};
function send(method, params = {}) {
    return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
}
async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

await send('Runtime.enable');
await send('Page.enable');

let ready = false;
for (let i = 0; i < 60; i++) {
    const s = await evalJs(`({ running: !!(window.Game && window.Game.isRunning), hasPlayer: !!(window.Game && window.Game.player) })`);
    if (s.running && s.hasPlayer) { ready = true; break; }
    await evalJs(`(async () => { if (window.Game && !window.Game.isRunning) window.Game.start(); })()`);
    await sleep(300);
}
if (!ready) { console.error('game not ready'); edge.kill(); process.exit(1); }
await sleep(800);

// 取真实模块实例（performance 资源表带 ?t= 的真实 URL，避免拿到重复实例）
const mod = await evalJs(`(async () => {
    const url = performance.getEntriesByType('resource')
        .map(e => e.name)
        .find(n => n.startsWith(location.origin) && /npc-dialogue\\.js/.test(n));
    if (!url) return null;
    const m = await import(url);
    return { active: m.NPCDialogue.active, goodbye: typeof m.NPCDialogue.goodbye, open: typeof m.NPCDialogue.open };
})()`);
if (!mod || !mod.open) { console.error('NPCDialogue 模块不可用', mod); edge.kill(); process.exit(1); }

async function openDialogue() {
    return evalJs(`(async () => {
        const url = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.startsWith(location.origin) && /npc-dialogue\\.js/.test(n));
        const { NPCDialogue } = await import(url);
        NPCDialogue.open({ npcType: 'blacksmith', id: 'probe', portrait: null, getRandomGreeting: () => '探针测试对话' });
        return { active: NPCDialogue.active, box: getComputedStyle(document.getElementById('npcDialogueBox')).display };
    })()`);
}
async function state() {
    return evalJs(`(async () => {
        const url = performance.getEntriesByType('resource').map(e => e.name)
            .find(n => n.startsWith(location.origin) && /npc-dialogue\\.js/.test(n));
        const { NPCDialogue } = await import(url);
        return {
            active: NPCDialogue.active,
            box: getComputedStyle(document.getElementById('npcDialogueBox')).display,
            shop: document.getElementById('shopPanel')?.classList.contains('active') || false,
            enhance: document.getElementById('enhancePanel')?.classList.contains('active') || false,
            systemUI: !!(window.SystemUI && window.SystemUI.isOpen),
        };
    })()`);
}
async function pressEsc() {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}
async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}

// ---- 用例 1：点对话框外部不关闭 ----
let s = await openDialogue();
check('打开对话', s.active === true && s.box === 'flex', JSON.stringify(s));
await clickAt(960, 540); // 屏幕中央 = 对话框外
await sleep(400);
s = await state();
check('点击外部不关闭对话', s.active === true, JSON.stringify(s));

// ---- 用例 2：ESC 两级退出（子界面 → 对话 → 退出）----
await evalJs(`(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name)
        .find(n => n.startsWith(location.origin) && /npc-dialogue\\.js/.test(n));
    const { NPCDialogue } = await import(url);
    NPCDialogue.openShop();
})()`);
await sleep(500);
s = await state();
check('打开商店子界面', s.shop === true && s.active === true, JSON.stringify(s));
await pressEsc();
await sleep(400);
s = await state();
check('第一次 ESC 只退回对话', s.shop === false && s.active === true, JSON.stringify(s));
await pressEsc();
await sleep(500);
s = await state();
check('第二次 ESC 退出对话', s.active === false && s.box === 'none', JSON.stringify(s));

// ---- 用例 3：再见按钮可关闭 ----
await openDialogue();
await evalJs(`document.getElementById('npcOptionClose')?.click()`);
await sleep(500);
s = await state();
check('再见按钮关闭对话', s.active === false, JSON.stringify(s));

edge.kill();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `结果: ${results.length - failed.length} 通过, ${failed.length} 失败` : `结果: ${results.length} 通过, 0 失败`);
console.log(errs.length ? `控制台错误 ${errs.length} 条:\n${errs.join('\n')}` : '无控制台错误');
process.exit(failed.length ? 1 : 0);
