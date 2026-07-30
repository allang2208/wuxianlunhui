import fs from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9223);
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const list = await res.json();
const page = list.find(t => t.type === 'page' && t.url.includes('localhost:51'));
if (!page) { console.log('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
const expr = fs.readFileSync(process.argv[2], 'utf8');
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails).slice(0, 3000));
else console.log(JSON.stringify(r.result.value, null, 2));
ws.close();
