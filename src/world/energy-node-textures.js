/**
 * 世界-122 能源水晶 v3 纹理生成器（运行时程序化版，2026-08-16）。
 *
 * 设计目标：
 * - 使用四种 AI 生成的尖塔晶簇（双尖/冠状/分叉/密集）；
 * - 每颗节点从四形态池随机抽选，并随机水平镜像；
 * - 不再绘制土堆或方块底座，节点只显示自然矿石与晶体；
 * - 生成结果只作为兜底。若 BootScene 已加载 AI 生图管线产出的
 *    energy_node_v3_<n> / energy_node_depleted_v3_<n>，则优先使用 AI 贴图。
 */

export const ENERGY_NODE_V3_COUNT = 4;

const FLOOR_SLOPE = 0.5774; // tan(30°)，与 wall-system FLOOR_SLOPE 对齐
const BASE_INSET = 2;       // 土堆前顶点离画布底边的像素（贴图底部即实体脚底）
const TAU = Math.PI * 2;

const FORMS = [
    { key: 'twin_spires', label: '双尖主晶', w: 192, seed: 1202, glow: 0.9 },
    { key: 'triple_crown', label: '冠状晶簇', w: 208, seed: 1303, glow: 1.0 },
    { key: 'leaning_spire', label: '分叉主晶', w: 184, seed: 2010, glow: 1.0 },
    { key: 'dense_cluster', label: '密集晶群', w: 224, seed: 1404, glow: 1.05 },
];

// 正常态 3 套蓝青色系；枯竭态统一灰绿（只保留几何差异，避免“耗尽后仍像活矿”）
const PALETTES = [
    {
        deep: '#071c30', mid: '#0b4f74', bright: '#2fb7ee',
        edge: '#d9f6ff', core: '#6de2ff', glow: 'rgba(42,180,255,',
        ground: ['#1d2b1a', '#2b3d22', '#394c2c', '#4c5d38'],
    },
    {
        deep: '#101c3a', mid: '#1f4f9c', bright: '#4f8cff',
        edge: '#e6efff', core: '#83c4ff', glow: 'rgba(64,140,255,',
        ground: ['#202418', '#2e3321', '#3d4529', '#4e5633'],
    },
    {
        deep: '#062528', mid: '#0a6a70', bright: '#26d8cf',
        edge: '#d9fffb', core: '#7df5e8', glow: 'rgba(38,216,207,',
        ground: ['#18261c', '#263425', '#34452b', '#435536'],
    },
];

const DEPLETED_PALETTE = {
    deep: '#272d2a', mid: '#3f4a44', bright: '#66736c',
    edge: '#8e9a93', core: '#7b8981', glow: null,
    ground: ['#1b211c', '#242b24', '#2c342b', '#363e34'],
};

/** 稳定伪随机（纹理形态固定，避免每次进场景长不一样、踩点截图对不上） */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
    return `rgb(${r},${g},${b})`;
}

function withAlpha(rgb, a) {
    return rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);
}

function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function polygon(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
}

/**
 * 等距接地土堆（世界-122 掩体/墙地板衔接同款 30° 底线）。
 * 菱形 footprint：前顶点在 baseY，左右顶点比前顶点高 halfW×tan30°，
 * 后顶点再高一倍；前脸两侧边缘的屏幕斜率正好 30°。
 */
