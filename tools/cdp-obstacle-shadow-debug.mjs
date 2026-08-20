// 障碍物（仙人掌）阴影取证：进 scene8 → 冻结正午 → dump hull 注册状态 → 截图
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);

async function getPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900));
  return r.result.value;
}

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'timeout';
})()`);

const sw = await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player && window.__phaserScene) {
      const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'))
        || '/src/world/scene-manager.js';
      const { SceneManager } = await import(u);
      if (SceneManager.currentScene === 'scene8') return { scene: 'scene8' };
      try { await SceneManager.switchScene('scene8', window.Game.player, 'explore'); return { scene: SceneManager.currentScene }; }
      catch (e) { return { err: String(e) }; }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return { err: 'not-ready' };
})()`);
console.log('scene:', JSON.stringify(sw));
await new Promise((r) => setTimeout(r, 2500));

await ev(cdp, `(async () => {
  window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.25 });
  return 'frozen-noon';
})()`);
await new Promise((r) => setTimeout(r, 900));

const dump = await ev(cdp, `(async () => {
  const scene = window.__phaserScene;
  const out = { total: scene._staticSunShadows?.size ?? -1, hull: 0, capsule: 0,
    bakes: scene._structureShadowBakeCache?.size ?? -1, scatterHull: 0, samples: [] };
  for (const [key, data] of (scene._staticSunShadows || new Map()).entries()) {
    if (data.hull) {
      out.hull++;
      const isObstacle = (data.sourceSprite?.texture?.key || '').startsWith('obstacle_cactus');
      if (isObstacle) out.scatterHull++;
      if (out.samples.length < 8 && isObstacle) out.samples.push({
        x: Math.round(data.x||0), y: Math.round(data.y||0),
        verts: (data.footprintVertices||[]).length,
        gVisible: key.visible, gAlpha: key.alpha,
        sil: data.silhouetteSprite ? {
          vis: data.silhouetteSprite.visible,
          x: Math.round(data.silhouetteSprite.x), y: Math.round(data.silhouetteSprite.y),
          alpha: +((data.silhouetteSprite.alpha||0).toFixed(2)),
          texW: data.silhouetteSprite.frame?.width ?? -1,
          texH: data.silhouetteSprite.frame?.height ?? -1,
        } : null,
        srcVisible: data.sourceSprite?.visible ?? null,
        srcTex: data.sourceSprite?.texture?.key || null,
      });
    } else out.capsule++;
  }
  return out;
})()`);
console.log(JSON.stringify(dump, null, 1));

const d = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync('tools/verify-shots', { recursive: true });
fs.writeFileSync('tools/verify-shots/obstacle-shadow-debug.png', Buffer.from(d.data, 'base64'));
console.log('shot saved');
cdp.close();
