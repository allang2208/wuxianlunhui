#!/usr/bin/env node
/** Tight-crop staged battlement renders and build high/low + assembly review sheets. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(project, 'tools', 'ai-gen', '_wall_battlement_20260828');
const sourceDir = path.join(root, 'tier_renders');
const stagedDir = path.join(sourceDir, 'staged');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dimensions = manifest.wallBattlement.dimensions;
const runtimeCropBoxes = manifest.wallBattlement.runtimeCropBoxes || {};
const allTiers = ['sand', 'brick', 'black_brick', 'concrete', 'rune'];
const selectedTier = process.argv[2] || null;
if (selectedTier && !allTiers.includes(selectedTier)) {
    throw new Error(`unknown wall battlement tier: ${selectedTier}`);
}
const tiers = selectedTier ? [selectedTier] : allTiers;
const variants = ['high', 'low'];

function readPng(file) {
    return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
}

function alphaBounds(png, threshold = 4) {
    let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            const alpha = png.data[(y * png.width + x) * 4 + 3];
            if (alpha <= threshold) continue;
            x0 = Math.min(x0, x); y0 = Math.min(y0, y);
            x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    }
    if (x1 < x0 || y1 < y0) throw new Error('empty alpha image');
    return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function crop(source, bounds, padding = 4) {
    const x0 = Math.max(0, bounds.x0 - padding);
    const y0 = Math.max(0, bounds.y0 - padding);
    const x1 = Math.min(source.width, bounds.x1 + padding);
    const y1 = Math.min(source.height, bounds.y1 + padding);
    const output = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = 0; y < output.height; y++) {
        for (let x = 0; x < output.width; x++) {
            const src = ((y0 + y) * source.width + x0 + x) * 4;
            const dst = (y * output.width + x) * 4;
            const alpha = source.data[src + 3];
            output.data[dst] = alpha ? source.data[src] : 0;
            output.data[dst + 1] = alpha ? source.data[src + 1] : 0;
            output.data[dst + 2] = alpha ? source.data[src + 2] : 0;
            output.data[dst + 3] = alpha;
        }
    }
    return { output, cropBox: [x0, y0, x1, y1] };
}

function sample(source, sx, sy, channel) {
    const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const tx = sx - x0, ty = sy - y0;
    const at = (x, y) => source.data[(y * source.width + x) * 4 + channel];
    return Math.round(at(x0, y0) * (1 - tx) * (1 - ty)
        + at(x1, y0) * tx * (1 - ty)
        + at(x0, y1) * (1 - tx) * ty
        + at(x1, y1) * tx * ty);
}

function contain(source, width, height, padding = 8) {
    const output = new PNG({ width, height });
    output.data.fill(0);
    const scale = Math.min((width - padding * 2) / source.width,
        (height - padding * 2) / source.height);
    const targetW = Math.max(1, Math.round(source.width * scale));
    const targetH = Math.max(1, Math.round(source.height * scale));
    const ox = Math.floor((width - targetW) / 2);
    const oy = Math.floor((height - targetH) / 2);
    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            const sx = (x + 0.5) / scale - 0.5;
            const sy = (y + 0.5) / scale - 0.5;
            const dst = ((oy + y) * width + ox + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                output.data[dst + channel] = sample(source, sx, sy, channel);
            }
        }
    }
    return output;
}

function reviewGrid(images, columns, rows, panelW, panelH) {
    const gap = 10;
    const output = new PNG({
        width: columns * panelW + (columns + 1) * gap,
        height: rows * panelH + (rows + 1) * gap,
    });
    for (let i = 0; i < output.data.length; i += 4) {
        output.data[i] = 24; output.data[i + 1] = 27;
        output.data[i + 2] = 31; output.data[i + 3] = 255;
    }
    images.forEach((image, index) => {
        const panel = contain(image, panelW, panelH);
        const ox = gap + (index % columns) * (panelW + gap);
        const oy = gap + Math.floor(index / columns) * (panelH + gap);
        for (let y = 0; y < panelH; y++) {
            for (let x = 0; x < panelW; x++) {
                const src = (y * panelW + x) * 4;
                const dst = ((oy + y) * output.width + ox + x) * 4;
                const alpha = panel.data[src + 3] / 255;
                for (let channel = 0; channel < 3; channel++) {
                    output.data[dst + channel] = Math.round(
                        panel.data[src + channel] * alpha
                        + output.data[dst + channel] * (1 - alpha));
                }
            }
        }
    });
    return output;
}

const isolatedReview = [];
const assemblyReview = [];
const twoPerWallReview = [];
for (const variant of variants) {
    for (const tier of tiers) {
        const sourcePath = path.join(sourceDir, `wall_battlement_${variant}_${tier}_raw.png`);
        const source = readPng(sourcePath);
        const visibleBounds = alphaBounds(source);
        const configuredCrop = runtimeCropBoxes[variant];
        const fixedBounds = Array.isArray(configuredCrop) && configuredCrop.length === 4
            ? {
                x0: configuredCrop[0], y0: configuredCrop[1],
                x1: configuredCrop[2], y1: configuredCrop[3],
            }
            : null;
        if (fixedBounds && (visibleBounds.x0 < fixedBounds.x0
            || visibleBounds.y0 < fixedBounds.y0
            || visibleBounds.x1 > fixedBounds.x1
            || visibleBounds.y1 > fixedBounds.y1)) {
            throw new Error(`${variant}/${tier} exceeds canonical runtime crop`);
        }
        const { output, cropBox } = fixedBounds
            ? crop(source, fixedBounds, 0)
            : crop(source, visibleBounds);
        const stagedPath = path.join(stagedDir, `wall_battlement_${variant}_${tier}.png`);
        writePng(stagedPath, output);
        fs.writeFileSync(path.join(stagedDir,
            `wall_battlement_${variant}_${tier}.json`), `${JSON.stringify({
                variant,
                tier,
                source: path.relative(project, sourcePath).replaceAll('\\', '/'),
                stagedOutput: path.relative(project, stagedPath).replaceAll('\\', '/'),
                cropBox,
                fileSize: [output.width, output.height],
                modelFootprint: [dimensions.segmentSide, dimensions.segmentSide],
                modelFootprintSide: dimensions.segmentSide,
                logicalFootprintAreaCells: (dimensions.segmentSide * dimensions.segmentSide)
                    / (dimensions.cell * dimensions.cell),
                placementRole: 'attach_to_standard_wall_outer_edge',
                standardWallHeight: dimensions.wallHeight,
                totalHeight: dimensions[`${variant}Height`],
                heightAboveWall: dimensions[`${variant}Height`] - dimensions.wallHeight,
                visualTotalHeight: dimensions[`visual${variant[0].toUpperCase()}${variant.slice(1)}Height`]
                    || dimensions[`${variant}Height`],
                runtimeStatus: 'integrated_runtime',
            }, null, 2)}\n`);
        isolatedReview.push(output);
    }
}

for (const tier of tiers) {
    const source = readPng(path.join(sourceDir,
        `wall_battlement_${tier}_assembly_raw.png`));
    const { output } = crop(source, alphaBounds(source));
    const stagedPath = path.join(stagedDir, `wall_battlement_${tier}_assembly.png`);
    writePng(stagedPath, output);
    assemblyReview.push(output);

    const fitSource = readPng(path.join(sourceDir,
        `wall_battlement_${tier}_two_per_wall_raw.png`));
    const { output: fitOutput } = crop(fitSource, alphaBounds(fitSource));
    const fitStagedPath = path.join(stagedDir,
        `wall_battlement_${tier}_two_per_wall.png`);
    writePng(fitStagedPath, fitOutput);
    twoPerWallReview.push(fitOutput);
}

const reviewSuffix = selectedTier ? `_${selectedTier}` : '';
writePng(path.join(sourceDir, `wall_battlement_tier_review${reviewSuffix}.png`),
    reviewGrid(isolatedReview, tiers.length, 2, 180, 210));
writePng(path.join(sourceDir, `wall_battlement_assembly_review${reviewSuffix}.png`),
    reviewGrid(assemblyReview, tiers.length, 1, 230, 190));
writePng(path.join(sourceDir, `wall_battlement_two_per_wall_review${reviewSuffix}.png`),
    reviewGrid(twoPerWallReview, tiers.length, 1, 230, 190));
console.log(JSON.stringify({
    isolatedReview: path.join(sourceDir, `wall_battlement_tier_review${reviewSuffix}.png`),
    assemblyReview: path.join(sourceDir, `wall_battlement_assembly_review${reviewSuffix}.png`),
    twoPerWallReview: path.join(sourceDir, `wall_battlement_two_per_wall_review${reviewSuffix}.png`),
    stagedDir,
}, null, 2));
