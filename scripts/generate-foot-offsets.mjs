#!/usr/bin/env node
/**
 * 批量生成敌人 footOffsetY 建议值
 *
 * 读取 data/enemy-config.json 中每个敌人的纹理，
 * 用 pngjs 分析 PNG 透明通道，找到最低非透明像素，
 * 计算 footOffsetY = lowestY - centerY（正数表示脚底在贴图中心下方）。
 *
 * - 如果配置了 idleFrameWidth/idleFrameHeight，按第一帧单元格分析（避免大 atlas 空白区域干扰）。
 * - 否则分析整张图片的有效内容包围盒。
 *
 * 分析得到的是“源像素”偏移，会按 `render.spriteSize / 源帧高度`
 * 缩放到“游戏内显示像素”，再写回 `render.footOffsetY`。
 * 这样 GameScene 可以直接把该值当作 Sprite 中心到脚底的距离使用。
 *
 * 用法：
 *   node scripts/generate-foot-offsets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'enemy-config.json');

const THRESHOLD = 20;

/**
 * 某些 PNG 在 IEND 后或 IDAT 与 IEND 之间夹带额外字节，
 * pngjs 会报 "unrecognised content at end of stream"。
 * 这里按 chunk 重新拼合，丢弃 IEND 之后的脏数据。
 */
function sanitizePng(input) {
    const parts = [input.slice(0, 8)]; // PNG signature
    let pos = 8;
    while (pos + 12 <= input.length) {
        const len = input.readUInt32BE(pos);
        const type = input.slice(pos + 4, pos + 8).toString('ascii');
        if (pos + 12 + len > input.length) break;
        parts.push(input.slice(pos, pos + 12 + len));
        pos += 12 + len;
        if (type === 'IEND') break;
    }
    return Buffer.concat(parts);
}

function readPng(filePath) {
    const buf = fs.readFileSync(filePath);
    return PNG.sync.read(sanitizePng(buf));
}

function lowestPixelInRect(png, left, top, width, height) {
    const right = Math.min(left + width, png.width);
    const bottom = Math.min(top + height, png.height);
    for (let y = bottom - 1; y >= top; y--) {
        for (let x = left; x < right; x++) {
            const alpha = png.data[(y * png.width + x) * 4 + 3];
            if (alpha > THRESHOLD) {
                return { x, y };
            }
        }
    }
    return null;
}

function analyzeFrame(png, frameX, frameY, frameW, frameH) {
    const p = lowestPixelInRect(png, frameX, frameY, frameW, frameH);
    if (!p) return null;
    const centerY = (frameH - 1) / 2;
    return p.y - frameY - centerY;
}

function analyzeWholeImage(png) {
    const p = lowestPixelInRect(png, 0, 0, png.width, png.height);
    if (!p) return null;
    const centerY = (png.height - 1) / 2;
    return p.y - centerY;
}

function findTextureFile(textures) {
    if (!textures) return null;
    const candidates = [
        textures.idle,
        textures.walk,
        textures.run,
        textures.attack,
        textures.attacking,
        textures.melt,
        textures.death
    ].filter(Boolean);
    for (const rel of candidates) {
        if (typeof rel !== 'string' || !rel.endsWith('.png')) continue;
        const full = path.join(ROOT, rel);
        if (fs.existsSync(full)) return full;
    }
    for (const rel of Object.values(textures)) {
        if (typeof rel !== 'string' || !rel.endsWith('.png')) continue;
        const full = path.join(ROOT, rel);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

/**
 * 把敌人 key 转成可能的资源目录/文件名（小写下划线）。
 * 当 textures 没配置时，兜底找 assets/enemies/<key>.png 或
 * assets/enemies/<key>/idle.png。
 */
function findTextureByKey(key) {
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    const candidates = [
        path.join(ROOT, 'assets', 'enemies', `${snake}.png`),
        path.join(ROOT, 'assets', 'enemies', snake, 'idle.png'),
    ];
    for (const full of candidates) {
        if (fs.existsSync(full)) return full;
    }
    return null;
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const report = [];

for (const [key, enemy] of Object.entries(config)) {
    const file = findTextureFile(enemy.textures) || findTextureByKey(key);
    if (!file) {
        report.push({ id: key, file: null, footOffsetY: null, note: 'no png texture' });
        continue;
    }

    try {
        const png = readPng(file);
        const textures = enemy.textures || {};
        const frameW = textures.idleFrameWidth;
        const frameH = textures.idleFrameHeight;

        let sourceOffset;
        let sourceFrameH;
        if (frameW > 0 && frameH > 0) {
            sourceOffset = analyzeFrame(png, 0, 0, frameW, frameH);
            sourceFrameH = frameH;
        } else {
            sourceOffset = analyzeWholeImage(png);
            sourceFrameH = png.height;
        }

        if (sourceOffset === null) {
            report.push({ id: key, file, footOffsetY: null, note: 'empty image/frame' });
            continue;
        }

        const render = enemy.render || {};
        const targetSize = render.spriteSize > 0
            ? render.spriteSize
            : (enemy.size > 0 ? enemy.size * 4 : sourceFrameH);

        // 缩放到游戏内显示像素
        const scale = sourceFrameH > 0 ? targetSize / sourceFrameH : 1;
        const footOffsetY = Math.round(sourceOffset * scale);

        enemy.render = render;
        enemy.render.footOffsetY = footOffsetY;
        report.push({
            id: key,
            file,
            footOffsetY,
            note: frameW > 0
                ? `first frame ${frameW}x${frameH}, src=${Math.round(sourceOffset)}, scale=${scale.toFixed(3)}`
                : `whole ${png.width}x${png.height}, src=${Math.round(sourceOffset)}, scale=${scale.toFixed(3)}`
        });
    } catch (err) {
        report.push({ id: key, file, footOffsetY: null, note: err.message });
    }
}

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log('\n=== footOffsetY 生成报告 ===\n');
for (const r of report) {
    const val = r.footOffsetY !== null ? String(r.footOffsetY).padStart(4) : '----';
    console.log(`${r.id.padEnd(22)} offset=${val}  ${r.note}`);
}
console.log(`\n已写回 ${CONFIG_PATH}`);
