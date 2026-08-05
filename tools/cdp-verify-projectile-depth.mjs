// 验证弹道深度修复：进 scene8 → 等塔开火 → 检查 projectile_tracer 深度是否 = y + 500
const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5173';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(URL_SUB));
if (!page) throw new Error('no page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) return { err: r.result.exceptionDetails.exception?.description };
  return r.result.result.value;
}

// 点开始（若在菜单）
await ev(`(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return;
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') b.click();
    await new Promise(r => setTimeout(r, 500));
  }
})()`);

// 确保在 scene8
const sw = await ev(`(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  if (!u) return 'no-sm';
  const { SceneManager } = await import(u);
  if (SceneManager.currentScene !== 'scene8') {
    await SceneManager.switchScene('scene8', window.Game.player, 'explore');
  }
  return SceneManager.currentScene;
})()`);
console.log('scene:', sw);

// 真实等待刷怪（6s 首波）与塔开火
await new Promise((r) => setTimeout(r, 9000));

const st = await ev(`(() => {
  const S = window.__phaserScene;
  if (!S) return null;
  const out = [];
  for (const obj of S.children.list) {
    if (obj && obj.texture && obj.texture.key === 'projectile_tracer') {
      out.push({ x: Math.round(obj.x), y: Math.round(obj.y), depth: Math.round(obj.depth * 100) / 100, expect: Math.round(obj.y) + 500 });
    }
  }
  return { count: out.length, samples: out.slice(0, 8) };
})()`);
console.log('PROJECTILES:', JSON.stringify(st, null, 2));
ws.close();
