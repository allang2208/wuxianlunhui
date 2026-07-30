// 激活 headless 页面目标（解决 document.hidden / rAF 停摆）
const PORT = Number(process.env.CDP_PORT || 9224);
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && t.url.includes('localhost:51'));
if (!page) { console.log('no page'); process.exit(1); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Target.activateTarget', { targetId: page.id });
console.log('activated', page.id);
// 再检查页面 hidden 状态
const pws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => pws.addEventListener('open', r));
let pid = 0; const p2 = new Map();
pws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && p2.has(m.id)) { const q = p2.get(m.id); p2.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
const psend = (method, params = {}) => new Promise((res, rej) => { const i = ++pid; p2.set(i, { res, rej }); pws.send(JSON.stringify({ id: i, method, params })); });
await psend('Runtime.enable');
await psend('Emulation.setFocusEmulationEnabled', { enabled: true });
const r = await psend('Runtime.evaluate', { expression: '({hidden: document.hidden, vis: document.visibilityState})', returnByValue: true });
console.log(JSON.stringify(r.result.value));
ws.close(); pws.close();
