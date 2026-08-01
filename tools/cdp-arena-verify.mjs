// CDP 实机验证（2026-08-01）：竞技场预制库等待重试 + 火把火焰清理 + 陷阱线前墙遮挡
// 用法: CDP_PORT=9224 node tools/cdp-arena-verify.mjs <子命令>
//   boot     —— 重载页面（拦截墙预制库 fetch 挂起，模拟加载慢）→ 进游戏 → init('scene7', player, 'zombie')
//              → 取 combat 节点 _enterCombat(node)，报告等待重试状态
//   release  —— 放行预制库 fetch，等竞技场构建完成，报告房间数/陷阱/emitter
//   traps    —— 收集三房陷阱坐标 + 距前墙边垂距 + 邻近墙件 depth + 粒子 emitter 统计
//   shot <file> <wx> <wy> [zoom] —— 相机对准世界坐标截图到 tools/verify-shots/<file>
//   cleanup  —— 任务 2 验证：cleanupRoom 前后粒子 emitter / _decoSprites 数量对比
import fs from 'node:fs';

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

// 新文档预注入：挂起墙预制库 fetch（直到 window.__releasePrefabs=true，兜底 60s 自动放行）
// + 记录 console.warn/error 到 window.__logs
const PREINJECT = `
window.__logs = [];
for (const k of ['warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { try { window.__logs.push(k + ': ' + a.map(String).join(' ')); } catch (_) {} orig(...a); };
}
{
    const of = window.fetch.bind(window);
    window.fetch = (url, opt) => {
        const u = String(url);
        if (u.includes('/data/wall-prefabs.json')) {
            return new Promise(res => {
                const t0 = Date.now();
                const tick = () => {
                    if (window.__releasePrefabs || Date.now() - t0 > 60000) res(of(url, opt));
                    else setTimeout(tick, 100);
                };
                tick();
            });
        }
        return of(url, opt);
    };
}
`;

// 进游戏 + 进竞技场（fetch 仍挂起 → 应触发"等待加载"路径而非静默回退）
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
    if (!DMS || !CRS) return { err: 'no DMS/CRS', DMS: !!DMS, CRS: !!CRS };
    DMS.init('scene7', window.Game.player, 'zombie');
    const node = DMS.nodes.find(n => n.type === 'combat');
    if (!node) return { err: 'no combat node', types: DMS.nodes.map(n => n.type) };
    DMS._enterCombat(node);
    await sleep(400); // 给同步回退路径一个窗口：若静默回退单房间，此时 CRS.state 已是 combat 且无 _arena
    return {
        waiting: !!DMS._arenaPrefabsWaiting,
        crsState: CRS.state,
        arenaBuilt: !!CRS._arena,
        dmsState: DMS.state,
        logs: window.__logs.slice(),
    };
})()`;

// 放行预制库 fetch → 等竞技场构建完成 → 统计
const RELEASE_WAIT = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    window.__releasePrefabs = true;
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) {
        await sleep(100);
        const CRS = window.CombatRoomSystem;
        if (CRS._arena) break;
        // 若等待标记已清且 CRS 进了 combat 但没有 _arena → 回退单房间了
        if (!window.DungeonMapSystem._arenaPrefabsWaiting && CRS.state === 'combat' && !CRS._arena) {
            return { fallbackSingleRoom: true, logs: window.__logs.slice() };
        }
    }
    const CRS = window.CombatRoomSystem;
    if (!CRS._arena) return { err: 'arena not built in 30s', logs: window.__logs.slice() };
    await sleep(500);
    const s = window.__phaserScene;
    const traps = s.children.list.filter(c => c.texture && (c.texture.key === 'trap_idle' || c.texture.key === 'trap_anim'));
    const emitters = s.children.list.filter(c => c.type === 'ParticleEmitter');
    return {
        builtMs: Math.round(performance.now() - t0),
        rooms: CRS._arena.rooms.length,
        awaiting: CRS._arena.awaiting,
        trapCount: traps.length,
        emitterCount: emitters.length,
        decoCount: (CRS._decoSprites || []).length,
        decoEmitterCount: (CRS._decoSprites || []).filter(d => d.type === 'ParticleEmitter').length,
        logs: window.__logs.slice(),
    };
})()`;

