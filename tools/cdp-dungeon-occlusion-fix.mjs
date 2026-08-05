// 遮挡专项（修正摆放）：墙后/墙前沙袋 + 墙后掉落物 X 光 + 站桩怪贴墙
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5173';
const SHOT_DIR = 'tools/verify-shots/layer-audit';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(URL_SUB));
if (!page) throw new Error('no page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description };
  return r.result.value;
}
async function shot(file) {
  const d = await send('Page.captureScreenshot', { format: 'png' });
  if (!d || !d.data) { console.log('shot failed:', file); return; }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(`${SHOT_DIR}/${file}`, Buffer.from(d.data, 'base64'));
}
const pump = (n) => ev(`(() => {
  const G = window.PhaserGame && window.PhaserGame.game;
  if (!G) return false;
  const t = G.loop.time;
  for (let i = 0; i < ${n}; i++) G.step(t + (i + 1) * 16.67, 16.67);
  for (let i = 0; i < ${n}; i++) window.Game.update(16.67);
  return true;
})()`);

// 清掉旧的审计实体，重新摆
const setup = await ev(`(async () => {
  const G = window.Game;
  for (const k of [...G.entities.keys()]) if (k.startsWith('audit_')) G.entities.delete(k);
  // 找玩家附近一段非垂直墙段
  const WS = window.WallSystem;
  const p = G.player;
  const segs = (WS.isoSegments || []).map((s, i) => ({ i, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }))
    .filter(s => Math.abs(s.x2 - s.x1) > 80 && Math.abs(s.y2 - s.y1) > 40);
  let best = null, bestD = Infinity;
  for (const s of segs) {
    const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return { err: 'no seg' };
  const mx = (best.x1 + best.x2) / 2, my = (best.y1 + best.y2) / 2;
  const len = Math.hypot(best.x2 - best.x1, best.y2 - best.y1) || 1;
  const ux = (best.x2 - best.x1) / len, uy = (best.y2 - best.y1) / len;
  const nx = -uy, ny = ux;
  // 墙后（北侧，baseY 之上）与墙前（南侧）
  const behind = { x: mx, y: my - 110 };       // 同 x → 必在墙段 x 范围内，且 footY < baseY
  const front = { x: mx + nx * 130, y: my + ny * 130 };
  const sandbagScale = 120 / 974;
  const pieces = [
    { tex: 'obstacle_sandbag', x: behind.x, y: behind.y, scaleX: sandbagScale, scaleY: sandbagScale },
    { tex: 'obstacle_sandbag', x: front.x, y: front.y, scaleX: sandbagScale, scaleY: sandbagScale },
  ];
  for (const piece of pieces) {
    piece.flipX = false; piece.flipY = false; piece.family = 'obstacle';
    piece.depth = WS.obstacleDepthOf(piece);
    WS.isoVisuals.push(piece);
  }
  // 墙后掉落物（金币）
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/entities/drop-item.js'));
  const { DropItem } = await import(u);
  const item = { name: '金币', type: '货币', icon: '💰', category: 'gold', rarity: 'mythic', stack: 50, price: 1, stats: [] };
  const drop = new DropItem(behind.x + 60, behind.y + 20, item);
  G.entities.set('audit_drop_behind', drop);
  // 玩家移到墙前观察
  p.x = mx + nx * 240;
  p.y = my + ny * 240;
  return {
    seg: { x1: Math.round(best.x1), y1: Math.round(best.y1), x2: Math.round(best.x2), y2: Math.round(best.y2) },
    pieces: pieces.map(pc => ({ x: Math.round(pc.x), y: Math.round(pc.y), depth: pc.depth })),
    drop: { x: Math.round(drop.x), y: Math.round(drop.y) },
    player: { x: Math.round(p.x), y: Math.round(p.y) },
  };
})()`);
console.log('setup:', JSON.stringify(setup, null, 2));
await pump(20);

// 检查 X 光
const xr = await ev(`(() => {
  const S = window.__phaserScene;
  const G = window.Game;
  const drop = G.entities.get('audit_drop_behind');
  const entries = [];
  for (const [e, cur] of S._xrayMap) {
    entries.push({ cls: e.constructor.name, visible: cur.circle ? cur.circle.visible : false });
  }
  return {
    xrayMapSize: S._xrayMap.size,
    entries,
    dropSpriteDepth: drop && drop._phaserSprite ? drop._phaserSprite.depth : null,
    dropY: drop ? Math.round(drop.y) : null,
  };
})()`);
console.log('xray:', JSON.stringify(xr, null, 2));
await shot('dungeon-occlusion-behind-front.png');

// 陨星跨墙线（墙后部分应被遮，墙前部分可见）
const met = await ev(`(() => {
  const p = window.Game.player;
  const WS = window.WallSystem;
  const segs = (WS.isoSegments || []).filter(s => Math.abs(s.x2 - s.x1) > 80 && Math.abs(s.y2 - s.y1) > 40);
  let best = null, bestD = Infinity;
  for (const s of segs) {
    const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  const mx = best ? (best.x1 + best.x2) / 2 : p.x;
  const my = best ? (best.y1 + best.y2) / 2 : p.y;
  const effect = p.skills.meteor.getEffect(1);
  p.meteorSystem._magicDamageMul = 1;
  p.meteorSystem._strikes = [];
  p.meteorSystem._spawnStrike(mx, my, effect);
  return { x: Math.round(mx), y: Math.round(my) };
})()`);
console.log('meteor at:', JSON.stringify(met));
let lava = false;
for (let i = 0; i < 50; i++) {
  await pump(6);
  const ph = await ev(`(() => { const s = window.Game.player.meteorSystem._strikes[0]; return s ? s.phase : 'gone'; })()`);
  if (ph === 'lava') { await pump(8); await shot('dungeon-occlusion-meteor.png'); lava = true; break; }
  if (ph === 'gone') break;
}
console.log('lava:', lava);

console.log('DONE');
ws.close();
