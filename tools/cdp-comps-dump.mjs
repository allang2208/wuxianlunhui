// CDP 实机验证（2026-08-01）：预制组合两条新规则
//   规则1 同房间不重复预制 key；规则2 组合间净间隔 > 较大组半径
// 进竞技场 → 按房间 dump isoVisuals 里的组合件（_prefabKey/_compAnchor/_compR），
// 校验每房无重复 key、两两净间隔全部满足，输出房间 3 中心/半径（供截图）。
// 用法: node tools/cdp-comps-dump.mjs
const PORT = Number(process.env.CDP_PORT || 9224);
const URL_SUB = process.env.CDP_URL_SUB || 'localhost:5174';

async function getPageTarget() {
    for (let i = 0; i < 30; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find(t => t.type === 'page' && t.url.includes(URL_SUB));
            if (page) return page;
        } catch (_e) { /* retry */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('no CDP page target');
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
        ws.addEventListener('message', ev => {
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

// 进游戏 + 进竞技场（预制库正常加载，不等等待路径）
const BOOT_ENTER = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    await sleep(1200);
    const DMS = window.DungeonMapSystem, CRS = window.CombatRoomSystem;
    if (!DMS || !CRS) return { err: 'no DMS/CRS' };
    DMS.init('scene7', window.Game.player, 'zombie');
    const node = DMS.nodes.find(n => n.type === 'combat');
    if (!node) return { err: 'no combat node', types: DMS.nodes.map(n => n.type) };
    DMS._enterCombat(node);
    t0 = Date.now();
    while (!CRS._arena) { if (Date.now() - t0 > 30000) return { err: 'arena not built', crsState: CRS.state }; await sleep(300); }
    await sleep(500);
    return { arenaBuilt: true, rooms: CRS._arena.rooms.length };
})()`;

// 按房间 dump 组合：key 清单 / 锚点 / 半径 / 两两净间隔校验
const DUMP_COMPS = `(() => {
    const CRS = window.CombatRoomSystem;
    const pieces = (window.WallSystem.isoVisuals || []).filter(p => p._prefabKey);
    const inDiamond = (b, pt) => Math.abs(pt.x - b.cx) / b.rx + Math.abs(pt.y - b.cy) / b.ry <= 1.05;
    const rooms = [];
    for (const ri of [1, 2, 3]) {
        const b = CRS.getArenaRoomBounds(ri);
        if (!b) continue;
        // 按组合锚点分组（同组各件共享 _compAnchor 引用）
        const groups = new Map();
        for (const p of pieces) {
            if (!inDiamond(b, p)) continue;
            const a = p._compAnchor;
            const id = a.x.toFixed(1) + ',' + a.y.toFixed(1);
            if (!groups.has(id)) groups.set(id, { key: p._prefabKey, x: a.x, y: a.y, r: p._compR, pieces: 0 });
            groups.get(id).pieces++;
        }
        const comps = [...groups.values()];
        const keys = comps.map(c => c.key);
        const dup = keys.length !== new Set(keys).size;
        const pairs = [];
        let gapViol = 0;
        for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
            const A = comps[i], B = comps[j];
            const d = Math.hypot(A.x - B.x, A.y - B.y);
            const net = d - (A.r + B.r);
            const need = Math.max(A.r, B.r);
            if (net <= need) gapViol++;
            pairs.push({ a: A.key, b: B.key, net: Math.round(net), need: Math.round(need), ok: net > need });
        }
        rooms.push({
            room: ri, cx: Math.round(b.cx), cy: Math.round(b.cy), rx: Math.round(b.rx), ry: Math.round(b.ry),
            compCount: comps.length, keys, dup, gapViol,
            comps: comps.map(c => ({ key: c.key, x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r), pieces: c.pieces })),
            pairs,
        });
    }
    return { rooms, totalCompPieces: pieces.length, decoShadows: (CRS._decoSprites || []).length };
})()`;

const target = await getPageTarget();
const cdp = await connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const boot = await ev(cdp, BOOT_ENTER);
console.log('BOOT:', JSON.stringify(boot));
if (!boot.arenaBuilt) { cdp.close(); process.exit(1); }
const dump = await ev(cdp, DUMP_COMPS);
console.log(JSON.stringify(dump, null, 1));
cdp.close();
