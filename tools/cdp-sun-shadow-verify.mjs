// 太阳投影实机验证（2026-08-19 影根/宽度算法重做）：
// 冻结日出/正午/日落三个时相，逐一时相截图 + 采集 ShadowDebug.inspect 影根对齐数据。
// 安全入口：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-sun-shadow-verify.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5173';

async function getPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(URL_SUB));
      if (page) return page;
    } catch (_e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('no page');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); }
    }));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1200));
  return r.result.value;
}

async function shot(cdp, file) {
  const d = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(d.data, 'base64'));
  console.log('shot:', file);
}

// 模块实例：走 main.js 挂载的 window.EnvironmentLightingSystem（HMR 后裸路径
// import 会拿到第二实例，配置不到游戏真正读的那份太阳状态）。
const IMPORT_ENV = `(async () => {
  if (!window.EnvironmentLightingSystem) throw new Error('window.EnvironmentLightingSystem 未挂载');
  return { EnvironmentLightingSystem: window.EnvironmentLightingSystem };
})()`;

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

// 若在开菜单则点开始
await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'already-in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'timeout';
})()`);

// 等真实模块就绪并切世界-122
let ready = null;
for (let i = 0; i < 60; i++) {
  ready = await ev(cdp, `(async () => {
    if (!(window.Game && window.Game.player && window.__phaserScene)) return null;
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'))
      || '/src/world/scene-manager.js';
    const { SceneManager } = await import(u);
    return { scene: SceneManager.currentScene };
  })()`);
  if (ready && ready.scene) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('ready:', JSON.stringify(ready));
if (ready.scene !== 'scene8') {
  const sw = await ev(cdp, `(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'))
      || '/src/world/scene-manager.js';
    const { SceneManager } = await import(u);
    try {
      await SceneManager.switchScene('scene8', window.Game.player, 'explore');
      return { ok: true, scene: SceneManager.currentScene };
    } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
  })()`);
  console.log('switch:', JSON.stringify(sw));
}
await new Promise((r) => setTimeout(r, 3000));

// 逐时相冻结 + 采样
const phases = [
  { name: 'noon', phase: 0.25 },
  { name: 'dusk', phase: 0.5 },
  { name: 'dawn', phase: 0.0 },
];
const report = {};
for (const p of phases) {
  const set = await ev(cdp, `(async () => {
    const { EnvironmentLightingSystem } = await ${IMPORT_ENV};
    EnvironmentLightingSystem.configure({ animateSun: false, startPhase: ${p.phase} });
    return { phase: ${p.phase} };
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  const sample = await ev(cdp, `(async () => {
    const { EnvironmentLightingSystem } = await ${IMPORT_ENV};
    const sun = EnvironmentLightingSystem.getSun();
    const dbg = window.ShadowDebug;
    const out = { sun: { shadowX: +sun.shadowX.toFixed(3), shadowY: +sun.shadowY.toFixed(3), elevation: +sun.elevation.toFixed(3) }, buildings: [] };
    if (!dbg) return { err: 'ShadowDebug 未安装' };
    const list = dbg.listBuildings();
    for (const b of list) {
      const info = dbg.inspect(b.id);
      if (!info.ok) continue;
      out.buildings.push({
        id: b.id, texture: info.entity.texture,
        visualFoot: info.visualFoot && { x: +info.visualFoot.x.toFixed(1), y: +info.visualFoot.y.toFixed(1) },
        shadowRoot: info.shadowRoot,
        delta: info.delta && { x: +info.delta.x.toFixed(1), y: +info.delta.y.toFixed(1) },
        sprite: info.shadowSprite && {
          x: +info.shadowSprite.x.toFixed(1), y: +info.shadowSprite.y.toFixed(1),
          rot: +info.shadowSprite.rotation.toFixed(3),
        },
      });
    }
    return out;
  })()`);
  report[p.name] = sample;
  await shot(cdp, `sun-shadow-${p.name}.png`);
}
console.log(JSON.stringify(report, null, 2));

// 恢复真实时间流
await ev(cdp, `(async () => {
  const { EnvironmentLightingSystem } = await ${IMPORT_ENV};
  EnvironmentLightingSystem.configure({ animateSun: true });
  return 'resumed';
})()`);
cdp.close();
