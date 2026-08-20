// 阴影系统综合审计探针（2026-08-19）：
// ①122 计数/透明度/深度/缓存 → ②质量档切换异常监听 → ③123 雪松注册+截图 → ④122 黄昏截图
// 安全入口：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-sun-shadow-audit.mjs
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1000));
  return r.result.value;
}

async function shot(cdp, file) {
  const d = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(d.data, 'base64'));
  console.log('shot:', file);
}

const AUDIT_SNAPSHOT = `JSON.stringify((() => {
  const scene = window.__phaserScene;
  const out = { total: 0, hullBuilding: 0, hullObstacle: 0, capsule: 0,
    bakes: scene._structureShadowBakeCache?.size ?? -1,
    alphas: new Set(), depthViolations: [], samples: [] };
  for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
    out.total++;
    const srcTex = data.sourceSprite?.texture?.key || '';
    if (data.hull) {
      if (srcTex.startsWith('obstacle_')) out.hullObstacle++; else out.hullBuilding++;
      if (sprite.visible) out.alphas.add(+sprite.alpha.toFixed(3));
      const srcDepth = data.sourceSprite?.depth;
      if (typeof srcDepth === 'number' && sprite.depth >= srcDepth) {
        out.depthViolations.push({ tex: srcTex, shadowDepth: +sprite.depth.toFixed(3), srcDepth });
      }
      if (out.samples.length < 4 && srcTex.startsWith('obstacle_cactus')) {
        out.samples.push({ tex: srcTex, alpha: +sprite.alpha.toFixed(3), visible: sprite.visible });
      }
    } else {
      out.capsule++;
      if (sprite.visible) out.alphas.add(+sprite.alpha.toFixed(3));
    }
  }
  out.alphas = Array.from(out.alphas);
  return out;
})())`;

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

// 异常收集
await ev(cdp, `window.__auditErrors = []; window.addEventListener('error', e => window.__auditErrors.push(String(e.message || e))); window.addEventListener('unhandledrejection', e => window.__auditErrors.push('rej:' + String(e.reason && e.reason.message || e.reason))); 'hooked'`);

// 进游戏
await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'timeout';
})()`);

const switchScene = async (sceneId) => ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player && window.__phaserScene) {
      const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'))
        || '/src/world/scene-manager.js';
      const { SceneManager } = await import(u);
      if (SceneManager.currentScene === '${sceneId}') return { scene: '${sceneId}' };
      try { await SceneManager.switchScene('${sceneId}', window.Game.player, 'explore'); return { scene: SceneManager.currentScene }; }
      catch (e) { return { err: String(e) }; }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return { err: 'not-ready' };
})()`);

console.log('switch122:', JSON.stringify(await switchScene('scene8')));
await new Promise((r) => setTimeout(r, 2500));

// ① 122 正午审计快照
await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.25 }); 'noon'`);
await new Promise((r) => setTimeout(r, 900));
const snap122 = await ev(cdp, AUDIT_SNAPSHOT);
console.log('122-noon:', JSON.stringify(snap122, null, 1));

// ② 质量档切换 medium→low→high
const qualityLog = [];
for (const q of ['medium', 'low', 'high']) {
  await ev(cdp, `window.EnvironmentLightingSystem.configure({ quality: '${q}' }); 'q=${q}'`);
  await new Promise((r) => setTimeout(r, 700));
  const vis = await ev(cdp, `JSON.stringify((() => {
    const scene = window.__phaserScene;
    let visHull = 0, visCap = 0;
    for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
      if (!sprite.visible) continue;
      if (data.hull) visHull++; else visCap++;
    }
    return { visHull, visCap, quality: window.EnvironmentLightingSystem.getShadowQuality() };
  })())`);
  qualityLog.push(JSON.parse(vis));
}
console.log('quality:', JSON.stringify(qualityLog));
const errsAfterQuality = await ev(cdp, `JSON.stringify(window.__auditErrors.slice(0, 8))`);
console.log('errors-after-quality:', errsAfterQuality);

// ③ 123 雪松
console.log('switch123:', JSON.stringify(await switchScene('scene9')));
await new Promise((r) => setTimeout(r, 3000));
const snap123 = await ev(cdp, `JSON.stringify((() => {
  const scene = window.__phaserScene;
  const out = { total: 0, hullPine: 0, capsule: 0, alphas: new Set() };
  for (const [sprite, data] of (scene._staticSunShadows || new Map()).entries()) {
    out.total++;
    const tex = data.sourceSprite?.texture?.key || '';
    if (data.hull) {
      if (tex.startsWith('obstacle_snow_pine')) out.hullPine++;
      if (sprite.visible) out.alphas.add(+sprite.alpha.toFixed(3));
    } else {
      out.capsule++;
      if (sprite.visible) out.alphas.add(+sprite.alpha.toFixed(3));
    }
  }
  out.alphas = Array.from(out.alphas);
  return out;
})())`);
console.log('123-noon:', snap123);
await shot(cdp, 'audit-123-pine.png');

// ④ 回 122 黄昏全景
console.log('switch122-back:', JSON.stringify(await switchScene('scene8')));
await new Promise((r) => setTimeout(r, 2500));
await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: 0.5 }); 'dusk'`);
await new Promise((r) => setTimeout(r, 900));
await shot(cdp, 'audit-122-dusk.png');

// 恢复真实时间流与高档
await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: true, quality: 'high' }); 'resumed'`);
const finalErrs = await ev(cdp, `JSON.stringify(window.__auditErrors.slice(0, 12))`);
console.log('errors-final:', finalErrs);
cdp.close();
