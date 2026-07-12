const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../public/data/weapon-anim-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const frames = config.sword && config.sword.attack && config.sword.attack.frames;
if (!frames || frames.length < 2) {
    console.error('[double-perframe-frames] No perFrame frames found');
    process.exit(1);
}

const n = frames.length;
const points = frames.map(f => ({ x: f.offsetX || 0, y: f.offsetY || 0 }));
const scales = frames.map(f => (f.scale !== undefined ? f.scale : 1));

let angles = frames.map(f => (f.rotation || 0) * Math.PI / 180);
for (let i = 1; i < angles.length; i++) {
    let delta = angles[i] - angles[i - 1];
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    angles[i] = angles[i - 1] + delta;
}

function catmullRom1D(values, progress) {
    const len = values.length;
    if (len === 0) return 0;
    if (len === 1 || progress <= 0) return values[0];
    if (progress >= 1) return values[len - 1];

    const raw = progress * (len - 1);
    const i = Math.floor(raw) + 1;
    const t = raw - (i - 1);

    const p0 = values[Math.max(0, i - 2)];
    const p1 = values[Math.min(len - 1, i - 1)];
    const p2 = values[Math.min(len - 1, i)];
    const p3 = values[Math.min(len - 1, i + 1)];

    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
    );
}

function catmullRom2D(pts, progress, alpha = 0.5) {
    const len = pts.length;
    if (len === 0) return { x: 0, y: 0 };
    if (len === 1 || progress <= 0) return { x: pts[0].x, y: pts[0].y };
    if (progress >= 1) return { x: pts[len - 1].x, y: pts[len - 1].y };

    const raw = progress * (len - 1);
    const i = Math.floor(raw) + 1;
    const t = raw - (i - 1);

    const P0 = pts[Math.max(0, i - 2)];
    const P1 = pts[Math.min(len - 1, i - 1)];
    const P2 = pts[Math.min(len - 1, i)];
    const P3 = pts[Math.min(len - 1, i + 1)];

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const d01 = Math.pow(dist(P0, P1), alpha);
    const d12 = Math.pow(dist(P1, P2), alpha);
    const d23 = Math.pow(dist(P2, P3), alpha);

    const t0 = 0;
    const t1 = t0 + d01;
    const t2 = t1 + d12;
    const t3 = t2 + d23;

    const u = t1 + t * (t2 - t1);
    const lerp = (a, b, tt) => ({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt });

    const A1 = t1 === t0 ? P1 : lerp(P0, P1, (u - t0) / (t1 - t0));
    const A2 = t2 === t1 ? P2 : lerp(P1, P2, (u - t1) / (t2 - t1));
    const A3 = t3 === t2 ? P3 : lerp(P2, P3, (u - t2) / (t3 - t2));

    const B1 = t2 === t0 ? A2 : lerp(A1, A2, (u - t0) / (t2 - t0));
    const B2 = t3 === t1 ? A3 : lerp(A2, A3, (u - t1) / (t3 - t1));

    return t2 === t1 ? B1 : lerp(B1, B2, (u - t1) / (t2 - t1));
}

const newFrames = [];
for (let i = 0; i < n - 1; i++) {
    // 保留原关键帧
    newFrames.push(frames[i]);
    // 在相邻关键帧中间插入一帧（取 0.5 处插值）
    const p = (i + 0.5) / (n - 1);
    const pos = catmullRom2D(points, p);
    const rot = catmullRom1D(angles, p);
    const scl = catmullRom1D(scales, p);
    newFrames.push({
        offsetX: Math.round(pos.x),
        offsetY: Math.round(pos.y),
        rotation: Math.round(rot * 180 / Math.PI),
        scale: parseFloat(scl.toFixed(2)),
    });
}
newFrames.push(frames[n - 1]);

config.sword.attack.frames = newFrames;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`[double-perframe-frames] ${n} -> ${newFrames.length} frames`);
