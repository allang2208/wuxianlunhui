// 一段攻击逐帧定格：触发攻击后逐帧 setFrame + 反推 weapon progress，带/不带武器各截图一轮
// 用法：node tools/cdp-sword-hold-frames.mjs
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
  window.__phaserScene.syncWeapon(p, p.weaponAnim || {});
  await sleep(300);
  return 'ready';
})()`));

// 单轮：慢放后按帧截图。withWeapon=false 隐藏武器
const run = async (label, withWeapon) => {
  const meta = [];
  await ev(cdp, `(() => {
    const s = window.__phaserScene, p = window.Game.player;
    // 彻底清场：杀掉历史 tween，复位武器动画状态机
    s.tweens.timeScale = 1;
    s.playerSprite.anims.timeScale = 1;
    const all = s.tweens.getAllTweens ? s.tweens.getAllTweens() : [];
    for (const t of all) { if (t && t.remove) t.remove(); }
    p._activeAttackTweens = [];
    p.weaponAnim.isAttacking = false;
    p.weaponAnim.state = 'idle';
    p.weaponAnim.timer = 0;
    p._attackHoldUntil = 0;
    p._attackRecovering = false;
    p._lastMeleeAttackEnd = 0;
    p.rotation = 0;
    // 手动进入一段攻击渲染态：不触发真实攻击（无 tween onComplete 干扰）
    // 动画必须保持 isPlaying=true（GameScene._updatePlayerAnimation 的卡死守卫会据此判断），
    // 用 timeScale=0 冻结帧 + setFrame 精确定格
    s.playerSprite.setTexture('player_attack_sword');
    s.playerSprite.play('player_attack_sword', true);
    s.playerSprite.anims.timeScale = 0;
    s.playerSprite.setFrame(0);
    s.playerSprite.flipX = false;
    p._activeAttackTweens = [s.tweens.add({ targets: { v: 0 }, v: 1, duration: 60000, ease: 'Linear' })];
    p.weaponAnim.isAttacking = true;
    p.weaponAnim.state = 'attacking';
    p._attackHoldUntil = performance.now() + 60000;
    s._playerAttackDuration = 40000;
    s._playerAttackStartTime = performance.now();
    s.weaponSprite.setVisible(${withWeapon});
    return true;
  })()`);
  for (let i = 0; i < 8; i++) {
    await ev(cdp, `(() => {
      const s = window.__phaserScene, p = window.Game.player;
      if (!s.playerSprite.anims.isPlaying) s.playerSprite.play('player_attack_sword', true);
      s.playerSprite.anims.timeScale = 0;
      s.playerSprite.setFrame(${i});
      s.playerSprite.flipX = false;
      s._playerAttackDuration = 40000;
      s._playerAttackStartTime = performance.now() - ${i} / 7 * 40000;
      if (!p._activeAttackTweens || !p._activeAttackTweens.length) {
        p._activeAttackTweens = [s.tweens.add({ targets: { v: 0 }, v: 1, duration: 60000, ease: 'Linear' })];
      }
      p.weaponAnim.isAttacking = true;
      p.weaponAnim.state = 'attacking';
      p.weaponAnim.timer = 0;
      p._attackHoldUntil = performance.now() + 60000;
      p._attackRecovering = false;
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 120));
    const st = await ev(cdp, `(() => {
      const s = window.__phaserScene, p = window.Game.player;
      const cam = s.cameras.main;
      const ws = s.weaponSprite;
      const now = performance.now();
      return {
        frame: s.playerSprite.frame.name,
        weapon: { x:+ws.x.toFixed(2), y:+ws.y.toFixed(2), rot:+((ws.rotation*180/Math.PI)%360).toFixed(2) },
        player: { x:+p.x.toFixed(2), y:+p.y.toFixed(2) },
        sprite: { x:+s.playerSprite.x.toFixed(2), y:+s.playerSprite.y.toFixed(2), w:+s.playerSprite.displayWidth.toFixed(2), h:+s.playerSprite.displayHeight.toFixed(2), flipX:s.playerSprite.flipX },
        cam: { scrollX:+cam.scrollX.toFixed(2), scrollY:+cam.scrollY.toFixed(2), zoom:+cam.zoom.toFixed(3), w:cam.width, h:cam.height },
        attacking: !!(p.weaponAnim && p.weaponAnim.isAttacking),
        animKey: s.playerSprite.anims.currentAnim && s.playerSprite.anims.currentAnim.key,
        progress: +Math.min(1, (now - s._playerAttackStartTime) / s._playerAttackDuration).toFixed(4),
      };
    })()`);
    meta.push(st);
    await shot(cdp, `${label}-f${i}.png`);
  }
  await ev(cdp, `(() => { window.__phaserScene.weaponSprite.setVisible(true); return true; })()`);
  await ev(cdp, `(() => { window.__phaserScene.setPlayerAnimation('idle'); return true; })()`);
  fs.writeFileSync(`tools/verify-shots/${label}.json`, JSON.stringify(meta, null, 2));
  console.log(label, 'meta saved, frames:', meta.map((m) => m.frame).join(','));
  await new Promise((r) => setTimeout(r, 800));
};

await run('atk1-hold-with', true);
await run('atk1-hold-no', false);

cdp.close();
process.exit(0);
