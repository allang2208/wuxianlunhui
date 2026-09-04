#!/usr/bin/env node
/*
 * 玩家长枪 ADS 运行时截图复查。
 * - 真正按住右键，要求 _aimEase >= 0.95 后才截图；
 * - 34 把步枪/散弹枪/机枪逐枪水平朝右截图；
 * - AKM 加做右上/右下/左上/左平/左下，M416/Super90/PKM 加做左平抽样；
 * - 独立 TEMP profile，结束后只关闭自己的无头 Edge。
 *
 * 用法：powershell -ExecutionPolicy Bypass -File tools/cdp-run.ps1 cdp-gun-ads-runtime-review.mjs
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
const cdpPort = 9246;
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const outputDir = path.join(here, 'verify-shots', 'gun-ads-runtime-20260901');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-gun-ads-'));
const viewport = { width: 1920, height: 1080 };
const clip = { x: 675, y: 285, width: 570, height: 470, scale: 1 };
fs.mkdirSync(outputDir, { recursive: true });

let edge = null;
let socket = null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
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

const fetchJson = async (url) => (await fetch(url)).json();
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
const started = await ensureGameReady();
if (!started) {
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
  const rifle = new Set(['akm','stg44','m416','qbz95','frontier_rifle','vengeance_rifle','astral_tide_rifle','zero_point_rifle','corona_cadence_rifle','terminal_echo_rifle','qbz191']);
  const machine = new Set(['pkm','rpd','m249','ultimax100','mg42','fusion_core_lmg','singularity_loom_lmg','celestial_cartographer_lmg','grave_covenant_cantor_lmg','qjb201','energy_lmg']);
  const seen = new Set();
  const result = [];
  for (const [exportKey, value] of Object.entries(EquipDataManager)) {
    if (!value || typeof value !== 'object' || !value.isTwoHanded) continue;
    const configKey = value.animConfigKey || value.weaponType;
    let family = null;
    if (rifle.has(configKey)) family = 'rifles';
    else if (machine.has(configKey)) family = 'machine_guns';
    else if (configKey === 'shotgun') family = 'shotguns';
    if (!family) continue;
    const identity = value.weaponId || value.attackKey || exportKey;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ exportKey, family, configKey, attackKey: value.attackKey, weaponId: value.weaponId, name: value.name });
  }
  const order = { rifles: 0, shotguns: 1, machine_guns: 2 };
  return result.sort((a, b) => order[a.family] - order[b.family] || a.weaponId.localeCompare(b.weaponId));
})()`);

const familyCounts = Object.groupBy(candidates, candidate => candidate.family);
const counts = Object.fromEntries(Object.entries(familyCounts).map(([key, values]) => [key, values.length]));
console.log('candidate counts:', JSON.stringify(counts));
if (counts.rifles !== 11 || counts.shotguns !== 12 || counts.machine_guns !== 11) {
  console.error('Expected 11 rifles, 12 shotguns and 11 machine guns');
  console.error(JSON.stringify(candidates, null, 2));
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
const levelShots = [];
const angleShots = [];

async function equip(exportKey) {
  return evaluate(`(async () => {
    const { EquipDataManager } = await import('/src/ui/equip-data-manager.js');
    const { EquipManager } = await import('/src/ui/equip-manager.js');
    const item = JSON.parse(JSON.stringify(EquipDataManager[${JSON.stringify(exportKey)}]));
    const player = window.Game.player;
    player.equipments.weapon1 = item;
    player.weaponMode = 'weapon1';
    player.equippedRangedType = item.weaponType;
    if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
    if (EquipManager.syncWeaponVisual) EquipManager.syncWeaponVisual();
    return { name: item.name, weaponType: item.weaponType, animConfigKey: item.animConfigKey, attackKey: item.attackKey };
  })()`);
}

async function waitForFullAds() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await evaluate(`(() => {
      const scene = window.__phaserScene || window.PhaserGame?.scene?.getScenes(true)?.[0];
      return { aimMode: !!window.Game?.player?._aimModeActive, aimEase: Number(scene?._aimEase || 0) };
    })()`);
    if (state.aimMode && state.aimEase >= 0.95) return state;
    await send('Page.captureScreenshot', { format: 'png' });
    await sleep(80);
  }
  return evaluate(`(() => {
    const scene = window.__phaserScene || window.PhaserGame?.scene?.getScenes(true)?.[0];
    return { aimMode: !!window.Game?.player?._aimModeActive, aimEase: Number(scene?._aimEase || 0) };
  })()`);
}

async function capture(candidate, poseName, group) {
  const target = targets[poseName];
  let adsState = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!await ensureGameReady()) continue;
    await equip(candidate.exportKey);
    await sleep(300);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await sleep(120);
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: target.x, y: target.y, button: 'right', buttons: 2, clickCount: 1,
    });
    adsState = await waitForFullAds().catch(() => null);
    if (adsState?.aimMode && adsState.aimEase >= 0.95) break;
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: target.x, y: target.y, button: 'right', buttons: 0, clickCount: 1,
    });
    await sleep(500);
  }
  if (!adsState?.aimMode || adsState.aimEase < 0.95) {
    throw new Error(`ADS did not engage for ${candidate.name}/${poseName}: ${JSON.stringify(adsState)}`);
  }

  const state = await evaluate(`(() => {
    const scene = window.__phaserScene || window.PhaserGame?.scene?.getScenes(true)?.[0];
    const weapon = scene?.weaponSprite;
    const arm = scene?.playerArmSprite;
    const supportArm = scene?.playerSupportArmSprite;
    const player = scene?.playerSprite;
    let label = document.getElementById('__gunAdsRuntimeLabel');
    if (!label) {
      label = document.createElement('div');
      label.id = '__gunAdsRuntimeLabel';
      label.style.cssText = 'position:fixed;left:${clip.x + 8}px;top:${clip.y + 8}px;z-index:999999;background:rgba(0,0,0,.78);color:#fff;font:700 18px Segoe UI;padding:5px 8px;border:1px solid #fff;border-radius:4px;pointer-events:none';
      document.body.appendChild(label);
    }
    label.textContent = ${JSON.stringify(candidate.name)} + ' | ' + ${JSON.stringify(poseName)}
      + ' | ADS=' + Number(scene?._aimEase || 0).toFixed(3);
    return {
      aimEase: Number(scene?._aimEase || 0),
      aimMode: !!window.Game.player._aimModeActive,
      weaponTexture: weapon?.texture?.key,
      weaponVisible: !!weapon?.visible,
      weaponX: Number(weapon?.x || 0), weaponY: Number(weapon?.y || 0),
      weaponRotation: Number(weapon?.rotation || 0),
      weaponWidth: Number(weapon?.displayWidth || 0), weaponHeight: Number(weapon?.displayHeight || 0),
      weaponFlipY: !!weapon?.flipY,
      rearGripWorld: scene?._gunGripWorld || null,
      rearGripRenderWorld: scene?._gunRearGripRenderWorld || null,
      rearContactError: Number(scene?._gunRearContactError ?? -1),
      armTexture: arm?.texture?.key,
      armFrame: arm?.frame?.name,
      armVisible: !!arm?.visible,
      armRotation: Number(arm?.rotation || 0),
      supportArmTexture: supportArm?.texture?.key,
      supportArmFrame: supportArm?.frame?.name,
      supportArmVisible: !!supportArm?.visible,
      supportArmRotation: Number(supportArm?.rotation || 0),
      supportArmScaleX: Number(supportArm?.scaleX || 0),
      supportContactError: Number(scene?._gunSupportContactError ?? -1),
      supportHandWorld: scene?._gunSupportHandWorld || null,
      supportTargetWorld: scene?._gunSupportTargetWorld || null,
      supportGuardWorld: scene?._gunSupportGuardWorld || null,
      supportGuardError: scene?._gunSupportHandWorld && scene?._gunSupportGuardWorld
        ? Math.hypot(
            scene._gunSupportHandWorld.x - scene._gunSupportGuardWorld.x,
            scene._gunSupportHandWorld.y - scene._gunSupportGuardWorld.y
          )
        : -1,
      playerTexture: player?.texture?.key,
      playerFrame: player?.frame?.name,
      playerFlipX: !!player?.flipX,
    };
  })()`);
  await sleep(80);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  const safeName = `${candidate.family}_${candidate.attackKey || candidate.configKey}_${poseName}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const outputPath = path.join(outputDir, `${safeName}.png`);
  fs.writeFileSync(outputPath, Buffer.from(screenshot.result.data, 'base64'));
  const entry = { ...candidate, pose: poseName, file: path.relative(root, outputPath).replaceAll('\\', '/'), ...state };
  metadata.push(entry);
  group.push(outputPath);
  console.log(`shot ${candidate.name}/${poseName}:`, JSON.stringify(state));
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: target.x, y: target.y, button: 'right', buttons: 0, clickCount: 1,
  });
  await sleep(120);
}

for (const candidate of candidates) {
  await capture(candidate, 'right_level', levelShots);
}

const akm = candidates.find(candidate => candidate.configKey === 'akm');
for (const pose of ['right_up', 'right_down', 'left_up', 'left_level', 'left_down']) {
  await capture(akm, pose, angleShots);
}
for (const key of ['m416', 'shotgun', 'pkm']) {
  const candidate = candidates.find(item => item.configKey === key && (key !== 'shotgun' || item.attackKey === 'super90'));
  await capture(candidate, 'left_level', angleShots);
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

const levelSheet = buildSheet(levelShots, 'all-34-right-level.png', 4);
const angleSheet = buildSheet(angleShots, 'angle-and-mirror-samples.png', 4);
const badSupportContacts = metadata.filter(entry => !entry.supportArmVisible
  || entry.rearContactError < 0 || entry.rearContactError > 0.05
  || entry.supportContactError < 0 || entry.supportContactError > 0.05
  || entry.supportGuardError < 0 || entry.supportGuardError > 0.05);
const maxRearContactError = Math.max(...metadata.map(entry => entry.rearContactError));
const maxSupportContactError = Math.max(...metadata.map(entry => entry.supportContactError));
const maxSupportGuardError = Math.max(...metadata.map(entry => entry.supportGuardError));
fs.writeFileSync(path.join(outputDir, 'runtime-metadata.json'), JSON.stringify({
  viewport, clip, counts, maxRearContactError, maxSupportContactError, maxSupportGuardError, badSupportContacts, entries: metadata,
}, null, 2));
console.log('level sheet:', levelSheet);
console.log('angle sheet:', angleSheet);
console.log('metadata:', path.join(outputDir, 'runtime-metadata.json'));
console.log('max rear contact error:', maxRearContactError);
console.log('max support contact error:', maxSupportContactError);
console.log('max support guard error:', maxSupportGuardError);
if (badSupportContacts.length) {
  console.error('Support hand contact failed:', JSON.stringify(badSupportContacts, null, 2));
  await cleanup(1);
}
await cleanup(0);
