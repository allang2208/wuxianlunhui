#!/usr/bin/env node
/**
 * Audit standard building explicit visual-footprint calibration.
 *
 * Usage:
 *   node tools/calibrate-building-footprints.mjs
 *   node tools/calibrate-building-footprints.mjs --check
 *
 * The tool never edits files. It reports the unified prism-constrained display
 * size and anchor used by runtime. Explicit normalized center/width/depth markers
 * are authoritative; alpha fitting is only a fallback for uncalibrated art.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
    fitExplicitVisualToPrism,
    fitOpaqueVisualToPrism,
    resolveConfiguredVisualFootprint,
} from '../src/world/structure-visual-anchor.js';

const ROOT = process.cwd();
const TARGET_W = 256;
const TARGET_H = 128;
const CHECK = process.argv.includes('--check');
const readJson = (relativePath) => JSON.parse(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
);
const configs = readJson('data/producer-buildings.json');
const minerCamp = readJson('data/hamster-miner-camp-building.json');
const population = readJson('data/population-economy.json');
let failed = 0;

function auditTargets() {
    const targets = [];
    for (const [id, cfg] of Object.entries(configs)) {
        if (!cfg || typeof cfg !== 'object' || !cfg.tex || !(cfg.displayW > 0) || !(cfg.displayH > 0)) continue;
        targets.push({
            id,
            textureKey: cfg.tex,
            sourcePath: cfg.assetPath || `assets/terrain/${cfg.tex}.png`,
            nominalWidth: TARGET_W,
            nominalHeight: TARGET_H,
            constrainToPrism: cfg.autoFootprint !== true,
            centerAdjustX: Number(cfg.anchorAdjustX) || 0,
            centerAdjustY: Number(cfg.anchorAdjustY) || 0,
            visualFootprint: resolveConfiguredVisualFootprint(cfg, TARGET_W, TARGET_H),
        });
    }
    for (const cfg of [minerCamp]) {
        targets.push({
            id: cfg.id,
            textureKey: cfg.tex,
            sourcePath: `assets/terrain/${cfg.tex}.png`,
            nominalWidth: TARGET_W,
            nominalHeight: TARGET_H,
            constrainToPrism: true,
            centerAdjustX: Number(cfg.anchorAdjustX) || 0,
            centerAdjustY: Number(cfg.anchorAdjustY) || 0,
            visualFootprint: resolveConfiguredVisualFootprint(cfg, TARGET_W, TARGET_H),
        });
    }
    for (const level of population.house?.levels || []) {
        targets.push({
            id: `house_lv${level.level}`,
            textureKey: level.tex,
            sourcePath: `assets/terrain/${level.tex}.png`,
            nominalWidth: TARGET_W,
            nominalHeight: TARGET_H,
            constrainToPrism: true,
            centerAdjustX: Number(level.anchorAdjustX) || 0,
            centerAdjustY: Number(level.anchorAdjustY) || 0,
            visualFootprint: resolveConfiguredVisualFootprint(level, TARGET_W, TARGET_H),
        });
    }
    targets.push({
        id: 'defense_base_4x4',
        textureKey: 'defense_base',
        sourcePath: 'assets/terrain/defense_base.png',
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

    // 审计按配置项逐栋报告；即使多级房屋暂时复用同一纹理，也不能因派生清单去重而漏项。
    return targets;
}

function formatBounds(bounds) {
    if (!bounds) return 'n/a';
    return `${bounds.minX},${bounds.minY}..${bounds.maxX},${bounds.maxY}`;
}

for (const target of auditTargets()) {
    if (!target.constrainToPrism) {
        console.log(`SKIP ${target.id}: explicit autoFootprint uses legacy alpha-ground fit`);
        continue;
    }
    const file = path.join(ROOT, target.sourcePath);
    if (!fs.existsSync(file)) {
        console.log(`FAIL ${target.id}: missing source ${target.sourcePath}`);
        failed++;
        continue;
    }
    const png = PNG.sync.read(fs.readFileSync(file));
    const alphaAt = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    const options = {
        nominalWidth: target.nominalWidth,
        nominalHeight: target.nominalHeight,
        centerAdjustX: target.centerAdjustX,
        centerAdjustY: target.centerAdjustY,
        visualFootprint: target.visualFootprint,
    };
    const fit = target.visualFootprint
        ? fitExplicitVisualToPrism(png.width, png.height, options)
        : fitOpaqueVisualToPrism(png.width, png.height, alphaAt, options);
    if (!fit) {
        console.log(`FAIL ${target.id}: alpha ground fit unavailable`);
        failed++;
        continue;
    }
    const ok = fit.prismConstrained
        && fit.sourceRole === 'structure-body'
        && fit.alignmentMode === (target.visualFootprint
            ? 'explicit-footprint-center' : 'footprint-center-locked')
        && fit.centerLocked === true
        && fit.sizeMatchedToFootprint === true
        && Math.abs(fit.collisionWidth - target.nominalWidth) <= 0.01
        && Math.abs(fit.collisionHeight - target.nominalHeight) <= 0.01
        && Math.abs((fit.mappedFootprintWidth
            ?? (fit.groundSectionWidth * fit.uniformScale)) - target.nominalWidth) <= 0.01
        && Math.abs((fit.mappedFootprintDepth ?? target.nominalHeight)
            - target.nominalHeight) <= 0.01
        && fit.scaleLimitedByOuterBounds === false
        && fit.scaleLimitedByBottom === false
        && Number.isFinite(fit.displayWidth)
        && Number.isFinite(fit.displayHeight)
        && Number.isFinite(fit.footOffsetY)
        && Number.isFinite(fit.groundCenterSourceX)
        && Number.isFinite(fit.groundCenterSourceY)
        && (fit.explicitCalibration === true || (
            fit.alphaBounds?.minX >= 0
            && fit.alphaBounds?.minY >= 0
            && fit.alphaBounds?.maxX <= png.width
            && fit.alphaBounds?.maxY <= png.height
            && Number.isFinite(fit.supportLocalX)
            && fit.actualBottomOverhang <= fit.bottomOverhangAllowance + 0.01
            && fit.selectedComponentCount >= 1
        ));
    const discarded = Number(fit.discardedAlphaPixels) || 0;
    const componentNote = fit.componentCount > 1
        ? `, components ${fit.selectedComponentCount}/${fit.componentCount}, discarded ${discarded}`
        : '';
    const boundsNote = discarded > 0
        ? `, alpha raw ${formatBounds(fit.rawAlphaBounds)} -> body ${formatBounds(fit.alphaBounds)}`
        : '';
    console.log(`${ok ? 'PASS' : 'WARN'} ${target.id}: `
        + `prism ${fit.collisionWidth.toFixed(1)}×${fit.collisionHeight.toFixed(1)}, `
        + `bottom ${fit.footOffsetY.toFixed(1)}, offsetX ${fit.visualOffsetX.toFixed(1)}, `
        + `display ${fit.displayWidth.toFixed(1)}×${fit.displayHeight.toFixed(1)}`
        + `, footprint-center ${fit.sourceFootprintCenterX.toFixed(1)},${fit.sourceFootprintCenterY.toFixed(1)}`
        + `, mapped ${(fit.mappedFootprintWidth ?? fit.collisionWidth).toFixed(1)}`
        + `×${(fit.mappedFootprintDepth ?? fit.collisionHeight).toFixed(1)}`
        + `${fit.explicitCalibration ? ', explicit' : ''}`
        + componentNote
        + boundsNote);
    if (CHECK && !ok) failed++;
}

process.exit(failed ? 1 : 0);
