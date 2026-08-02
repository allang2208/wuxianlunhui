// 闪电色块链离屏预览（与 src/effects/lightning-bolt.js 同算法，便于肉眼调参不入游戏）
// 渲染 3 帧随机形态 + 施法端粗/目标端细的色块链，输出 tools/verify-shots/lightning-preview.png
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const W = 820, H = 420;
const OUT = path.join(import.meta.dirname, 'verify-shots', 'lightning-preview.png');

function buildChain(jitter, segments = 10) {
    const a = { x: 80, y: 200 };
    const b = { x: 740, y: 200 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const amp = Math.max(10, dist * jitter);
    const px = -dy / dist, py = dx / dist;
    const pts = [{ x: a.x, y: a.y }];
    for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const off = (Math.random() * 2 - 1) * amp;
        pts.push({ x: a.x + dx * t + px * off, y: a.y + dy * t + py * off });
    }
    pts.push({ x: b.x, y: b.y });
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
        dense.push(pts[i]);
        dense.push({ x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 });
    }
    dense.push(pts[pts.length - 1]);
    const smooth = [];
    for (let i = 0; i < dense.length - 1; i++) {
        const p1 = dense[i], p2 = dense[i + 1];
        if (i === 0) smooth.push({ x: p1.x, y: p1.y });
        smooth.push({ x: 0.75 * p1.x + 0.25 * p2.x, y: 0.75 * p1.y + 0.25 * p2.y });
        smooth.push({ x: 0.25 * p1.x + 0.75 * p2.x, y: 0.25 * p1.y + 0.75 * p2.y });
        if (i === dense.length - 2) smooth.push({ x: p2.x, y: p2.y });
    }
    // 固定步长重采样（细端圆块仍相连）+ 烘焙大小变化因子
    const step = 4;
    const chain = [];
    let acc = 0;
    for (let i = 0; i < smooth.length - 1; i++) {
        const p1 = smooth[i], p2 = smooth[i + 1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (segLen < 1e-6) continue;
        let t = acc / segLen;
        while (t <= 1) {
            chain.push({
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t,
                s: 0.75 + Math.random() * 0.5,
            });
            acc += step;
            t = acc / segLen;
        }
        acc -= segLen;
    }
    const last = smooth[smooth.length - 1];
    chain.push({ x: last.x, y: last.y, s: 1 });
    return chain;
}

const png = new PNG({ width: W, height: H });
for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 10; png.data[i + 1] = 10; png.data[i + 2] = 16; png.data[i + 3] = 255;
}

function fillCircle(x, y, r, r0, g0, b0, a) {
    const rr = Math.max(0.5, r);
    const x0 = Math.max(0, Math.floor(x - rr)), x1 = Math.min(W - 1, Math.ceil(x + rr));
    const y0 = Math.max(0, Math.floor(y - rr)), y1 = Math.min(H - 1, Math.ceil(y + rr));
    for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
            const d = Math.hypot(xx - x, yy - y);
            if (d > rr) continue;
            const i = (yy * W + xx) * 4;
            const ca = a * (1 - d / rr);
            png.data[i] = Math.round(png.data[i] * (1 - ca) + r0 * ca);
            png.data[i + 1] = Math.round(png.data[i + 1] * (1 - ca) + g0 * ca);
            png.data[i + 2] = Math.round(png.data[i + 2] * (1 - ca) + b0 * ca);
        }
    }
}

function drawChain(chain, rStart, rEnd, r0, g0, b0, alpha) {
    const n = chain.length;
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const w = (rStart + (rEnd - rStart) * t) * chain[i].s;
        fillCircle(chain[i].x, chain[i].y, w, r0, g0, b0, alpha);
    }
}

for (let frame = 0; frame < 3; frame++) {
    const chain = buildChain(0.12);
    drawChain(chain, 30, 5, 0x6a, 0x4b, 0xff, 0.35);
    drawChain(chain, 19, 4, 0xa9, 0x8f, 0xff, 0.3);
    drawChain(chain, 11, 2, 0xdc, 0xd6, 0xff, 0.7);
    drawChain(chain, 5, 1, 0xff, 0xff, 0xff, 0.75);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PNG.sync.write(png));
console.log('written:', OUT);
