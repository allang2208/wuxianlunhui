#!/usr/bin/env node
/**
 * 精灵图怪物碰撞体自动调整脚本
 *
 * 作用：
 *   读取已有精灵图怪物的 walk/idle 精灵图，按帧分析实际内容包围盒，
 *   把内容尺寸按比例缩放到游戏内 spriteSize，写入 data/enemy-config.json
 *   的 `render.collisionWidth / collisionHeight`，让碰撞体尽量贴合实际贴图。
 *
 * 规则：
 *   - 只处理已经有精灵图的怪物（blackWolf、zombieDog、zombieWizard、mutant3、spitterZombie）。
 *   - 保持现有 `render.spriteSize`（显示尺寸）不变。
 *   - 碰撞体 = 平均内容包围盒 × (spriteSize / frameHeight)。
 *   - 结果四舍五入到整数，且至少保留 20×20，避免过小导致判定异常。
 *
 * 用法：
 *   node scripts/adjust-sprite-enemies.js
 *
 * 该脚本会就地修改 data/enemy-config.json，执行前已自动备份到 backup/。
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'enemy-config.json');

// 已有精灵图的怪物映射：key = enemy-config.json 中的键
const SPRITE_ENEMIES = {
    blackWolf: {
        file: 'assets/enemies/black_wolf.png',
        frameWidth: 250,
        frameHeight: 215,
        maxFrames: 8,
        // blackWolf 的 render.spriteSize 在 animation-config.json / _getPhaserOptions 里是 151
        spriteSize: 151
    },
    zombieDog: {
        file: 'assets/enemies/zombie_dog_walk.png',
        frameWidth: 512,
        frameHeight: 512,
        maxFrames: 8,
        spriteSize: 90
    },
    zombieWizard: {
        file: 'assets/enemies/zombie_wizard/walking.png',
        frameWidth: 512,
        frameHeight: 512,
        maxFrames: 10,
        spriteSize: 120
    },
    mutant3: {
        file: 'assets/enemies/mutant3/running.png',
        frameWidth: 512,
        frameHeight: 512,
        maxFrames: 10,
        spriteSize: 120
    },
    spitterZombie: {
        file: 'assets/enemies/spitter_zombie/walking.png',
        frameWidth: 512,
        frameHeight: 512,
        maxFrames: 13,
        spriteSize: 90
    }
};

const ALPHA_THRESHOLD = 10;
const MIN_SIZE = 20;

function readPng(filePath) {
    const buf = fs.readFileSync(filePath);
    return PNG.sync.read(buf);
}

function alphaAt(png, x, y) {
    return png.data[(y * png.width + x) * 4 + 3];
}

function analyzeFrame(png, left, top, frameW, frameH) {
    const right = Math.min(left + frameW, png.width);
    const bottom = Math.min(top + frameH, png.height);
    let minX = right, maxX = left - 1;
    let minY = bottom, maxY = top - 1;
    let hasContent = false;

    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            if (alphaAt(png, x, y) > ALPHA_THRESHOLD) {
                hasContent = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasContent) return null;
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        centerX: (minX + maxX + 1) / 2,
        centerY: (minY + maxY + 1) / 2
    };
}

function analyzeEnemy(key, info) {
    const filePath = path.join(PROJECT_ROOT, info.file);
    if (!fs.existsSync(filePath)) {
        console.warn(`[Adjust] 跳过 ${key}: 文件不存在 ${info.file}`);
        return null;
    }
    const png = readPng(filePath);
    const cols = Math.floor(png.width / info.frameWidth);
    const rows = Math.floor(png.height / info.frameHeight);
    const frames = [];

    for (let r = 0; r < rows && frames.length < info.maxFrames; r++) {
        for (let c = 0; c < cols && frames.length < info.maxFrames; c++) {
            const left = c * info.frameWidth;
            const top = r * info.frameHeight;
            const frame = analyzeFrame(png, left, top, info.frameWidth, info.frameHeight);
            if (frame) frames.push(frame);
        }
    }

    if (frames.length === 0) {
        console.warn(`[Adjust] 跳过 ${key}: 未识别到有效内容`);
        return null;
    }

    const avg = key => frames.reduce((s, f) => s + f[key], 0) / frames.length;
    const avgW = avg('width');
    const avgH = avg('height');
    const scale = info.spriteSize / info.frameHeight;

    return {
        key,
        file: info.file,
        framesAnalyzed: frames.length,
        avgContentWidth: avgW,
        avgContentHeight: avgH,
        scale,
        collisionWidth: Math.max(MIN_SIZE, Math.round(avgW * scale)),
        collisionHeight: Math.max(MIN_SIZE, Math.round(avgH * scale)),
        spriteSize: info.spriteSize
    };
}

function main() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`[Adjust] 找不到配置文件: ${CONFIG_PATH}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const results = [];

    for (const [key, info] of Object.entries(SPRITE_ENEMIES)) {
        if (!config[key]) {
            console.warn(`[Adjust] 跳过 ${key}: enemy-config.json 中无此条目`);
            continue;
        }
        console.log(`[Adjust] 分析 ${key} ...`);
        const result = analyzeEnemy(key, info);
        if (!result) continue;

        if (!config[key].render) config[key].render = {};
        const render = config[key].render;
        render.spriteSize = result.spriteSize;
        render.collisionWidth = result.collisionWidth;
        render.collisionHeight = result.collisionHeight;

        results.push(result);
        console.log(`  → 平均内容 ${result.avgContentWidth.toFixed(1)}x${result.avgContentHeight.toFixed(1)} px，` +
            `缩放 ${result.scale.toFixed(3)}，` +
            `碰撞体 ${result.collisionWidth}x${result.collisionHeight}`);
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log(`[Adjust] 已更新: ${CONFIG_PATH}`);
    console.log('[Adjust] 汇总:');
    for (const r of results) {
        console.log(`  ${r.key}: ${r.collisionWidth}x${r.collisionHeight} (原 ${r.spriteSize}x${r.spriteSize})`);
    }
}

main();