function drawGroundMound(ctx, form, pal, rand, depleted) {
    const { w } = form;
    const h = 256;
    const cx = w / 2;
    const baseY = h - BASE_INSET;
    const halfW = w * (0.36 + rand() * 0.07);
    const halfD = Math.round(halfW * FLOOR_SLOPE);
    const left = [cx - halfW, baseY - halfD];
    const front = [cx, baseY];
    const right = [cx + halfW, baseY - halfD];
    const back = [cx, baseY - halfD * 2];
    const rock = pal.ground;

    // 接触阴影（烘焙进贴图，实体本身 _noShadow）
    const shadowR = halfW * 1.55;
    ctx.save();
    ctx.translate(cx, baseY + 4);
    ctx.scale(1, 0.3);
    const sh = ctx.createRadialGradient(0, 0, 2, 0, 0, shadowR);
    sh.addColorStop(0, 'rgba(0,0,0,0.42)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0.2)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, shadowR, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 顶面（背光面）：left-back-right
    const topGrad = ctx.createLinearGradient(0, back[1], 0, baseY);
    topGrad.addColorStop(0, shade(rock[1], 0.82));
    topGrad.addColorStop(1, rock[2]);
    ctx.fillStyle = topGrad;
    polygon(ctx, [left, back, right]);
    ctx.fill();

    // 正面：left-front-right（与相机同侧，稍亮）
    const faceGrad = ctx.createLinearGradient(0, baseY - halfD, 0, baseY);
    faceGrad.addColorStop(0, rock[1]);
    faceGrad.addColorStop(1, shade(rock[0], 0.86));
    ctx.fillStyle = faceGrad;
    polygon(ctx, [left, front, right]);
    ctx.fill();

    // 30° 前缘描边：暗色压住贴图裁切毛边 + 顶面亮线强调接地角度
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    polygon(ctx, [left, front, right]);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(shade(rock[3], 1.15), 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left[0], left[1]);
    ctx.lineTo(front[0], front[1]);
    ctx.lineTo(right[0], right[1]);
    ctx.stroke();

    // 碎石子 / 小土块 / 根部微晶
    for (let i = 0; i < 26; i++) {
        const u = rand();
        const v = rand();
        const px = cx + (u - 0.5) * halfW * 1.85;
        const py = baseY - halfD * 2 * v - halfD * (1 - v) * 0.25;
        if (px < 6 || px > w - 6 || py < 2) continue;
        const r = 0.7 + rand() * 1.7;
        ctx.fillStyle = rand() > 0.5 ? rock[0] : rock[3];
        ctx.globalAlpha = 0.35 + rand() * 0.35;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 土堆顶部少许发亮晶体碎屑
    for (let i = 0; i < 7; i++) {
        const ang = rand() * TAU;
        const rr = halfW * 0.18 + rand() * halfW * 0.5;
        const sx = cx + Math.cos(ang) * rr;
        const sy = baseY - halfD * 1.05 - Math.sin(ang) * rr * 0.55;
        drawMiniShard(ctx, sx, sy, 6 + rand() * 9, pal, rand, depleted);
    }

    return { cx, groundY: baseY - halfD * 0.72, baseY, halfW };
}

function drawMiniShard(ctx, x, y, h, pal, rand, depleted) {
    const w = Math.max(2.4, h * 0.42);
    const lean = (rand() - 0.5) * w * 0.9;
    drawShard(ctx, x, y, h, w, lean, pal, rand, depleted, 0.9);
}

/** 画一根晶体棱柱（六边形剪影 + 左亮/右暗分面 + 顶棱高光） */
function drawShard(ctx, x, groundY, h, w, lean, pal, rand, depleted, alpha = 1) {
    const apex = [x + lean, groundY - h];
    const baseL = [x - w / 2, groundY];
    const baseR = [x + w / 2, groundY];
    const midR = [x + w * 0.48 + lean * 0.28, groundY - h * 0.2];
    const midL = [x - w * 0.48 + lean * 0.28, groundY - h * 0.2];

    ctx.save();
    ctx.globalAlpha = alpha;

    // 主体竖向渐变：根深 → 中饱和 → 顶亮
    const grad = ctx.createLinearGradient(0, apex[1], 0, groundY);
    grad.addColorStop(0, depleted ? shade(pal.bright, 1.08) : pal.bright);
    grad.addColorStop(0.45, depleted ? shade(pal.mid, 1.1) : pal.mid);
    grad.addColorStop(1, pal.deep);
    ctx.fillStyle = grad;
    polygon(ctx, [baseL, baseR, midR, apex, midL]);
    ctx.fill();

    // 右半暗面
    ctx.fillStyle = depleted ? 'rgba(0,0,0,0.22)' : 'rgba(0,10,26,0.28)';
    polygon(ctx, [apex, midR, baseR, [x + lean * 0.25, groundY]]);
    ctx.fill();

    // 左半高光面
    ctx.fillStyle = depleted ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.12)';
    polygon(ctx, [baseL, midL, apex, [x + lean * 0.25, groundY]]);
    ctx.fill();

    // 顶棱高光
    ctx.strokeStyle = depleted ? pal.edge : pal.edge;
    ctx.globalAlpha = alpha * (depleted ? 0.45 : 0.95);
    ctx.lineWidth = Math.max(1, w * 0.06);
    ctx.beginPath();
    ctx.moveTo(midL[0], midL[1]);
    ctx.lineTo(apex[0], apex[1]);
    ctx.stroke();

    // 内部裂线
    ctx.globalAlpha = alpha * (depleted ? 0.5 : 0.32);
    ctx.strokeStyle = depleted ? '#2a312d' : '#d9f6ff';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const cxx = x + lean * 0.18;
    const cyy = groundY - h * 0.3 - rand() * h * 0.15;
    ctx.moveTo(cxx, cyy);
    ctx.lineTo(cxx + (rand() - 0.5) * w * 0.5, cyy - h * 0.14);
    ctx.lineTo(cxx + (rand() - 0.5) * w * 0.6, cyy - h * 0.3);
    ctx.stroke();

    ctx.restore();
}

function drawGlow(ctx, cx, cy, r, pal, depleted, strength) {
    if (depleted || !pal.glow) return;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, pal.glow + (0.4 * strength) + ')');
    g.addColorStop(0.45, pal.glow + (0.12 * strength) + ')');
    g.addColorStop(1, pal.glow + '0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function buildFormShards(form, rand) {
    const { w } = form;
    const cx = w / 2;
    const groundY = 256 - BASE_INSET - Math.round(w * 0.36 * FLOOR_SLOPE * 0.72);
    const J = (v) => (rand() - 0.5) * v;
    const arr = [];
    const add = (x, h, bw, lean) => arr.push({
        x, h, bw, lean: lean || 0,
        // 离中心越远的晶柱，根部沿土堆前坡略微下沉，避免所有柱子踩在同一水平线上
        gy: groundY + Math.abs(x - cx) * 0.14,
    });

    switch (form.key) {
        case 'single_spire':
            add(cx, 112 + J(8), 26 + J(3), J(6));
            add(cx - 20, 34 + J(5), 13, J(4));
            add(cx + 21, 42 + J(6), 14, J(4));
            add(cx + 5, 55 + J(6), 11, J(4));
            break;
        case 'twin_spires':
            add(cx - 16, 96 + J(10), 24, -6 - rand() * 8);
            add(cx + 17, 104 + J(10), 25, 5 + rand() * 8);
            add(cx - 34, 42 + J(6), 13, J(5));
            add(cx + 36, 38 + J(5), 13, J(5));
            add(cx, 48 + J(6), 10, J(3));
            break;
        case 'triple_crown':
            add(cx, 110 + J(10), 26, J(4));
            add(cx - 34, 76 + J(8), 18, -6);
            add(cx + 34, 80 + J(8), 18, 6);
            add(cx - 52, 38 + J(5), 12, -4);
            add(cx + 52, 40 + J(5), 12, 4);
            break;
        case 'dense_cluster': {
            const n = 10;
            for (let i = 0; i < n; i++) {
                const u = (i / (n - 1) - 0.5) * 2;
                const hh = 42 + rand() * 74 + (1 - Math.abs(u)) * 34;
                add(cx + u * w * 0.34 + J(9), hh, 12 + rand() * 10, u * 12 + J(9));
            }
            break;
        }
        case 'fan_cluster':
            for (let i = -3; i <= 3; i++) {
                const spread = Math.abs(i) / 3;
                add(cx + i * 24, 46 + (1 - spread) * 58 + J(10), 11 + (1 - spread) * 5, i * 11 + J(4));
            }
            add(cx, 96 + J(10), 22, J(3));
            break;
        case 'needle_spire':
            add(cx, 142 + J(10), 21, J(4));
            add(cx - 17, 58 + J(6), 10, -5);
            add(cx + 18, 52 + J(6), 10, 5);
            add(cx - 8, 34 + J(5), 9, J(4));
            add(cx + 9, 30 + J(5), 9, J(4));
            break;
        case 'broken_shard': {
            add(cx - 8, 98 + J(8), 30, -8);
            // 顶部断口：画一个矮平头大晶
            add(cx + 22, 54 + J(7), 16, 8);
            add(cx - 30, 36 + J(5), 11, -4);
            add(cx + 44, 26 + J(5), 10, 6);
            add(cx + 6, 30 + J(6), 8, J(4));
            break;
        }
        case 'ring_cluster': {
            const n = 9;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU + rand() * 0.2;
                add(cx + Math.cos(a) * 44, 34 + rand() * 22, 10 + rand() * 6, Math.cos(a) * 5);
            }
            break;
        }
        case 'crystal_crest':
            for (let i = -3; i <= 3; i++) {
                const k = 1 - Math.abs(i) / 4;
                add(cx + i * 30, 38 + k * 72 + J(10), 11 + k * 8, i * 3);
            }
            add(cx, 96 + J(8), 20, J(3));
            break;
        case 'leaning_spire':
            add(cx + 18, 124 + J(10), 24, 22 + rand() * 8);
            add(cx - 26, 42 + J(6), 13, -8);
            add(cx - 8, 54 + J(6), 11, -3);
            add(cx + 42, 30 + J(4), 10, 12);
            break;
        case 'split_geode':
            add(cx - 18, 82 + J(8), 28, -12);
            add(cx + 20, 74 + J(8), 26, 13);
            add(cx, 40 + J(6), 11, J(3));
            add(cx - 44, 34 + J(5), 10, -8);
            add(cx + 46, 36 + J(5), 10, 8);
            break;
        case 'wild_growth': {
            const n = 13;
            for (let i = 0; i < n; i++) {
                const a = rand() * TAU;
                const rr = 8 + rand() * 52;
                const hh = 24 + rand() * 92;
                add(cx + Math.cos(a) * rr, hh, 8 + rand() * 11, Math.cos(a) * 12 + J(8));
            }
            break;
        }
        default:
            add(cx, 92, 24, 0);
    }

    // 按高度从低到高画，高晶压前，符合遮挡直觉
    arr.sort((a, b) => a.h - b.h);
    return { cx, groundY, arr };
}

