// 近战普通攻击一段跟手 + 方向性模糊实机验证（2026-08-03）
// 用法：node tools/cdp-sword-attack-check.mjs
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
  await sleep(1200);
  const p = window.Game.player;
  p.equipments['weapon'] = { name:'生锈的剑', weaponId:'weapon1', type:'剑', weaponType:'sword', category:'weapon_melee', weaponCategory:'mainhand', weaponTypeTag:'近战武器', animConfigKey:'sword', equipSlot:'weapon', attackKey:'melee', rarity:'common', level:1, attack:{ range:110, knockback:20, attackInterval:400, damageType:'物理' } };
  p.weaponMode = 'weapon';
  window.__phaserScene.syncWeapon(p, p.weaponAnim || {});
  await sleep(300);
  return 'ready';
})()`));

const sample = async (label) => {
  const st = await ev(cdp, `(() => {
    const p = window.Game.player, s = window.__phaserScene;
    const f = s._weaponBlurFilter;
    return {
      state: p.weaponAnim && p.weaponAnim.state,
      attacking: !!(p.weaponAnim && p.weaponAnim.isAttacking),
      combo: p._meleeComboStage,
      weapon: { x:+s.weaponSprite.x.toFixed(1), y:+s.weaponSprite.y.toFixed(1), rotDeg:+(s.weaponSprite.rotation*180/Math.PI).toFixed(1) },
      blur: f ? { x:+f.x.toFixed(2), y:+f.y.toFixed(2), strength:+f.strength.toFixed(1) } : null,
      anim: s.playerSprite.anims.currentAnim && s.playerSprite.anims.currentAnim.key,
    };
  })()`);
  console.log(label + ':', JSON.stringify(st));
  return st;
};

// 触发一段攻击（朝玩家前方）
await ev(cdp, `(() => {
  const p = window.Game.player;
  const ok = p.attacks && p.attacks.melee ? p.attacks.melee.execute(p, p.x + 120, p.y, []) : false;
  if (ok) p.triggerWeaponAnim();
  return ok;
})()`);

for (let i = 0; i < 12; i++) {
  const st = await sample(`t${i * 90}ms`);
  if (i === 2) await shot(cdp, 'sword-attack-windup.png');
  if (i === 5) await shot(cdp, 'sword-attack-swing.png');
  if (i === 8) await shot(cdp, 'sword-attack-follow.png');
  await ev(cdp, `new Promise(r => setTimeout(r, 90))`);
}

cdp.close();
process.exit(0);
