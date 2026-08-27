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
  '免费次数用完',
  '未认证人脸', '出于肖像保护考虑', '暂不支持上传真实人脸素材', '暂不支持',
  '服务繁忙', '网络异常', '请稍后重试',
  '视频时长超出支持范围',
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
    if (['attach-only', 'inspect', 'download-latest', 'fill-only', 'submit-filled', 'wait-current', 'keep-open', 'loop', 'new-chat', 'confirm-paid', 'scroll-latest', 'play-latest', 'help', 'h'].includes(key)) {
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
  node doubao-seedance-gen.mjs --attach-only --cdp-port 9333
    --submit-filled --confirm-paid --out output.mp4

Notes:
  - Fully exit a normally-launched Doubao client before first use.
  - --inspect enters the video composer and prints visible state, but never
    uploads, submits, downloads, or consumes quota.
  - --download-latest downloads the last ready video already visible in the
    current conversation. It never uploads, submits, or consumes quota.
  - --submit-filled submits the already-filled composer once, waits for a
    genuinely new video URL, and never uploads or rewrites the prompt.
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
      throw new Error(result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || 'page evaluation failed');
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
        title: norm(el.getAttribute('title')).slice(0, 120),
        placeholder: norm(el.getAttribute('placeholder')).slice(0, 120),
        left: Math.round(el.getBoundingClientRect().left),
        top: Math.round(el.getBoundingClientRect().top),
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
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

async function isAbstractedVideoSkill(session) {
  return session.evaluate(`(() => {
    const exit = document.querySelector('[data-testid="skill_input_exit_button"][data-value="17"]');
    if (!exit) return false;
    const r = exit.getBoundingClientRect();
    const s = getComputedStyle(exit);
    if (!exit.closest('[data-testid="chat_input"]')
      || r.width <= 2 || r.height <= 2 || s.display === 'none') return false;
    const root = exit.closest('button,[role="button"]')?.parentElement || exit.parentElement;
    return String(root?.innerText || root?.textContent || '').includes('视频生成');
  })()`);
}

async function isVideoComposerReady(session) {
  return (await isVideoComposer(session)) || (await isAbstractedVideoSkill(session));
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
  if (await isVideoComposerReady(session)) return;
  // A completed video can leave the “图片与视频” viewer tab open. Its main
  // chat editor is not the Seedance composer, so close the viewer first.
  const closedViewer = await session.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(el =>
      String(el.getAttribute('aria-label') || '').startsWith('关闭标签页：图片与视频'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (closedViewer) await sleep(800);
  // Cold-started desktop clients can expose the page target before the mode
  // buttons finish rendering. Wait for the real entry instead of treating the
  // initial empty shell as an account/permission failure.
  const initialEntry = await waitUntil(
    () => pointByText(session, { text: '视频生成', exact: true, bottom: true }),
    12000,
  );
  let clicked = await clickPoint(session, initialEntry);
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
    const skillsEntry = await clickText(session, { text: '技能 · 连接器 · 伙伴', exact: true });
    if (skillsEntry) {
      let videoEntry = await waitUntil(
        () => pointByText(session, { text: '视频生成', exact: true, bottom: true }),
        3000,
      );
      if (!videoEntry) {
        const search = await session.evaluate(`(() => {
          const el = [...document.querySelectorAll('input')].find(input => {
            const r = input.getBoundingClientRect();
            const s = getComputedStyle(input);
            return input.getAttribute('placeholder') === '搜索技能'
              && r.width > 5 && r.height > 5 && s.display !== 'none' && s.visibility !== 'hidden';
          });
          return el || null;
        })()`, { returnByValue: false });
        if (search?.objectId) {
          await session.send('DOM.focus', { objectId: search.objectId });
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
          });
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
          });
          await session.send('Input.insertText', { text: '视频生成' });
          videoEntry = await waitUntil(
            () => pointByText(session, { regex: '^视频生成(?:\\s|$)', bottom: true }),
            10000,
          );
        }
      }
      clicked = await clickPoint(session, videoEntry);
      if (clicked) await sleep(1200);
    }
  }
  if (!clicked) {
    const controls = await composerDiagnostics(session);
    fail(`could not find the Doubao “视频生成” entry; relevant controls=${JSON.stringify(controls)}`);
  }
  let ready = await waitUntil(() => isVideoComposerReady(session), 5000);
  if (!ready) {
    const useButton = await pointByText(session, { regex: '^(立即使用|使用)$', bottom: true });
    if (useButton) {
      await clickPoint(session, useButton);
      ready = await waitUntil(() => isVideoComposerReady(session), 10000);
    }
  }
  if (!ready) {
    await domClickText(session, { text: '视频生成', exact: true, bottom: true });
    ready = await waitUntil(() => isVideoComposerReady(session), 10000);
  }
  if (!ready) {
    const controls = await composerDiagnostics(session);
    fail(`Doubao did not enter the video composer; relevant controls=${JSON.stringify(controls)}`);
  }
}