function renderCanvas(form, depleted) {
    const h = 256;
    const c = document.createElement('canvas');
    c.width = form.w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, h);

    const rand = mulberry32(form.seed);
    const pal = depleted ? DEPLETED_PALETTE : PALETTES[form.seed % PALETTES.length];
    const ground = drawGroundMound(ctx, form, pal, rand, depleted);
    const { arr, cx, groundY } = buildFormShards(form, rand);

    const topShard = arr[arr.length - 1];
    const glowR = Math.min(form.w * 0.78, 150) + (topShard ? topShard.h * 0.22 : 0);
    drawGlow(ctx, cx, groundY - (topShard ? topShard.h * 0.45 : 45), glowR, pal, depleted, form.glow);

    for (const s of arr) {
        drawShard(ctx, s.x, s.gy ?? groundY, s.h, s.bw, s.lean, pal, rand, depleted);
    }

    // 根部微光点（仅正常态，增强能量感）
    if (!depleted) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) {
            const a = rand() * TAU;
            const rr = 10 + rand() * (ground.halfW * 0.8);
            const px = cx + Math.cos(a) * rr;
            const py = ground.groundY + Math.sin(a) * rr * 0.35 + rand() * 6;
            const r = 0.8 + rand() * 2;
            const g = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
            g.addColorStop(0, hexToRgba(pal.core, 0.7));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, r * 4, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    return c;
}

