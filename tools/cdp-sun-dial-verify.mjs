// 24h 太阳针表盘实机验证（2026-08-19）：冻结四时相，断言指针角度 + 截图右上角 HUD。
// 安全入口：powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-sun-dial-verify.mjs
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9224);

async function getPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900));
  return r.result.value;
}

const page = await getPageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');

await ev(cdp, `(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.Game && window.Game.player) return 'in';
    const b = document.getElementById('startGameBtn');
    if (b && getComputedStyle(b).display !== 'none') { b.click(); }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'timeout';
})()`);
await new Promise((r) => setTimeout(r, 2500));

const phases = [
  { name: 'dawn', phase: 0, want: -90 },
  { name: 'noon', phase: 0.25, want: 0 },
  { name: 'dusk', phase: 0.5, want: 90 },
  { name: 'midnight', phase: 0.75, want: 180 },
];
let pass = 0;
let fail = 0;
const clip = { x: 0, y: 0, width: 0, height: 0, scale: 1 };
for (const p of phases) {
  await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: false, startPhase: ${p.phase} }); 'set'`);
  await new Promise((r) => setTimeout(r, 900));
  const got = await ev(cdp, `(() => {
    const hand = document.getElementById('gameTimeDialHand');
    const m = hand?.getAttribute('transform')?.match(/rotate\\((-?[0-9.]+)/);
    const deg = m ? parseFloat(m[1]) : null;
    const text = document.getElementById('gameTimeText')?.textContent || '';
    const rect = document.getElementById('gameTime')?.getBoundingClientRect();
    return { deg, text, rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null };
  })()`);
  const ok = got.deg !== null && Math.abs(got.deg - p.want) < 0.6;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${p.name}: 指针 ${got.deg}°（期望 ${p.want}°）| ${got.text}`);
  if (got.rect) {
    clip.x = Math.max(0, got.rect.x - 8);
    clip.y = Math.max(0, got.rect.y - 8);
    clip.width = got.rect.w + 60;
    clip.height = got.rect.h + 30;
  }
  const d = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  fs.mkdirSync('tools/verify-shots', { recursive: true });
  fs.writeFileSync(`tools/verify-shots/sun-dial-${p.name}.png`, Buffer.from(d.data, 'base64'));
}
console.log(`${pass} passed, ${fail} failed`);

await ev(cdp, `window.EnvironmentLightingSystem.configure({ animateSun: true }); 'resumed'`);
cdp.close();
process.exit(fail ? 1 : 0);
