// 基地阴影问题复现取证：冻结深夜/斜向/正午三相，镜头对准基地拍特写
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
      if (SceneManager.currentScene === 'scene8') return 'scene8';
      try { await SceneManager.switchScene('scene8', window.Game.player, 'explore'); return SceneManager.currentScene; }
      catch (e) { return 'err:' + e; }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return 'not-ready';
})()`);
console.log('scene:', sw);
await new Promise((r) => setTimeout(r, 2500));

// 把玩家挪到基地旁，让镜头对准基地（相机恒居玩家中央）
await ev(cdp, `(async () => {
  const base = window.Game.entities.get('defense_base');
  if (base && window.Game.player) {
    window.Game.player.x = base.x + 260;
    window.Game.player.y = base.y + 240;
  }
  return base ? { x: base.x, y: base.y } : null;
})()`);
await new Promise((r) => setTimeout(r, 1200));

// 基地阴影数据 dump + 三相截图
const info = await ev(cdp, `JSON.stringify((() => {
  const scene = window.__phaserScene;
  const base = window.Game.entities.get('defense_base');
  const shadow = scene._structureSunShadows.get(base);
  const data = scene._staticSunShadows.get(shadow);
  return {
    vertices: data?.footprintVertices,
    crossOffset: data?.projectionCrossOffset,
    sprite: shadow ? { x: shadow.x, y: shadow.y, rotation: +shadow.rotation.toFixed(3), alpha: shadow.alpha, visible: shadow.visible, texKey: shadow.texture?.key, frameW: shadow.frame?.width, frameH: shadow.frame?.height } : null,
  };
})())`);
console.log('base-shadow:', info);

for (const p of [{ name: 'midnight', phase: 0.75 }, { name: 'morning-diag', phase: 0.125 }, { name: 'noon', phase: 0.25 }]) {
  await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: ${p.phase} }); 'set'`);
  await new Promise((r) => setTimeout(r, 900));
  const d = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/base-shadow-${p.name}.png`, Buffer.from(d.data, 'base64'));
  const st = await ev(cdp, `(() => {
    const base = window.Game.entities.get('defense_base');
    const shadow = window.__phaserScene._structureSunShadows.get(base);
    return JSON.stringify({ visible: shadow?.visible, alpha: shadow?.alpha, rotation: +shadow?.rotation.toFixed(3) });
  })()`);
  console.log(`${p.name}:`, st);
}
await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: true }); 'resumed'`);
cdp.close();
