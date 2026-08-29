#!/usr/bin/env node
/** Tight-crop the adopted battlement renders into runtime assets and metadata. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(project, 'tools', 'ai-gen', '_wall_battlement_20260828');
const sourceDir = path.join(root, 'tier_renders');
const metadataDir = path.join(sourceDir, 'runtime_metadata');
const terrainDir = path.join(project, 'assets', 'terrain');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dimensions = manifest.wallBattlement.dimensions;
const tiers = ['sand', 'brick', 'black_brick', 'concrete', 'rune'];
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

const outputs = [];
for (const variant of variants) {
    for (const tier of tiers) {
        const sourcePath = path.join(sourceDir, `wall_battlement_${variant}_${tier}_raw.png`);
        const source = readPng(sourcePath);
        const { output, cropBox } = crop(source, alphaBounds(source));
        const runtimePath = path.join(terrainDir, `wall_battlement_${variant}_${tier}.png`);
        writePng(runtimePath, output);
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(path.join(metadataDir,
            `wall_battlement_${variant}_${tier}.json`), `${JSON.stringify({
                variant,
                tier,
                source: path.relative(project, sourcePath).replaceAll('\\', '/'),
                output: path.relative(project, runtimePath).replaceAll('\\', '/'),
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
                runtimeStatus: 'integrated',
            }, null, 2)}\n`);
        outputs.push(path.relative(project, runtimePath).replaceAll('\\', '/'));
    }
}

console.log(JSON.stringify({
    outputs,
    metadataDir,
}, null, 2));
