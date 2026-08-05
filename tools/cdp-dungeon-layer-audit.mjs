// 地牢模式墙面遮挡取证（走 depart 等价初始化）：进战斗房 → 玩家/怪物贴墙 →
// 手动沙袋跨墙线 → 技能特效贴墙 → GLM-4.6V 辅助分析
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5173';
const SHOT_DIR = 'tools/verify-shots/layer-audit';

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
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(`${SHOT_DIR}/${file}`, Buffer.from(d.data, 'base64'));
}

const pumpFrames = async (cdp, frames) => {
  await ev(cdp, `(() => {
    const G = window.PhaserGame && window.PhaserGame.game;
    if (!G) return false;
    const t = G.loop.time;
    for (let i = 0; i < ${frames}; i++) G.step(t + (i + 1) * 16.67, 16.67);
    for (let i = 0; i < ${frames}; i++) window.Game.update(16.67);
    return true;
  })()`);
};

const realUrl = async (cdp, pat) => {
  const u = await ev(cdp, `(() => {
    const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes(${JSON.stringify(pat)}));
    return u || null;
  })()`);
  return u;
};

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

// 干净重载 + 启动
await cdp.send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2000));
await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player && window.__phaserScene) return;
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') b.click();
    await new Promise(r => setTimeout(r, 500));
  }
})()`);
await new Promise((r) => setTimeout(r, 1500));

// depart 等价初始化（绕过祭品门槛）
const initRes = await ev(cdp, `(async () => {
const smUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js'));
const dmUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/dungeon-map-system.js'));
  const { SceneManager } = await import(smUrl);
  const { DungeonMapSystem } = await import(dmUrl);
  const player = window.Game.player;
  player.data.mp = 9999;
  // 清理主神空间实体，只留玩家
  const ps = window.__phaserScene;
  if (ps && ps.clearCombatView) ps.clearCombatView();
  if (ps && ps.clearAllEntitySprites) ps.clearAllEntitySprites();
  window.Game.entities.clear();
  window.Game.entities.set('player', player);
const cfgUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/config/config.js'));
const { CONFIG } = await import(cfgUrl);
  CONFIG.WORLD_WIDTH = 2048;
  CONFIG.WORLD_HEIGHT = 2048;
  player.x = 1024; player.y = 1024;
  DungeonMapSystem.init('scene7', player, 'zombie');
  SceneManager.currentScene = 'scene7';
  return { state: DungeonMapSystem.state, active: DungeonMapSystem.active, dungeonType: DungeonMapSystem.dungeonType, scene: SceneManager.currentScene };
})()`);
console.log('dungeon init:', JSON.stringify(initRes));
await new Promise((r) => setTimeout(r, 800));
await pumpFrames(cdp, 30);
await shot(cdp, 'dungeon-map-view.png');

// 进入普通战斗房（僵尸地牢 D 级 → 三房竞技场）
const dmUrl = await realUrl(cdp, '/src/world/dungeon-map-system.js?');
const enter = await ev(cdp, `(async () => {
  const { DungeonMapSystem } = await import(${JSON.stringify(dmUrl)});
  try {
    DungeonMapSystem._enterCombat({ id: 'audit-combat', type: 'combat', isElite: false });
    return { ok: true, state: DungeonMapSystem.state };
  } catch (e) {
    return { ok: false, err: String(e && e.message || e), state: DungeonMapSystem.state };
  }
})()`);
console.log('enter combat:', JSON.stringify(enter));
await new Promise((r) => setTimeout(r, 3000)); // 等预制加载/竞技场建成
await pumpFrames(cdp, 60);

const roomInfo = await ev(cdp, `(() => {
  const S = window.__phaserScene;
  const p = window.Game.player;
  return {
    player: { x: Math.round(p.x), y: Math.round(p.y) },
    walls: window.WallSystem ? window.WallSystem.isoVisuals.length : -1,
    segs: window.WallSystem ? window.WallSystem.isoSegments.length : -1,
    visualWalls: S.visualWalls ? S.visualWalls.children.size : -1,
  };
})()`);
console.log('room:', JSON.stringify(roomInfo));
await shot(cdp, 'dungeon-arena-overview.png');

// 玩家贴南墙（前墙外侧视角 = 玩家在房内靠下墙）
await ev(cdp, `(() => { const p = window.Game.player; p.x = 2048; p.y = 2650; return true; })()`);
await pumpFrames(cdp, 20);
await shot(cdp, 'dungeon-player-near-south-wall.png');

// 玩家贴北墙（后墙内侧视角）
await ev(cdp, `(() => { const p = window.Game.player; p.x = 2048; p.y = 1400; return true; })()`);
await pumpFrames(cdp, 20);
await shot(cdp, 'dungeon-player-near-north-wall.png');

// 手动摆沙袋跨墙线（墙内/墙外各一）
const placed = await ev(cdp, `(() => {
  const WS = window.WallSystem;
  const sandbagScale = 120 / 974;
  const p = window.Game.player;
  const pieces = [
    { tex: 'obstacle_sandbag', x: 2048, y: 2650, scaleX: sandbagScale, scaleY: sandbagScale },
    { tex: 'obstacle_sandbag', x: 2228, y: 2650, scaleX: sandbagScale, scaleY: sandbagScale },
  ];
  for (const piece of pieces) {
    piece.flipX = false; piece.flipY = false; piece.family = 'obstacle';
    piece.depth = WS.obstacleDepthOf(piece);
    WS.isoVisuals.push(piece);
  }
  WS.rebuildIsoCollision && WS.rebuildIsoCollision();
  WS._syncWallsToPhaser && WS._syncWallsToPhaser();
  return pieces.map(pc => ({ x: pc.x, y: pc.y, depth: pc.depth }));
})()`);
console.log('placed sandbags:', JSON.stringify(placed));
await pumpFrames(cdp, 10);
await shot(cdp, 'dungeon-sandbag-near-wall.png');

// 陨星落在墙线附近
await ev(cdp, `(() => {
  const p = window.Game.player;
  const effect = p.skills.meteor.getEffect(1);
  p.meteorSystem._magicDamageMul = 1;
  p.meteorSystem._strikes = [];
  p.meteorSystem._spawnStrike(2048, 2750, effect);
  return true;
})()`);
let lava = false;
for (let i = 0; i < 50; i++) {
  await pumpFrames(cdp, 6);
  const ph = await ev(cdp, `(() => { const s = window.Game.player.meteorSystem._strikes[0]; return s ? s.phase : 'gone'; })()`);
  if (ph === 'lava') { await pumpFrames(cdp, 8); await shot(cdp, 'dungeon-meteor-near-wall.png'); lava = true; break; }
  if (ph === 'gone') break;
}
console.log('dungeon meteor lava:', lava);

// 等刷怪后看怪物贴墙
await new Promise((r) => setTimeout(r, 2500));
await pumpFrames(cdp, 30);
const mobs = await ev(cdp, `(() => {
  const arr = [];
  for (const e of window.Game.entities.values()) {
    if (e && e._faction === 'enemy' && e.active && e._phaserSprite) arr.push({ x: Math.round(e.x), y: Math.round(e.y), key: e._phaserSprite.texture.key, depth: Math.round(e._phaserSprite.depth) });
  }
  return arr.slice(0, 8);
})()`);
console.log('mobs:', JSON.stringify(mobs, null, 2));
await shot(cdp, 'dungeon-mobs-in-room.png');

cdp.close();
console.log('DONE');
