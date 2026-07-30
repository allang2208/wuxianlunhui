// 开火时刻取证：包装 player._fireRanged，记录当帧贴图/枪口/目标/子弹生成
const PORT = Number(process.env.CDP_PORT || 9224);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page exc: ' + JSON.stringify(r.exceptionDetails).slice(0, 1500));
    return r.result.value;
};

const INSTALL_HOOK = `(() => {
    const p = window.Game.player, s = window.__phaserScene;
    if (!p.__origFireRanged) {
        p.__origFireRanged = p._fireRanged;
        const grab = spr => spr ? {
            x: +spr.x.toFixed(2), y: +spr.y.toFixed(2),
            rotDeg: +(spr.rotation * 180 / Math.PI).toFixed(2),
            flipY: spr.flipY, displayWidth: +spr.displayWidth.toFixed(2), displayHeight: +spr.displayHeight.toFixed(2)
        } : null;
        p._fireRanged = function (hand) {
            const spr = hand === 'offhand' ? s.offhandWeaponSprite : s.weaponSprite;
            const d = this.rangedFireData;
            const m = this._getMuzzleWorldPosition(hand);
            const before = new Set(s.projectilesGroup.getChildren());
            const r = this.__origFireRanged.call(this, hand);
            const news = s.projectilesGroup.getChildren().filter(c => !before.has(c));
            (window.__fireLog = window.__fireLog || []).push({
                hand,
                spr: grab(spr),
                muzzle: m ? { x: +m.x.toFixed(2), y: +m.y.toFixed(2) } : null,
                target: d ? { x: +d.targetX.toFixed(1), y: +d.targetY.toFixed(1) } : null,
                frozen: !!s._frozenAimActive,
                effAimDeg: s._effectiveAim != null ? +(s._effectiveAim * 180 / Math.PI).toFixed(2) : null,
                playerRotDeg: +(this.rotation * 180 / Math.PI).toFixed(2),
                offState: this.offhandWeaponAnim && this.offhandWeaponAnim.state,
                mainState: this.weaponAnim && this.weaponAnim.state,
                spawns: news.map(c => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), rotDeg: +(c.rotation * 180 / Math.PI).toFixed(2) }))
            });
            return r;
        };
    }
    window.__fireLog = [];
    return 'hooked';
})()`;

console.log(await ev(INSTALL_HOOK));

const waitFrames = n => ev(`new Promise(r => { let i = 0; const s = () => { if (++i < ${n}) requestAnimationFrame(s); else r('ok'); }; requestAnimationFrame(s); })`);

const out = {};
for (const [label, dx] of [['LEFT', -400], ['RIGHT', 400]]) {
    const p0 = await ev('({x: window.Game.player.x, y: window.Game.player.y})');
    let ctr = await ev(`window.__clientForWorld(${p0.x + dx}, ${p0.y})`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ctr.x, y: ctr.y, button: 'none' });
    await waitFrames(20);
    ctr = await ev(`window.__clientForWorld(${p0.x + dx}, ${p0.y})`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ctr.x, y: ctr.y, button: 'none' });
    await waitFrames(20);
    await ev('window.__fireLog = []; "cleared"');
    // 右键（副手）按住 ~500ms
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctr.x, y: ctr.y, button: 'right', buttons: 2, clickCount: 1 });
    await waitFrames(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctr.x, y: ctr.y, button: 'right', buttons: 0, clickCount: 1 });
    await waitFrames(10);
    // 左键（主手）按住 ~500ms
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctr.x, y: ctr.y, button: 'left', buttons: 1, clickCount: 1 });
    await waitFrames(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctr.x, y: ctr.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitFrames(10);
    out[label] = await ev('window.__fireLog');
}
console.log(JSON.stringify(out, null, 1));
ws.close();
