// 真实连段路径端到端验证（2026-08-18）：真实 triggerWeaponAnim 三连，截 attack3 回拉/突刺帧
// 用法：node tools/cdp-combo-live-probe.mjs（前置：vite 5173 + 无头 Edge 9224）
import fs from 'node:fs';

const PORT = 9224;
const URL_SUB = 'localhost:5173';

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(URL_SUB));
      if (page) return page;
    } catch (_e) {}
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
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  p.rotation = 0;
  window.__phaserScene.syncWeapon(p, p.weaponAnim || {});
  await sleep(300);
  return 'ready';
})()`));

// 真实连段：1段(600ms)+500窗口内按 → 2段(600ms)+200窗口内按 → 3段；在 3 段回拉期截图
console.log('trigger1:', await ev(cdp, `(() => { const p = window.Game.player; p.triggerWeaponAnim('main'); return p._meleeComboStage; })()`));
await sleep(650);
console.log('trigger2:', await ev(cdp, `(() => { const p = window.Game.player; p.triggerWeaponAnim('main'); return p._meleeComboStage; })()`));
await sleep(650);
console.log('trigger3:', await ev(cdp, `(() => { const p = window.Game.player; p.triggerWeaponAnim('main'); return p._meleeComboStage; })()`));
// 3段 800ms：回拉期约 200~450ms（sheet f3~f8）
for (const [ms, tag] of [[260, 'pullback'], [430, 'coil'], [560, 'drive']]) {
  await sleep(ms === 260 ? 260 : ms - (ms === 430 ? 260 : ms === 560 ? 430 : 0));
  const st = await ev(cdp, `(() => {
    const s = window.__phaserScene, p = window.Game.player, ws = s.weaponSprite;
    return { stage: p._meleeComboStage, frame: s.playerSprite.frame && s.playerSprite.frame.name,
             anim: s.playerSprite.anims.currentAnim && s.playerSprite.anims.currentAnim.key,
             rot: +((ws.rotation*180/Math.PI)%360).toFixed(1), attacking: p.weaponAnim.isAttacking };
  })()`);
  console.log('stage3@' + tag, JSON.stringify(st));
  await shot(cdp, `combo-live-${tag}.png`);
}
await ev(cdp, `(() => { window.__phaserScene.setPlayerAnimation('idle'); return true; })()`);
cdp.close();
process.exit(0);
