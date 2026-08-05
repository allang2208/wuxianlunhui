// 进入 scene8 的稳健流程：点开始 → 真实模块 switchScene → 真实等待 → 校验
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1000));
  return r.result.value;
}

async function shot(cdp, file) {
  const d = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(d.data, 'base64'));
}

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

// 若在开始菜单则点开始
await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'already-in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'timeout';
})()`);

// 确保真实模块就绪
let ready = null;
for (let i = 0; i < 60; i++) {
  ready = await ev(cdp, `(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
    if (!u) return null;
    const { SceneManager } = await import(u);
    if (window.Game && window.Game.player && window.__phaserScene && SceneManager.currentScene) {
      return { scene: SceneManager.currentScene, walls: window.WallSystem ? window.WallSystem.isoVisuals.length : -1 };
    }
    return null;
  })()`);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('ready:', JSON.stringify(ready));

// 真实 switchScene
const sw = await ev(cdp, `(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  const { SceneManager } = await import(u);
  try {
    await SceneManager.switchScene('scene8', window.Game.player, 'explore');
    return { ok: true, scene: SceneManager.currentScene };
  } catch (e) {
    return { ok: false, err: String(e && e.stack || e) };
  }
})()`);
console.log('switch:', JSON.stringify(sw));

// 真实等待（RAF 自身驱动）
let st = null;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 800));
  st = await ev(cdp, `(async () => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/defense-system.js?'));
    const { DefenseSystem } = await import(u);
    return {
      scene: (await import(performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?')))).SceneManager.currentScene,
      active: DefenseSystem.active,
      base: DefenseSystem.base ? { x: Math.round(DefenseSystem.base.x), y: Math.round(DefenseSystem.base.y) } : null,
      hasBase: window.Game.entities.has('defense_base'),
      towers: DefenseSystem.towers.length,
      entities: window.Game.entities.size,
    };
  })()`);
  if (st.active) break;
}
console.log('state:', JSON.stringify(st, null, 2));
await shot(cdp, 'defense-scene8.png');
cdp.close();
