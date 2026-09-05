/**
 * 世界-122 能量矿脉正式纹理选择器与 v3 程序化兜底。
 *
 * 正式资源：五种真实碎石轮廓、蓝/紫及各自枯竭态、蓝/紫各64帧外围环境图集。
 * 旧兜底目标：
 * - 使用三种贴地形态（横向裂隙/中心矿窝/Y形分叉）；
 * - 每颗节点从三形态池随机抽选，并随机水平镜像；
 * - 逻辑占格仍为1格，视觉只显示26.565°碎石 footprint 与宽扁能量块；
 * - 生成结果只作为兜底。若 BootScene 已加载 AI 生图管线产出的
 *    energy_node_v3_<n> / energy_node_depleted_v3_<n>，则优先使用 AI 贴图。
 */

export const ENERGY_NODE_V3_COUNT = 3;
export const ENERGY_NODE_RUBBLE_COUNT = 5;
export const ENERGY_NODE_GROUND_CONTACT_COUNT = 16;

const RUBBLE_LABELS = ['紧凑台地', '双峰鞍部', '低矮斜脊', '前沿散石', '弧形缺口'];

/** 已确认的五款独立矿堆；正常/枯竭必须成对可用，缺失才回退旧素材。 */
export function energyNodeRubblePair(scene, idx, highEnergy = false) {
    const n = Math.max(1, Math.min(ENERGY_NODE_RUBBLE_COUNT, Math.floor(Number(idx) || 1)));
    const key = `energy_node_rubble_${n}`;
    const depletedKey = `energy_node_rubble_depleted_${n}`;
    const highEnergyKey = `energy_node_high_energy_${n}`;
    const highEnergyDepletedKey = `energy_node_high_energy_depleted_${n}`;
    if (highEnergy && scene?.textures?.exists(highEnergyKey)) {
        const pairedDepleted = scene.textures.exists(highEnergyDepletedKey)
            ? highEnergyDepletedKey
            : depletedKey;
        if (scene.textures.exists(pairedDepleted)) {
            return {
                key: highEnergyKey,
                depletedKey: pairedDepleted,
                source: 'imagegen-rubble-purple-v4',
                label: RUBBLE_LABELS[n - 1],
            };
        }
    }
    if (!scene?.textures?.exists(key) || !scene.textures.exists(depletedKey)) return null;
    return { key, depletedKey, source: 'imagegen-rubble-v4', label: RUBBLE_LABELS[n - 1] };
}

/** 四邻接地层图集；frame = 稳定外圈形态 * 16 + 邻接mask。 */
export function energyNodeGroundContact(scene, mask, visualVariant = 0, highEnergy = false) {
    const normalized = Number(mask) & 0x0f;
    const variant = Math.max(0, Math.min(3, Math.floor(Number(visualVariant) || 0)));
    const atlasKey = highEnergy
        ? 'energy_node_ground_surround_purple_tiles'
        : 'energy_node_ground_surround_blue_tiles';
    if (scene?.textures?.exists(atlasKey)) {
        return {
            key: atlasKey,
            frame: variant * 16 + normalized,
            displayW: 192,
            displayH: 108,
            source: 'energy-surround-atlas-v1',
        };
    }
    const fallbackKey = `energy_node_ground_contact_${normalized}`;
    if (!scene?.textures?.exists(fallbackKey)) return null;
    return {
        key: fallbackKey,
        frame: null,
        displayW: 128,
        displayH: 72,
        source: 'energy-contact-v1-fallback',
    };
}

const FLOOR_SLOPE = 0.5;    // 2:1 等距地面轴，屏幕角 atan(0.5)=26.565°
const BASE_INSET = 2;       // 土堆前顶点离画布底边的像素（贴图底部即实体脚底）
const TAU = Math.PI * 2;

