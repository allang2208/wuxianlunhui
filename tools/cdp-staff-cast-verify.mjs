// 法杖施法贴手实机验证（2026-08-03）：
//   装备学徒长杖 → startPlayerCast → 逐帧采样 weaponSprite / playerHandSprite 状态 + 截图
// 环境：vite 5174 + Edge --remote-debugging-port=9224（headless）
// 用法：node tools/cdp-staff-cast-verify.mjs
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
  throw new Error('no CDP page target for ' + URL_SUB);
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
  if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 2000));
  return r.result.value;
}

async function shot(cdp, file) {
  const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(data.data, 'base64'));
  console.log('saved tools/verify-shots/' + file);
}

const BOOT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let t0 = Date.now();
  while (!window.Game) { if (Date.now() - t0 > 30000) return { err: 'no Game' }; await sleep(200); }
  if (!window.__phaserScene) {
    const btn = document.getElementById('startGameBtn');
    if (btn) btn.click(); else window.Game.start();
  }
  t0 = Date.now();
  while (!(window.Game.player && window.__phaserScene)) {
    if (Date.now() - t0 > 90000) return { err: 'no player/scene' };
    await sleep(400);
  }
  await sleep(1000);
  const s = window.__phaserScene;
  return {
    ok: true,
    textures: {
      cast: s.textures.exists('player_staff_cast'),
      castBody: s.textures.exists('player_staff_cast_body'),
      castHand: s.textures.exists('player_staff_cast_hand'),
    },
    anims: {
      cast: s.anims.exists('player_staff_cast'),
      castBody: s.anims.exists('player_staff_cast_body'),
    }
  };
})()`;

const EQUIP_STAFF = `(() => {
  const p = window.Game.player;
  const s = window.__phaserScene;
  p.equipments['weapon'] = {
    name: '学徒长杖', weaponId: 'weapon20', type: '法杖', weaponType: 'staff',
    category: 'weapon_melee', weaponCategory: 'mainhand', weaponTypeTag: '近战武器',
    animConfigKey: 'sword', castAnimKey: 'staff_cast', equipSlot: 'weapon',
    attackKey: 'melee', rarity: 'uncommon', level: 1,
    attack: { range: 110, knockback: 0, attackInterval: 500, damageType: '物理' },
  };
  p.weaponMode = 'weapon';
  s.syncWeapon(p, p.weaponAnim || {});
  return {
    wt: p.equipments[p.weaponMode].weaponType,
    castAnimKey: p.equipments[p.weaponMode].castAnimKey,
  };
})()`;

const SAMPLE = `(() => {
  const p = window.Game.player;
  const s = window.__phaserScene;
  const ws = s.weaponSprite;
  const hs = s.playerHandSprite;
  return {
    t: Math.round(performance.now() - window.__castT0),
    castState: p._castState,
    playerAnim: s.playerSprite.anims.currentAnim && s.playerSprite.anims.currentAnim.key,
    playerFrame: s.playerSprite.frame && s.playerSprite.frame.name,
    weapon: ws ? {
      x: +ws.x.toFixed(1), y: +ws.y.toFixed(1), rotDeg: +(ws.rotation * 180 / Math.PI).toFixed(1),
      visible: ws.visible,
    } : null,
    hand: hs ? {
      visible: hs.visible, tex: hs.texture.key, frame: hs.frame && hs.frame.name,
      flipX: hs.flipX,
    } : null,
    player: { x: +p.x.toFixed(1), y: +p.y.toFixed(1) },
    footOff: s._getFootOffsetY ? +s._getFootOffsetY(p, s.playerSprite).toFixed(1) : null,
  };
})()`;

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
console.log('boot:', JSON.stringify(await ev(cdp, BOOT)));
console.log('equip:', JSON.stringify(await ev(cdp, EQUIP_STAFF)));
await ev(cdp, `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);

// 触发施法（直接走 startPlayerCast，释放回调仅打标记）
await ev(cdp, `(() => {
  window.__castReleaseOK = 0;
  window.__castT0 = performance.now();
  window.__phaserScene.startPlayerCast({ onRelease(){ window.__castReleaseOK = 1; } });
  return 'cast started';
})()`);

for (let i = 0; i < 10; i++) {
  const st = await ev(cdp, SAMPLE);
  console.log(JSON.stringify(st));
  if (i === 1) await shot(cdp, 'staff-cast-mid.png');
  if (i === 3) await shot(cdp, 'staff-cast-raised.png');
  await ev(cdp, `new Promise(r => setTimeout(r, 120))`);
}
console.log('releaseOK:', await ev(cdp, 'window.__castReleaseOK'));
await shot(cdp, 'staff-cast-after.png');
cdp.close();
process.exit(0);
