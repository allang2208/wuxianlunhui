// 陨星熔岩特效性能实测：进游戏 → 装备法杖 → 施放陨星 → 在熔岩阶段采样 G.step 逻辑帧耗时
// 对比施法前基线。用法：node tools/cdp-meteor-perf.mjs
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

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);

await cdp.send('Page.enable');
await cdp.send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));

const boot = await ev(cdp, `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  const b = document.getElementById('startGameBtn');
  if (b) b.click(); else window.Game.start();
  return 'clicked';
})()`);
console.log('boot:', boot);

const pumpFrames = async (frames) => {
  await ev(cdp, `(() => {
    const G = window.PhaserGame.game;
    if (!G.__renderPatched) {
      G.__renderPatched = true;
      G.__origRender = G.renderer.render;
      G.renderer.render = function () {};
    }
    const t = G.loop.time;
    for (let i = 0; i < ${frames}; i++) G.step(t + (i + 1) * 16.67, 16.67);
    return true;
  })()`);
};

// 旧逻辑循环（Game.update 驱动 player 子系统/EffectManager/meteorSystem；G.step 只推 Phaser 场景）
const pumpLogic = async (frames) => {
  await ev(cdp, `(() => {
    for (let i = 0; i < ${frames}; i++) window.Game.update(16.67);
    return true;
  })()`);
};

let ready = null;
for (let i = 0; i < 90 && !ready; i++) {
  await ev(cdp, `(() => {
    if (!window.__phaserScene && document.getElementById('startGameBtn')) {
      document.getElementById('startGameBtn').click();
    }
    return true;
  })()`);
  const hasGame = await ev(cdp, `!!(window.PhaserGame && window.PhaserGame.game)`);
  if (hasGame) await pumpFrames(40);
  await new Promise((r) => setTimeout(r, 40));
  ready = await ev(cdp, `!!(window.__phaserScene && window.Game && window.Game.player && window.PhaserGame && window.PhaserGame.game) ? 'ready' : null`);
}
console.log('scene:', ready);

const setup = await ev(cdp, `(() => {
  const p = window.Game.player, s = window.__phaserScene;
  p.equipments['weapon'] = { name:'学徒法杖', weaponId:'staff1', type:'法杖', weaponType:'staff', category:'weapon_magic', weaponCategory:'mainhand', weaponTypeTag:'法杖', animConfigKey:'staff', equipSlot:'weapon', attackKey:'melee', rarity:'common', level:1, attack:{ range:110, knockback:20, attackInterval:600 } };
  p.weaponMode = 'weapon';
  p.data.mp = 9999;
  s.syncWeapon(p, p.weaponAnim || {});
  return { hasSkill: !!p.skills.meteor, staffOk: p.equipments.weapon.weaponType === 'staff' };
})()`);
console.log('setup:', JSON.stringify(setup));

// 基线：施法前 90 帧逻辑耗时
const baseline = await ev(cdp, `(() => {
  const G = window.PhaserGame.game;
  const t = G.loop.time;
  const stepTimes = [];
  for (let i = 0; i < 90; i++) {
    const t0 = performance.now();
    G.step(t + (i + 1) * 16.67, 16.67);
    stepTimes.push(performance.now() - t0);
  }
  const logicTimes = [];
  for (let i = 0; i < 90; i++) {
    const t0 = performance.now();
    window.Game.update(16.67);
    logicTimes.push(performance.now() - t0);
  }
  const stat = (arr) => {
    const s = arr.slice().sort((a, b) => a - b);
    return {
      avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
      p50: +s[45].toFixed(3),
      p95: +s[85].toFixed(3),
      max: +s[89].toFixed(3),
    };
  };
  return {
    sceneStep: stat(stepTimes),
    logicStep: stat(logicTimes),
  };
})()`);
console.log('baseline step ms:', JSON.stringify(baseline));

const cast = await ev(cdp, `(() => {
  const p = window.Game.player;
  const effect = p.skills.meteor.getEffect(1);
  p.meteorSystem._magicDamageMul = 1;
  p.meteorSystem._spawnStrike(p.x + 150, p.y, effect);
  return p.meteorSystem._strikes.length;
})()`);
console.log('cast:', cast);

// 用逻辑循环推进穿过施法/坠落/爆炸，直到进入 lava 阶段（熔岩只持续 3s，进阶段后立刻采样）
let lava = false;
for (let i = 0; i < 40 && !lava; i++) {
  await pumpLogic(10);
  lava = await ev(cdp, `(() => {
    const p = window.Game.player;
    const st = p.meteorSystem._strikes[0];
    return !!(st && st.phase === 'lava');
  })()`);
}
console.log('lava reached:', lava);

const lavaTime = await ev(cdp, `(() => {
  const p = window.Game.player;
  const st = p.meteorSystem._strikes[0];
  const emitters = st && st._lavaEmitters ? st._lavaEmitters.filter(e => e && e.active).length : 0;
  const G = window.PhaserGame.game;
  const t = G.loop.time;
  const stepTimes = [];
  for (let i = 0; i < 90; i++) {
    const t0 = performance.now();
    G.step(t + (i + 1) * 16.67, 16.67);
    stepTimes.push(performance.now() - t0);
  }
  const logicTimes = [];
  for (let i = 0; i < 90; i++) {
    const t0 = performance.now();
    window.Game.update(16.67);
    logicTimes.push(performance.now() - t0);
  }
  const stat = (arr) => {
    const s = arr.slice().sort((a, b) => a - b);
    return {
      avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
      p50: +s[45].toFixed(3),
      p95: +s[85].toFixed(3),
      max: +s[89].toFixed(3),
    };
  };
  return {
    emitters,
    sceneStep: stat(stepTimes),
    logicStep: stat(logicTimes),
  };
})()`);
console.log('lava step ms:', JSON.stringify(lavaTime));

cdp.close();
process.exit(0);
