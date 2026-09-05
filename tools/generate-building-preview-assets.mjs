/**
 * Generate building-panel thumbnails and the precomputed visual-footprint manifest.
 *
 * Usage:
 *   node tools/generate-building-preview-assets.mjs
 *   node tools/generate-building-preview-assets.mjs --only tower
 *
 * Source PNGs and gameplay configuration remain authoritative. Generated files:
 *   assets/ui/building-thumbnails/<build-item-id>.png
 *   data/structure-ground-fits.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
    fitExplicitVisualToPrism,
    fitOpaqueGroundFootprint,
    fitOpaqueVisualToPrism,
    resolveConfiguredVisualFootprint,
    STRUCTURE_GROUND_FIT_ALGORITHM_VERSION,
} from '../src/world/structure-visual-anchor.js';

const ROOT = process.cwd();
const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 64;
const THUMBNAIL_PADDING = 3;
const NOMINAL_WIDTH = 256;
const NOMINAL_HEIGHT = 128;
const ALGORITHM_VERSION = STRUCTURE_GROUND_FIT_ALGORITHM_VERSION;
const ONLY_INDEX = process.argv.indexOf('--only');
const ONLY_ID = ONLY_INDEX >= 0 ? String(process.argv[ONLY_INDEX + 1] || '').trim() : '';
if (ONLY_INDEX >= 0 && !ONLY_ID) throw new Error('--only requires a target id');

const readJson = (relativePath) => JSON.parse(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
);
const producerBuildings = readJson('data/producer-buildings.json');
const minerCamp = readJson('data/hamster-miner-camp-building.json');
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
        displayWidth: Number.isFinite(fit.displayWidth) ? roundHalf(fit.displayWidth) : undefined,
        displayHeight: Number.isFinite(fit.displayHeight) ? roundHalf(fit.displayHeight) : undefined,
        groundCenterSourceX: Number.isFinite(fit.groundCenterSourceX)
            ? roundHalf(fit.groundCenterSourceX) : undefined,
        groundCenterSourceY: Number.isFinite(fit.groundCenterSourceY)
            ? roundHalf(fit.groundCenterSourceY) : undefined,
        sourceFootprintCenterX: Number.isFinite(fit.sourceFootprintCenterX)
            ? roundHalf(fit.sourceFootprintCenterX) : undefined,
        sourceFootprintCenterY: Number.isFinite(fit.sourceFootprintCenterY)
            ? roundHalf(fit.sourceFootprintCenterY) : undefined,
        sourceFootprintFrontY: Number.isFinite(fit.sourceFootprintFrontY)
            ? roundHalf(fit.sourceFootprintFrontY) : undefined,
        sourceFootprintHalfDepth: Number.isFinite(fit.sourceFootprintHalfDepth)
            ? roundHalf(fit.sourceFootprintHalfDepth) : undefined,
        sourceFootprintWidth: Number.isFinite(fit.sourceFootprintWidth)
            ? roundHalf(fit.sourceFootprintWidth) : undefined,
        sourceFootprintDepth: Number.isFinite(fit.sourceFootprintDepth)
            ? roundHalf(fit.sourceFootprintDepth) : undefined,
        mappedFootprintWidth: Number.isFinite(fit.mappedFootprintWidth)
            ? roundHalf(fit.mappedFootprintWidth) : undefined,
        mappedFootprintDepth: Number.isFinite(fit.mappedFootprintDepth)
            ? roundHalf(fit.mappedFootprintDepth) : undefined,
        groundSectionWidth: Number.isFinite(fit.groundSectionWidth)
            ? roundHalf(fit.groundSectionWidth) : undefined,
        sideOverhangAllowance: Number.isFinite(fit.sideOverhangAllowance)
            ? roundHalf(fit.sideOverhangAllowance) : undefined,
        actualSideOverhang: Number.isFinite(fit.actualSideOverhang)
            ? roundHalf(fit.actualSideOverhang) : undefined,
        bottomOverhangAllowance: Number.isFinite(fit.bottomOverhangAllowance)
            ? roundHalf(fit.bottomOverhangAllowance) : undefined,
        actualBottomOverhang: Number.isFinite(fit.actualBottomOverhang)
            ? roundHalf(fit.actualBottomOverhang) : undefined,
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
        const footprintCells = Number(cfg.footprintCells) === 4 ? 4 : 2;
        const nominalWidth = footprintCells * 128;
        const nominalHeight = footprintCells * 64;
        const pushVisual = (id, visual) => {
            if (!visual?.tex || !(visual.displayW > 0) || !(visual.displayH > 0)) return;
            targets.push({
                id,
                textureKey: visual.tex,
                sourcePath: visual.assetPath || terrainPath(visual.tex),
                displayWidth: visual.displayW,
                displayHeight: visual.displayH,
                nominalWidth,
                nominalHeight,
                constrainToPrism: visual.autoFootprint !== true,
                centerAdjustX: Number(visual.anchorAdjustX) || 0,
                centerAdjustY: Number(visual.anchorAdjustY) || 0,
                visualFootprint: resolveConfiguredVisualFootprint(
                    visual, nominalWidth, nominalHeight
                ),
            });
        };
        pushVisual(cfg.id, cfg);
        for (const tier of [...(cfg.buildingTiers || []), ...(cfg.recruitmentTiers || [])]) {
            pushVisual(tier.id || `${cfg.id}_level_${tier.level}`, tier.visual);
        }
    }
    targets.push(
        {
            id: minerCamp.id,
            textureKey: minerCamp.tex,
            sourcePath: terrainPath(minerCamp.tex),
            displayWidth: minerCamp.displayW,
            displayHeight: minerCamp.displayH,
            nominalWidth: NOMINAL_WIDTH,
            nominalHeight: NOMINAL_HEIGHT,
            constrainToPrism: true,
            centerAdjustX: Number(minerCamp.anchorAdjustX) || 0,
            centerAdjustY: Number(minerCamp.anchorAdjustY) || 0,
            visualFootprint: resolveConfiguredVisualFootprint(
                minerCamp, NOMINAL_WIDTH, NOMINAL_HEIGHT
            ),
        }
    );
    for (const level of population.house?.levels || []) {
        targets.push({
            id: `house_lv${level.level}`,
            textureKey: level.tex,
            sourcePath: terrainPath(level.tex),
            displayWidth: level.displayW,
            displayHeight: level.displayH,
            nominalWidth: NOMINAL_WIDTH,
            nominalHeight: NOMINAL_HEIGHT,
            constrainToPrism: true,
            centerAdjustX: Number(level.anchorAdjustX) || 0,
            centerAdjustY: Number(level.anchorAdjustY) || 0,
            visualFootprint: resolveConfiguredVisualFootprint(
                level, NOMINAL_WIDTH, NOMINAL_HEIGHT
            ),
        });
    }
    targets.push({
        id: 'defense_base_4x4',
        textureKey: 'defense_base',
        sourcePath: terrainPath('defense_base'),
        displayWidth: 440,
        displayHeight: 366,
        nominalWidth: 512,
        nominalHeight: 256,
        constrainToPrism: true,
        visualFootprint: {
            centerXRatio: 0.5,
            centerYRatio: 0.653005,
            widthRatio: 1,
            depthRatio: 0.699454,
            scaleMode: 'strict',
        },
    });
    const seen = new Set();
    return targets.filter((target) => {
        const key = [
            target.textureKey,
            target.displayWidth,
            target.displayHeight,
            target.nominalWidth,
            target.nominalHeight,
            target.constrainToPrism ? 'prism-body' : 'ground',
            target.visualFootprint ? 0 : (target.centerAdjustX || 0),
            target.visualFootprint ? 0 : (target.centerAdjustY || 0),
            target.visualFootprint ? JSON.stringify(target.visualFootprint) : '',
        ].join(':');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function thumbnailTargets() {
    const targets = [
        { id: 'tower', sourcePath: terrainPath('obstacle_defense_tower') },
        { id: 'cover_block', sourcePath: terrainPath('obstacle_block_sand') },
        {
            id: 'cover_block_sand',
            sourcePath: terrainPath('obstacle_block_sand'),
        },
        {
            id: 'cover_block_brick',
            sourcePath: terrainPath('obstacle_block_brick'),
        },
        {
            id: 'cover_block_black_brick',
            sourcePath: terrainPath('obstacle_block'),
        },
        {
            id: 'cover_block_concrete',
            sourcePath: terrainPath('obstacle_block_concrete'),
        },
        {
            id: 'cover_block_rune',
            sourcePath: terrainPath('obstacle_block_rune'),
        },
        { id: 'road', sourcePath: terrainPath('building_road') },
        { id: 'gate_4cell', sourcePath: terrainPath('gate_4cell') },
        { id: 'gate_4cell_sand', sourcePath: terrainPath('gate_4cell_sand') },
        { id: 'gate_4cell_brick', sourcePath: terrainPath('gate_4cell_brick') },
        { id: 'gate_4cell_black_brick', sourcePath: terrainPath('gate_4cell_black_brick') },
        { id: 'gate_4cell_concrete', sourcePath: terrainPath('gate_4cell_concrete') },
        { id: 'gate_4cell_rune', sourcePath: terrainPath('gate_4cell_rune') },
        { id: minerCamp.id, sourcePath: terrainPath(minerCamp.tex) },
        { id: 'wall_staircase', sourcePath: terrainPath('wall_stair_lower_e1_pos_sand') },
        { id: 'wall_staircase_sand', sourcePath: terrainPath('wall_stair_lower_e1_pos_sand') },
        { id: 'wall_staircase_brick', sourcePath: terrainPath('wall_stair_lower_e1_pos_brick') },
        { id: 'wall_staircase_black_brick', sourcePath: terrainPath('wall_stair_lower_e1_pos_black_brick') },
        { id: 'wall_staircase_concrete', sourcePath: terrainPath('wall_stair_lower_e1_pos_concrete') },
        { id: 'wall_staircase_rune', sourcePath: terrainPath('wall_stair_lower_e1_pos_rune') },
    ];
    for (const cfg of Object.values(producerBuildings)) {
        if (!cfg || typeof cfg !== 'object' || !cfg.id || cfg.playerBuildable === false) continue;
        const panelTexture = cfg.panelTex || cfg.tex;
        targets.push({
            id: cfg.id,
            sourcePath: cfg.panelTex
                ? terrainPath(panelTexture)
                : (cfg.assetPath || terrainPath(panelTexture)),
            outputPath: typeof cfg.thumbnailPath === 'string'
                && cfg.thumbnailPath.replaceAll('\\', '/').startsWith('assets/ui/building-thumbnails/')
                ? cfg.thumbnailPath.replaceAll('\\', '/')
                : null,
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

const allGroundFitTargets = groundFitTargets();
const selectedGroundFitTargets = ONLY_ID
    ? allGroundFitTargets.filter((target) => target.id === ONLY_ID)
    : allGroundFitTargets;
const generatedManifestEntries = [];
for (const target of selectedGroundFitTargets) {
    const source = existingSource(target.sourcePath, target.id);
    const png = PNG.sync.read(fs.readFileSync(source.absolute));
    const alphaAt = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    const options = {
        nominalWidth: target.nominalWidth,
        nominalHeight: target.nominalHeight,
        centerAdjustX: target.constrainToPrism && !target.visualFootprint
            ? target.centerAdjustX : 0,
        centerAdjustY: target.constrainToPrism && !target.visualFootprint
            ? target.centerAdjustY : 0,
        visualFootprint: target.constrainToPrism ? target.visualFootprint : null,
    };
    const fit = target.constrainToPrism
        ? (target.visualFootprint
            ? fitExplicitVisualToPrism(png.width, png.height, options)
            : fitOpaqueVisualToPrism(png.width, png.height, alphaAt, options))
        : fitOpaqueGroundFootprint(
            png.width,
            png.height,
            alphaAt,
            target.displayWidth,
            target.displayHeight,
            options
        );
    if (!fit) throw new Error(`${target.id}: alpha ground fit unavailable`);
    generatedManifestEntries.push({
        algorithmVersion: ALGORITHM_VERSION,
        id: target.id,
        textureKey: target.textureKey,
        frameName: '__BASE',
        sourcePath: source.relative,
        sourceWidth: png.width,
        sourceHeight: png.height,
        displayWidth: target.displayWidth,
        displayHeight: target.displayHeight,
        nominalWidth: target.nominalWidth,
        nominalHeight: target.nominalHeight,
        centerAdjustX: target.constrainToPrism && !target.visualFootprint
            ? target.centerAdjustX : 0,
        centerAdjustY: target.constrainToPrism && !target.visualFootprint
            ? target.centerAdjustY : 0,
        visualFootprint: target.constrainToPrism ? target.visualFootprint : null,
        fit: roundFit(fit),
    });
}

let manifestEntries = generatedManifestEntries;
if (ONLY_ID) {
    const previous = readJson('data/structure-ground-fits.json');
    const replacedIds = new Set(generatedManifestEntries.map((entry) => entry.id));
    manifestEntries = [
        ...(Array.isArray(previous.entries)
            ? previous.entries.filter((entry) => !replacedIds.has(entry.id))
            : []),
        ...generatedManifestEntries,
    ];
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
const allThumbnailTargets = thumbnailTargets();
const selectedThumbnailTargets = ONLY_ID
    ? allThumbnailTargets.filter((target) => target.id === ONLY_ID)
    : allThumbnailTargets;
if (ONLY_ID && selectedGroundFitTargets.length === 0 && selectedThumbnailTargets.length === 0) {
    throw new Error(`unknown --only target: ${ONLY_ID}`);
}
for (const target of selectedThumbnailTargets) {
    const source = existingSource(target.sourcePath, target.id);
    const png = PNG.sync.read(fs.readFileSync(source.absolute));
    const thumbnail = createThumbnail(png);
    const outputPath = target.outputPath
        ? path.join(ROOT, target.outputPath)
        : path.join(thumbnailDirectory, `${target.id}.png`);
    if (writeIfChanged(outputPath, PNG.sync.write(thumbnail))) changedThumbnails++;
}

console.log(
    `building preview assets: ${manifestEntries.length} ground fits `
    + `(${manifestChanged ? 'manifest updated' : 'manifest unchanged'}), `
    + `${changedThumbnails} thumbnails updated`
);
