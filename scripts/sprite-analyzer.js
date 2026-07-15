#!/usr/bin/env node
/**
 * 精灵图自动化识别脚本
 *
 * 作用：
 *   1. 读取 PNG 图片的透明通道，识别图中每个“物体/帧”的包围盒、中心点。
 *   2. 支持按固定网格（frameWidth x frameHeight）逐帧分析。
 *   3. 支持自动连通域检测，找出所有独立对象。
 *
 * 特点：
 *   - 使用 pngjs（纯 JS，无原生依赖），不依赖 Canvas / Phaser 渲染上下文。
 *   - 可在 Node 环境直接运行，输出 JSON 报告，供 Phaser 生成 atlas / spritesheet 配置。
 *
 * 用法：
 *   按网格分析：
 *     node scripts/sprite-analyzer.js assets/character/walk.png --grid 512x516
 *
 *   自动识别对象：
 *     node scripts/sprite-analyzer.js assets/enemies/spider.png
 *
 *   批量分析目录：
 *     node scripts/sprite-analyzer.js assets/enemies --grid 512x512 --output reports/sprites.json
 *
 *   调整透明阈值（默认 alpha > 10 算有效像素）：
 *     node scripts/sprite-analyzer.js assets/foo.png --threshold 5
 *
 *   忽略过小的噪声点（默认像素数 < 50 的连通域会被过滤）：
 *     node scripts/sprite-analyzer.js assets/foo.png --min-area=200
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const THRESHOLD_DEFAULT = 10;

function parseArgs(argv) {
    const args = argv.slice(2);
    const input = args.find(a => !a.startsWith('--'));
    const grid = args.find(a => a.startsWith('--grid='));
    const output = args.find(a => a.startsWith('--output='));
    const threshold = args.find(a => a.startsWith('--threshold='));
    const minArea = args.find(a => a.startsWith('--min-area='));

    return {
        input,
        grid: grid ? grid.slice('--grid='.length).split('x').map(Number) : null,
        output: output ? output.slice('--output='.length) : null,
        threshold: threshold ? Number(threshold.slice('--threshold='.length)) : THRESHOLD_DEFAULT,
        minArea: minArea ? Number(minArea.slice('--min-area='.length)) : 50
    };
}

function readPng(filePath) {
    const buf = fs.readFileSync(filePath);
    return PNG.sync.read(buf);
}

function alphaAt(png, x, y) {
    return png.data[(y * png.width + x) * 4 + 3];
}

/**
 * 固定网格分析：按 frameWidth x frameHeight 切分，返回每帧实际内容包围盒
 */
function analyzeGrid(png, frameW, frameH, threshold) {
    const cols = Math.ceil(png.width / frameW);
    const rows = Math.ceil(png.height / frameH);
    const frames = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const left = c * frameW;
            const top = r * frameH;
            const right = Math.min(left + frameW, png.width);
            const bottom = Math.min(top + frameH, png.height);

            let minX = right, maxX = left - 1;
            let minY = bottom, maxY = top - 1;
            let hasContent = false;

            for (let y = top; y < bottom; y++) {
                for (let x = left; x < right; x++) {
                    if (alphaAt(png, x, y) > threshold) {
                        hasContent = true;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            if (hasContent) {
                frames.push({
                    index: frames.length,
                    row: r,
                    col: c,
                    x: minX,
                    y: minY,
                    width: maxX - minX + 1,
                    height: maxY - minY + 1,
                    centerX: (minX + maxX + 1) / 2,
                    centerY: (minY + maxY + 1) / 2
                });
            }
        }
    }

    return { cols, rows, frameWidth: frameW, frameHeight: frameH, frames };
}

/**
 * 自动连通域分析：找出所有独立对象
 */
function analyzeAuto(png, threshold) {
    const w = png.width;
    const h = png.height;
    const visited = new Uint8Array(w * h);
    const components = [];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (visited[idx] || alphaAt(png, x, y) <= threshold) continue;

            // BFS
            const stack = [idx];
            visited[idx] = 1;
            let minX = x, maxX = x, minY = y, maxY = y;
            let head = 0;

            while (head < stack.length) {
                const cur = stack[head++];
                const cx = cur % w;
                const cy = Math.floor(cur / w);

                if (cx > 0) {
                    const n = cur - 1;
                    if (!visited[n] && alphaAt(png, cx - 1, cy) > threshold) {
                        visited[n] = 1;
                        stack.push(n);
                    }
                }
                if (cx < w - 1) {
                    const n = cur + 1;
                    if (!visited[n] && alphaAt(png, cx + 1, cy) > threshold) {
                        visited[n] = 1;
                        stack.push(n);
                    }
                }
                if (cy > 0) {
                    const n = cur - w;
                    if (!visited[n] && alphaAt(png, cx, cy - 1) > threshold) {
                        visited[n] = 1;
                        stack.push(n);
                    }
                }
                if (cy < h - 1) {
                    const n = cur + w;
                    if (!visited[n] && alphaAt(png, cx, cy + 1) > threshold) {
                        visited[n] = 1;
                        stack.push(n);
                    }
                }
            }

            for (const cur of stack) {
                const cx = cur % w;
                const cy = Math.floor(cur / w);
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
            }

            components.push({
                index: components.length,
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
                centerX: (minX + maxX + 1) / 2,
                centerY: (minY + maxY + 1) / 2,
                pixelCount: stack.length
            });
        }
    }

    // 按从上到下、从左到右排序
    components.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    components.forEach((c, i) => { c.index = i; });

    return { components };
}

