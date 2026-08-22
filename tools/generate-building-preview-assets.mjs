/**
 * Generate the derived building-panel thumbnails and the precomputed alpha-ground-fit manifest.
 *
 * Usage:
 *   node tools/generate-building-preview-assets.mjs
 *
 * Source PNGs and gameplay configuration remain authoritative. Generated files:
 *   assets/ui/building-thumbnails/<build-item-id>.png
 *   data/structure-ground-fits.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fitOpaqueGroundFootprint } from '../src/world/structure-visual-anchor.js';

const ROOT = process.cwd();
const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 64;
const THUMBNAIL_PADDING = 3;
const NOMINAL_WIDTH = 256;
const NOMINAL_HEIGHT = 128;
const ALGORITHM_VERSION = 1;

const readJson = (relativePath) => JSON.parse(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
);
const producerBuildings = readJson('data/producer-buildings.json');
const minerCamp = readJson('data/hamster-miner-camp-building.json');
const barracks = readJson('data/hamster-barracks-building.json');
const population = readJson('data/population-economy.json');

function terrainPath(textureKey) {
    return `assets/terrain/${textureKey}.png`;
}

function existingSource(relativePath, label) {
    const normalized = relativePath.replaceAll('\\', '/');
    const absolute = path.join(ROOT, normalized);
    if (!fs.existsSync(absolute)) {
        throw new Error(`${label}: missing source ${normalized}`);
    }
    return { relative: normalized, absolute };
}

function roundHalf(value) {
    return Math.round((Number(value) || 0) * 2) / 2;
}

function roundFit(fit) {
    return {
        ...fit,
        visualOffsetX: roundHalf(fit.visualOffsetX),
        footOffsetY: roundHalf(fit.footOffsetY),
        leftX: roundHalf(fit.leftX),
        rightX: roundHalf(fit.rightX),
        centerX: roundHalf(fit.centerX),
        centerY: roundHalf(fit.centerY),
        collisionWidth: roundHalf(fit.collisionWidth),
        collisionHeight: roundHalf(fit.collisionHeight),
        collisionRadius: roundHalf(fit.collisionRadius),
        localVertices: fit.localVertices.map((point) => ({
            ...point,
            x: roundHalf(point.x),
            y: roundHalf(point.y),
        })),
        contactPolygon: (fit.contactPolygon || fit.localVertices).map((point) => ({
            ...point,
            x: roundHalf(point.x),
            y: roundHalf(point.y),
        })),
    };
}

function groundFitTargets() {
    const targets = [];
    for (const cfg of Object.values(producerBuildings)) {
        if (!cfg || typeof cfg !== 'object' || !cfg.tex || !(cfg.displayW > 0) || !(cfg.displayH > 0)) continue;
        targets.push({
            id: cfg.id,
            textureKey: cfg.tex,
            sourcePath: cfg.assetPath || terrainPath(cfg.tex),
            displayWidth: cfg.displayW,
            displayHeight: cfg.displayH,
        });
    }
    targets.push(
        {
            id: minerCamp.id,
            textureKey: minerCamp.tex,
            sourcePath: terrainPath(minerCamp.tex),
            displayWidth: minerCamp.displayW,
            displayHeight: minerCamp.displayH,
        },
        {
            id: barracks.id,
            textureKey: barracks.tex,
            sourcePath: terrainPath(barracks.tex),
            displayWidth: barracks.displayW,
            displayHeight: barracks.displayH,
        }
    );
    for (const level of population.house?.levels || []) {
        targets.push({
            id: `house_lv${level.level}`,
            textureKey: level.tex,
            sourcePath: terrainPath(level.tex),
            displayWidth: level.displayW,
            displayHeight: level.displayH,
        });
    }
    const seen = new Set();
    return targets.filter((target) => {
        const key = [
            target.textureKey,
            target.displayWidth,
            target.displayHeight,
            NOMINAL_WIDTH,
            NOMINAL_HEIGHT,
        ].join(':');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function thumbnailTargets() {
    const targets = [
        { id: 'tower', sourcePath: terrainPath('obstacle_defense_tower') },
        { id: 'cover_block', sourcePath: terrainPath('obstacle_block') },
        { id: 'road', sourcePath: terrainPath('building_road') },
        { id: 'gate_4cell', sourcePath: terrainPath('gate_4cell') },
        { id: minerCamp.id, sourcePath: terrainPath(minerCamp.tex) },
        { id: barracks.id, sourcePath: terrainPath(barracks.tex) },
        { id: 'wall_staircase', sourcePath: terrainPath('wall_stair_lower_e1_pos') },
    ];
    for (const cfg of Object.values(producerBuildings)) {
        if (!cfg || typeof cfg !== 'object' || !cfg.id || cfg.playerBuildable === false) continue;
        const panelTexture = cfg.panelTex || cfg.tex;
        targets.push({
            id: cfg.id,
            sourcePath: cfg.panelTex
                ? terrainPath(panelTexture)
                : (cfg.assetPath || terrainPath(panelTexture)),
        });
    }
    return targets;
}

function alphaBounds(png) {
    let minX = png.width;
    let minY = png.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            const alpha = png.data[(y * png.width + x) * 4 + 3];
            if (alpha < 8) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    return maxX >= minX && maxY >= minY
        ? { minX, minY, maxX, maxY }
        : { minX: 0, minY: 0, maxX: png.width - 1, maxY: png.height - 1 };
}

function bilinearPremultiplied(png, x, y) {
    const x0 = Math.max(0, Math.min(png.width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(png.height - 1, Math.floor(y)));
    const x1 = Math.min(png.width - 1, x0 + 1);
    const y1 = Math.min(png.height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, x - x0));
    const ty = Math.max(0, Math.min(1, y - y0));
    const weights = [
        [(1 - tx) * (1 - ty), x0, y0],
        [tx * (1 - ty), x1, y0],
        [(1 - tx) * ty, x0, y1],
        [tx * ty, x1, y1],
    ];
    let alpha = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const [weight, px, py] of weights) {
        const index = (py * png.width + px) * 4;
        const a = png.data[index + 3] / 255;
        alpha += a * weight;
        red += png.data[index] * a * weight;
        green += png.data[index + 1] * a * weight;
        blue += png.data[index + 2] * a * weight;
    }
    if (alpha <= 1e-6) return [0, 0, 0, 0];
    return [
        Math.round(red / alpha),
        Math.round(green / alpha),
        Math.round(blue / alpha),
        Math.round(alpha * 255),
    ];
}

function createThumbnail(source) {
    const bounds = alphaBounds(source);
    const cropWidth = bounds.maxX - bounds.minX + 1;
    const cropHeight = bounds.maxY - bounds.minY + 1;
    const innerWidth = TARGET_WIDTH - THUMBNAIL_PADDING * 2;
    const innerHeight = TARGET_HEIGHT - THUMBNAIL_PADDING * 2;
    const scale = Math.min(innerWidth / cropWidth, innerHeight / cropHeight);
    const drawWidth = Math.max(1, Math.round(cropWidth * scale));
    const drawHeight = Math.max(1, Math.round(cropHeight * scale));
    const offsetX = Math.floor((TARGET_WIDTH - drawWidth) * 0.5);
    const offsetY = Math.floor((TARGET_HEIGHT - drawHeight) * 0.5);
    const output = new PNG({ width: TARGET_WIDTH, height: TARGET_HEIGHT });
    const sourcePerPixelX = cropWidth / drawWidth;
    const sourcePerPixelY = cropHeight / drawHeight;
    const sampleGrid = 4;

    for (let dy = 0; dy < drawHeight; dy++) {
        for (let dx = 0; dx < drawWidth; dx++) {
            let alpha = 0;
            let red = 0;
            let green = 0;
            let blue = 0;
            for (let sy = 0; sy < sampleGrid; sy++) {
                for (let sx = 0; sx < sampleGrid; sx++) {
                    const sourceX = bounds.minX + (dx + (sx + 0.5) / sampleGrid) * sourcePerPixelX - 0.5;
                    const sourceY = bounds.minY + (dy + (sy + 0.5) / sampleGrid) * sourcePerPixelY - 0.5;
                    const [r, g, b, a255] = bilinearPremultiplied(source, sourceX, sourceY);
                    const a = a255 / 255;
                    alpha += a;
                    red += r * a;
                    green += g * a;
                    blue += b * a;
                }
            }
            const samples = sampleGrid * sampleGrid;
            const averagedAlpha = alpha / samples;
            const outputIndex = ((offsetY + dy) * TARGET_WIDTH + offsetX + dx) * 4;
            if (averagedAlpha <= 1e-6) continue;
            output.data[outputIndex] = Math.round(red / alpha);
            output.data[outputIndex + 1] = Math.round(green / alpha);
            output.data[outputIndex + 2] = Math.round(blue / alpha);
            output.data[outputIndex + 3] = Math.round(averagedAlpha * 255);
        }
    }
    return output;
}

function writeIfChanged(filePath, buffer) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(buffer)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return true;
}

const manifestEntries = [];
for (const target of groundFitTargets()) {
    const source = existingSource(target.sourcePath, target.id);
    const png = PNG.sync.read(fs.readFileSync(source.absolute));
    const alphaAt = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    const fit = fitOpaqueGroundFootprint(
        png.width,
        png.height,
        alphaAt,
        target.displayWidth,
        target.displayHeight,
        { nominalWidth: NOMINAL_WIDTH, nominalHeight: NOMINAL_HEIGHT }
    );
    if (!fit) throw new Error(`${target.id}: alpha ground fit unavailable`);
    manifestEntries.push({
        algorithmVersion: ALGORITHM_VERSION,
        id: target.id,
        textureKey: target.textureKey,
        frameName: '__BASE',
        sourcePath: source.relative,
        sourceWidth: png.width,
        sourceHeight: png.height,
        displayWidth: target.displayWidth,
        displayHeight: target.displayHeight,
        nominalWidth: NOMINAL_WIDTH,
        nominalHeight: NOMINAL_HEIGHT,
        fit: roundFit(fit),
    });
}

manifestEntries.sort((a, b) => (
    a.textureKey.localeCompare(b.textureKey)
    || a.displayWidth - b.displayWidth
    || a.displayHeight - b.displayHeight
));
const manifest = Buffer.from(`${JSON.stringify({
    algorithmVersion: ALGORITHM_VERSION,
    entries: manifestEntries,
}, null, 2)}\n`);
const manifestPath = path.join(ROOT, 'data/structure-ground-fits.json');
const manifestChanged = writeIfChanged(manifestPath, manifest);

let changedThumbnails = 0;
const thumbnailDirectory = path.join(ROOT, 'assets/ui/building-thumbnails');
for (const target of thumbnailTargets()) {
    const source = existingSource(target.sourcePath, target.id);
    const png = PNG.sync.read(fs.readFileSync(source.absolute));
    const thumbnail = createThumbnail(png);
    const outputPath = path.join(thumbnailDirectory, `${target.id}.png`);
    if (writeIfChanged(outputPath, PNG.sync.write(thumbnail))) changedThumbnails++;
}

console.log(
    `building preview assets: ${manifestEntries.length} ground fits `
    + `(${manifestChanged ? 'manifest updated' : 'manifest unchanged'}), `
    + `${changedThumbnails} thumbnails updated`
);
