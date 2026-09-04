#!/usr/bin/env node
/*
 * 玩家手枪单持/双持运行时截图复查。
 * - 12 把手枪逐枪水平朝右，分别截图单持与同枪双持；
 * - Desert Eagle 加做五个方向的单持/双持镜像抽样；
 * - 同时量化主手与副手的渲染握把点误差。
 *
 * 用法：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-pistol-grip-runtime-review.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 避免与其他并行视觉任务残留的固定 CDP 端口相撞；profile 仍保持每次独立。
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const outputDir = path.join(here, 'verify-shots', 'pistol-grip-runtime-20260901');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-pistol-grip-'));
const viewport = { width: 1920, height: 1080 };
const clip = { x: 675, y: 285, width: 570, height: 470, scale: 1 };
const runMode = process.argv[2] || 'levels';
if (!['all', 'levels', 'angles', 'locomotion'].includes(runMode)) {
  throw new Error(`Unknown run mode: ${runMode}`);
}
fs.mkdirSync(outputDir, { recursive: true });

let edge = null;
let socket = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanup(code) {
  try { socket?.close(); } catch {}
  try { edge?.kill('SIGKILL'); } catch {}
  await sleep(1000);
  for (let attempt = 0; attempt < 6; attempt++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(profile)) break;
    await sleep(500);
  }
  if (code !== undefined) process.exit(code);
}
process.on('exit', () => {
  try { socket?.close(); } catch {}
  try { edge?.kill(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

edge = spawn(edgePath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  `--window-size=${viewport.width},${viewport.height}`,
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  'http://localhost:5173/',
], { stdio: 'ignore', windowsHide: true });
edge.on('exit', (code, signal) => {
  console.error(`Edge exited early: code=${code} signal=${signal}`);
});

const fetchJson = async url => (await fetch(url)).json();
let page = null;
for (let attempt = 0; attempt < 120 && !page; attempt++) {
  try {
    const pages = await fetchJson(`${cdpBase}/json/list`);
    page = pages.find(entry => entry.type === 'page' && entry.url.includes('localhost:5173')) || null;
  } catch {}
  if (!page) await sleep(250);
}
if (!page) {
  console.error('No Vite page found on CDP');
  await cleanup(1);
}

socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
socket.onclose = event => console.error(`CDP socket closed: code=${event.code} reason=${event.reason}`);
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++sequence;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  }
  return response.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: viewport.width,
  height: viewport.height,
  deviceScaleFactor: 1,
  mobile: false,
});

async function ensureGameReady() {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = await evaluate(`(async () => {
      if (window.Game?.isRunning && window.Game?.player) return true;
      const button = document.getElementById('startGameBtn');
      if (button && getComputedStyle(button).display !== 'none') button.click();
      return false;
    })()`).catch(() => false);
    if (!ready) await sleep(500);
  }
  return ready;
}
async function ensureMainSceneAndSafety() {
  if (!await ensureGameReady()) return false;
  return evaluate(`(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const sceneUrl = resources.find(url => url.includes('/src/world/scene-manager.js?')) || '/src/world/scene-manager.js';
    const { SceneManager } = await import(sceneUrl);
    if (SceneManager.currentScene !== 'scene_main' && SceneManager.switchScene) {
      await SceneManager.switchScene('scene_main', window.Game.player);
    }
    const player = window.Game?.player;
    if (!player) return false;
    player.maxHealth = Math.max(Number(player.maxHealth) || 0, 999999);
    player.health = player.maxHealth;
    player._invulnerable = true;
    player.invulnerable = true;
    return true;
  })()`).catch(() => false);
}
if (!await ensureGameReady()) {
  console.error('Game did not reach running state');
  await cleanup(1);
}

await evaluate(`(async () => {
  const resources = performance.getEntriesByType('resource').map(entry => entry.name);
  const sceneUrl = resources.find(url => url.includes('/src/world/scene-manager.js?')) || '/src/world/scene-manager.js';
  const { SceneManager } = await import(sceneUrl);
  if (SceneManager.currentScene !== 'scene_main' && SceneManager.switchScene) {
    await SceneManager.switchScene('scene_main', window.Game.player);
  }
  return true;
})()`);
await sleep(2500);

const candidates = await evaluate(`(async () => {
  const { EquipDataManager } = await import('/src/ui/equip-data-manager.js');
  const family = new Set(['pistol','p4040','deagle','revolver','beretta93r','m1911a1','usp45','fiveSeven','eternalEdict','falconEdict','crimsonCrownSettlement','myriadCorridor']);
  const seen = new Set();
  const result = [];
  for (const [exportKey, value] of Object.entries(EquipDataManager)) {
    if (!value || typeof value !== 'object') continue;
    const configKey = value.animConfigKey || value.weaponType;
    if (!family.has(configKey)) continue;
    const identity = value.weaponId || value.attackKey || exportKey;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ exportKey, configKey, attackKey: value.attackKey, weaponId: value.weaponId, name: value.name });
  }
  const order = ['weapon9','weapon10','weapon22','weapon18','weapon19','weapon49','weapon50','weapon51','weapon52','weapon53','weapon54','weapon55'];
  return result.sort((a, b) => order.indexOf(a.weaponId) - order.indexOf(b.weaponId));
})()`);
console.log('pistol candidates:', JSON.stringify(candidates));
if (candidates.length !== 12) {
  console.error(`Expected 12 pistols, got ${candidates.length}`);
  await cleanup(1);
}

const targets = {
  right_level: { x: 1530, y: 520 },
  right_up: { x: 1420, y: 185 },
  right_down: { x: 1420, y: 875 },
  left_level: { x: 390, y: 520 },
  left_up: { x: 500, y: 185 },
  left_down: { x: 500, y: 875 },
};
const metadata = [];
const singleShots = [];
const dualShots = [];
const angleShots = [];
const locomotionShots = [];

async function equip(exportKey, dual) {
  return evaluate(`(async () => {
    const { EquipDataManager } = await import('/src/ui/equip-data-manager.js');
    const { EquipManager } = await import('/src/ui/equip-manager.js');
    const item = JSON.parse(JSON.stringify(EquipDataManager[${JSON.stringify(exportKey)}]));
    const player = window.Game?.player;
    if (!player) throw new Error('Runtime player is unavailable');
    player.maxHealth = Math.max(Number(player.maxHealth) || 0, 999999);
    player.health = player.maxHealth;
    player._invulnerable = true;
    player.invulnerable = true;
    player.equipments.weapon1 = item;
    player.equipments.ring2 = ${dual ? 'JSON.parse(JSON.stringify(item))' : 'null'};
    player.weaponMode = 'weapon1';
    player.equippedRangedType = item.weaponType;
    if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
    if (EquipManager.syncWeaponVisual) EquipManager.syncWeaponVisual();
    return { name: item.name, weaponType: item.weaponType, animConfigKey: item.animConfigKey };
  })()`);
}

async function capture(candidate, mode, poseName, group, gait = null) {
  const target = targets[poseName];
  if (!await ensureMainSceneAndSafety()) {
    throw new Error(`Game did not remain ready for ${candidate.name}/${mode}/${poseName}`);
  }
  await equip(candidate.exportKey, mode === 'dual');
  await sleep(450);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  if (gait === 'run') {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  }
  if (gait) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  }
  await sleep(gait ? 420 : 300);
  const state = await evaluate(`(async () => {
    const scene = window.__phaserScene || window.PhaserGame?.scene?.getScenes(true)?.[0];
    const weapon = scene?.weaponSprite;
    const offhand = scene?.offhandWeaponSprite;
    const armSprite = scene?.playerArmSprite;
    const playerSprite = scene?.playerSprite;
    const { WeaponTransform } = await import('/src/combat/weapon-transform.js');
    const item = window.Game.player.equipments.weapon1;
    const offItem = window.Game.player.equipments.ring2;
    function renderedGrip(sprite, weaponType) {
      if (!sprite?.visible || !weaponType) return null;
      const grip = WeaponTransform.getTextureGrip(weaponType, sprite.texture.key, {
        width: sprite.displayWidth,
        height: sprite.displayHeight,
      });
      const lx = (grip.x - sprite.originX) * sprite.displayWidth * (sprite.flipX ? -1 : 1);
      const ly = (grip.y - sprite.originY) * sprite.displayHeight * (sprite.flipY ? -1 : 1);
      const cos = Math.cos(sprite.rotation), sin = Math.sin(sprite.rotation);
      return { x: sprite.x + lx * cos - ly * sin, y: sprite.y + lx * sin + ly * cos };
    }
    const mainRendered = renderedGrip(weapon, item?.animConfigKey || item?.weaponType);
    const offRendered = renderedGrip(offhand, offItem?.animConfigKey || offItem?.weaponType);
    const mainAnchor = scene?._gunGripWorld || null;
    const offAnchor = scene?._offhandGunGripWorld || null;
    let mainHandWorld = null;
    const armCfg = scene?._twistConfig?.arm;
    if (armSprite?.visible && armCfg && playerSprite && scene?._twistState) {
      const frameW = Number(playerSprite.frame?.width || 512);
      const frameH = Number(playerSprite.frame?.height || 516);
      const handPixelX = scene._twistState.facingRight ? armCfg.handX : frameW - armCfg.handX;
      const localX = (handPixelX / frameW - armSprite.originX) * armSprite.displayWidth;
      const localY = (armCfg.handY / frameH - armSprite.originY) * armSprite.displayHeight;
      const cos = Math.cos(armSprite.rotation), sin = Math.sin(armSprite.rotation);
      mainHandWorld = {
        x: armSprite.x + localX * cos - localY * sin,
        y: armSprite.y + localX * sin + localY * cos,
      };
    }
    let label = document.getElementById('__pistolGripRuntimeLabel');
    if (!label) {
      label = document.createElement('div');
      label.id = '__pistolGripRuntimeLabel';
      label.style.cssText = 'position:fixed;left:${clip.x + 8}px;top:${clip.y + 8}px;z-index:999999;background:rgba(0,0,0,.78);color:#fff;font:700 18px Segoe UI;padding:5px 8px;border:1px solid #fff;border-radius:4px;pointer-events:none';
      document.body.appendChild(label);
    }
    label.textContent = ${JSON.stringify(candidate.name)} + ' | ' + ${JSON.stringify(mode)} + ' | '
      + ${JSON.stringify(gait || poseName)};
    return {
      playerTexture: playerSprite?.texture?.key,
      playerFrame: playerSprite?.frame?.name,
      playerFlipX: !!playerSprite?.flipX,
      isMoving: !!window.Game?.player?.isMoving,
      isRunning: !!window.Game?.player?.isRunning,
      weaponTexture: weapon?.texture?.key,
      weaponVisible: !!weapon?.visible,
      weaponWidth: Number(weapon?.displayWidth || 0),
      weaponHeight: Number(weapon?.displayHeight || 0),
      weaponRotation: Number(weapon?.rotation || 0),
      weaponFlipY: !!weapon?.flipY,
      mainAnchor,
      mainRendered,
      mainContactError: mainAnchor && mainRendered ? Math.hypot(mainAnchor.x - mainRendered.x, mainAnchor.y - mainRendered.y) : -1,
      mainHandWorld,
      mainHandContactError: mainAnchor && mainHandWorld ? Math.hypot(mainAnchor.x - mainHandWorld.x, mainAnchor.y - mainHandWorld.y) : -1,
      offhandTexture: offhand?.texture?.key,
      offhandVisible: !!offhand?.visible,
      offhandWidth: Number(offhand?.displayWidth || 0),
      offhandHeight: Number(offhand?.displayHeight || 0),
      offhandRotation: Number(offhand?.rotation || 0),
      offhandFlipY: !!offhand?.flipY,
      offAnchor,
      offRendered,
      offContactError: offAnchor && offRendered ? Math.hypot(offAnchor.x - offRendered.x, offAnchor.y - offRendered.y) : (offItem ? -1 : null),
    };
  })()`);
  await sleep(80);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  const safe = `${candidate.attackKey || candidate.configKey}_${mode}_${gait || poseName}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const outputPath = path.join(outputDir, `${safe}.png`);
  fs.writeFileSync(outputPath, Buffer.from(screenshot.result.data, 'base64'));
  metadata.push({ ...candidate, mode, pose: poseName, gait, file: path.relative(root, outputPath).replaceAll('\\', '/'), ...state });
  group.push(outputPath);
  console.log(`shot ${candidate.name}/${mode}/${gait || poseName}:`, JSON.stringify(state));
  if (gait) {
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  }
  if (gait === 'run') {
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  }
  if (gait) await sleep(100);
}

if (runMode !== 'angles' && runMode !== 'locomotion') {
  for (const candidate of candidates) {
    await capture(candidate, 'single', 'right_level', singleShots);
    await capture(candidate, 'dual', 'right_level', dualShots);
  }
}

const deagle = candidates.find(candidate => candidate.configKey === 'deagle');
if (runMode !== 'levels' && runMode !== 'locomotion') {
  for (const pose of ['right_up', 'right_down', 'left_up', 'left_level', 'left_down']) {
    await capture(deagle, 'single', pose, angleShots);
    await capture(deagle, 'dual', pose, angleShots);
  }
}
if (runMode === 'locomotion') {
  for (const candidate of candidates) {
    await capture(candidate, 'single', 'right_level', locomotionShots, 'run');
  }
  await capture(deagle, 'single', 'right_level', locomotionShots, 'walk');
  await capture(deagle, 'dual', 'right_level', locomotionShots, 'walk');
  await capture(deagle, 'dual', 'right_level', locomotionShots, 'run');
}

function buildSheet(paths, filename, columns) {
  const images = paths.map(file => PNG.sync.read(fs.readFileSync(file)));
  const rows = Math.ceil(images.length / columns);
  const sheet = new PNG({ width: clip.width * columns, height: clip.height * rows });
  for (let i = 0; i < sheet.data.length; i += 4) {
    sheet.data[i] = 28; sheet.data[i + 1] = 31; sheet.data[i + 2] = 38; sheet.data[i + 3] = 255;
  }
  images.forEach((source, index) => {
    const ox = (index % columns) * clip.width;
    const oy = Math.floor(index / columns) * clip.height;
    PNG.bitblt(source, sheet, 0, 0, source.width, source.height, ox, oy);
  });
  const target = path.join(outputDir, filename);
  fs.writeFileSync(target, PNG.sync.write(sheet));
  return target;
}

const singleSheet = singleShots.length ? buildSheet(singleShots, 'all-12-single-right-level.png', 4) : null;
const dualSheet = dualShots.length ? buildSheet(dualShots, 'all-12-dual-right-level.png', 4) : null;
const angleSheet = angleShots.length ? buildSheet(angleShots, 'deagle-single-dual-angle-mirror.png', 4) : null;
const locomotionSheet = locomotionShots.length ? buildSheet(locomotionShots, 'all-12-run-and-deagle-walk-dual.png', 4) : null;
const palmTolerance = runMode === 'locomotion' ? 0.75 : 0.05;
const badContacts = metadata.filter(entry => !entry.weaponVisible || entry.mainContactError < 0 || entry.mainContactError > 0.05
  || entry.mainHandContactError < 0 || entry.mainHandContactError > palmTolerance
  || (entry.mode === 'dual' && (!entry.offhandVisible || entry.offContactError < 0 || entry.offContactError > 0.05)));
const maxMainContactError = Math.max(...metadata.map(entry => entry.mainContactError));
const maxMainHandContactError = Math.max(...metadata.map(entry => entry.mainHandContactError));
const dualEntries = metadata.filter(entry => entry.mode === 'dual');
const maxOffContactError = Math.max(...dualEntries.map(entry => entry.offContactError));
const reportPath = path.join(outputDir, `runtime-metadata-${runMode}.json`);
fs.writeFileSync(reportPath, JSON.stringify({
  viewport, clip, count: candidates.length, palmTolerance, maxMainContactError, maxMainHandContactError, maxOffContactError, badContacts, entries: metadata,
}, null, 2));
console.log('single sheet:', singleSheet);
console.log('dual sheet:', dualSheet);
console.log('angle sheet:', angleSheet);
console.log('locomotion sheet:', locomotionSheet);
console.log('metadata:', reportPath);
console.log('max main contact error:', maxMainContactError);
console.log('max main hand contact error:', maxMainHandContactError);
console.log('max offhand contact error:', maxOffContactError);
if (badContacts.length) {
  console.error('Pistol contact failed:', JSON.stringify(badContacts, null, 2));
  await cleanup(1);
}
await cleanup(0);
