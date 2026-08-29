#!/usr/bin/env node
/** Tight-crop the adopted wall-tower renders into runtime assets and thumbnails. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceDir = path.join(project, 'tools', 'ai-gen', '_wall_tower_20260828', 'tier_renders');
const terrainDir = path.join(project, 'assets', 'terrain');
const thumbnailDir = path.join(project, 'assets', 'ui', 'building-thumbnails');
const tiers = ['sand', 'brick', 'black_brick', 'concrete', 'rune'];
const displayWidth = 360;

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

function cropPng(source, bounds, padding = 4) {
    const x0 = Math.max(0, bounds.x0 - padding);
    const y0 = Math.max(0, bounds.y0 - padding);
    const x1 = Math.min(source.width, bounds.x1 + padding);
    const y1 = Math.min(source.height, bounds.y1 + padding);
    const output = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = 0; y < output.height; y++) {
        for (let x = 0; x < output.width; x++) {
            const srcIndex = ((y0 + y) * source.width + (x0 + x)) * 4;
            const dstIndex = (y * output.width + x) * 4;
            const alpha = source.data[srcIndex + 3];
            output.data[dstIndex] = alpha ? source.data[srcIndex] : 0;
            output.data[dstIndex + 1] = alpha ? source.data[srcIndex + 1] : 0;
            output.data[dstIndex + 2] = alpha ? source.data[srcIndex + 2] : 0;
            output.data[dstIndex + 3] = alpha;
        }
    }
    return { output, cropBox: [x0, y0, x1, y1] };
}

function cropPngToBox(source, cropBox) {
    const [x0, y0, x1, y1] = cropBox;
    const output = new PNG({ width: x1 - x0, height: y1 - y0 });
    output.data.fill(0);
    for (let y = 0; y < output.height; y++) {
        for (let x = 0; x < output.width; x++) {
            const srcIndex = ((y0 + y) * source.width + x0 + x) * 4;
            const dstIndex = (y * output.width + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                output.data[dstIndex + channel] = source.data[srcIndex + channel];
            }
        }
    }
    return output;
}

function extractForeground(source, mask) {
    if (source.width !== mask.width || source.height !== mask.height) {
        throw new Error('wall tower foreground mask canvas does not match beauty render');
    }
    const output = new PNG({ width: source.width, height: source.height });
    output.data.fill(0);
    for (let i = 0; i < source.data.length; i += 4) {
        const alpha = mask.data[i + 3];
        if (!alpha) continue;
        // Copy the already composited beauty colour. Drawing the same colour over
        // the complete body is pixel-stable, including antialiased contact edges.
        output.data[i] = source.data[i];
        output.data[i + 1] = source.data[i + 1];
        output.data[i + 2] = source.data[i + 2];
        output.data[i + 3] = alpha;
    }
    return output;
}

function sampleBilinear(source, sx, sy, channel) {
    const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const tx = sx - x0, ty = sy - y0;
    const at = (x, y) => source.data[(y * source.width + x) * 4 + channel];
    return Math.round(
        at(x0, y0) * (1 - tx) * (1 - ty)
        + at(x1, y0) * tx * (1 - ty)
        + at(x0, y1) * (1 - tx) * ty
        + at(x1, y1) * tx * ty
    );
}

function contain(source, width, height, padding = 3) {
    const output = new PNG({ width, height });
    output.data.fill(0);
    const scale = Math.min((width - padding * 2) / source.width,
        (height - padding * 2) / source.height);
    const targetW = Math.max(1, Math.round(source.width * scale));
    const targetH = Math.max(1, Math.round(source.height * scale));
    const offsetX = Math.floor((width - targetW) / 2);
    const offsetY = Math.floor((height - targetH) / 2);
    for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
            const sx = (x + 0.5) / scale - 0.5;
            const sy = (y + 0.5) / scale - 0.5;
            const dstIndex = ((offsetY + y) * width + offsetX + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                output.data[dstIndex + channel] = sampleBilinear(source, sx, sy, channel);
            }
        }
    }
    return output;
}

for (const tier of tiers) {
    const sourcePath = path.join(sourceDir, `wall_tower_${tier}_raw.png`);
    const source = readPng(sourcePath);
    const sourceBounds = alphaBounds(source);
    const { output, cropBox } = cropPng(source, sourceBounds, 4);
    const runtimePath = path.join(terrainDir, `wall_tower_${tier}.png`);
    writePng(runtimePath, output);
    const foregroundMaskPath = path.join(
        sourceDir, `wall_tower_${tier}_foreground_mask_raw.png`);
    const foregroundSource = extractForeground(source, readPng(foregroundMaskPath));
    const foreground = cropPngToBox(foregroundSource, cropBox);
    const foregroundPath = path.join(
        terrainDir, `wall_tower_${tier}_foreground.png`);
    writePng(foregroundPath, foreground);
    writePng(path.join(thumbnailDir, `wall_tower_${tier}.png`), contain(output, 128, 64, 3));
    const localBounds = alphaBounds(output);
    const scale = displayWidth / output.width;
    const metadata = {
        tier,
        source: path.relative(project, sourcePath).replaceAll('\\', '/'),
        output: path.relative(project, runtimePath).replaceAll('\\', '/'),
        foregroundMaskSource: path.relative(project, foregroundMaskPath).replaceAll('\\', '/'),
        foregroundOutput: path.relative(project, foregroundPath).replaceAll('\\', '/'),
        materialSource: tier === 'rune'
            ? 'tools/ai-gen/_depth_templates/stair_tread_black_brick.png'
            : `tools/ai-gen/_depth_templates/stair_tread_${tier}.png`,
        ornamentSource: tier === 'rune'
            ? 'tools/ai-gen/render-wall-tower-tiers.py#add_rune_ornaments'
            : null,
        cropBox,
        fileSize: [output.width, output.height],
        alphaBBox: [localBounds.x0, localBounds.y0, localBounds.x1, localBounds.y1],
        foregroundAlphaBBox: (() => {
            const bounds = alphaBounds(foreground);
            return [bounds.x0, bounds.y0, bounds.x1, bounds.y1];
        })(),
        displayW: displayWidth,
        displayH: Math.round(output.height * scale),
        footOffsetY: Math.round((localBounds.y1 - output.height / 2) * scale),
        logicalFootprintCells: 2,
    };
    fs.writeFileSync(path.join(sourceDir, `wall_tower_${tier}_runtime.json`),
        `${JSON.stringify(metadata, null, 2)}\n`);
}

fs.copyFileSync(path.join(thumbnailDir, 'wall_tower_sand.png'),
    path.join(thumbnailDir, 'wall_tower.png'));
console.log(JSON.stringify({ tiers, displayWidth, terrainDir, thumbnailDir }, null, 2));
