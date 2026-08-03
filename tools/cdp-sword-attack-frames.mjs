// 一段攻击逐帧抓取：触发攻击，按播放帧号截图（带武器 / 不带武器各一轮）
// 用法：node tools/cdp-sword-attack-frames.mjs
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

// 单轮攻击：按帧截图。withWeapon=true 带武器；false 隐藏武器
const run = async (label, withWeapon) => {
  const seen = new Set();
  await ev(cdp, `(() => {
    const p = window.Game.player, s = window.__phaserScene;
    if (!${withWeapon}) s.weaponSprite.setVisible(false);
    const ok = p.attacks && p.attacks.melee ? p.attacks.melee.execute(p, p.x + 120, p.y, []) : false;
    if (ok) p.triggerWeaponAnim();
    return ok;
  })()`);
  const t0 = Date.now();
  let lastKey = '';
  while (Date.now() - t0 < 2600) {
    const st = await ev(cdp, `(() => {
      const p = window.Game.player, s = window.__phaserScene;
      const a = s.playerSprite.anims.currentAnim;
      const idx = s.playerSprite.frame && typeof s.playerSprite.frame.name === 'number' ? s.playerSprite.frame.name : -1;
      const key = a ? a.key : '';
      return { idx, key, atk: !!(p.weaponAnim && p.weaponAnim.isAttacking) };
    })()`);
    if (st.key === 'player_attack_sword' && !seen.has(st.idx) && st.idx >= 0) {
      seen.add(st.idx);
      await shot(cdp, `${label}-f${st.idx}.png`);
    }
    if (st.key !== 'player_attack_sword' && lastKey === 'player_attack_sword' && st.idx === -1) break;
    lastKey = st.key;
    await new Promise((r) => setTimeout(r, 24));
  }
  await ev(cdp, `(() => { window.__phaserScene.weaponSprite.setVisible(true); return true; })()`);
  console.log(label, 'frames captured:', [...seen].sort().join(','));
  await new Promise((r) => setTimeout(r, 900));
};

await run('atk1-frames-with', true);
await run('atk1-frames-no', false);

cdp.close();
process.exit(0);