/**
 * 保证 v3 程序化纹理存在。
 * 必须在 Phaser scene 已创建后调用（BootScene 之后）。
 */
export function ensureEnergyNodeTextures(scene) {
    if (!scene || typeof scene.textures?.createCanvas !== 'function') return;
    for (let i = 1; i <= ENERGY_NODE_V3_COUNT; i++) {
        const normalKey = `energy_node_gen_${i}`;
        const depletedKey = `energy_node_dep_gen_${i}`;
        const form = FORMS[i - 1];
        if (!scene.textures.exists(normalKey)) {
            const tex = scene.textures.createCanvas(normalKey, form.w, 256);
            const c = renderCanvas(form, false);
            const ctx = tex.getContext();
            ctx.clearRect(0, 0, form.w, 256);
            ctx.drawImage(c, 0, 0);
            tex.refresh();
        }
        if (!scene.textures.exists(depletedKey)) {
            const tex = scene.textures.createCanvas(depletedKey, form.w, 256);
            const c = renderCanvas(form, true);
            const ctx = tex.getContext();
            ctx.clearRect(0, 0, form.w, 256);
            ctx.drawImage(c, 0, 0);
            tex.refresh();
        }
    }
}

/** 取第 idx（1 基）个尖塔形态的纹理键：优先 AI 成品，缺图时用程序化版 */
export function energyNodeVariantPair(scene, idx) {
    const n = Math.max(1, Math.min(ENERGY_NODE_V3_COUNT, idx));
    const aiKey = `energy_node_v3_${n}`;
    const aiDepKey = `energy_node_depleted_v3_${n}`;
    if (scene?.textures?.exists(aiKey) && scene.textures.exists(aiDepKey)) {
        return { key: aiKey, depletedKey: aiDepKey, source: 'ai-v3' };
    }
    ensureEnergyNodeTextures(scene);
    return {
        key: `energy_node_gen_${n}`,
        depletedKey: `energy_node_dep_gen_${n}`,
        source: 'procedural-v3',
    };
}

/** 形态描述（调试/审计用） */
export function energyNodeFormMeta(idx) {
    return FORMS[Math.max(0, Math.min(FORMS.length - 1, idx - 1))];
}

/** 预览用：返回第 idx（1 基）形态的 HTMLCanvasElement（未挂载 Phaser） */
export function energyNodePreviewCanvas(idx, depleted = false) {
    const form = FORMS[Math.max(0, Math.min(FORMS.length - 1, idx - 1))];
    return renderCanvas(form, !!depleted);
}
