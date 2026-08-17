// 一段末帧 剑-手契合像素取证（2026-08-16）：冻结 attack_sword f11，带/不带武器各截一张。
// 用法：node tools/cdp-fist-fit-probe.mjs   （前置：vite 5173 + 无头 Edge 9224）
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
  return 'ready';
})()`));

// 冻结在一段末帧（f11 / progress=1 定格保持态）
console.log('freeze:', await ev(cdp, `(() => {
  const s = window.__phaserScene, p = window.Game.player;
  s.tweens.timeScale = 1;
  const all = s.tweens.getAllTweens ? s.tweens.getAllTweens() : [];
  for (const t of all) { if (t && t.remove) t.remove(); }
  p._activeAttackTweens = [];
  p._attackHoldUntil = 0;
  p._attackRecovering = false;
  p._lastMeleeAttackEnd = 0;
  p._meleeComboStage = 1;
  p.rotation = 0;
  s.setPlayerAnimation('attack_sword', 40000);
  s.playerSprite.anims.timeScale = 0;
  s.playerSprite.setFrame(11);
  s.playerSprite.flipX = false;
  p._activeAttackTweens = [s.tweens.add({ targets: { v: 0 }, v: 1, duration: 60000, ease: 'Linear' })];
  p.weaponAnim.isAttacking = false;
  p.weaponAnim.state = 'idle';
  p.weaponAnim.timer = 0;
  // 定格保持窗口（武器定格在末帧，等同真实攻击播完后的 hold 状态）
  p._attackHoldUntil = performance.now() + 60000;
  s.weaponSprite.setVisible(true);
  return true;
})()`));

await new Promise((r) => setTimeout(r, 400));
const meta = await ev(cdp, `(() => {
  const s = window.__phaserScene, p = window.Game.player;
  const ws = s.weaponSprite, cam = s.cameras.main;
  return {
    weapon: { x:+ws.x.toFixed(2), y:+ws.y.toFixed(2), rot:+((ws.rotation*180/Math.PI)%360).toFixed(2),
              ox:+(ws.originX||0.5).toFixed(3), oy:+(ws.originY||0.5).toFixed(3),
              dw:+(ws.displayWidth||0).toFixed(2), dh:+(ws.displayHeight||0).toFixed(2) },
    player: { x:+p.x.toFixed(2), y:+p.y.toFixed(2) },
    sprite: { x:+s.playerSprite.x.toFixed(2), y:+s.playerSprite.y.toFixed(2),
              w:+s.playerSprite.displayWidth.toFixed(2), h:+s.playerSprite.displayHeight.toFixed(2) },
    cam: { scrollX:+cam.scrollX.toFixed(2), scrollY:+cam.scrollY.toFixed(2), zoom:+cam.zoom.toFixed(3) },
  };
})()`);
console.log('meta:', JSON.stringify(meta));
await shot(cdp, 'fit-f11-with.png');
await ev(cdp, `(() => { window.__phaserScene.weaponSprite.setVisible(false); return true; })()`);
await new Promise((r) => setTimeout(r, 200));
await shot(cdp, 'fit-f11-no.png');
await ev(cdp, `(() => { window.__phaserScene.weaponSprite.setVisible(true); window.__phaserScene.setPlayerAnimation('idle'); return true; })()`);

cdp.close();
process.exit(0);