const FORMS = [
    { key: 'horizontal_vein', label: '横向裂隙', w: 224, h: 128, seed: 1202, glow: 0.9 },
    { key: 'center_pocket', label: '中心矿窝', w: 224, h: 128, seed: 1303, glow: 1.0 },
    { key: 'branching_vein', label: 'Y形分叉', w: 224, h: 128, seed: 2010, glow: 1.0 },
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

function drawExposedVeinFallback(form, depleted) {
    const c = document.createElement('canvas');
    c.width = form.w;
    c.height = form.h;
    const ctx = c.getContext('2d');
    const rand = mulberry32(form.seed);
    const cx = form.w / 2;
    const baseY = form.h - BASE_INSET;
    const halfW = form.w * 0.47;
    const halfD = halfW * FLOOR_SLOPE;
    const centerY = baseY - halfD;
    const left = [cx - halfW, centerY];
    const back = [cx, centerY - halfD];
    const right = [cx + halfW, centerY];
    const front = [cx, baseY];
    const rock = depleted
        ? ['#171b1a', '#242a27', '#343b37', '#505954']
        : ['#151a1c', '#242b2e', '#353e42', '#525e63'];
    const ore = depleted
        ? ['#293235', '#48565a', '#758287']
        : ['#05283b', '#087aa2', '#5de8ff'];

    // A continuous two-axis alpha envelope keeps the exact 26.565° contact
    // edges; dense chips above it make the surface read as rubble, not a slab.
    const groundGrad = ctx.createLinearGradient(0, back[1], 0, front[1]);
    groundGrad.addColorStop(0, rock[1]);
    groundGrad.addColorStop(1, rock[0]);
    ctx.fillStyle = groundGrad;
    polygon(ctx, [left, back, right, front]);
    ctx.fill();

    for (let i = 0; i < 170; i++) {
        let u = 0;
        let v = 0;
        do {
            u = rand() * 2 - 1;
            v = rand() * 2 - 1;
        } while (Math.abs(u) + Math.abs(v) > 0.98);
        const x = cx + u * halfW;
        const y = centerY + v * halfD;
        const rx = 0.7 + rand() * 2.2;
        const ry = 0.45 + rand() * 1.2;
        ctx.fillStyle = rock[1 + Math.floor(rand() * 3)];
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, TAU);
        ctx.fill();
    }

    const layouts = {
        horizontal_vein: [
            [-0.31, 0.02], [-0.20, 0.00], [-0.09, 0.02],
            [0.03, -0.01], [0.15, 0.01], [0.28, -0.02],
        ],
        center_pocket: [
            [-0.13, -0.08], [0.02, -0.12], [0.16, -0.04],
            [-0.15, 0.08], [0.00, 0.08], [0.15, 0.09], [0.02, 0.00],
        ],
        branching_vein: [
            [0.00, -0.20], [0.00, -0.09], [0.00, 0.02],
            [-0.10, 0.12], [-0.22, 0.20], [0.11, 0.12], [0.23, 0.20],
        ],
    };
    const plates = layouts[form.key] || layouts.horizontal_vein;
    const largeRocks = [
        [-0.34, -0.16], [-0.12, -0.25], [0.15, -0.24], [0.35, -0.12],
        [-0.36, 0.14], [-0.17, 0.25], [0.18, 0.25], [0.36, 0.13],
    ];
    const items = [];
    for (const [u, v] of largeRocks) {
        items.push({ type: 'rock', x: cx + u * halfW * 1.9,
            y: centerY + v * halfD * 1.9, seed: rand() });
    }
    for (const [u, v] of plates) {
        items.push({ type: 'ore', x: cx + u * halfW * 1.75,
            y: centerY + v * halfD * 1.8, seed: rand() });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) {
        if (item.type === 'rock') {
            const rx = 8 + item.seed * 4;
            const ry = 4.5 + item.seed * 2.2;
            const grad = ctx.createLinearGradient(0, item.y - ry, 0, item.y + ry);
            grad.addColorStop(0, rock[3]);
            grad.addColorStop(1, rock[1]);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(item.x, item.y, rx, ry, item.seed * 0.7, 0, TAU);
            ctx.fill();
            continue;
        }
        const rx = 8.5 + item.seed * 3;
        const ry = 3.8 + item.seed * 1.6;
        const grad = ctx.createLinearGradient(0, item.y - ry, 0, item.y + ry);
        grad.addColorStop(0, ore[2]);
        grad.addColorStop(0.45, ore[1]);
        grad.addColorStop(1, ore[0]);
        ctx.fillStyle = grad;
        polygon(ctx, [
            [item.x - rx, item.y], [item.x - rx * 0.55, item.y - ry],
            [item.x + rx * 0.35, item.y - ry * 0.9], [item.x + rx, item.y],
            [item.x + rx * 0.45, item.y + ry], [item.x - rx * 0.45, item.y + ry],
        ]);
        ctx.fill();
        ctx.strokeStyle = depleted ? 'rgba(165,180,184,0.35)' : 'rgba(160,244,255,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(item.x - rx * 0.5, item.y + ry * 0.1);
        ctx.lineTo(item.x, item.y - ry * 0.45);
        ctx.lineTo(item.x + rx * 0.48, item.y + ry * 0.25);
        ctx.stroke();
    }
    return c;
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
    if (form.key === 'horizontal_vein'
        || form.key === 'center_pocket'
        || form.key === 'branching_vein') {
        return drawExposedVeinFallback(form, depleted);
    }
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
        const height = form.h || 256;
        if (!scene.textures.exists(normalKey)) {
            const tex = scene.textures.createCanvas(normalKey, form.w, height);
            const c = renderCanvas(form, false);
            const ctx = tex.getContext();
            ctx.clearRect(0, 0, form.w, height);
            ctx.drawImage(c, 0, 0);
            tex.refresh();
        }
        if (!scene.textures.exists(depletedKey)) {
            const tex = scene.textures.createCanvas(depletedKey, form.w, height);
            const c = renderCanvas(form, true);
            const ctx = tex.getContext();
            ctx.clearRect(0, 0, form.w, height);
            ctx.drawImage(c, 0, 0);
            tex.refresh();
        }
    }
}

/** 取第 idx（1 基）个裸露矿脉形态纹理键：优先 AI 成品，缺图时用程序化版 */
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

/**
 * 道路式四邻拼接能源矿：frame 直接使用 4-bit 邻接掩码。
 * bit 0/1/2/3 分别代表 +i/-i/+j/-j，完整覆盖孤立、端头、直线、转角、T 字与十字。
 */
export const ENERGY_NODE_CONNECTION_BITS = Object.freeze({
    I_POSITIVE: 1,
    I_NEGATIVE: 2,
    J_POSITIVE: 4,
    J_NEGATIVE: 8,
});

export const ENERGY_NODE_DIRECTIONAL_FRAME_COUNT = 16;

export function energyNodeDirectionalPair(scene) {
    const key = 'energy_node_directional_tiles';
    const depletedKey = 'energy_node_directional_depleted_tiles';
    if (scene?.textures?.exists(key) && scene.textures.exists(depletedKey)) {
        return { key, depletedKey, source: 'directional-roadstyle-v1' };
    }
    return null;
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
