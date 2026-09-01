#!/usr/bin/env node
/**
 * Build the runtime-only building shadow-caster manifest from foundation-free
 * Body Depth renders. The generated geometry never changes placement,
 * collision, pathfinding, visualFootprint, or source artwork.
 *
 * Usage:
 *   node tools/generate-building-shadow-casters.mjs --write
 *   node tools/generate-building-shadow-casters.mjs --write --write-if-source assets/terrain/example.png
 *   node tools/generate-building-shadow-casters.mjs --check
 *
 * A source is accepted only when:
 * - its runtime metadata points at the current formal terrain PNG;
 * - its Body Depth identity exactly matches the target texture/id/metadata;
 * - the Body Depth crop uses the same canvas/crop contract;
 * - an authoritative model/build manifest proves the foundation was excluded;
 * - the derived body contact polygon is finite and bounded by the configured
 *   visual foundation contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
    fitExplicitVisualToPrism,
    fitOpaqueGroundFootprint,
    resolveConfiguredVisualFootprint,
} from '../src/world/structure-visual-anchor.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_ROOT = path.join(ROOT, 'tools', 'ai-gen');
const OUTPUT_PATH = path.join(ROOT, 'data', 'structure-shadow-casters.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'building-shadow-caster-audit-2026-09-01.md');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
if (WRITE && CHECK) throw new Error('choose either --write or --check');
const writeIfSourceIndex = process.argv.indexOf('--write-if-source');
const WRITE_IF_SOURCE = writeIfSourceIndex >= 0
    ? process.argv[writeIfSourceIndex + 1] : null;
if (writeIfSourceIndex >= 0 && !WRITE_IF_SOURCE) {
    throw new Error('--write-if-source requires a path');
}
if (WRITE_IF_SOURCE && !WRITE) {
    throw new Error('--write-if-source requires --write');
}

const BODY_DEPTH_SUFFIX = '_body_depth.png';
const SHADOW_PROXY_SUFFIX = '_shadow_proxy.json';
const METADATA_SUFFIX = '_runtime_metadata.json';
const EXPORT_METADATA_NAME = 'export-metadata.json';
const DEPTH_ALPHA_THRESHOLD = 8;
const FOUNDATION_RING_MIN = 0.76;
const FOUNDATION_RING_MAX = 1.04;
const MIN_BODY_AREA_RATIO = 0.035;
const MAX_BODY_AREA_RATIO = 0.99;
const MAX_CONTACT_POINTS = 12;
const SKIP_DIRS = new Set([
    '.git', 'frames', 'video', 'previews', 'reports', 'node_modules',
]);
const SETTLEMENT_PACK_ROOT = path.join(
    TOOLS_ROOT,
    '_settlement_building_pack_20260821'
);
const SETTLEMENT_PACK_MANIFEST = fs.existsSync(path.join(SETTLEMENT_PACK_ROOT, 'manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(SETTLEMENT_PACK_ROOT, 'manifest.json'), 'utf8'))
    : { buildings: {} };

const readJson = (relativePath) => JSON.parse(
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
);

function slash(value) {
    return String(value || '').replaceAll('\\', '/');
}

function absoluteFromRoot(value) {
    if (!value) return null;
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT, value);
}

function comparablePath(value) {
    return slash(path.normalize(value || '')).toLowerCase();
}

function relativeToRoot(value) {
    return slash(path.relative(ROOT, value));
}

function walkFiles(root, accept) {
    const output = [];
    const visit = (directory) => {
        let items = [];
        try {
            items = fs.readdirSync(directory, { withFileTypes: true });
        } catch (_error) {
            return;
        }
        for (const item of items) {
            const full = path.join(directory, item.name);
            if (item.isDirectory()) {
                if (!SKIP_DIRS.has(item.name)) visit(full);
            } else if (item.isFile() && accept(item.name)) {
                output.push(full);
            }
        }
    };
    visit(root);
    return output;
}

function safePng(filePath) {
    try {
        return PNG.sync.read(fs.readFileSync(filePath));
    } catch (_error) {
        return null;
    }
}

function visualTarget(id, base, visual, group = 'producer') {
    if (!visual?.tex || !(visual.displayW > 0) || !(visual.displayH > 0)) return null;
    const footprintCells = Number(base?.footprintCells) === 4 ? 4 : 2;
    const nominalWidth = footprintCells * 128;
    const nominalHeight = footprintCells * 64;
    const sourcePath = slash(visual.assetPath || `assets/terrain/${visual.tex}.png`);
    return {
        id,
        group,
        textureKey: visual.tex,
        sourcePath,
        sourceAbsolute: path.resolve(ROOT, sourcePath),
        displayWidth: Number(visual.displayW),
        displayHeight: Number(visual.displayH),
        nominalWidth,
        nominalHeight,
        autoFootprint: visual.autoFootprint === true,
        visualFootprint: resolveConfiguredVisualFootprint(
            visual,
            nominalWidth,
            nominalHeight
        ),
        explicitShadowCaster: visual.shadowCaster || null,
    };
}

function collectTargets() {
    const producer = readJson('data/producer-buildings.json');
    const targets = [];
    for (const [id, config] of Object.entries(producer)) {
        if (!config || typeof config !== 'object' || !config.tex) continue;
        const base = visualTarget(id, config, config);
        if (base) targets.push(base);
        for (const groupName of ['buildingTiers', 'recruitmentTiers']) {
            for (const tier of config[groupName] || []) {
                if (!tier?.visual?.tex) continue;
                const merged = {
                    ...config,
                    ...tier.visual,
                    shadowCaster: Object.prototype.hasOwnProperty.call(tier.visual, 'shadowCaster')
                        ? tier.visual.shadowCaster : config.shadowCaster,
                };
                const target = visualTarget(
                    tier.id || `${id}_level_${tier.level}`,
                    config,
                    merged,
                    groupName
                );
                if (target) targets.push(target);
            }
        }
    }

    for (const [file, group] of [
        ['data/hamster-miner-camp-building.json', 'special'],
    ]) {
        if (!fs.existsSync(path.join(ROOT, file))) continue;
        const config = readJson(file);
        const target = visualTarget(config.id || path.basename(file, '.json'), config, config, group);
        if (target) targets.push(target);
    }

    if (fs.existsSync(path.join(ROOT, 'data/population-economy.json'))) {
        const population = readJson('data/population-economy.json');
        for (const level of population.house?.levels || []) {
            const target = visualTarget(
                `house_lv${level.level}`,
                { footprintCells: 2 },
                level,
                'population'
            );
            if (target) targets.push(target);
        }
    }

    const unique = new Map();
    for (const target of targets) {
        const key = [
            target.textureKey,
            target.displayWidth.toFixed(3),
            target.displayHeight.toFixed(3),
        ].join(':');
        if (!unique.has(key)) unique.set(key, target);
    }
    return [...unique.values()];
}

function loadRuntimeMetadata() {
    const files = walkFiles(TOOLS_ROOT, (name) => (
        name.endsWith(METADATA_SUFFIX) || name === EXPORT_METADATA_NAME
    ));
    const records = [];
    for (const filePath of files) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const output = absoluteFromRoot(data.output);
            const cropBox = Array.isArray(data.cropBox) ? data.cropBox.map(Number) : null;
            if (!output || !cropBox || cropBox.length !== 4 || !cropBox.every(Number.isFinite)) continue;
            records.push({ filePath, data, output, cropBox });
        } catch (_error) {
            // Historical metadata may be incomplete; it is an audit miss, not a generator crash.
        }
    }
    return records;
}

function loadSemanticProxies() {
    const files = walkFiles(TOOLS_ROOT, (name) => name.endsWith(SHADOW_PROXY_SUFFIX));
    const records = [];
    for (const filePath of files) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data?.algorithmVersion !== 2
                || data?.sourceKind !== 'semantic_shadow_proxy_v2'
                || !data?.assetId
                || !Array.isArray(data?.contactPolygon)
                || !Array.isArray(data?.parts)) continue;
            records.push({ filePath, data });
        } catch (_error) {
            // An incomplete proxy remains an audit miss and never blocks old fallbacks.
        }
    }
    return records;
}

function normalizedStem(filePath, suffix) {
    const name = path.basename(filePath).toLowerCase();
    return name.endsWith(suffix) ? name.slice(0, -suffix.length) : path.parse(name).name;
}

const _exactFileMatchCache = new Map();
const _fileHashCache = new Map();

function filesMatchExactly(leftPath, rightPath) {
    const key = `${comparablePath(leftPath)}|${comparablePath(rightPath)}`;
    if (_exactFileMatchCache.has(key)) return _exactFileMatchCache.get(key);
    let matches = false;
    try {
        const leftStat = fs.statSync(leftPath);
        const rightStat = fs.statSync(rightPath);
        matches = leftStat.size === rightStat.size
            && fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
    } catch (_error) {
        matches = false;
    }
    _exactFileMatchCache.set(key, matches);
    return matches;
}

function fileSha256(filePath) {
    const key = comparablePath(filePath);
    if (_fileHashCache.has(key)) return _fileHashCache.get(key);
    let digest = null;
    try {
        digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch (_error) {
        digest = null;
    }
    _fileHashCache.set(key, digest);
    return digest;
}

function commonPathScore(leftPath, rightPath) {
    const left = comparablePath(path.dirname(leftPath)).split('/');
    const right = comparablePath(path.dirname(rightPath)).split('/');
    let count = 0;
    while (count < left.length && count < right.length && left[count] === right[count]) count++;
    return count * 3;
}

function candidateTokens(target, metadata) {
    return new Set([
        target.id,
        target.textureKey,
        target.textureKey.replace(/_(structure_occluder|body)$/i, ''),
        normalizedStem(metadata.filePath, METADATA_SUFFIX),
    ].map((value) => String(value || '').toLowerCase()).filter(Boolean));
}

function normalizedIdentity(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/_(structure_occluder|body)$/i, '');
}

function alignedMetadataCandidates(target, assetPng, metadataRecords) {
    const formalPath = comparablePath(target.sourceAbsolute);
    return metadataRecords.filter((record) => (
        (comparablePath(record.output) === formalPath
            || filesMatchExactly(record.output, target.sourceAbsolute))
        && record.cropBox[2] - record.cropBox[0] === assetPng.width
        && record.cropBox[3] - record.cropBox[1] === assetPng.height
    ));
}

function sourceProxy(target, assetPng, metadataRecords, proxyRecords) {
    const metadataCandidates = alignedMetadataCandidates(target, assetPng, metadataRecords);
    if (!metadataCandidates.length) return { reason: 'missing-aligned-runtime-metadata' };
    const targetIdentities = new Set([
        target.id,
        target.textureKey,
        target.textureKey.replace(/_(structure_occluder|body)$/i, ''),
    ].map(normalizedIdentity));
    const ranked = [];
    let rejectedIntegrity = false;
    let rejectedFoundation = false;
    for (const proxy of proxyRecords) {
        if (!targetIdentities.has(normalizedIdentity(proxy.data.assetId))) continue;
        const sourceBlend = absoluteFromRoot(proxy.data.sourceBlend);
        const expectedHash = String(proxy.data.sourceBlendSha256 || '').toLowerCase();
        if (!sourceBlend || !expectedHash || fileSha256(sourceBlend) !== expectedHash) {
            rejectedIntegrity = true;
            continue;
        }
        if (proxy.data.foundation?.excluded !== true
            || !Array.isArray(proxy.data.foundation?.groundObjects)
            || proxy.data.foundation.groundObjects.length === 0) {
            rejectedFoundation = true;
            continue;
        }
        for (const metadata of metadataCandidates) {
            ranked.push({
                ...proxy,
                metadata,
                sourceBlend,
                score: commonPathScore(metadata.filePath, proxy.filePath),
            });
        }
    }
    ranked.sort((left, right) => right.score - left.score
        || left.filePath.localeCompare(right.filePath));
    if (ranked.length) return ranked[0];
    if (rejectedIntegrity) return { reason: 'semantic-proxy-source-integrity-mismatch' };
    if (rejectedFoundation) return { reason: 'semantic-proxy-foundation-exclusion-unproven' };
    return { reason: 'missing-semantic-shadow-proxy' };
}

function sourcePair(target, assetPng, metadataRecords, bodyDepthFiles) {
    const metadataCandidates = alignedMetadataCandidates(target, assetPng, metadataRecords);
    if (!metadataCandidates.length) return { reason: 'missing-aligned-runtime-metadata' };

    const ranked = [];
    for (const metadata of metadataCandidates) {
        const tokens = candidateTokens(target, metadata);
        const identities = new Set([...tokens].map(normalizedIdentity));
        for (const depthPath of bodyDepthFiles) {
            const depthStem = normalizedStem(depthPath, BODY_DEPTH_SUFFIX);
            // Do not borrow another level's Body Depth merely because it lives in
            // the same generation pack. Different tiers may have different bases,
            // annexes or source crops even when their names share a prefix.
            if (!identities.has(normalizedIdentity(depthStem))) continue;
            let score = commonPathScore(metadata.filePath, depthPath);
            score += 120;
            ranked.push({
                metadata,
                depthPath,
                score,
                trustedFoundationExclusion: Boolean(foundationExclusionProvenance(depthPath)),
            });
        }
    }
    ranked.sort((left, right) => (
        Number(right.trustedFoundationExclusion) - Number(left.trustedFoundationExclusion)
        || right.score - left.score
        || left.depthPath.localeCompare(right.depthPath)));
    if (!ranked.length) return { reason: 'missing-body-depth' };

    for (const candidate of ranked) {
        const depthPng = safePng(candidate.depthPath);
        if (!depthPng) continue;
        const [left, top, right, bottom] = candidate.metadata.cropBox;
        if (left < 0 || top < 0 || right > depthPng.width || bottom > depthPng.height) continue;
        return { ...candidate, depthPng };
    }
    return { reason: 'body-depth-crop-mismatch' };
}

function foundationExclusionProvenance(depthPath) {
    const comparable = comparablePath(depthPath);
    const settlementRoot = comparablePath(SETTLEMENT_PACK_ROOT);
    if (comparable.startsWith(`${settlementRoot}/`)) {
        const relative = slash(path.relative(SETTLEMENT_PACK_ROOT, depthPath));
        const sourceId = relative.split('/')[0];
        const spec = SETTLEMENT_PACK_MANIFEST.buildings?.[sourceId];
        if (Array.isArray(spec?.bodyDepthExclude) && spec.bodyDepthExclude.length > 0) {
            return `settlement-manifest:${sourceId}`;
        }
        if (sourceId.startsWith('research_institute')) {
            return `settlement-builder-implicit:${sourceId}`;
        }
    }
    if (comparable.endsWith('/_geothermal_power_plant_20260831/model_correction_v2/geothermal_power_plant_body_depth.png')) {
        return 'geothermal-model-manifest';
    }
    if (comparable.endsWith('/_high_energy_research_laboratory_20260901/model_v2/high_energy_research_laboratory_body_depth.png')) {
        return 'high-energy-body-only-render';
    }
    if (comparable.endsWith('/_planar_observation_array_20260901/model/planar_observation_array_body_depth.png')) {
        return 'planar-observation-manifest';
    }
    const sidecarPath = depthPath.replace(/_body_depth\.png$/i, '_body_depth.json');
    try {
        const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
        if (sidecar?.algorithmVersion === 1
            && sidecar?.bodyDepthIncludesFoundation === false
            && sidecar?.foundationExclusionMode === 'exact-authored-building-foundation-prefix'
            && Array.isArray(sidecar?.excludedObjects)
            && sidecar.excludedObjects.length > 0
            && sidecar?.generator === 'tools/ai-gen/render-foundation-free-building-depth.py') {
            return `blender-foundation-excluded:${sidecar.assetId}`;
        }
    } catch (_error) {
        // A Body Depth filename alone never proves that its foundation was removed.
    }
    return null;
}

function depthMask(pair) {
    const [left, top, right, bottom] = pair.metadata.cropBox;
    const width = right - left;
    const height = bottom - top;
    const png = pair.depthPng;
    const alphaAt = (x, y) => {
        const px = Math.max(0, Math.min(width - 1, Math.floor(Number(x) || 0))) + left;
        const py = Math.max(0, Math.min(height - 1, Math.floor(Number(y) || 0))) + top;
        const index = (py * png.width + px) * 4;
        const depth = Math.max(png.data[index], png.data[index + 1], png.data[index + 2]);
        const alpha = png.data[index + 3];
        return alpha >= DEPTH_ALPHA_THRESHOLD && depth >= DEPTH_ALPHA_THRESHOLD ? 255 : 0;
    };
    return { width, height, alphaAt };
}

function foundationRingCoverage(mask, visualFootprint) {
    if (!visualFootprint) return 1;
    const centerX = visualFootprint.centerXRatio * mask.width;
    const centerY = visualFootprint.centerYRatio * mask.height;
    const halfWidth = Math.max(1, visualFootprint.widthRatio * mask.width * 0.5);
    const halfDepth = Math.max(1, visualFootprint.depthRatio * mask.height * 0.5);
    const minX = Math.max(0, Math.floor(centerX - halfWidth));
    const maxX = Math.min(mask.width - 1, Math.ceil(centerX + halfWidth));
    const minY = Math.max(0, Math.floor(centerY - halfDepth));
    const maxY = Math.min(mask.height - 1, Math.ceil(centerY + halfDepth));
    const step = Math.max(1, Math.ceil(Math.max(mask.width, mask.height) / 512));
    let samples = 0;
    let occupied = 0;
    for (let y = minY; y <= maxY; y += step) {
        for (let x = minX; x <= maxX; x += step) {
            const radius = Math.abs((x - centerX) / halfWidth)
                + Math.abs((y - centerY) / halfDepth);
            if (radius < FOUNDATION_RING_MIN || radius > FOUNDATION_RING_MAX) continue;
            samples++;
            if (mask.alphaAt(x, y) >= 96) occupied++;
        }
    }
    return samples > 0 ? occupied / samples : 1;
}

function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let twice = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        twice += current.x * next.y - next.x * current.y;
    }
    return Math.abs(twice) * 0.5;
}

function simplifyPolygon(points, maxPoints = MAX_CONTACT_POINTS) {
    const result = points
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({ x: point.x, y: point.y }));
    while (result.length > maxPoints) {
        let removeIndex = -1;
        let smallestTriangle = Number.POSITIVE_INFINITY;
        for (let index = 0; index < result.length; index++) {
            const previous = result[(index - 1 + result.length) % result.length];
            const current = result[index];
            const next = result[(index + 1) % result.length];
            const triangle = Math.abs(
                previous.x * (current.y - next.y)
                + current.x * (next.y - previous.y)
                + next.x * (previous.y - current.y)
            );
            if (triangle < smallestTriangle) {
                smallestTriangle = triangle;
                removeIndex = index;
            }
        }
        if (removeIndex < 0) break;
        result.splice(removeIndex, 1);
    }
    return result;
}

function roundHalf(value) {
    return Math.round((Number(value) || 0) * 2) / 2;
}

function proxyPointToRuntime(point, target) {
    const modelX = Number(Array.isArray(point) ? point[0] : point?.x);
    const modelY = Number(Array.isArray(point) ? point[1] : point?.y);
    if (!Number.isFinite(modelX) || !Number.isFinite(modelY)) return null;
    return {
        x: target.nominalWidth * 0.5 * (modelX - modelY),
        y: -target.nominalHeight * 0.5 * (modelX + modelY + 1),
    };
}

function deriveSemanticEntry(target, proxy) {
    if (!target.visualFootprint || target.autoFootprint) {
        return { reason: 'non-prism-or-missing-visual-footprint' };
    }
    const convertPolygon = (polygon) => simplifyPolygon(
        (Array.isArray(polygon) ? polygon : [])
            .map((point) => proxyPointToRuntime(point, target))
            .filter(Boolean)
    );
    const contactPolygon = convertPolygon(proxy.data.contactPolygon);
    const bodyArea = polygonArea(contactPolygon);
    const foundationArea = target.nominalWidth * target.nominalHeight * 0.5;
    const areaRatio = foundationArea > 0 ? bodyArea / foundationArea : 1;
    const maxX = contactPolygon.length
        ? Math.max(...contactPolygon.map((point) => Math.abs(point.x))) : Infinity;
    const minY = contactPolygon.length
        ? Math.min(...contactPolygon.map((point) => point.y)) : -Infinity;
    const maxY = contactPolygon.length
        ? Math.max(...contactPolygon.map((point) => point.y)) : Infinity;
    if (contactPolygon.length < 3
        || areaRatio < MIN_BODY_AREA_RATIO
        || areaRatio > 1.05
        || maxX > target.nominalWidth * 0.68
        || minY < -target.nominalHeight * 1.35
        || maxY > target.nominalHeight * 0.15) {
        return {
            reason: 'semantic-proxy-contact-geometry-out-of-bounds',
            areaRatio,
            bounds: { maxX, minY, maxY },
        };
    }

    const parts = [];
    for (const sourcePart of proxy.data.parts) {
        const baseRatio = Number(sourcePart?.baseRatio);
        const topRatio = Number(sourcePart?.topRatio);
        const polygon = convertPolygon(sourcePart?.polygon);
        if (!Number.isFinite(baseRatio)
            || !Number.isFinite(topRatio)
            || baseRatio < 0
            || topRatio > 1
            || topRatio <= baseRatio
            || polygon.length < 3) {
            return { reason: 'semantic-proxy-invalid-height-part', areaRatio };
        }
        parts.push({
            id: String(sourcePart.id || `part_${parts.length + 1}`),
            polygon: polygon.map((point) => [roundHalf(point.x), roundHalf(point.y)]),
            baseRatio: Number(baseRatio.toFixed(6)),
            topRatio: Number(topRatio.toFixed(6)),
        });
    }
    if (!parts.length || parts.length > 32) {
        return { reason: 'semantic-proxy-part-count-out-of-bounds', areaRatio };
    }

    return {
        entry: {
            id: target.id,
            textureKey: target.textureKey,
            displayWidth: target.displayWidth,
            displayHeight: target.displayHeight,
            sourceKind: 'semantic_shadow_proxy_v2',
            sourcePath: target.sourcePath,
            shadowProxyPath: relativeToRoot(proxy.filePath),
            sourceBlend: relativeToRoot(proxy.sourceBlend),
            runtimeMetadataPath: relativeToRoot(proxy.metadata.filePath),
            foundationExclusion: 'semantic-shadow-role-v2',
            bodyAreaRatio: Number(areaRatio.toFixed(4)),
            contactPolygon: contactPolygon.map((point) => [
                roundHalf(point.x),
                roundHalf(point.y),
            ]),
            parts,
        },
        areaRatio,
    };
}

function deriveEntry(target, assetPng, pair) {
    if (!target.visualFootprint || target.autoFootprint) {
        return { reason: 'non-prism-or-missing-visual-footprint' };
    }
    const mask = depthMask(pair);
    if (mask.width !== assetPng.width || mask.height !== assetPng.height) {
        return { reason: 'body-depth-final-crop-size-mismatch' };
    }
    const ringCoverage = foundationRingCoverage(mask, target.visualFootprint);
    const foundationExclusion = foundationExclusionProvenance(pair.depthPath);
    if (!foundationExclusion) {
        return {
            reason: 'body-depth-foundation-exclusion-unproven',
            ringCoverage,
        };
    }

    const groundFitOptions = {
        nominalWidth: target.nominalWidth,
        nominalHeight: target.nominalHeight,
        visualFootprint: target.visualFootprint,
    };
    const finalGroundFit = fitExplicitVisualToPrism(
        assetPng.width,
        assetPng.height,
        groundFitOptions
    );
    if (!finalGroundFit) return { reason: 'final-ground-fit-unavailable', ringCoverage };

    const bodyFit = fitOpaqueGroundFootprint(
        mask.width,
        mask.height,
        mask.alphaAt,
        target.displayWidth,
        target.displayHeight,
        {
            nominalWidth: target.nominalWidth,
            nominalHeight: target.nominalHeight,
            threshold: 96,
        }
    );
    if (!bodyFit?.contactPolygon?.length) {
        return { reason: 'body-contact-fit-unavailable', ringCoverage };
    }

    const offsetX = finalGroundFit.visualOffsetX - bodyFit.visualOffsetX;
    const offsetY = bodyFit.footOffsetY - finalGroundFit.footOffsetY;
    const contactPolygon = simplifyPolygon(bodyFit.contactPolygon.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
    })));
    const bodyArea = polygonArea(contactPolygon);
    const foundationArea = target.nominalWidth * target.nominalHeight * 0.5;
    const areaRatio = foundationArea > 0 ? bodyArea / foundationArea : 1;
    const maxX = Math.max(...contactPolygon.map((point) => Math.abs(point.x)));
    const minY = Math.min(...contactPolygon.map((point) => point.y));
    const maxY = Math.max(...contactPolygon.map((point) => point.y));
    if (contactPolygon.length < 3
        || areaRatio < MIN_BODY_AREA_RATIO
        || areaRatio > MAX_BODY_AREA_RATIO
        || maxX > target.nominalWidth * 0.62
        || minY < -target.nominalHeight * 1.25
        || maxY > target.nominalHeight * 0.12) {
        return {
            reason: 'body-contact-geometry-out-of-bounds',
            ringCoverage,
            areaRatio,
            bounds: { maxX, minY, maxY },
        };
    }

    return {
        entry: {
            id: target.id,
            textureKey: target.textureKey,
            displayWidth: target.displayWidth,
            displayHeight: target.displayHeight,
            sourceKind: 'body_depth_v1',
            sourcePath: target.sourcePath,
            bodyDepthPath: relativeToRoot(pair.depthPath),
            runtimeMetadataPath: relativeToRoot(pair.metadata.filePath),
            foundationExclusion,
            foundationRingCoverage: Number(ringCoverage.toFixed(4)),
            bodyAreaRatio: Number(areaRatio.toFixed(4)),
            contactPolygon: contactPolygon.map((point) => [
                roundHalf(point.x),
                roundHalf(point.y),
            ]),
        },
        ringCoverage,
        areaRatio,
    };
}

function effectiveExplicitContact(target) {
    return Array.isArray(target.explicitShadowCaster?.contactPolygon)
        && target.explicitShadowCaster.contactPolygon.length >= 3;
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function auditMarkdown(results, entries) {
    const generated = results.filter((result) => result.status === 'generated');
    const semantic = generated.filter((result) => (
        result.entry.sourceKind === 'semantic_shadow_proxy_v2'
    ));
    const bodyDepth = generated.filter((result) => result.entry.sourceKind === 'body_depth_v1');
    const explicit = results.filter((result) => result.status === 'explicit');
    const fallback = results.filter((result) => result.status === 'fallback');
    const byReason = new Map();
    for (const result of fallback) {
        if (!byReason.has(result.reason)) byReason.set(result.reason, []);
        byReason.get(result.reason).push(result);
    }
    const lines = [
        '# 建筑主体影根离线审计（2026-09-01）',
        '',
        '> 该报告由 `tools/generate-building-shadow-casters.mjs` 生成。只审计并派生视觉阴影低模；不修改逻辑占格、碰撞、寻路、`visualFootprint` 或建筑贴图。',
        '',
        `- 审计视觉项：${results.length}`,
        `- 语义模型多段影根：${semantic.length}`,
        `- Body Depth 主体影根：${bodyDepth.length}`,
        `- 配置显式影根：${explicit.length}`,
        `- 保守回退旧影根：${fallback.length}`,
        `- 运行时清单条目：${entries.length}`,
        '',
        '## 已生成主体影根',
        '',
        '| ID | 纹理 | 来源 | 地基外环占用 | 主体/地基面积 | 点数/部件 |',
        '|---|---|---|---:|---:|---:|',
        ...generated.map((result) => (
            `| ${result.target.id} | ${result.target.textureKey} | ${result.entry.sourceKind} | ${formatPercent(result.ringCoverage)} | ${formatPercent(result.areaRatio)} | ${result.entry.contactPolygon.length}/${result.entry.parts?.length || 1} |`
        )),
        '',
        '## 显式配置影根',
        '',
        ...(explicit.length
            ? explicit.map((result) => `- ${result.target.id}（${result.target.textureKey}）`)
            : ['- 无']),
        '',
        '## 继续保守回退',
        '',
    ];
    for (const [reason, grouped] of [...byReason.entries()].sort()) {
        lines.push(`### ${reason}`, '');
        for (const result of grouped) {
            const notes = [
                Number.isFinite(result.ringCoverage)
                    ? `外环=${formatPercent(result.ringCoverage)}` : null,
                Number.isFinite(result.areaRatio)
                    ? `面积=${formatPercent(result.areaRatio)}` : null,
                result.bounds
                    ? `边界=±${result.bounds.maxX.toFixed(1)},${result.bounds.minY.toFixed(1)}..${result.bounds.maxY.toFixed(1)}`
                    : null,
            ].filter(Boolean).join('，');
            lines.push(`- ${result.target.id}（${result.target.textureKey}）${notes ? `：${notes}` : ''}`);
        }
        lines.push('');
    }
    lines.push(
        '## 验证边界',
        '',
        '- 裁切元数据必须直接指向正式 PNG，或其输出与正式 PNG 逐字节一致；模型代理或 Body Depth 身份必须与建筑 ID、纹理键精确相同，不跨等级借用。',
        '- 优先采用 `.blend` 导出的语义多段代理；生成器会复核源模型 SHA-256、地基排除对象和几何边界，任一不匹配即拒绝陈旧代理。',
        '- 生成器只接受模型清单或专用构建脚本明确排除地基的 Body Depth；外环占用仅作诊断，不用像素猜测地基语义。',
        '- 未命中可靠来源的建筑继续使用现有 `visualFootprint` 影根，不做猜测性缩放。',
        '- 本报告不是游戏运行时验收；正午、晨昏和建筑升级换图仍需玩家实机检查。',
        ''
    );
    return `${lines.join('\n')}\n`;
}

function writeIfChanged(filePath, content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(buffer)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return true;
}

const targets = collectTargets();
let requestedTargets = [];
if (WRITE_IF_SOURCE) {
    const requestedSource = absoluteFromRoot(WRITE_IF_SOURCE);
    requestedTargets = targets.filter((target) => (
        comparablePath(target.sourceAbsolute) === comparablePath(requestedSource)
    ));
    if (!requestedTargets.length) {
        console.log(`building shadow casters: skipped unregistered source ${relativeToRoot(requestedSource)}`);
        process.exit(0);
    }
}
const metadataRecords = loadRuntimeMetadata();
const proxyRecords = loadSemanticProxies();
const bodyDepthFiles = walkFiles(TOOLS_ROOT, (name) => name.endsWith(BODY_DEPTH_SUFFIX));
const results = [];
const entries = [];

const processedTargets = WRITE_IF_SOURCE ? requestedTargets : targets;
for (const target of processedTargets) {
    if (effectiveExplicitContact(target)) {
        results.push({ status: 'explicit', target });
        continue;
    }
    const assetPng = safePng(target.sourceAbsolute);
    if (!assetPng) {
        results.push({ status: 'fallback', target, reason: 'missing-formal-terrain-png' });
        continue;
    }
    const proxy = sourceProxy(target, assetPng, metadataRecords, proxyRecords);
    let semanticFailure = proxy;
    if (proxy.data) {
        const derived = deriveSemanticEntry(target, proxy);
        if (derived.entry) {
            entries.push(derived.entry);
            results.push({ status: 'generated', target, ...derived });
            continue;
        }
        semanticFailure = derived;
    }
    const pair = sourcePair(target, assetPng, metadataRecords, bodyDepthFiles);
    if (!pair.depthPng) {
        const reason = semanticFailure.reason !== 'missing-semantic-shadow-proxy'
            ? semanticFailure.reason : pair.reason;
        results.push({ status: 'fallback', target, reason });
        continue;
    }
    const derived = deriveEntry(target, assetPng, pair);
    if (!derived.entry) {
        results.push({ status: 'fallback', target, ...derived });
        continue;
    }
    entries.push(derived.entry);
    results.push({ status: 'generated', target, ...derived });
}

let manifestEntries = entries;
if (WRITE_IF_SOURCE) {
    const currentManifest = fs.existsSync(OUTPUT_PATH)
        ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'))
        : { entries: [] };
    const replacedIds = new Set(requestedTargets.map((target) => target.id));
    manifestEntries = (Array.isArray(currentManifest.entries) ? currentManifest.entries : [])
        .filter((entry) => !replacedIds.has(entry.id))
        .concat(entries);
}
manifestEntries.sort((left, right) => left.textureKey.localeCompare(right.textureKey)
    || left.displayWidth - right.displayWidth
    || left.displayHeight - right.displayHeight);
const manifestText = `${JSON.stringify({
    algorithmVersion: 2,
    generatedBy: 'tools/generate-building-shadow-casters.mjs',
    entries: manifestEntries,
}, null, 2)}\n`;
const auditText = auditMarkdown(results, entries);

if (CHECK) {
    const currentManifest = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
    const currentAudit = fs.existsSync(AUDIT_PATH) ? fs.readFileSync(AUDIT_PATH, 'utf8') : '';
    if (currentManifest !== manifestText || currentAudit !== auditText) {
        console.error('building shadow caster artifacts are stale');
        process.exitCode = 1;
    }
} else if (WRITE) {
    const manifestChanged = writeIfChanged(OUTPUT_PATH, manifestText);
    const auditChanged = WRITE_IF_SOURCE ? false : writeIfChanged(AUDIT_PATH, auditText);
    console.log(`building shadow casters: ${entries.length}/${processedTargets.length} generated; `
        + `${manifestChanged ? 'manifest updated' : 'manifest unchanged'}; `
        + `${auditChanged ? 'audit updated' : 'audit unchanged'}${WRITE_IF_SOURCE ? ' (target-scoped)' : ''}`);
} else {
    console.log(auditText);
}
