// 法杖统一到前伸手后：行走/待机/施法边界验证（2026-08-03）
// 用法：node tools/cdp-staff-walk-check.mjs
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

console.log('boot:', await ev(cdp, `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now()-t0>30000) return 'no game'; await sleep(200); }
  if (!window.__phaserScene) { const b = document.getElementById('startGameBtn'); if (b) b.click(); else window.Game.start(); }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) { if (Date.now()-t0>60000) return 'no scene'; await sleep(400); }
  await sleep(800);
  const p = window.Game.player;
  p.equipments['weapon'] = { name:'学徒长杖', weaponId:'weapon20', type:'法杖', weaponType:'staff', category:'weapon_melee', weaponCategory:'mainhand', weaponTypeTag:'近战武器', animConfigKey:'sword', castAnimKey:'staff_cast', equipSlot:'weapon', attackKey:'melee', rarity:'uncommon', level:1, attack:{ range:110, knockback:0, attackInterval:500, damageType:'物理' } };
  p.weaponMode = 'weapon';
  window.__phaserScene.syncWeapon(p, p.weaponAnim || {});
  return 'ready';
})()`));

const state = () => ev(cdp, `(() => {
  const p = window.Game.player, s = window.__phaserScene;
  return {
    anim: s.playerSprite.anims.currentAnim && s.playerSprite.anims.currentAnim.key,
    weapon: { x:+s.weaponSprite.x.toFixed(1), y:+s.weaponSprite.y.toFixed(1), rotDeg:+(s.weaponSprite.rotation*180/Math.PI).toFixed(1) },
    handVisible: !!(s.playerHandSprite && s.playerHandSprite.visible),
    player: { x:+p.x.toFixed(1), y:+p.y.toFixed(1) },
    footOff: +s._getFootOffsetY(p, s.playerSprite).toFixed(1),
  };
})()`);

// 行走
await ev(cdp, `(() => { const p = window.Game.player, s = window.__phaserScene; p.isMoving = true; p._isSprinting = false; s.setPlayerAnimation('walk'); s.syncWeapon(p, p.weaponAnim||{}); return 1; })()`);
await ev(cdp, `new Promise(r => setTimeout(r, 600))`);
console.log('walk:', JSON.stringify(await state()));
await shot(cdp, 'staff-walk.png');

// 待机
await ev(cdp, `(() => { const p = window.Game.player, s = window.__phaserScene; p.isMoving = false; s.setPlayerAnimation('idle'); s.syncWeapon(p, p.weaponAnim||{}); return 1; })()`);
await ev(cdp, `new Promise(r => setTimeout(r, 250))`);
console.log('idle:', JSON.stringify(await state()));
await shot(cdp, 'staff-idle.png');

// 施法 f0
await ev(cdp, `(() => { window.__phaserScene.startPlayerCast({ onRelease(){} }); return 1; })()`);
await ev(cdp, `new Promise(r => setTimeout(r, 60))`);
console.log('cast-f0:', JSON.stringify(await state()));

// 施法 f8
await ev(cdp, `new Promise(r => setTimeout(r, 400))`);
console.log('cast-f8:', JSON.stringify(await state()));
await shot(cdp, 'staff-cast-f8.png');

cdp.close();
process.exit(0);
