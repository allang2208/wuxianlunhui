// 精确图层取证：单发技能后 dump 场景对象（类型/纹理/坐标/深度）与系统状态
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

const dumpChildren = async (cdp, label, filterY = null) => {
  const d = await ev(cdp, `(() => {
    const S = window.__phaserScene;
    if (!S) return null;
    const out = [];
    for (const obj of S.children.list) {
      if (!obj || typeof obj.depth !== 'number') continue;
      const y = obj.y || 0;
      if (${filterY ? `y < ${filterY[0]} || y > ${filterY[1]}` : 'false'}) continue;
      const key = obj.texture && obj.texture.key ? obj.texture.key : (obj.type || obj.constructor.name);
      out.push({ key, depth: Math.round(obj.depth * 100) / 100, x: Math.round(obj.x), y: Math.round(y) });
    }
    return out.sort((a, b) => a.depth - b.depth);
  })()`);
  console.log(`--- ${label} (${d ? d.length : 0} objs) ---`);
  if (d) {
    for (const o of d) console.log(`  d=${o.depth} ${o.key} @(${o.x},${o.y})`);
  }
  return d;
};

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

// 确保在 scene8
const st = await ev(cdp, `(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/world/scene-manager.js?'));
  const { SceneManager } = await import(u);
  if (SceneManager.currentScene !== 'scene8') {
    await SceneManager.switchScene('scene8', window.Game.player, 'explore');
  }
  const p = window.Game.player;
  p.x = 2048; p.y = 2450; p.data.mp = 9999;
  return SceneManager.currentScene;
})()`);
console.log('scene:', st);
await new Promise((r) => setTimeout(r, 1500));
await pumpFrames(cdp, 30);

// 基准：仅障碍物/塔/基地
await dumpChildren(cdp, 'baseline', [1600, 3100]);

// 1) 暴风雪单发，区域中心 (1800,2600)，立即看内部状态与场景对象
await ev(cdp, `(() => {
  const p = window.Game.player;
  const effect = p.skills.blizzard.getEffect(1);
  p.blizzardSystem._magicDamageMul = 1;
  p.blizzardSystem._spawnZone(1800, 2600, effect);
  return true;
})()`);
await pumpFrames(cdp, 12); // 200ms：雪球刚生成
const blzState = await ev(cdp, `(async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/entities/components/blizzard-system.js?'));
  const { BlizzardSystem } = await import(u);
  const p = window.Game.player;
  const zones = p.blizzardSystem._zones || [];
  return zones.map(z => ({
    x: Math.round(z.x), y: Math.round(z.y),
    falling: (z._falling || []).map(f => ({ x: Math.round(f.x), y: Math.round(f.y), landX: Math.round(f.landX), landY: Math.round(f.landY) })),
  }));
})()`);
console.log('blizzard zones:', JSON.stringify(blzState, null, 2));
await dumpChildren(cdp, 'blizzard t+200ms', [1500, 2900]);
await shot(cdp, 'depth-blizzard-early.png');
await pumpFrames(cdp, 40);
await dumpChildren(cdp, 'blizzard t+866ms', [1500, 2900]);
await shot(cdp, 'depth-blizzard-mid.png');

// 2) 冰墙单发
await ev(cdp, `(() => {
  const p = window.Game.player;
  const sys = p.iceWallSystem;
  sys.breakdown && sys.breakdown();
  const effect = p.skills.iceWall.getEffect(1);
  sys._magicDamageMul = 1;
  sys._spawnWall(p, 2048, 2600, effect);
  return true;
})()`);
await pumpFrames(cdp, 6);
const iwState = await ev(cdp, `(() => {
  const sys = window.Game.player.iceWallSystem;
  return (sys._walls || []).map(w => ({ x: Math.round(w.x), y: Math.round(w.y), segs: w.segs || null }));
})()`);
console.log('icewall walls:', JSON.stringify(iwState, null, 2));
await dumpChildren(cdp, 'icewall t+100ms', [1500, 2900]);
await shot(cdp, 'depth-icewall-early.png');

// 3) 陨星单发，逐阶段 dump
await ev(cdp, `(() => {
  const p = window.Game.player;
  p.meteorSystem._strikes = [];
  const effect = p.skills.meteor.getEffect(1);
  p.meteorSystem._magicDamageMul = 1;
  p.meteorSystem._spawnStrike(2048, 2550, effect);
  return true;
})()`);
for (let i = 0; i < 24; i++) {
  await pumpFrames(cdp, 6);
  const ph = await ev(cdp, `(() => { const s = window.Game.player.meteorSystem._strikes[0]; return s ? s.phase : 'gone'; })()`);
  console.log('meteor phase:', ph, 't≈' + ((i + 1) * 100) + 'ms');
  if (ph === 'lava') {
    await dumpChildren(cdp, 'meteor lava', [2000, 2900]);
    await shot(cdp, 'depth-meteor-lava.png');
    break;
  }
}

// 4) 塔防开火：等 7s 刷怪，dump 弹丸
await pumpFrames(cdp, 420);
const mobs = await ev(cdp, `(() => { let n = 0; for (const e of window.Game.entities.values()) if (e && e._defenseMonster) n++; return n; })()`);
console.log('monsters:', mobs);
await pumpFrames(cdp, 120);
await dumpChildren(cdp, 'towers firing', [1700, 3100]);
await shot(cdp, 'depth-towers-firing.png');

cdp.close();