async function startNewConversation(session) {
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await sleep(300);
  const before = await session.evaluate('location.href');
  const clicked = await clickText(session, { text: '新对话', exact: true });
  if (!clicked) fail('could not find the Doubao “新对话” entry');
  await sleep(1200);
  const after = await session.evaluate('location.href');
  console.log(`[doubao] opened a fresh conversation (${before} -> ${after})`);
}

async function chooseModel(session, model) {
  const point = await pointByText(session, {
    regex: '^(模型\\s*)?Seedance\\s+[^\\n]{1,40}$', flags: 'i', bottom: true,
  });
  if (!point) {
    if (await isAbstractedVideoSkill(session)) {
      console.log(`[doubao] active video skill confirmed; backend model is managed by Doubao and not exposed in this UI (requested=${model})`);
      return 'managed';
    }
    fail('could not find the Seedance model selector');
  }
  await clickPoint(session, point);
  const option = await waitUntil(() => pointByText(session, { text: model, exact: true }), 8000);
  if (!option) fail(`model option not found: ${model}`);
  await clickPoint(session, option);
  await sleep(500);
  const text = await bodyText(session);
  if (!text.includes(model)) fail(`Doubao did not select ${model}`);
  return 'explicit';
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
  const selector = await waitUntil(() => pointByText(session, {
    regex: '^(自动|3:4|4:3|9:16|16:9|1:1|21:9)\\s*[·・]\\s*\\d+s$', bottom: true,
  }), 10000, 500);
  if (!selector) {
    if (await isAbstractedVideoSkill(session)) {
      console.log(`[doubao] video skill parameters are prompt-managed in this UI; required prompt contract=${ratio}, ${duration}s`);
      return 'prompt';
    }
    fail('could not find the Seedance parameter selector');
  }
  await clickPoint(session, selector);
  let ratioPoint = await waitUntil(() => pointByText(session, { text: ratio, exact: true }), 3500);
  if (!ratioPoint) {
    const escapedRatio = ratio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ratioPoint = await waitUntil(() => pointByText(session, {
      regex: `^${escapedRatio}(?:\\s|$)`,
    }), 4500);
  }
  if (!ratioPoint) {
    const controls = await composerDiagnostics(session);
    console.log(`[doubao] parameter menu controls=${JSON.stringify(controls.slice(-24))}`);
    fail(`ratio option not found: ${ratio}`);
  }
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
  return 'explicit';
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

async function composerImageState(session) {
  return session.evaluate(`(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 12 && r.height > 12 && r.top > innerHeight * .42 &&
        s.display !== 'none' && s.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('img')].filter(visible).map(img => ({
      src: String(img.currentSrc || img.src || ''),
      alt: String(img.alt || ''),
      width: img.naturalWidth,
      height: img.naturalHeight,
    })).filter(item => item.src);
  })()`);
}

async function composerAttachmentState(session) {
  return session.evaluate(`(() => {
    const prompt = ${PROMPT_EDITOR_SCRIPT};
    const root = prompt?.closest('[data-testid="chat_input"]');
    if (!root?.querySelector('#flow-end-msg-send')) return [];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 12 && r.height > 12 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    return [...root.querySelectorAll('img')].filter(visible).map(img => ({
      src: String(img.currentSrc || img.src || ''),
      alt: String(img.alt || ''),
      width: img.naturalWidth,
      height: img.naturalHeight,
    })).filter(item => item.src);
  })()`);
}

async function plusPoint(session) {
  return session.evaluate(`(() => {
    const visible = el => { const r=el.getBoundingClientRect(); return r.width>4 && r.height>4; };
    const prompt = ${PROMPT_EDITOR_SCRIPT};
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

async function submitPoint(session) {
  return session.evaluate(`(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const prompt = ${PROMPT_EDITOR_SCRIPT};
    if (!prompt) return null;
    const pr = prompt.getBoundingClientRect();
    let root = prompt;
    for (let i = 0; root && i < 7; i += 1, root = root.parentElement) {
      const rr = root.getBoundingClientRect();
      const buttons = [...root.querySelectorAll('button,[role="button"]')]
        .filter(visible)
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(item => item.r.left >= pr.left + pr.width * .55
          && item.r.right <= rr.right + 2
          && item.r.top >= pr.top - 8
          && item.r.bottom <= pr.bottom + 8);
      if (buttons.length) {
        buttons.sort((a, b) => b.r.right - a.r.right || b.r.bottom - a.r.bottom);
        const r = buttons[0].r;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  })()`);
}

async function uploadReference(session, filePath) {
  const removed = await session.evaluate(`(() => {
    const prompt = ${PROMPT_EDITOR_SCRIPT};
    const root = prompt?.closest('[data-testid="chat_input"]');
    const buttons = root ? [...root.querySelectorAll('[data-testid="attachment-delete-btn"]')] : [];
    buttons.forEach(button => button.click());
    return buttons.length;
  })()`);
  if (removed) {
    const cleared = await waitUntil(async () => (await composerAttachmentState(session)).length === 0, 5000, 250);
    if (!cleared) fail('could not clear stale composer attachments before reference upload');
    console.log(`[doubao] cleared ${removed} stale composer attachment(s)`);
  }
  const beforeImages = await composerAttachmentState(session);
  const beforeSources = new Set(beforeImages.map(item => item.src));
  await session.send('DOM.enable');
  await session.send('Page.setInterceptFileChooserDialog', { enabled: true });
  try {
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
  const preview = await waitUntil(async () => {
    const images = await composerAttachmentState(session);
    return images.find(item => !beforeSources.has(item.src)) || null;
  }, 12000, 500);
  if (!preview) {
    const input = await existingFileInput(session);
    const selected = input?.objectId ? await session.send('Runtime.callFunctionOn', {
      objectId: input.objectId,
      functionDeclaration: 'function(){return this.files?.[0]?.name || ""}',
      returnByValue: true,
    }).then(result => result.result?.value || '').catch(() => '') : '';
    fail(`reference upload was not confirmed by a new preview (selected=${selected || 'none'}); task was not submitted`);
  }
  console.log(`[doubao] reference preview confirmed: ${path.basename(filePath)} ${preview.width}x${preview.height}`);
}

async function fillPrompt(session, prompt) {
  const editor = await promptEditor(session);
  if (!editor?.objectId) fail('could not find the video prompt editor');
  const expected = prompt.replace(/\s+/g, ' ').trim();
  const tiptap = await session.evaluate(`(prompt => {
    const el = ${PROMPT_EDITOR_SCRIPT};
    const tiptapEditor = el?.editor;
    if (!tiptapEditor?.commands?.setContent) return null;
    try {
      const paragraphs = String(prompt).split(/\\n+/).map(value => value.trim()).filter(Boolean);
      const doc = {
        type: 'doc',
        content: paragraphs.map(value => ({
          type: 'paragraph', content: [{ type: 'text', text: value }],
        })),
      };
      tiptapEditor.commands.setContent(doc, { emitUpdate: true });
      tiptapEditor.commands.focus('end');
      return { used: true, text: String(tiptapEditor.getText?.({ blockSeparator: '\\n' }) || '') };
    } catch (error) {
      return { used: false, error: String(error?.stack || error) };
    }
  })(${JSON.stringify(prompt)})`);
  if (tiptap?.used) {
    await sleep(500);
    const actual = String(tiptap.text || '').replace(/\s+/g, ' ').trim();
    const domState = await promptEditorState(session);
    const domActual = String(domState?.value || '').replace(/\s+/g, ' ').trim();
    if (actual === expected && domActual === expected) {
      const sha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
      console.log(`[doubao] prompt editor verified through Tiptap state: ${actual.length} chars sha256=${sha256}`);
      return;
    }
  } else if (tiptap?.error) {
    console.log(`[doubao] Tiptap state update unavailable; falling back to browser input: ${tiptap.error.split('\n')[0]}`);
  }
  const before = await promptEditorState(session);
  await clickPoint(session, before);
  await session.send('DOM.focus', { objectId: editor.objectId }).catch(() => {});
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
  });
  await session.send('Input.insertText', { text: prompt });
  await sleep(500);
  let after = await promptEditorState(session);
  let actual = String(after?.value || '').replace(/\s+/g, ' ').trim();
  if (actual !== expected) {
    // Some Doubao desktop builds intermittently drop one large IME insertion
    // even though the ProseMirror editor is visible. Refocus and type bounded
    // chunks through CDP; full read-back verification remains mandatory.
    await session.send('DOM.focus', { objectId: editor.objectId }).catch(() => {});
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
    });
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
    });
    for (let offset = 0; offset < prompt.length; offset += 256) {
      await session.send('Input.insertText', { text: prompt.slice(offset, offset + 256) });
      await sleep(40);
    }
    await sleep(500);
    after = await promptEditorState(session);
    actual = String(after?.value || '').replace(/\s+/g, ' ').trim();
  }
  if (actual !== expected) {
    fail(`prompt editor verification failed: expected ${expected.length} chars, read back ${actual.length}; task was not submitted`);
  }
  const sha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
  console.log(`[doubao] prompt editor verified: ${actual.length} chars sha256=${sha256}`);
}

async function videoSources(session) {
  return session.evaluate(String.raw`(() => {
    const found = [...document.querySelectorAll('video')].map((video,index)=>({
      index, src: video.currentSrc || video.src || video.querySelector('source')?.src || '',
      readyState: video.readyState, width: video.videoWidth, height: video.videoHeight,
      visible: !!(video.offsetWidth || video.offsetHeight || video.getClientRects().length)
    })).filter(item=>item.src);
    const known = new Set(found.map(item => item.src));
    for (const [index, entry] of performance.getEntriesByType('resource').entries()) {
      const src = String(entry.name || '');
      if (!src || known.has(src) || !/(?:mime_type=video|\/video\/tos\/|\.mp4(?:\?|$))/i.test(src)) continue;
      known.add(src);
      found.push({index:10000+index,src,readyState:1,width:0,height:0,visible:false,resource:true});
    }
    return found;
  })()`);
}

async function submitCurrentPrompt(session, prompt, confirmPaid = false) {
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await session.send('Emulation.setPageVisibilityOverride', { visibilityState: 'visible' }).catch(() => {});
  await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await session.evaluate('window.focus()').catch(() => {});
  const interactive = await waitUntil(() => session.evaluate(`({
    visibility: document.visibilityState, focus: document.hasFocus(),
  })`).then(state => state.focus || state.visibility === 'visible'), 3000, 250);
  if (!interactive) fail('Doubao page remained hidden and unfocused; task was not submitted');
  console.log(`[doubao] background page interaction state visibility=${interactive.visibility} focus=${interactive.focus}`);
  const before = await bodyText(session);
  const promptSignature = prompt.replace(/\s+/g, ' ').trim().slice(0, 120);
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await sleep(1200);
  const afterEnter = await promptEditorState(session);
  if (String(afterEnter?.value || '').trim()) {
    const point = await submitPoint(session);
    if (!point) fail('Enter did not submit and the constrained composer submit button was not found');
    await clickPoint(session, point);
    console.log('[doubao] Enter did not submit; clicked the constrained composer submit button');
    const pointClickStarted = await waitUntil(async () => {
      const text = await bodyText(session);
      const editor = await promptEditorState(session);
      return !String(editor?.value || '').trim()
        || text.includes('将消耗付费额度')
        || text.includes('生成中')
        || text.includes('正在生成');
    }, 2500, 250);
    if (!pointClickStarted) {
      const domClicked = await session.evaluate(`(() => {
        const button = document.querySelector('#flow-end-msg-send[data-testid="chat_input_send_button"]');
        if (!button || button.getAttribute('aria-disabled') === 'true'
          || button.getAttribute('data-disabled') === 'true') return false;
        button.click();
        return true;
      })()`);
      if (!domClicked) fail('the exact enabled composer submit button was not available');
      console.log('[doubao] coordinate click had no effect; clicked the exact enabled submit node');
      const domClickStarted = await waitUntil(async () => {
        const text = await bodyText(session);
        const editor = await promptEditorState(session);
        return !String(editor?.value || '').trim()
          || text.includes('将消耗付费额度')
          || text.includes('生成中')
          || text.includes('正在生成');
      }, 3000, 250);
      if (!domClickStarted) {
        const editor = await promptEditor(session);
        if (!editor?.objectId) fail('could not refocus the prompt editor for Ctrl+Enter submission');
        await session.send('DOM.focus', { objectId: editor.objectId }).catch(() => {});
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13,
        });
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13,
        });
        console.log('[doubao] click submission had no effect; used the configured Ctrl+Enter send shortcut');
        const shortcutStarted = await waitUntil(async () => {
          const text = await bodyText(session);
          const state = await promptEditorState(session);
          return !String(state?.value || '').trim()
            || text.includes('将消耗付费额度')
            || text.includes('生成中')
            || text.includes('正在生成');
        }, 3000, 250);
        if (!shortcutStarted) {
          const reactInvoked = await session.evaluate(`(() => {
            const button = document.querySelector('#flow-end-msg-send[data-testid="chat_input_send_button"]');
            if (!button) return false;
            const key = Object.getOwnPropertyNames(button).find(name => name.startsWith('__reactProps$'));
            const handler = key ? button[key]?.onClick : null;
            if (typeof handler !== 'function') return false;
            handler.call(button);
            return true;
          })()`);
          if (!reactInvoked) fail('the exact send button React handler was not available');
          console.log('[doubao] UI events had no effect; invoked the exact bound React send handler');
        }
      }
    }
  }
  const paidConfirmation = await waitUntil(async () => {
    const text = await bodyText(session);
    return text.includes('将消耗付费额度') && text.includes('确认生成');
  }, 5000, 500);
  if (paidConfirmation) {
    if (!confirmPaid) {
      fail('Doubao requires paid quota confirmation; rerun only with explicit user authorization and --confirm-paid');
    }
    const confirmed = await clickText(session, { text: '确认生成', exact: true });
    if (!confirmed) fail('paid quota was authorized but the “确认生成” button was not found');
    console.log('[doubao] paid quota confirmation accepted by explicit --confirm-paid authorization');
    await sleep(800);
  }
  const accepted = await waitUntil(async () => {
    const text = await bodyText(session);
    const error = ERROR_TEXTS.find(item => countText(text, item) > countText(before, item));
    if (error) fail(`Doubao rejected the task: ${error}`);
    const editor = await promptEditorState(session);
    const posted = !String(editor?.value || '').trim()
      && text.replace(/\s+/g, ' ').includes(promptSignature);
    return text.includes('生成中') || text.includes('正在生成')
      || countText(text, '视频生成已提交') > countText(before, '视频生成已提交')
      || posted || text.length > before.length + 20;
  }, 15000, 800);
  if (!accepted) {
    fail('Doubao did not confirm task submission; the tool will not retry automatically to avoid double quota use');
  }
  return before;
}

async function submitOnce(session, prompt, confirmPaid = false) {
  await fillPrompt(session, prompt);
  return submitCurrentPrompt(session, prompt, confirmPaid);
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
    const completedNow = countText(text, '你的视频生成好了') > baselineCompleted;
    const newSource = videos.find(item => !baselineSet.has(item.src)
      && (item.readyState >= 1 || (completedNow && /^https?:/i.test(item.src))));
    if (newSource) return newSource;
    // Completion text alone is insufficient: a stale conversation can retain
    // an older <video> while a new result card is still being hydrated. Scroll
    // the page to the newest card, then keep waiting for a genuinely new URL.
    // Never download the old last video merely because a marker appeared.
    if (completedNow) {
      await session.evaluate(`(() => {
        document.querySelector('#to-bottom-button')?.click();
        const nodes = [...document.querySelectorAll('*')];
        const target = nodes.reverse().find(el => String(el.innerText || '').includes('你的视频生成好了'));
        target?.scrollIntoView({block:'end'});
        window.scrollTo(0, document.body.scrollHeight);
        const cards=[...document.querySelectorAll('[data-container-type="block-v1"]')]
          .filter(el=>String(el.innerText||'').includes('你的视频生成好了'));
        cards.at(-1)?.querySelector('[class*="block-video-"]')?.click();
        return true;
      })()`);
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

  if (!args.inspect && !args['download-latest'] && !args['submit-filled'] && !args['wait-current']) {
    if (!ref || !fs.existsSync(ref)) fail('provide an existing --ref image');
    if (!prompt) fail('provide --prompt or --prompt-file');
    if (!out) fail('provide --out');
  }
  if (args['download-latest'] && !out) fail('--download-latest requires --out');
  if (args['submit-filled'] && !out) fail('--submit-filled requires --out');
  if (args['wait-current'] && !out) fail('--wait-current requires --out');

  const bootstrap = await ensureDebugClient(options);
  const targets = bootstrap.targets;
  const { session, state } = await selectDoubaoPage(targets);
  let completed = false;
  try {
    if (args['open-conversation']) {
      const opened = await clickText(session, { text: String(args['open-conversation']), exact: true });
      if (!opened) fail(`conversation not found: ${args['open-conversation']}`);
      await sleep(1500);
    }
    if (args['scroll-latest']) {
      await session.evaluate(`document.querySelector('#to-bottom-button')?.click() || false`);
      await sleep(1200);
    }
    if (args['play-latest']) {
      await session.evaluate(`(() => {
        document.querySelector('#to-bottom-button')?.click();
        const cards=[...document.querySelectorAll('[data-container-type="block-v1"]')]
          .filter(el=>String(el.innerText||'').includes('你的视频生成好了'));
        const card=cards.at(-1); card?.scrollIntoView({block:'end'});
        card?.querySelector('[class*="block-video-"]')?.click(); return !!card;
      })()`);
      await sleep(1500);
    }
    if (args.inspect) {
      const text = await bodyText(session);
      const viewport = await session.evaluate(`({
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        visibility: document.visibilityState, hasFocus: document.hasFocus(),
      })`);
      const editor = await promptEditorState(session);
      const controls = await composerDiagnostics(session);
      const composerImages = await composerImageState(session);
      const abstractedVideoSkill = await isAbstractedVideoSkill(session);
      const abstractedSkillDebug = await session.evaluate(`(() => {
        const exit = document.querySelector('[data-testid="skill_input_exit_button"][data-value="17"]');
        if (!exit) return null;
        const r = exit.getBoundingClientRect();
        const s = getComputedStyle(exit);
        const parent = exit.closest('button,[role="button"]')?.parentElement || exit.parentElement;
        return {
          text: String(parent?.innerText || parent?.textContent || '').replace(/\s+/g, ' ').trim(),
          left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
          display: s.display, visibility: s.visibility, opacity: s.opacity,
          inCurrentComposer: Boolean(exit.closest('[data-testid="chat_input"]')),
          html: String(parent?.outerHTML || '').slice(0, 2500),
        };
      })()`);
      const sendButtonDebug = await session.evaluate(`(() => {
        const button = document.querySelector('#flow-end-msg-send[data-testid="chat_input_send_button"]');
        if (!button) return null;
        const keys = Object.getOwnPropertyNames(button);
        const reactPropsKey = keys.find(key => key.startsWith('__reactProps$')) || '';
        const reactProps = reactPropsKey ? button[reactPropsKey] : null;
        return {
          disabled: button.disabled,
          ariaDisabled: button.getAttribute('aria-disabled'),
          dataDisabled: button.getAttribute('data-disabled'),
          activeElement: document.activeElement === button,
          ownKeys: keys.filter(key => /react|vue|event|click/i.test(key)),
          reactPropsKey,
          reactPropKeys: reactProps ? Object.keys(reactProps).filter(key => /click|mouse|pointer|disabled/i.test(key)) : [],
          onClickType: typeof reactProps?.onClick,
          onClickSource: typeof reactProps?.onClick === 'function'
            ? String(reactProps.onClick).slice(0, 500) : '',
        };
      })()`);
      const editorDebug = await session.evaluate(`(() => {
        const editor = ${PROMPT_EDITOR_SCRIPT};
        if (!editor) return null;
        const ownKeys = Object.getOwnPropertyNames(editor);
        const pm = editor.pmViewDesc || null;
        const pmKeys = pm ? Object.getOwnPropertyNames(pm) : [];
        let root = pm;
        for (let i = 0; root?.parent && i < 12; i += 1) root = root.parent;
        return {
          ownKeys: ownKeys.filter(key => /pm|prose|view|editor|react/i.test(key)),
          editorKeys: editor.editor ? Object.getOwnPropertyNames(editor.editor).filter(key => !key.startsWith('_')) : [],
          commandKeys: editor.editor?.commands ? Object.keys(editor.editor.commands).slice(0, 80) : [],
          pmKeys: pmKeys.filter(key => !key.startsWith('_')),
          rootKeys: root ? Object.getOwnPropertyNames(root).filter(key => !key.startsWith('_')) : [],
          rootHasView: Boolean(root?.view),
          rootViewKeys: root?.view ? Object.getOwnPropertyNames(root.view).filter(key => !key.startsWith('_')) : [],
        };
      })()`);
      const composerLocalDebug = await session.evaluate(`(() => {
        const editor = ${PROMPT_EDITOR_SCRIPT};
        const root = editor?.closest('[data-testid="chat_input"]');
        if (!root?.querySelector('#flow-end-msg-send')) return null;
        const visible = el => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const items = [...root.querySelectorAll('img,button,[role="button"],[data-testid],[data-value]')]
          .filter(visible).map(el => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              testid: el.getAttribute('data-testid') || '',
              value: el.getAttribute('data-value') || '',
              src: String(el.currentSrc || el.src || '').slice(0, 240),
              text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
              left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
            };
          });
        return { text: String(root.innerText || '').slice(0, 1200), items };
      })()`);
      const attachmentDebug = await session.evaluate(`(() => {
        const prompt = ${PROMPT_EDITOR_SCRIPT};
        const root = prompt?.closest('[data-testid="chat_input"]');
        return root ? [...root.querySelectorAll('[data-testid="attachment-image-card"]')].map(card => {
          const key = Object.getOwnPropertyNames(card).find(name => name.startsWith('__reactProps$'));
          const props = key ? card[key] : null;
          const shallow = {};
          for (const [name, value] of Object.entries(props || {})) {
            if (['string', 'number', 'boolean'].includes(typeof value)) shallow[name] = value;
            else if (value && typeof value === 'object') shallow[name] = {
              keys: Object.keys(value).slice(0, 60),
              status: value.status ?? value.uploadStatus ?? value.state ?? null,
              name: value.name ?? value.fileName ?? null,
              type: value.type ?? value.mimeType ?? null,
            };
          }
          return { propKeys: Object.keys(props || {}), shallow };
        }) : [];
      })()`);
      const videos = await videoSources(session);
      let pointState = null;
      if (args.point) {
        const [x, y] = String(args.point).split(',').map(Number);
        pointState = await session.evaluate(`(() => {
          let el=document.elementFromPoint(${x},${y}); const items=[];
          for(let i=0;el&&i<12;i++,el=el.parentElement){const r=el.getBoundingClientRect();items.push({
            tag:el.tagName,role:el.getAttribute('role')||'',aria:el.getAttribute('aria-label')||'',
            title:el.getAttribute('title')||'',text:String(el.innerText||el.textContent||'').trim().slice(0,160),
            left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height),
            html:el.outerHTML.slice(0,1200)});} return items;
        })()`);
      }
      if (args.screenshot) {
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const screenshotPath = path.resolve(args.screenshot);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
        console.log(`[doubao] screenshot -> ${screenshotPath}`);
      }
      console.log(JSON.stringify({ title: state.title, url: state.url, model, ratio, duration, viewport, pointState,
        editor: editor ? { tag: editor.tag, placeholder: editor.placeholder, valueLength: editor.value.length } : null,
        controls, composerImages, abstractedVideoSkill, abstractedSkillDebug,
        sendButtonDebug, editorDebug, composerLocalDebug, attachmentDebug,
        videos, visibleText: text.slice(-6000) }, null, 2));
      return;
    }
    if (args['download-latest']) {
      const videos = await videoSources(session);
      const completedText = await bodyText(session);
      const hasCompletedVideo = completedText.includes('你的视频生成好了');
      const video = [...videos].reverse().find(item => item.readyState >= 1 && !item.resource && item.visible) ||
        [...videos].reverse().find(item => item.readyState >= 1 && !item.resource) ||
        [...videos].reverse().find(item => item.readyState >= 1) ||
        (hasCompletedVideo ? [...videos].reverse().find(item => /^https?:/i.test(item.src)) : null);
      if (!video) fail('no ready video is visible in the current Doubao conversation');
      await downloadVideo(session, video.src, out);
      writeManifest(out, {
        provider: 'doubao-desktop', recoveredFromConversation: true,
        recoveredAt: new Date().toISOString(), sourceUrlScheme: String(video.src).split(':')[0],
      });
      completed = true;
      return;
    }

    if (args['submit-filled']) {
      if (prompt) await fillPrompt(session, prompt);
      const editor = await promptEditorState(session);
      const existingPrompt = String(editor?.value || '').trim();
      if (!existingPrompt) fail('--submit-filled requires a non-empty current prompt editor');
      const baseline = await videoSources(session);
      const baselineText = await submitCurrentPrompt(
        session, existingPrompt, Boolean(args['confirm-paid']),
      );
      console.log('[doubao] existing filled composer submitted; waiting for result');
      const video = await waitForResult(session, baseline, baselineText, timeoutMs);
      await downloadVideo(session, video.src, out);
      writeManifest(out, {
        provider: 'doubao-desktop', recoveredFromFilledComposer: true,
        promptChars: existingPrompt.length,
        promptSha256: crypto.createHash('sha256').update(existingPrompt, 'utf8').digest('hex'),
        generatedAt: new Date().toISOString(), sourceUrlScheme: String(video.src).split(':')[0],
      });
      completed = true;
      return;
    }
    if (args['wait-current']) {
      const baseline = await videoSources(session);
      const baselineText = await bodyText(session);
      const editor = await promptEditorState(session);
      const paidConfirmation = baselineText.includes('将消耗付费额度')
        && baselineText.includes('确认生成');
      const started = paidConfirmation || !String(editor?.value || '').trim()
        || baselineText.includes('生成中') || baselineText.includes('正在生成')
        || baselineText.includes('视频生成已提交');
      if (!started) fail('--wait-current found no submitted or pending-confirmation task');
      if (paidConfirmation) {
        if (!args['confirm-paid']) fail('pending generation requires explicit --confirm-paid authorization');
        const confirmed = await clickText(session, { text: '确认生成', exact: true });
        if (!confirmed) fail('pending paid confirmation button was not found');
        console.log('[doubao] pending paid generation confirmed by explicit --confirm-paid authorization');
        await sleep(800);
      }
      console.log('[doubao] waiting for the already-submitted current task');
      const video = await waitForResult(session, baseline, baselineText, timeoutMs);
      await downloadVideo(session, video.src, out);
      writeManifest(out, {
        provider: 'doubao-desktop', recoveredFromCurrentSubmission: true,
        generatedAt: new Date().toISOString(), sourceUrlScheme: String(video.src).split(':')[0],
      });
      completed = true;
      return;
    }

    await ensureVideoComposer(session);
    if (args['new-chat']) {
      await startNewConversation(session);
      await ensureVideoComposer(session);
    }
    console.log(`[doubao] model=${model} ratio=${ratio} duration=${duration}s candidates=${candidates}`);
    for (let index = 0; index < candidates; index += 1) {
      await ensureVideoComposer(session);
      const modelSelection = await chooseModel(session, model);
      const parameterSelection = await setParameters(session, ratio, duration);
      if (args['fill-only']) {
        await fillPrompt(session, prompt);
        console.log(`[doubao] fill-only verification passed (${modelSelection}/${parameterSelection}); no file uploaded and no task submitted`);
        return;
      }
      const baseline = await videoSources(session);
      await uploadReference(session, ref);
      const baselineText = await submitOnce(session, prompt, Boolean(args['confirm-paid']));
      console.log(`[doubao] candidate ${index + 1}/${candidates} submitted; waiting for result`);
      const video = await waitForResult(session, baseline, baselineText, timeoutMs);
      const outPath = candidatePath(out, index, candidates);
      await downloadVideo(session, video.src, outPath);
      writeManifest(outPath, {
        provider: 'doubao-desktop', model, modelSelection, ratio, duration,
        parameterSelection, loopRequested: Boolean(args.loop),
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
