// 伊莉丝六动作精灵图实物 × 配置一致性守卫（2026-08-17 统一尺度 v2）
// 保护「六动作统一角色尺度」口径：帧格规格按最大内容选型（idle 512² / walk·run·defend 640² /
// attacking 960×1024 / windmill 896×640），sheet 实物 PNG 尺寸必须与配置 frameWidth/Height × cols/rows
// 一致，防止退回 512 一刀切（attacking/windmill 角色缩水 65%/53%）或改配置漏改素材。
// 运行：node --import ./scripts/register-json-loader.mjs scripts/test-elise-sheets.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (cond, msg, extra = '') => {
    if (cond) {
        console.log(`PASS: ${msg}`);
    } else {
        console.error(`FAIL: ${msg}${extra ? ' | ' + extra : ''}`);
        failed++;
    }
};

const cfg = (await import('../data/companion-config.json')).default;
const elise = (cfg.companions || []).find((c) => c.id === 'warrior_bruno');
check(!!elise, '存在 warrior_bruno（伊莉丝）配置');

// 统一尺度口径锁定（v2 定稿）：[frameWidth, frameHeight, cols, rows, frameCount]
const CELL_SPEC = {
    idle: [512, 512, 1, 1, 1],
    walk: [640, 640, 4, 3, 12],
    run: [640, 640, 5, 5, 23],
    attack: [960, 1024, 5, 6, 28],
    windmill: [896, 640, 5, 5, 23],
    defend: [640, 640, 4, 5, 19],
};

for (const [key, [w, h, cols, rows, frames]] of Object.entries(CELL_SPEC)) {
    const def = elise.animations && elise.animations[key];
    check(!!def, `伊莉丝 ${key} 动画配置存在`);
    if (!def) continue;
    check(def.frameWidth === w && def.frameHeight === h,
        `${key} 格规格 ${def.frameWidth}×${def.frameHeight} = ${w}×${h}`,
        `${def.frameWidth}×${def.frameHeight}`);
    check(def.cols === cols && def.rows === rows,
        `${key} 网格 ${def.cols}×${def.rows} = ${cols}×${rows}`,
        `${def.cols}×${def.rows}`);
    check(def.frameCount === frames, `${key} frameCount=${frames}`, String(def.frameCount));
    check(cols * rows >= frames, `${key} 网格容量 ${cols * rows} ≥ 帧数 ${frames}`);
    // sheet 实物 IHDR 尺寸 vs 配置（防"改配置漏改素材"）
    const png = readFileSync(path.join(ROOT, def.src));
    const pw = png.readUInt32BE(16);
    const ph = png.readUInt32BE(20);
    check(pw === w * cols && ph === h * rows,
        `${key} sheet 实物 ${pw}×${ph} = ${w * cols}×${h * rows}`,
        `${pw}×${ph}`);
}

process.exit(failed ? 1 : 0);
