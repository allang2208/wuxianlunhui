// 法杖施法最终帧截图 + 武器/手屏幕坐标（供视觉模型裁剪判断贴手方向）
// 环境：vite 5174 + Edge 9224；用法：node tools/cdp-staff-cast-shot.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
  return r.result.value;
}

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);

// 等游戏就绪 + 装备法杖
await ev(cdp, `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now() - t0 > 30000) return; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now() - t0 > 60000) return; await sleep(400); }
  await sleep(800);
  const p = window.Game.player;
  p.equipments['weapon'] = {
    name: '学徒长杖', weaponId: 'weapon20', type: '法杖', weaponType: 'staff',
    category: 'weapon_melee', weaponCategory: 'mainhand', weaponTypeTag: '近战武器',
    animConfigKey: 'sword', castAnimKey: 'staff_cast', equipSlot: 'weapon',
    attackKey: 'melee', rarity: 'uncommon', level: 1,
    attack: { range: 110, knockback: 0, attackInterval: 500, damageType: '物理' },
  };
  p.weaponMode = 'weapon';
  window.__phaserScene.syncWeapon(p, p.weaponAnim || {});
  return 'ready';
})()`);

await ev(cdp, `(() => { window.__castT0 = performance.now(); window.__phaserScene.startPlayerCast({ onRelease(){} }); return 1; })()`);
await ev(cdp, `new Promise(r => setTimeout(r, 430))`); // 举杖最高帧（releaseFrame 前）

const info = await ev(cdp, `(() => {
  const s = window.__phaserScene, p = window.Game.player;
  const cam = s.cameras.main;
  const w = s.weaponSprite, h = s.playerHandSprite;
  return {
    castState: p._castState,
    frame: s.playerSprite.frame && s.playerSprite.frame.name,
    cam: { scrollX: +cam.scrollX.toFixed(1), scrollY: +cam.scrollY.toFixed(1), zoom: cam.zoom },
    weapon: { x: +w.x.toFixed(1), y: +w.y.toFixed(1), rot: +(w.rotation * 180 / Math.PI).toFixed(1) },
    hand: { visible: h.visible, x: +h.x.toFixed(1), y: +h.y.toFixed(1) },
    player: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), size: s.playerSprite.displayHeight },
    canvas: { w: s.scale.gameSize.width, h: s.scale.gameSize.height },
    w: 0,
  };
})()`);

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync('tools/verify-shots', { recursive: true });
fs.writeFileSync('tools/verify-shots/staff-cast-final.png', Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify(info));
cdp.close();
process.exit(0);
