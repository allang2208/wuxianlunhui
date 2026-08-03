// 灼锋焰甲武器火焰附着检查：进游戏（离屏窗口 rAF 冻结，手动 G.step 泵帧）→ 装备剑 →
// 激活 Buff → 左右朝向各截一张 + 输出武器精灵几何
// 用法：node tools/cdp-flame-armor-check.mjs
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
  console.log('saved', file);
}

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);

// 整页重载：确保加载最新代码（旧 HMR 模块/旧特效实例会滞留）
await cdp.send('Page.enable');
await cdp.send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));

// 泵帧（stub 渲染加速；截屏前 unpatch 恢复真实渲染）
const pumpFrames = async (frames) => {
  await ev(cdp, `(() => {
    const G = window.PhaserGame.game;
    if (!G.__renderPatched) {
      G.__renderPatched = true;
      G.__origRender = G.renderer.render;
      G.renderer.render = function () {};
      window.__unpatchRender = () => { G.renderer.render = G.__origRender; };
    }
    const t = G.loop.time;
    for (let i = 0; i < ${frames}; i++) G.step(t + (i + 1) * 16.67, 16.67);
    return true;
  })()`);
};

const boot = await ev(cdp, `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) {
    if (Date.now()-t0>30000) return 'no game'; await sleep(200);
  }
  if (!window.__phaserScene) {
    const b = document.getElementById('startGameBtn');
    if (b) b.click(); else window.Game.start();
  }
  return { clicked: true, hasBtn: !!document.getElementById('startGameBtn') };
})()`);
console.log('boot:', boot);

// 泵帧直到场景/玩家就绪（离屏 rAF 冻结，必须手动推进）
let ready = null;
for (let i = 0; i < 40 && !ready; i++) {
  const hasGame = await ev(cdp, `!!(window.PhaserGame && window.PhaserGame.game)`);
  if (hasGame) await pumpFrames(40);
  await new Promise((r) => setTimeout(r, 40));
  ready = await ev(cdp, `(() => {
    const ok = !!(window.__phaserScene && window.Game && window.Game.player && window.PhaserGame && window.PhaserGame.game);
    return ok ? 'ready' : null;
  })()`);
}
console.log('scene:', ready);

const equipSword = await ev(cdp, `(() => {
  const p = window.Game.player, s = window.__phaserScene;
  p.equipments['weapon'] = { name:'生锈的剑', weaponId:'weapon1', type:'剑', weaponType:'sword', category:'weapon_melee', weaponCategory:'mainhand', weaponTypeTag:'近战武器', animConfigKey:'sword', equipSlot:'weapon', attackKey:'melee', rarity:'common', level:1, attack:{ range:110, knockback:20, attackInterval:400, damageType:'物理' } };
  p.weaponMode = 'weapon';
  p.data.mp = 999;
  s.syncWeapon(p, p.weaponAnim || {});
  return { weapon: !!s.weaponSprite };
})()`);
console.log('equip:', JSON.stringify(equipSword));

// 泵几秒让粒子累积（渲染 stub，逻辑帧推进；截屏前恢复真实渲染再泵 2 帧画出来）
await pumpFrames(200);

async function face(cdp, flipX) {
  return ev(cdp, `(() => {
    const p = window.Game.player, s = window.__phaserScene;
    p.rotation = ${flipX ? 'Math.PI' : '0'};
    s.playerSprite.setFlipX(${flipX});
    return true;
  })()`);
}

async function dumpGeom(label) {
  const g = await ev(cdp, `(() => {
    const p = window.Game.player, s = window.__phaserScene;
    const w = s.weaponSprite;
    return {
      player: { x: Math.round(p.x), y: Math.round(p.y), rotation: +p.rotation.toFixed(2), flipX: s.playerSprite.flipX },
      weapon: w ? { x: Math.round(w.x), y: Math.round(w.y), rotation: +w.rotation.toFixed(2), flipX: w.flipX, dw: Math.round(w.displayWidth), dh: Math.round(w.displayHeight), visible: w.visible, active: w.active } : null,
    };
  })()`);
  console.log(label, JSON.stringify(g));
}

async function shotWithRender(cdp, file) {
  await ev(cdp, `(() => { if (window.__unpatchRender) window.__unpatchRender(); return true; })()`);
  await pumpFrames(2);
  await shot(cdp, file);
  await ev(cdp, `(() => {
    const G = window.PhaserGame.game;
    G.renderer.render = function () {};
    return true;
  })()`);
}

// 基线（无 Buff）：左右各一张，供差分扣除背景火焰
await face(cdp, false);
await pumpFrames(60);
await shotWithRender(cdp, 'fa-base-right.png');
await face(cdp, true);
await pumpFrames(60);
await shotWithRender(cdp, 'fa-base-left.png');

// 激活灼锋焰甲（直接上状态 + 确保武器火焰特效实例，绕开 MP/施法流程）
const setup = await ev(cdp, `(() => {
  const p = window.Game.player;
  p.addStatusEffect('flameArmor', 60000, { name:'灼锋焰甲', icon:'🔥', color:'#ff7a3a' });
  if (p.flameArmorSystem && typeof p.flameArmorSystem._ensureWeaponFx === 'function') {
    p.flameArmorSystem._ensureWeaponFx();
  }
  return { has: p.hasStatusEffect('flameArmor'), fx: !!(p.flameArmorSystem && p.flameArmorSystem._weaponFx) };
})()`);
console.log('setup:', JSON.stringify(setup));

await pumpFrames(200);

// 朝右
await face(cdp, false);
await pumpFrames(60);
await dumpGeom('right');
await shotWithRender(cdp, 'fa-armor-right.png');

// 朝左
await face(cdp, true);
await pumpFrames(60);
await dumpGeom('left');
await shotWithRender(cdp, 'fa-armor-left.png');

cdp.close();
process.exit(0);