// 陷阱 + 前墙遮挡数据收集
const COLLECT_TRAPS = `(() => {
    const CRS = window.CombatRoomSystem;
    const s = window.__phaserScene;
    const traps = s.children.list
        .filter(c => c.texture && (c.texture.key === 'trap_idle' || c.texture.key === 'trap_anim'))
        .map(c => ({ x: Math.round(c.x), y: Math.round(c.y), depth: c.depth }));
    // 前墙边垂距（与 trap-system._distToFrontEdges 同公式）
    const distFront = (b, pt) => {
        const edges = [
            [{ x: b.cx - b.rx, y: b.cy }, { x: b.cx, y: b.cy + b.ry }],
            [{ x: b.cx + b.rx, y: b.cy }, { x: b.cx, y: b.cy + b.ry }],
        ];
        let best = Infinity;
        for (const [A, B] of edges) {
            const dx = B.x - A.x, dy = B.y - A.y;
            const len2 = dx * dx + dy * dy || 1;
            let t = ((pt.x - A.x) * dx + (pt.y - A.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            best = Math.min(best, Math.hypot(pt.x - (A.x + dx * t), pt.y - (A.y + dy * t)));
        }
        return best;
    };
    const inDiamond = (b, pt) => Math.abs(pt.x - b.cx) / b.rx + Math.abs(pt.y - b.cy) / b.ry <= 1.05;
    // 墙件（非障碍物）→ 到底边线段距离
    const wallPieces = (window.WallSystem.isoVisuals || []).filter(p => {
        const g = window.WallSystem._geoForTex(p.tex);
        return g && g.category !== 'obstacle' && p._sprite;
    });
    const segDist = (pt, p) => {
        const segs = window.WallSystem._pieceBaseSegments(p);
        let d = Infinity;
        for (const [A, B] of segs) {
            const dx = B.x - A.x, dy = B.y - A.y;
            const len2 = dx * dx + dy * dy || 1;
            let t = ((pt.x - A.x) * dx + (pt.y - A.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            d = Math.min(d, Math.hypot(pt.x - (A.x + dx * t), pt.y - (A.y + dy * t)));
        }
        return d;
    };
    const rooms = [];
    for (const ri of [1, 2, 3]) {
        const b = CRS.getArenaRoomBounds(ri);
        if (!b) continue;
        const list = traps.filter(t => inDiamond(b, t)).map(t => {
            const dF = distFront(b, t);
            const near = wallPieces
                .map(p => ({ p, d: segDist(t, p) }))
                .filter(w => w.d < 300)
                .sort((a, b2) => a.d - b2.d)
                .slice(0, 3)
                .map(w => ({ tex: w.p.tex, dist: Math.round(w.d), wallDepth: w.p._sprite.depth }));
            return { x: t.x, y: t.y, trapDepth: t.depth, distFront: Math.round(dF), nearWalls: near };
        }).sort((a, b2) => a.x - b2.x);
        rooms.push({ room: ri, cx: Math.round(b.cx), cy: Math.round(b.cy), rx: Math.round(b.rx), ry: Math.round(b.ry), traps: list });
    }
    const emitters = s.children.list.filter(c => c.type === 'ParticleEmitter');
    return {
        rooms,
        emitterCount: emitters.length,
        deco: (CRS._decoSprites || []).map(d => d.type || '?').reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {}),
    };
})()`;

const CLEANUP_CHECK = `(() => {
    const CRS = window.CombatRoomSystem;
    const s = window.__phaserScene;
    const count = () => ({
        emitters: s.children.list.filter(c => c.type === 'ParticleEmitter').length,
        emitterAlive: s.children.list.filter(c => c.type === 'ParticleEmitter' && c.active !== false).length,
        decoLen: (CRS._decoSprites || []).length,
    });
    const before = count();
    let err = null;
    try { CRS.cleanupRoom(); } catch (e) { err = String(e && e.message || e); }
    const after = count();
    return { before, after, err, crsState: CRS.state };
})()`;

async function main() {
    const cmd = process.argv[2];
    const target = await getPageTarget();
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    if (cmd === 'boot') {
        await cdp.send('Page.enable');
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PREINJECT });
        await cdp.send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 2000));
        console.log(JSON.stringify(await ev(cdp, BOOT_ENTER), null, 1));
    } else if (cmd === 'release') {
        console.log(JSON.stringify(await ev(cdp, RELEASE_WAIT), null, 1));
    } else if (cmd === 'traps') {
        console.log(JSON.stringify(await ev(cdp, COLLECT_TRAPS), null, 1));
    } else if (cmd === 'shot') {
        const [file, wx, wy, zoom] = process.argv.slice(3);
        await ev(cdp, `(async () => {
            const cam = window.__phaserScene.cameras.main;
            cam.stopFollow();
            cam.setZoom(${Number(zoom) || 1});
            cam.centerOn(${Number(wx)}, ${Number(wy)});
            await new Promise(r => { let i = 0; const s = () => { if (++i < 4) requestAnimationFrame(s); else r(0); }; requestAnimationFrame(s); });
            return { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom };
        })()`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync('tools/verify-shots', { recursive: true });
        fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(shot.data, 'base64'));
        console.log('saved tools/verify-shots/' + file);
    } else if (cmd === 'tpshot') {
        // 传送玩家到世界坐标（相机跟随玩家，等 lerp 稳定后截图）
        const [file, wx, wy] = process.argv.slice(3);
        await ev(cdp, `(async () => {
            const p = window.DungeonMapSystem.player || window.Game.player;
            if (!p) return { err: 'no player' };
            p.x = ${Number(wx)}; p.y = ${Number(wy)};
            await new Promise(r => { let i = 0; const s = () => { if (++i < 90) requestAnimationFrame(s); else r(0); }; requestAnimationFrame(s); });
            return { x: p.x, y: p.y };
        })()`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync('tools/verify-shots', { recursive: true });
        fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(shot.data, 'base64'));
        console.log('saved tools/verify-shots/' + file);
    } else if (cmd === 'clipshot') {
        // 世界坐标 → 屏幕坐标，以该点为中心局部放大截图（CDP clip，scale=2）
        const [file, wx, wy, half] = process.argv.slice(3);
        const h = Number(half) || 110;
        const pos = await ev(cdp, `(() => {
            const cam = window.__phaserScene.cameras.main;
            const c = document.querySelector('canvas');
            const r = c.getBoundingClientRect();
            return { sx: ${Number(wx)} - cam.scrollX + r.left, sy: ${Number(wy)} - cam.scrollY + r.top };
        })()`);
        const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: Math.max(0, pos.sx - h * 1.4), y: Math.max(0, pos.sy - h), width: h * 2.8, height: h * 2, scale: 2 },
        });
        fs.mkdirSync('tools/verify-shots', { recursive: true });
        fs.writeFileSync(`tools/verify-shots/${file}`, Buffer.from(shot.data, 'base64'));
        console.log('saved tools/verify-shots/' + file, JSON.stringify(pos));
    } else if (cmd === 'cleanup') {
        console.log(JSON.stringify(await ev(cdp, CLEANUP_CHECK), null, 1));
    } else {
        console.log('usage: boot|release|traps|shot|cleanup');
    }
    cdp.close();
}

main().catch(e => { console.error(e); process.exit(1); });
