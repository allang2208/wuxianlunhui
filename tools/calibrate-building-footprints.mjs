#!/usr/bin/env node
/**
 * Report 2×2 building texture calibration from the real alpha silhouette.
 *
 * Usage:
 *   node tools/calibrate-building-footprints.mjs
 *   node tools/calibrate-building-footprints.mjs --check
 *
 * The tool never edits files.  It reports the fitted visual footprint,
 * bottom lock and the next display size obtained by iterating toward a
 * 256×128 logical 2×2 diamond.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fitOpaqueGroundFootprint } from '../src/world/structure-visual-anchor.js';

const ROOT = process.cwd();
const TARGET_W = 256;
const TARGET_H = 128;
const CHECK = process.argv.includes('--check');
const configs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
let failed = 0;

for (const [id, cfg] of Object.entries(configs)) {
    if (!cfg || typeof cfg !== 'object' || !cfg.tex || !(cfg.displayW > 0) || !(cfg.displayH > 0)) continue;
    const file = path.join(ROOT, 'assets/terrain', `${cfg.tex}.png`);
    if (!fs.existsSync(file)) continue;
    const png = PNG.sync.read(fs.readFileSync(file));
    const alphaAt = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    let displayW = cfg.displayW;
    let displayH = cfg.displayH;
    let fit = null;
    for (let pass = 0; pass < 8; pass++) {
        fit = fitOpaqueGroundFootprint(
            png.width, png.height, alphaAt, displayW, displayH,
            { nominalWidth: TARGET_W, nominalHeight: TARGET_H }
        );
        if (!fit) break;
        displayW = Math.max(16, Math.round(displayW * TARGET_W / fit.collisionWidth));
        displayH = Math.max(16, Math.round(displayH * TARGET_H / fit.collisionHeight));
    }
    fit = fitOpaqueGroundFootprint(
        png.width, png.height, alphaAt, cfg.displayW, cfg.displayH,
        { nominalWidth: TARGET_W, nominalHeight: TARGET_H }
    );
    if (!fit) {
        console.log(`FAIL ${id}: alpha ground fit unavailable`);
        failed++;
        continue;
    }
    const ok = Math.abs(fit.collisionWidth - TARGET_W) <= 2
        && Math.abs(fit.collisionHeight - TARGET_H) <= 2;
    console.log(`${ok ? 'PASS' : 'WARN'} ${id}: `
        + `fit ${fit.collisionWidth.toFixed(1)}×${fit.collisionHeight.toFixed(1)}, `
        + `bottom ${fit.footOffsetY.toFixed(1)}, offsetX ${fit.visualOffsetX.toFixed(1)}, `
        + `next display ${displayW}×${displayH}`);
    if (CHECK && !ok) failed++;
}

process.exit(failed ? 1 : 0);