function summarize(items) {
    if (!items || items.length === 0) return null;
    const avg = key => items.reduce((s, f) => s + f[key], 0) / items.length;
    return {
        count: items.length,
        avgWidth: avg('width'),
        avgHeight: avg('height'),
        avgCenterX: avg('centerX'),
        avgCenterY: avg('centerY')
    };
}

function analyzeFile(filePath, grid, threshold, minArea) {
    const png = readPng(filePath);
    const result = {
        file: filePath,
        width: png.width,
        height: png.height
    };

    if (grid && grid.length === 2 && grid[0] > 0 && grid[1] > 0) {
        Object.assign(result, analyzeGrid(png, grid[0], grid[1], threshold));
        result.summary = summarize(result.frames);
        // 顺便生成一份 Phaser spritesheet 配置（仅含 frameWidth/frameHeight）
        result.phaserSpritesheet = {
            frameWidth: grid[0],
            frameHeight: grid[1],
            endFrame: result.frames.length - 1
        };
    } else {
        Object.assign(result, analyzeAuto(png, threshold));
        result.components = result.components.filter(c => c.pixelCount >= minArea);
        result.components.forEach((c, i) => { c.index = i; });
        result.summary = summarize(result.components);
    }

    return result;
}

function collectPngFiles(inputPath) {
    const stat = fs.statSync(inputPath);
    if (stat.isFile()) return [inputPath];
    if (!stat.isDirectory()) throw new Error(`无效输入: ${inputPath}`);

    const files = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const s = fs.statSync(full);
            if (s.isDirectory()) walk(full);
            else if (s.isFile() && entry.toLowerCase().endsWith('.png')) files.push(full);
        }
    }
    walk(inputPath);
    return files.sort();
}

function main() {
    const args = parseArgs(process.argv);
    if (!args.input) {
        console.error('[Analyzer] 用法: node scripts/sprite-analyzer.js <png文件或目录> [--grid=WxH] [--output=report.json] [--threshold=N] [--min-area=N]');
        process.exit(1);
    }

    const inputFull = path.resolve(args.input);
    if (!fs.existsSync(inputFull)) {
        console.error(`[Analyzer] 路径不存在: ${inputFull}`);
        process.exit(1);
    }

    const files = collectPngFiles(inputFull);
    if (files.length === 0) {
        console.error('[Analyzer] 未找到 PNG 文件');
        process.exit(1);
    }

    console.log(`[Analyzer] 共发现 ${files.length} 个 PNG 文件`);
    const reports = files.map(f => {
        console.log(`[Analyzer] 分析中: ${f}`);
        return analyzeFile(f, args.grid, args.threshold, args.minArea);
    });

    const report = {
        generatedAt: new Date().toISOString(),
        grid: args.grid ? { frameWidth: args.grid[0], frameHeight: args.grid[1] } : null,
        threshold: args.threshold,
        minArea: args.minArea,
        files: reports
    };

    const outPath = args.output
        ? path.resolve(args.output)
        : path.join(process.cwd(), 'sprite-analysis-report.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(`[Analyzer] 报告已保存: ${outPath}`);
    for (const r of reports) {
        const items = r.frames || r.components || [];
        const sum = r.summary;
        console.log(`  - ${path.basename(r.file)}: ${items.length} 个对象` +
            (sum ? `, 平均尺寸 ${sum.avgWidth.toFixed(1)}x${sum.avgHeight.toFixed(1)}` : ''));
    }
}

main();
