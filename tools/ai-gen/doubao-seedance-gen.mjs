#!/usr/bin/env node
/**
 * Drive the installed Doubao desktop client through a loopback-only Chrome
 * DevTools connection and download Seedance results into the existing asset
 * scratch pipeline.  No account tokens/cookies are read or copied.
 *
 * First use: fully exit Doubao before running this script.  It launches the
 * installed client with --remote-debugging-port on 127.0.0.1.  If Doubao was
 * already launched normally, Chromium cannot enable CDP after startup and the
 * script fails without closing the user's client.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const DEFAULT_PORT = 9333;
const DEFAULT_MODEL = 'Seedance 2.0 Mini';
const ERROR_TEXTS = [
  '额度不足', '已达上限', '用量已达', '生成失败', '生成超时', '内容不合规',
  '未认证人脸', '出于肖像保护考虑', '暂不支持上传真实人脸素材', '暂不支持',
  '服务繁忙', '网络异常', '请稍后重试',
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['attach-only', 'inspect', 'download-latest', 'fill-only', 'keep-open', 'loop', 'help', 'h'].includes(key)) {
      out[key] = true;
      continue;
    }
    if (i + 1 >= argv.length) fail(`missing value for ${token}`);
    out[key] = argv[++i];
  }
  return out;
}

function usage() {
  console.log(`Doubao desktop Seedance generator

Usage:
  node tools/ai-gen/doubao-seedance-gen.mjs \\
    --ref first-frame.png --prompt-file prompt.txt --out candidate.mp4 \\
    [--model "Seedance 2.0 Mini"] [--duration 5] [--size 1024x576] \\
    [--candidates 1] [--timeout 1800] [--cdp-port 9333]
  node doubao-seedance-gen.mjs --attach-only --cdp-port 9333
    --download-latest --out output.mp4

Notes:
  - Fully exit a normally-launched Doubao client before first use.
  - --inspect enters the video composer and prints visible state, but never
    uploads, submits, downloads, or consumes quota.
  - --download-latest downloads the last ready video already visible in the
    current conversation. It never uploads, submits, or consumes quota.
`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processIsRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const text = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Doubao.exe', '/NH'], {
      encoding: 'utf8', windowsHide: true,
    });
    return /Doubao\.exe/i.test(text);
  } catch {
    return false;
  }
}

function findDoubaoExe(explicit) {
  const candidates = [
    explicit,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Doubao', 'Application', 'app', 'Doubao.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Doubao', 'Application', 'Doubao.exe'),
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) fail('Doubao.exe not found; pass --doubao-exe with the installed client path');
  return found;
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function listTargets(port) {
  return fetchJson(`http://127.0.0.1:${port}/json/list`);
}

async function ensureDebugClient(options) {
  try {
    return { targets: await listTargets(options.port), launched: false };
  } catch {
    // Continue into safe bootstrap.
  }
  if (options.attachOnly) {
    fail(`Doubao CDP is not listening on 127.0.0.1:${options.port}`);
  }
  if (processIsRunning()) {
    fail(
      'Doubao is already running without the automation port. Fully exit it once ' +
      '(including the tray process), then rerun; this tool will not kill or restart it automatically.'
    );
  }
  const executable = findDoubaoExe(options.exe);
  console.log(`[doubao] launching ${executable} with loopback CDP port ${options.port}`);
  const child = spawn(executable, [
    `--remote-debugging-port=${options.port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=http://127.0.0.1',
    '--force-renderer-accessibility',
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      return { targets: await listTargets(options.port), launched: true };
    } catch {
      // Client is still starting.
    }
  }
  fail(
    `Doubao started but CDP did not appear on port ${options.port}. ` +
    'Check that all old Doubao tray processes were closed before launch.'
  );
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket connect timeout')), 10000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', event => {
        clearTimeout(timer);
        reject(event.error || new Error('CDP websocket error'));
      }, { once: true });
    });
    this.ws.addEventListener('message', event => this.#onMessage(event.data));
    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP websocket closed'));
      this.pending.clear();
    });
  }

  #onMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result || {});
      return;
    }
    const queue = this.waiters.get(message.method);
    if (queue?.length) queue.shift().resolve(message.params || {});
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.waiters.get(method) || [];
        this.waiters.set(method, queue.filter(item => item.resolve !== wrappedResolve));
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      const wrappedResolve = value => { clearTimeout(timer); resolve(value); };
      const queue = this.waiters.get(method) || [];
      queue.push({ resolve: wrappedResolve });
      this.waiters.set(method, queue);
    });
  }

  async evaluate(expression, { returnByValue = true, awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue, awaitPromise, userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'page evaluation failed');
    }
    return returnByValue ? result.result?.value : result.result;
  }

  close() {
    this.ws?.close();
  }
}

async function selectDoubaoPage(targets) {
  const pageTargets = targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pageTargets.length) fail('Doubao exposed no page targets');
  let fallback = null;
  for (const target of pageTargets) {
    const session = new CdpSession(target.webSocketDebuggerUrl);
    try {
      await session.connect();
      await session.send('Runtime.enable');
      await session.send('Page.enable');
      const state = await session.evaluate(`({
        title: document.title,
        url: location.href,
        text: (document.body?.innerText || '').slice(0, 30000)
      })`);
      const score = (state.text.includes('视频生成') ? 20 : 0) +
        (/doubao/i.test(`${state.title} ${state.url}`) ? 10 : 0) +
        (state.text.includes('豆包') ? 5 : 0);
      if (score >= 20) {
        fallback?.session.close();
        return { session, state };
      }
      if (!fallback || score > fallback.score) {
        fallback?.session.close();
        fallback = { session, state, score };
      } else {
        session.close();
      }
    } catch {
      session.close();
    }
  }
  if (fallback) return fallback;
  fail('unable to identify the Doubao conversation page');
}

const FIND_POINT_SCRIPT = String.raw`(request => {
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const all = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],div,span,p')]
    .filter(visible);
  let candidates = all.filter(el => {
    const text = norm(el.innerText || el.textContent);
    if (request.regex) return new RegExp(request.regex, request.flags || '').test(text);
    return request.exact ? text === request.text : text.includes(request.text);
  });
  if (request.bottom) candidates = candidates.filter(el => el.getBoundingClientRect().top > innerHeight * 0.55);
  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    const aa = ar.width * ar.height, ba = br.width * br.height;
    const bottomBias = request.bottom ? (br.top - ar.top) * 10000 : 0;
    return bottomBias + aa - ba;
  });
  const match = candidates[0];
  if (!match) return null;
  const clickable = match.closest('button,a,[role="button"],[role="menuitem"],[role="option"]');
  const el = clickable && visible(clickable) ? clickable : match;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2,
    text: norm(el.innerText || el.textContent), tag: el.tagName, className: String(el.className || '') };
})`;

async function pointByText(session, request) {
  return session.evaluate(`${FIND_POINT_SCRIPT}(${JSON.stringify(request)})`);
}

async function clickPoint(session, point) {
  if (!point) return false;
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  return true;
}

async function clickText(session, request) {
  return clickPoint(session, await pointByText(session, request));
}

async function bodyText(session) {
  return session.evaluate(`(document.body?.innerText || '').slice(0, 120000)`);
}

async function composerDiagnostics(session) {
  return session.evaluate(`(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"],textarea,input,[contenteditable="true"]')]
      .filter(visible)
      .map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        text: norm(el.innerText || el.textContent).slice(0, 120),
        aria: norm(el.getAttribute('aria-label')).slice(0, 120),
        placeholder: norm(el.getAttribute('placeholder')).slice(0, 120),
        top: Math.round(el.getBoundingClientRect().top),
        pressed: el.getAttribute('aria-pressed') || '',
        state: el.getAttribute('data-state') || '',
        className: norm(el.className).slice(0, 160),
      }))
      .filter(item => item.placeholder || item.top > innerHeight * .55 || /视频|生成|创作|Seedance|时长|画幅/i.test(
        [item.text, item.aria].join(' ')
      ))
      .slice(0, 80);
  })()`);
}

const PROMPT_EDITOR_SCRIPT = String.raw`(() => {
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 5 && r.height > 5 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const candidates = [...document.querySelectorAll('textarea,input,[contenteditable="true"]')]
    .filter(visible);
  const scored = candidates.map(el => {
    const r = el.getBoundingClientRect();
    const placeholder = String(el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '');
    const video = /描述.*视频|视频.*描述|生成.*视频/.test(placeholder) ? 100000000 : 0;
    const editable = el.matches('textarea,[contenteditable="true"]') ? 10000000 : 0;
    const bottom = r.top > innerHeight * .45 ? 1000000 : 0;
    return {el, score: video + editable + bottom + r.width * r.height};
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.el || null;
})()`;

async function promptEditor(session) {
  return session.evaluate(PROMPT_EDITOR_SCRIPT, { returnByValue: false });
}

async function promptEditorState(session) {
  return session.evaluate(`(() => {
    const el = ${PROMPT_EDITOR_SCRIPT};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      placeholder: String(el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || ''),
      value: el.isContentEditable ? String(el.innerText || el.textContent || '') : String(el.value || ''),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  })()`);
}

async function domClickText(session, request) {
  return session.evaluate(`(request => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const all = [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]')]
      .filter(visible);
    const matches = all.filter(el => {
      const text = norm(el.innerText || el.textContent);
      return request.exact ? text === request.text : text.includes(request.text);
    });
    if (request.bottom) matches.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const el = matches[0];
    if (!el) return false;
    el.click();
    return true;
  })(${JSON.stringify(request)})`);
}

async function isVideoComposer(session) {
  return session.evaluate(`(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && r.top > innerHeight * .45 &&
        s.display !== 'none' && s.visibility !== 'hidden';
    };
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const controls = [...document.querySelectorAll('button,[role="button"],[role="option"],div,span')]
      .filter(visible).map(el => norm(el.innerText || el.textContent));
    const prompts = [...document.querySelectorAll('textarea,input,[contenteditable="true"]')]
      .filter(visible).map(el => String(el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || ''));
    return prompts.some(value => /描述.*视频|视频.*描述|生成.*视频/.test(value)) ||
      (controls.some(value => /^(模型\\s*)?Seedance\\s+/i.test(value)) &&
       controls.some(value => /^(自动|3:4|4:3|9:16|16:9|1:1|21:9)\\s*[·・]\\s*\\d+s$/.test(value)));
  })()`);
}

async function waitUntil(check, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  if (lastError) throw lastError;
  return null;
}

async function ensureVideoComposer(session) {
  if (await isVideoComposer(session)) return;
  let clicked = await clickText(session, { text: '视频生成', exact: true, bottom: true });
  if (!clicked) {
    const modeMenu = await clickText(session, { text: '对话', exact: true, bottom: true });
    if (modeMenu) {
      const videoEntry = await waitUntil(
        () => pointByText(session, { text: '视频生成', exact: true }),
        1500,
      );
      clicked = await clickPoint(session, videoEntry);
    }
  }
  if (!clicked) {
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    const moreMenu = await clickText(session, { text: '更多', exact: true, bottom: true });
    if (moreMenu) {
      const videoEntry = await waitUntil(
        () => pointByText(session, { text: '视频生成', exact: true }),
        5000,
      );
      clicked = await clickPoint(session, videoEntry);
    }
  }
  if (!clicked) {
    const controls = await composerDiagnostics(session);
    fail(`could not find the Doubao “视频生成” entry; relevant controls=${JSON.stringify(controls)}`);
  }
  let ready = await waitUntil(() => isVideoComposer(session), 5000);
  if (!ready) {
    await domClickText(session, { text: '视频生成', exact: true, bottom: true });
    ready = await waitUntil(() => isVideoComposer(session), 10000);
  }
  if (!ready) {
    const controls = await composerDiagnostics(session);
    fail(`Doubao did not enter the video composer; relevant controls=${JSON.stringify(controls)}`);
  }
}

async function chooseModel(session, model) {
  const point = await pointByText(session, {
    regex: '^(模型\\s*)?Seedance\\s+[^\\n]{1,40}$', flags: 'i', bottom: true,
  });
  if (!point) fail('could not find the Seedance model selector');
  await clickPoint(session, point);
  const option = await waitUntil(() => pointByText(session, { text: model, exact: true }), 8000);
  if (!option) fail(`model option not found: ${model}`);
  await clickPoint(session, option);
  await sleep(500);
  const text = await bodyText(session);
  if (!text.includes(model)) fail(`Doubao did not select ${model}`);
}

function ratioFromSize(size) {
  if (!size || size === 'auto') return '自动';
  if (/^(自动|3:4|4:3|9:16|16:9|1:1|21:9)$/.test(size)) return size;
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) fail(`--size must be WIDTHxHEIGHT or a supported ratio, got ${size}`);
  const value = Number(match[1]) / Number(match[2]);
  const options = [['3:4', 3 / 4], ['4:3', 4 / 3], ['9:16', 9 / 16],
    ['16:9', 16 / 9], ['1:1', 1], ['21:9', 21 / 9]];
  options.sort((a, b) => Math.abs(a[1] - value) - Math.abs(b[1] - value));
  return options[0][0];
}

async function setParameters(session, ratio, duration) {
  const selector = await pointByText(session, {
    regex: '^(自动|3:4|4:3|9:16|16:9|1:1|21:9)\\s*[·・]\\s*\\d+s$', bottom: true,
  });
  if (!selector) fail('could not find the Seedance parameter selector');
  await clickPoint(session, selector);
  const ratioPoint = await waitUntil(() => pointByText(session, { text: ratio, exact: true }), 8000);
  if (!ratioPoint) fail(`ratio option not found: ${ratio}`);
  await clickPoint(session, ratioPoint);

  const slider = await session.evaluate(`(() => {
    const visible = el => { const r=el.getBoundingClientRect(); return r.width>2 && r.height>2; };
    const native = [...document.querySelectorAll('input[type="range"]')].find(visible);
    const aria = [...document.querySelectorAll('[role="slider"]')].find(visible);
    const el = native || aria;
    if (!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,native:!!native};
  })()`);
  if (!slider) fail('could not find the duration slider');
  await clickPoint(session, slider);
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  for (let value = 4; value < duration; value += 1) {
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  }
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'left', clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'left', clickCount: 1 });
  await sleep(300);
}

async function existingFileInput(session) {
  return session.evaluate(`(() => {
    const walk = root => {
      for (const el of root.querySelectorAll('*')) {
        if (el.matches?.('input[type="file"]')) return el;
        if (el.shadowRoot) { const found=walk(el.shadowRoot); if(found) return found; }
      }
      return null;
    };
    return walk(document);
  })()`, { returnByValue: false });
}

async function plusPoint(session) {
  return session.evaluate(`(() => {
    const visible = el => { const r=el.getBoundingClientRect(); return r.width>4 && r.height>4; };
    const promptCandidates = [...document.querySelectorAll('textarea,input,[contenteditable="true"],div,span')]
      .filter(visible).filter(el => String(el.placeholder || el.innerText || '').includes('描述你想要的视频'));
    promptCandidates.sort((a,b)=>{
      const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
      const aPreferred=a.matches('textarea,input,[contenteditable="true"]')?-1000000:0;
      const bPreferred=b.matches('textarea,input,[contenteditable="true"]')?-1000000:0;
      return aPreferred+ar.width*ar.height-(bPreferred+br.width*br.height);
    });
    const prompt = promptCandidates[0];
    let root=prompt;
    for(let i=0; root && i<7; i++, root=root.parentElement){
      const buttons=[...root.querySelectorAll('button,[role="button"]')].filter(visible);
      if(buttons.length>=2){
        buttons.sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
        const r=buttons[0].getBoundingClientRect();
        return {x:r.left+r.width/2,y:r.top+r.height/2};
      }
    }
    return null;
  })()`);
}

async function uploadReference(session, filePath) {
  await session.send('DOM.enable');
  await session.send('Page.setInterceptFileChooserDialog', { enabled: true });
  try {
    const object = await existingFileInput(session);
    if (object?.objectId) {
      await session.send('DOM.setFileInputFiles', { objectId: object.objectId, files: [filePath] });
      await sleep(1200);
      return;
    }
    const point = await plusPoint(session);
    if (!point) fail('could not find the reference upload button');
    const chooserPromise = session.waitEvent('Page.fileChooserOpened', 12000);
    await clickPoint(session, point);
    const chooser = await chooserPromise;
    await session.send('DOM.setFileInputFiles', {
      backendNodeId: chooser.backendNodeId, files: [filePath],
    });
  } finally {
    await session.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
  await sleep(1200);
}

async function fillPrompt(session, prompt) {
  const editor = await promptEditor(session);
  if (!editor?.objectId) fail('could not find the video prompt editor');
  const before = await promptEditorState(session);
  await clickPoint(session, before);
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
  });
  await session.send('Input.insertText', { text: prompt });
  await sleep(500);
  const after = await promptEditorState(session);
  const expected = prompt.replace(/\s+/g, ' ').trim();
  const actual = String(after?.value || '').replace(/\s+/g, ' ').trim();
  if (actual !== expected) {
    fail(`prompt editor verification failed: expected ${expected.length} chars, read back ${actual.length}; task was not submitted`);
  }
  const sha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
  console.log(`[doubao] prompt editor verified: ${actual.length} chars sha256=${sha256}`);
}

async function videoSources(session) {
  return session.evaluate(`[...document.querySelectorAll('video')].map((video,index)=>({
    index, src: video.currentSrc || video.src || '', readyState: video.readyState,
    width: video.videoWidth, height: video.videoHeight,
    visible: !!(video.offsetWidth || video.offsetHeight || video.getClientRects().length)
  })).filter(item=>item.src)`);
}

async function submitOnce(session, prompt) {
  await fillPrompt(session, prompt);
  const before = await bodyText(session);
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  const accepted = await waitUntil(async () => {
    const text = await bodyText(session);
    const error = ERROR_TEXTS.find(item => countText(text, item) > countText(before, item));
    if (error) fail(`Doubao rejected the task: ${error}`);
    return text.includes('生成中') || text.includes('正在生成') || text.length > before.length + 20;
  }, 15000, 800);
  if (!accepted) {
    fail('Doubao did not confirm task submission; the tool will not retry automatically to avoid double quota use');
  }
  return before;
}

function countText(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function waitForResult(session, baseline, baselineText, timeoutMs) {
  const baselineSet = new Set(baseline.map(item => item.src));
  const baselineCompleted = countText(baselineText, '你的视频生成好了');
  const result = await waitUntil(async () => {
    const text = await bodyText(session);
    const error = ERROR_TEXTS.find(item => countText(text, item) > countText(baselineText, item));
    if (error) fail(`Doubao stopped generation: ${error}`);
    const videos = await videoSources(session);
    const newSource = videos.find(item => item.readyState >= 1 && !baselineSet.has(item.src));
    if (newSource) return newSource;
    // Doubao may reuse a blob: URL or replace a video element in place. Once
    // the conversation gains a fresh completion marker, the last ready video
    // is the newly generated result even when its URL matches the baseline.
    if (countText(text, '你的视频生成好了') > baselineCompleted) {
      return [...videos].reverse().find(item => item.readyState >= 1) || null;
    }
    return null;
  }, timeoutMs, 3000);
  if (!result) fail(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for Seedance output`);
  return result;
}

async function readBlobThroughPage(session, src) {
  const key = `__codexVideo_${Date.now()}`;
  const length = await session.evaluate(`(async()=>{
    const response=await fetch(${JSON.stringify(src)});
    if(!response.ok) throw new Error('video fetch '+response.status);
    const blob=await response.blob();
    const b64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
    globalThis[${JSON.stringify(key)}]=b64;
    return b64.length;
  })()`);
  const chunks = [];
  for (let start = 0; start < length; start += 512 * 1024) {
    chunks.push(await session.evaluate(`globalThis[${JSON.stringify(key)}].slice(${start},${start + 512 * 1024})`));
  }
  await session.evaluate(`delete globalThis[${JSON.stringify(key)}]`);
  return Buffer.from(chunks.join(''), 'base64');
}

async function downloadVideo(session, src, outPath) {
  let data;
  if (/^https?:/i.test(src)) {
    try {
      const response = await fetch(src, { headers: { Referer: 'https://www.doubao.com/' } });
      if (response.ok) data = Buffer.from(await response.arrayBuffer());
    } catch {
      // Signed URLs sometimes require the page context; use the fallback below.
    }
  }
  if (!data) data = await readBlobThroughPage(session, src);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, data);
  console.log(`[doubao] saved ${outPath} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
}

function candidatePath(outPath, index, count) {
  if (count === 1) return outPath;
  const ext = path.extname(outPath) || '.mp4';
  return path.join(path.dirname(outPath), `${path.basename(outPath, ext)}_c${String(index + 1).padStart(2, '0')}${ext}`);
}

function writeManifest(outPath, metadata) {
  fs.writeFileSync(`${outPath}.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  const options = {
    port: Number(args['cdp-port'] || DEFAULT_PORT),
    exe: args['doubao-exe'],
    attachOnly: Boolean(args['attach-only']),
  };
  const rawDuration = Number(args.duration || 5);
  if (!Number.isFinite(rawDuration)) fail(`invalid --duration: ${args.duration}`);
  const duration = Math.max(4, Math.min(15, Math.round(rawDuration)));
  const ratio = ratioFromSize(args.ratio || args.size || '16:9');
  const model = args.model || DEFAULT_MODEL;
  const candidates = Number.parseInt(args.candidates || '1', 10);
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 20) {
    fail('--candidates must be an integer from 1 to 20');
  }
  const rawTimeout = Number(args.timeout || 1800);
  if (!Number.isFinite(rawTimeout)) fail(`invalid --timeout: ${args.timeout}`);
  const timeoutMs = Math.max(60, rawTimeout) * 1000;
  const ref = args.ref ? path.resolve(args.ref) : null;
  const out = args.out ? path.resolve(args.out) : null;
  let prompt = args.prompt || '';
  if (args['prompt-file']) prompt = fs.readFileSync(path.resolve(args['prompt-file']), 'utf8').trim();
  if (args.loop) {
    prompt += '\nThe motion forms one complete cycle and returns to the exact starting pose, position, scale, and camera framing at the end.';
  }

  if (!args.inspect && !args['download-latest']) {
    if (!ref || !fs.existsSync(ref)) fail('provide an existing --ref image');
    if (!prompt) fail('provide --prompt or --prompt-file');
    if (!out) fail('provide --out');
  }
  if (args['download-latest'] && !out) fail('--download-latest requires --out');

  const bootstrap = await ensureDebugClient(options);
  const targets = bootstrap.targets;
  const { session, state } = await selectDoubaoPage(targets);
  let completed = false;
  try {
    if (args.inspect) {
      const text = await bodyText(session);
      const editor = await promptEditorState(session);
      const controls = await composerDiagnostics(session);
      const videos = await videoSources(session);
      console.log(JSON.stringify({ title: state.title, url: state.url, model, ratio, duration,
        editor: editor ? { tag: editor.tag, placeholder: editor.placeholder, valueLength: editor.value.length } : null,
        controls, videos, visibleText: text.slice(-6000) }, null, 2));
      return;
    }
    if (args['download-latest']) {
      const videos = await videoSources(session);
      const video = [...videos].reverse().find(item => item.readyState >= 1);
      if (!video) fail('no ready video is visible in the current Doubao conversation');
      await downloadVideo(session, video.src, out);
      writeManifest(out, {
        provider: 'doubao-desktop', recoveredFromConversation: true,
        recoveredAt: new Date().toISOString(), sourceUrlScheme: String(video.src).split(':')[0],
      });
      completed = true;
      return;
    }

    await ensureVideoComposer(session);
    console.log(`[doubao] model=${model} ratio=${ratio} duration=${duration}s candidates=${candidates}`);
    for (let index = 0; index < candidates; index += 1) {
      await ensureVideoComposer(session);
      await chooseModel(session, model);
      await setParameters(session, ratio, duration);
      if (args['fill-only']) {
        await fillPrompt(session, prompt);
        console.log('[doubao] fill-only verification passed; no file uploaded and no task submitted');
        return;
      }
      const baseline = await videoSources(session);
      await uploadReference(session, ref);
      const baselineText = await submitOnce(session, prompt);
      console.log(`[doubao] candidate ${index + 1}/${candidates} submitted; waiting for result`);
      const video = await waitForResult(session, baseline, baselineText, timeoutMs);
      const outPath = candidatePath(out, index, candidates);
      await downloadVideo(session, video.src, outPath);
      writeManifest(outPath, {
        provider: 'doubao-desktop', model, ratio, duration, loopRequested: Boolean(args.loop),
        reference: ref, promptFile: args['prompt-file'] ? path.resolve(args['prompt-file']) : null,
        promptChars: prompt.length,
        promptSha256: crypto.createHash('sha256').update(prompt, 'utf8').digest('hex'),
        candidate: index + 1, candidateCount: candidates,
        generatedAt: new Date().toISOString(), sourceUrlScheme: String(video.src).split(':')[0],
      });
    }
    completed = true;
  } finally {
    if (completed && bootstrap.launched && !args['keep-open']) {
      await session.send('Browser.close').catch(() => {});
      console.log('[doubao] closed the automation-launched client and loopback debug port');
    }
    session.close();
  }
}

main().catch(error => {
  console.error(`[doubao] ${error.message}`);
  process.exitCode = 1;
});
