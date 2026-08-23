#!/usr/bin/env node
/**
 * 生成精灵图每帧内容中心相对于切分方格中心的偏移表
 *
 * 用法：
 *   node scripts/generate-sprite-offsets.js
 *
 * 配置：修改下方 SHEETS 数组，指定 Phaser 动画 key、图片路径、单帧尺寸、有效帧数。
 * 输出：data/sprite-offsets.json
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const THRESHOLD = 10;
const OUTPUTS = [
    path.join(__dirname, '..', 'data', 'sprite-offsets.json'),
    path.join(__dirname, '..', 'public', 'data', 'sprite-offsets.json'),
];

// 需要生成偏移表的动画配置；按行主序排列帧
const SHEETS = [
    // 胖子僵尸
    { key: 'enemy_fat_zombie_idle',   file: 'assets/enemies/fat_zombie/idle.png',     frameWidth: 512, frameHeight: 512, endFrame: 0 },
    { key: 'enemy_fat_zombie_walk',   file: 'assets/enemies/fat_zombie/walking.png',  frameWidth: 512, frameHeight: 512, endFrame: 10 },
    { key: 'enemy_fat_zombie_attack', file: 'assets/enemies/fat_zombie/attacking.png',frameWidth: 512, frameHeight: 512, endFrame: 13 },
    { key: 'enemy_fat_zombie_death',  file: 'assets/enemies/fat_zombie/melting.png',  frameWidth: 512, frameHeight: 512, endFrame: 20 },
    // 黑狼
    { key: 'enemy_black_wolf',        file: 'assets/enemies/black_wolf.png',          frameWidth: 250, frameHeight: 215, endFrame: 7 },
    { key: 'enemy_black_wolf_pacing', file: 'assets/enemies/black_wolf_pacing.png',   frameWidth: 250, frameHeight: 215, endFrame: 7 },
    { key: 'enemy_black_wolf_attack', file: 'assets/enemies/black_wolf_attack.png',   frameWidth: 250, frameHeight: 215, endFrame: 7 },
    // 红狼王普通攻击只校正水平重心；纵向起伏属于动作表现，必须保留。
    { key: 'enemy_red_wolf_king_attack', file: 'assets/enemies/red_wolf_king/attack.png', frameWidth: 640, frameHeight: 640, endFrame: 20, horizontalOnly: true },
    // 僵尸犬
    { key: 'enemy_zombie_dog_walk',   file: 'assets/enemies/zombie_dog_walk.png',    frameWidth: 512, frameHeight: 512, endFrame: 7 },
    { key: 'enemy_zombie_dog_run',    file: 'assets/enemies/zombie_dog_run.png',     frameWidth: 512, frameHeight: 512, endFrame: 4 },
    { key: 'enemy_zombie_dog_attack', file: 'assets/enemies/zombie_dog_attack.png',  frameWidth: 512, frameHeight: 512, endFrame: 5 },
    // 僵尸巫师
    { key: 'enemy_zombie_wizard_idle',   file: 'assets/enemies/zombie_wizard/idle.png',       frameWidth: 512, frameHeight: 512, endFrame: 0 },
    { key: 'enemy_zombie_wizard_walk',   file: 'assets/enemies/zombie_wizard/walking.png',    frameWidth: 512, frameHeight: 512, endFrame: 9 },
    { key: 'enemy_zombie_wizard_attack', file: 'assets/enemies/zombie_wizard/attacking.png',  frameWidth: 512, frameHeight: 512, endFrame: 10 },
    { key: 'enemy_zombie_wizard_summon', file: 'assets/enemies/zombie_wizard/summoning.png',  frameWidth: 512, frameHeight: 512, endFrame: 6 },
    // 突变体-3
    { key: 'enemy_mutant3_idle',         file: 'assets/enemies/mutant3/idle.png',        frameWidth: 512, frameHeight: 512, endFrame: 0 },
    { key: 'enemy_mutant3_walk',         file: 'assets/enemies/mutant3/running.png',     frameWidth: 512, frameHeight: 512, endFrame: 9 },
    { key: 'enemy_mutant3_attack',       file: 'assets/enemies/mutant3/attacking.png',   frameWidth: 512, frameHeight: 512, endFrame: 20 },
    { key: 'enemy_mutant3_attack_normal',file: 'assets/enemies/mutant3/attacking-2.png', frameWidth: 512, frameHeight: 512, endFrame: 21 },
    // 毒液僵尸
    { key: 'enemy_spitter_zombie_idle',   file: 'assets/enemies/spitter_zombie/idle.png',      frameWidth: 512, frameHeight: 512, endFrame: 23 },
    { key: 'enemy_spitter_zombie_walk',   file: 'assets/enemies/spitter_zombie/walking.png',   frameWidth: 512, frameHeight: 512, endFrame: 12 },
    { key: 'enemy_spitter_zombie_attack', file: 'assets/enemies/spitter_zombie/attacking.png', frameWidth: 512, frameHeight: 512, endFrame: 21 },
    // 普通僵尸
    { key: 'enemy_zombie_idle',   file: 'assets/enemies/zombie/idle.png',     frameWidth: 512, frameHeight: 512, endFrame: 0 },
    { key: 'enemy_zombie_walk',   file: 'assets/enemies/zombie/walking.png',  frameWidth: 512, frameHeight: 512, endFrame: 14 },
    { key: 'enemy_zombie_attack', file: 'assets/enemies/zombie/attacking.png',frameWidth: 512, frameHeight: 512, endFrame: 14 },
    // 蝇手
    { key: 'enemy_flyhand_idle',       file: 'assets/enemies/flyhand/idle.png',        frameWidth: 512, frameHeight: 512, endFrame: 0 },
    { key: 'enemy_flyhand_walk',       file: 'assets/enemies/flyhand/walking.png',     frameWidth: 512, frameHeight: 512, endFrame: 15 },
    { key: 'enemy_flyhand_hammer',     file: 'assets/enemies/flyhand/attacking.png',   frameWidth: 512, frameHeight: 512, endFrame: 15 },
    { key: 'enemy_flyhand_slam',       file: 'assets/enemies/flyhand/attacking-2.png', frameWidth: 512, frameHeight: 512, endFrame: 23 },
    { key: 'enemy_flyhand_grand_slam', file: 'assets/enemies/flyhand/attacking-3.png', frameWidth: 512, frameHeight: 512, endFrame: 18 },
];

function analyzeFrame(png, col, row, frameW, frameH) {
    const left = col * frameW;
    const top = row * frameH;
    const right = Math.min(left + frameW, png.width);
    const bottom = Math.min(top + frameH, png.height);

    let minX = right, maxX = left - 1;
    let minY = bottom, maxY = top - 1;
    let hasContent = false;

    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const alpha = png.data[(y * png.width + x) * 4 + 3];
            if (alpha > THRESHOLD) {
                hasContent = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasContent) return null;

    const centerX = (minX + maxX + 1) / 2;
    const centerY = (minY + maxY + 1) / 2;
    const frameCenterX = left + frameW / 2;
    const frameCenterY = top + frameH / 2;
    return {
        offsetX: centerX - frameCenterX,
        offsetY: centerY - frameCenterY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

function cleanPngBuffer(buf) {
    // pngjs 对某些带附加数据的 PNG 会报错，截断到 IEND 之后即可
    let offset = 8;
    while (offset < buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        if (type === 'IEND') {
            return buf.slice(0, offset + 12);
        }
        offset += 12 + len;
    }
    return buf;
}

function analyzeSheet(sheet) {
    const pngPath = path.join(__dirname, '..', sheet.file);
    const raw = cleanPngBuffer(fs.readFileSync(pngPath));
    const png = PNG.sync.read(raw);
    const cols = Math.floor(png.width / sheet.frameWidth);
    const result = {};

    for (let i = 0; i <= sheet.endFrame; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const info = analyzeFrame(png, col, row, sheet.frameWidth, sheet.frameHeight);
        if (info) {
            result[i] = {
                x: Math.round(info.offsetX),
                y: sheet.horizontalOnly ? 0 : Math.round(info.offsetY)
            };
        }
    }

    return result;
}

function main() {
    const printKeyIndex = process.argv.indexOf('--print-key');
    if (printKeyIndex >= 0) {
        const key = process.argv[printKeyIndex + 1];
        const sheet = SHEETS.find((item) => item.key === key);
        if (!sheet) throw new Error(`unknown sheet key: ${key}`);
        console.log(JSON.stringify({ [key]: analyzeSheet(sheet) }, null, 2));
        return;
    }
    // 旧美术资产可能已经按项目要求删除；缺失表保留现有偏移，不阻断其余现行素材重算。
    const offsets = fs.existsSync(OUTPUTS[0])
        ? JSON.parse(fs.readFileSync(OUTPUTS[0], 'utf8'))
        : {};
    for (const sheet of SHEETS) {
        const pngPath = path.join(__dirname, '..', sheet.file);
        if (!fs.existsSync(pngPath)) {
            console.warn(`[Offsets] ${sheet.key}: source missing, kept existing entry (${sheet.file})`);
            continue;
        }
        offsets[sheet.key] = analyzeSheet(sheet);
        console.log(`[Offsets] ${sheet.key}: generated ${Object.keys(offsets[sheet.key]).length} frames`);
    }

    for (const output of OUTPUTS) {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(offsets, null, 2));
        console.log(`[Offsets] saved: ${output}`);
    }
}

main();
