#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..', '..');
const sourcePath = path.join(
    scriptDir,
    '_wall_battlement_20260828',
    'rune_decal_concept_imagegen.png'
);
const outputDir = path.join(projectDir, 'assets', 'terrain');
const reviewPath = path.join(
    scriptDir,
    '_wall_battlement_20260828',
    'tier_renders',
    'wall_battlement_rune_decal_review.png'
);
const metadataPath = path.join(
    scriptDir,
    '_wall_battlement_20260828',
    'rune_decal_metadata.json'
);

const DECAL_WIDTH = 128;
const DECAL_HEIGHT = 160;
const INNER_PADDING = 12;
const ALPHA_THRESHOLD = 4;

function alphaBounds(source, region) {
    let minX = region.x1;
    let minY = region.y1;
    let maxX = region.x0 - 1;
    let maxY = region.y0 - 1;
    for (let y = region.y0; y < region.y1; y += 1) {
        for (let x = region.x0; x < region.x1; x += 1) {
            const alpha = source.data[(y * source.width + x) * 4 + 3];
            if (alpha <= ALPHA_THRESHOLD) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (maxX < minX || maxY < minY) {
        throw new Error(`No visible rune pixels in quadrant ${JSON.stringify(region)}`);
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function sourcePixel(source, x, y) {
    const sx = Math.max(0, Math.min(source.width - 1, x));
    const sy = Math.max(0, Math.min(source.height - 1, y));
    const offset = (sy * source.width + sx) * 4;
    return [
        source.data[offset],
        source.data[offset + 1],
        source.data[offset + 2],
        source.data[offset + 3],
    ];
}

function samplePremultiplied(source, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const samples = [
        [sourcePixel(source, x0, y0), (1 - tx) * (1 - ty)],
        [sourcePixel(source, x0 + 1, y0), tx * (1 - ty)],
        [sourcePixel(source, x0, y0 + 1), (1 - tx) * ty],
        [sourcePixel(source, x0 + 1, y0 + 1), tx * ty],
    ];
    let alpha = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const [rgba, weight] of samples) {
        const a = rgba[3] / 255;
        alpha += a * weight;
        red += rgba[0] * a * weight;
        green += rgba[1] * a * weight;
        blue += rgba[2] * a * weight;
    }
    if (alpha <= 1e-6) return [0, 0, 0, 0];
    return [
        Math.round(red / alpha),
        Math.round(green / alpha),
        Math.round(blue / alpha),
        Math.round(alpha * 255),
    ];
}

function normalizeRune(source, bounds) {
    const canvas = new PNG({ width: DECAL_WIDTH, height: DECAL_HEIGHT });
    const availableW = DECAL_WIDTH - INNER_PADDING * 2;
    const availableH = DECAL_HEIGHT - INNER_PADDING * 2;
    const scale = Math.min(availableW / bounds.w, availableH / bounds.h);
    const drawW = bounds.w * scale;
    const drawH = bounds.h * scale;
    const drawX = (DECAL_WIDTH - drawW) * 0.5;
    const drawY = (DECAL_HEIGHT - drawH) * 0.5;
    for (let y = 0; y < DECAL_HEIGHT; y += 1) {
        for (let x = 0; x < DECAL_WIDTH; x += 1) {
            const offset = (y * DECAL_WIDTH + x) * 4;
            if (x < drawX || x >= drawX + drawW || y < drawY || y >= drawY + drawH) {
                canvas.data[offset] = 0;
                canvas.data[offset + 1] = 0;
                canvas.data[offset + 2] = 0;
                canvas.data[offset + 3] = 0;
                continue;
            }
            const sx = bounds.x + (x - drawX + 0.5) / scale - 0.5;
            const sy = bounds.y + (y - drawY + 0.5) / scale - 0.5;
            const rgba = samplePremultiplied(source, sx, sy);
            canvas.data[offset] = rgba[0];
            canvas.data[offset + 1] = rgba[1];
            canvas.data[offset + 2] = rgba[2];
            canvas.data[offset + 3] = rgba[3];
        }
    }
    return canvas;
}

function composite(review, decal, offsetX, offsetY) {
    for (let y = 0; y < decal.height; y += 1) {
        for (let x = 0; x < decal.width; x += 1) {
            const sourceOffset = (y * decal.width + x) * 4;
            const targetOffset = ((offsetY + y) * review.width + offsetX + x) * 4;
            const alpha = decal.data[sourceOffset + 3] / 255;
            for (let channel = 0; channel < 3; channel += 1) {
                review.data[targetOffset + channel] = Math.round(
                    decal.data[sourceOffset + channel] * alpha
                    + review.data[targetOffset + channel] * (1 - alpha)
                );
            }
            review.data[targetOffset + 3] = 255;
        }
    }
}

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const middleX = Math.floor(source.width / 2);
const middleY = Math.floor(source.height / 2);
const quadrants = [
    { x0: 0, y0: 0, x1: middleX, y1: middleY },
    { x0: middleX, y0: 0, x1: source.width, y1: middleY },
    { x0: 0, y0: middleY, x1: middleX, y1: source.height },
    { x0: middleX, y0: middleY, x1: source.width, y1: source.height },
];

fs.mkdirSync(outputDir, { recursive: true });
const decals = quadrants.map((quadrant, index) => {
    const bounds = alphaBounds(source, quadrant);
    const decal = normalizeRune(source, bounds);
    const filename = `wall_battlement_rune_decal_${index + 1}.png`;
    fs.writeFileSync(path.join(outputDir, filename), PNG.sync.write(decal));
    return { decal, filename, sourceBounds: bounds };
});

const review = new PNG({ width: 4 * 160 + 32, height: 208 });
for (let y = 0; y < review.height; y += 1) {
    for (let x = 0; x < review.width; x += 1) {
        const offset = (y * review.width + x) * 4;
        const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) & 1) === 0;
        review.data[offset] = checker ? 25 : 32;
        review.data[offset + 1] = checker ? 31 : 38;
        review.data[offset + 2] = checker ? 38 : 46;
        review.data[offset + 3] = 255;
    }
}
for (let index = 0; index < decals.length; index += 1) {
    composite(review, decals[index].decal, 24 + index * 160, 24);
}
fs.writeFileSync(reviewPath, PNG.sync.write(review));

fs.writeFileSync(metadataPath, `${JSON.stringify({
    source: path.relative(projectDir, sourcePath).replaceAll('\\', '/'),
    sourceDimensions: [source.width, source.height],
    outputDimensions: [DECAL_WIDTH, DECAL_HEIGHT],
    selection: 'four alpha-bounded quadrants normalized with premultiplied-alpha bilinear sampling',
    variants: decals.map(({ filename, sourceBounds }, index) => ({
        id: index + 1,
        file: `assets/terrain/${filename}`,
        sourceBounds,
    })),
}, null, 2)}\n`);

console.log(`wrote ${decals.length} wall battlement rune decals`);
console.log(`review: ${reviewPath}`);
