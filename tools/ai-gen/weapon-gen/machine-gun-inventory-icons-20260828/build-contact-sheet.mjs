import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const CELL = 512;
const COLS = 4;
const BG_A = [38, 43, 49];
const BG_B = [55, 62, 70];

function readPng(filePath) {
    return PNG.sync.read(fs.readFileSync(filePath));
}

function alphaBounds(png) {
    let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            if (png.data[(y * png.width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

function putPixel(dst, x, y, rgba) {
    if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
    const i = (y * dst.width + x) * 4;
    const a = rgba[3] / 255;
    dst.data[i] = Math.round(rgba[0] * a + dst.data[i] * (1 - a));
    dst.data[i + 1] = Math.round(rgba[1] * a + dst.data[i + 1] * (1 - a));
    dst.data[i + 2] = Math.round(rgba[2] * a + dst.data[i + 2] * (1 - a));
    dst.data[i + 3] = 255;
}

function buildSheet(items, outPath) {
    const rows = Math.ceil(items.length / COLS);
    const sheet = new PNG({ width: COLS * CELL, height: rows * CELL });
    for (let y = 0; y < sheet.height; y += 1) {
        for (let x = 0; x < sheet.width; x += 1) {
            const c = ((Math.floor(x / 32) + Math.floor(y / 32)) & 1) ? BG_A : BG_B;
            const i = (y * sheet.width + x) * 4;
            sheet.data[i] = c[0];
            sheet.data[i + 1] = c[1];
            sheet.data[i + 2] = c[2];
            sheet.data[i + 3] = 255;
        }
    }

    items.forEach(({ path: filePath }, index) => {
        const png = readPng(filePath);
        const bounds = alphaBounds(png) || { minX: 0, minY: 0, maxX: png.width - 1, maxY: png.height - 1 };
        const bw = bounds.maxX - bounds.minX + 1;
        const bh = bounds.maxY - bounds.minY + 1;
        const scale = Math.min((CELL * 0.88) / bw, (CELL * 0.82) / bh);
        const dw = Math.max(1, Math.round(bw * scale));
        const dh = Math.max(1, Math.round(bh * scale));
        const cellX = (index % COLS) * CELL;
        const cellY = Math.floor(index / COLS) * CELL;
        const ox = cellX + Math.round((CELL - dw) / 2);
        const oy = cellY + Math.round((CELL - dh) / 2);
        for (let dy = 0; dy < dh; dy += 1) {
            const sy = bounds.minY + Math.min(bh - 1, Math.floor(dy / scale));
            for (let dx = 0; dx < dw; dx += 1) {
                const sx = bounds.minX + Math.min(bw - 1, Math.floor(dx / scale));
                const si = (sy * png.width + sx) * 4;
                putPixel(sheet, ox + dx, oy + dy, [
                    png.data[si], png.data[si + 1], png.data[si + 2], png.data[si + 3],
                ]);
            }
        }
        const marker = index + 1;
        for (let y = cellY + 12; y < cellY + 42; y += 1) {
            for (let x = cellX + 12; x < cellX + 42; x += 1) {
                const i = (y * sheet.width + x) * 4;
                sheet.data[i] = 190 + (marker * 17) % 65;
                sheet.data[i + 1] = 130 + (marker * 29) % 105;
                sheet.data[i + 2] = 70 + (marker * 41) % 145;
                sheet.data[i + 3] = 255;
            }
        }
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, PNG.sync.write(sheet));
}

const manifestPath = process.argv[2];
const outPath = process.argv[3];
if (!manifestPath || !outPath) {
    throw new Error('Usage: node build-contact-sheet.mjs <manifest.json> <output.png>');
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
buildSheet(manifest.items, outPath);
console.log(outPath);
