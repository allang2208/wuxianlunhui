#!/usr/bin/env node
/**
 * 为所有可改造武器生成“候选布局”，不直接修改 craft-config.json。
 *
 * 输出：
 *   src/config/craft-auto-layouts.js             供面板“自动排布”按钮预览
 *   tools/craft-layout-preview/manifest.json     机器可读诊断
 *   tools/craft-layout-preview/contact-sheet.svg 批量人工复核
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { EquipDataManager } from '../src/ui/equip-data-manager.js';
import {
    CRAFT_LAYOUT_PANEL,
    CRAFT_LAYOUT_PROFILES,
    CRAFT_LAYOUT_REVIEW_WEAPONS,
    resolveCraftLayoutProfile,
} from '../src/config/craft-layout-profiles.js';

const { PNG } = pngjs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'craft-config.json');
const OUTPUT_MODULE = path.join(ROOT, 'src', 'config', 'craft-auto-layouts.js');
const PREVIEW_DIR = path.join(ROOT, 'tools', 'craft-layout-preview');
const MANIFEST_PATH = path.join(PREVIEW_DIR, 'manifest.json');
const CONTACT_SHEET_PATH = path.join(PREVIEW_DIR, 'contact-sheet.svg');
const ALPHA_THRESHOLD = 24;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
    return Number(value.toFixed(digits));
}

function collectWeaponConfigs(value, out = new Map()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [key, child] of Object.entries(value)) {
        if (/^weapon\d+$/.test(key) && child && typeof child === 'object') out.set(key, child);
        else collectWeaponConfigs(child, out);
    }
    return out;
}

function resolveConfig(weaponId, rawConfigs, cache = new Map(), stack = new Set()) {
    if (cache.has(weaponId)) return cache.get(weaponId);
    const raw = rawConfigs.get(weaponId);
    if (!raw || stack.has(weaponId)) return raw || null;
    stack.add(weaponId);
    const base = raw.templateWeaponId
        ? resolveConfig(raw.templateWeaponId, rawConfigs, cache, stack)
        : null;
    stack.delete(weaponId);
    const resolved = base
        ? {
            ...base,
            ...raw,
            slots: raw.slots || base.slots,
            options: { ...(base.options || {}), ...(raw.options || {}) },
        }
        : raw;
    cache.set(weaponId, resolved);
    return resolved;
}

function collectWeaponData(value, out = new Map(), seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return out;
    seen.add(value);
    if (!Array.isArray(value) && /^weapon\d+$/.test(value.weaponId || '')) {
        const previous = out.get(value.weaponId);
        const score = Number(Boolean(value.weaponAsset?.image)) + Number(Boolean(value.equipImage));
        const previousScore = Number(Boolean(previous?.weaponAsset?.image)) + Number(Boolean(previous?.equipImage));
        if (!previous || score > previousScore) out.set(value.weaponId, value);
    }
    for (const child of Object.values(value)) collectWeaponData(child, out, seen);
    return out;
}

function resolveImagePath(weaponData) {
    return weaponData?.weaponAsset?.image
        || weaponData?.equipImage
        || weaponData?.slotImage
        || weaponData?.iconImage
        || null;
}

function resolveAnalysisImage(imagePath) {
    if (!imagePath) return null;
    const clean = imagePath.replaceAll('\\', '/').replace(/^\.\//, '');
    const runtimeRel = clean.replace(/^assets\//, '');
    const runtime = path.join(ROOT, 'assets', 'weapons', 'runtime', ...runtimeRel.split('/'));
    const original = path.join(ROOT, ...clean.split('/'));
    if (fs.existsSync(runtime)) return { absolute: runtime, relative: path.relative(ROOT, runtime).replaceAll('\\', '/') };
    if (fs.existsSync(original)) return { absolute: original, relative: clean };
    return null;
}

function percentileBound(histogram, total, fraction, fromEnd = false) {
    const target = total * fraction;
    let sum = 0;
    if (fromEnd) {
        for (let i = histogram.length - 1; i >= 0; i -= 1) {
            sum += histogram[i];
            if (sum >= target) return i;
        }
        return histogram.length - 1;
    }
    for (let i = 0; i < histogram.length; i += 1) {
        sum += histogram[i];
        if (sum >= target) return i;
    }
    return 0;
}

function analyzePng(filePath) {
    const png = PNG.sync.read(fs.readFileSync(filePath));
    const columns = new Uint32Array(png.width);
    const rows = new Uint32Array(png.height);
    const alphaPoints = [];
    let alphaPixels = 0;
    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            const alpha = png.data[(y * png.width + x) * 4 + 3];
            if (alpha <= ALPHA_THRESHOLD) continue;
            columns[x] += 1;
            rows[y] += 1;
            alphaPixels += 1;
            alphaPoints.push([x, y]);
        }
    }
    if (!alphaPixels) throw new Error('PNG has no visible alpha pixels');
    const trimFraction = 0.002;
    const x0 = percentileBound(columns, alphaPixels, trimFraction);
    const x1 = percentileBound(columns, alphaPixels, trimFraction, true);
    const y0 = percentileBound(rows, alphaPixels, trimFraction);
    const y1 = percentileBound(rows, alphaPixels, trimFraction, true);
    return {
        width: png.width,
        height: png.height,
        alphaPixels,
        alphaPoints,
        bbox: { x0, y0, x1, y1, width: Math.max(1, x1 - x0 + 1), height: Math.max(1, y1 - y0 + 1) },
    };
}

function snapAnchor(anchor, analysis) {
    const { bbox, alphaPoints } = analysis;
    const sourceX = bbox.x0 + clamp(anchor[0], 0, 1) * (bbox.width - 1);
    const sourceY = bbox.y0 + clamp(anchor[1], 0, 1) * (bbox.height - 1);
    let bestX = sourceX;
    let bestY = sourceY;
    let bestDistance2 = Number.POSITIVE_INFINITY;
    for (const [x, y] of alphaPoints) {
        const dx = x - sourceX;
        const dy = y - sourceY;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < bestDistance2) {
            bestDistance2 = distance2;
            bestX = x;
            bestY = y;
            if (distance2 === 0) break;
        }
    }
    const scale = Math.min(CRAFT_LAYOUT_PANEL.width / analysis.width, CRAFT_LAYOUT_PANEL.height / analysis.height);
    const drawWidth = analysis.width * scale;
    const drawHeight = analysis.height * scale;
    const offsetX = (CRAFT_LAYOUT_PANEL.width - drawWidth) / 2;
    const offsetY = (CRAFT_LAYOUT_PANEL.height - drawHeight) / 2;
    return {
        x: clamp((offsetX + bestX * scale) / CRAFT_LAYOUT_PANEL.width, 0.05, 0.95),
        y: clamp((offsetY + bestY * scale) / CRAFT_LAYOUT_PANEL.height, 0.04, 0.96),
        snapDistance: Math.sqrt(bestDistance2) / Math.hypot(bbox.width, bbox.height),
    };
}

function spreadSideSlots(items) {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => a.target.y - b.target.y || a.index - b.index);
    const min = CRAFT_LAYOUT_PANEL.minY;
    const max = CRAFT_LAYOUT_PANEL.maxY;
    const availableGap = sorted.length > 1 ? (max - min) / (sorted.length - 1) : 0;
    const gap = Math.min(CRAFT_LAYOUT_PANEL.minCellGap, availableGap);
    const positions = sorted.map(item => clamp(item.target.y, min, max));
    for (let i = 1; i < positions.length; i += 1) positions[i] = Math.max(positions[i], positions[i - 1] + gap);
    if (positions.at(-1) > max) positions[positions.length - 1] = max;
    for (let i = positions.length - 2; i >= 0; i -= 1) positions[i] = Math.min(positions[i], positions[i + 1] - gap);
    if (positions[0] < min) {
        const shift = min - positions[0];
        for (let i = 0; i < positions.length; i += 1) positions[i] += shift;
    }
    return sorted.map((item, index) => ({ ...item, y: positions[index] }));
}

function orientation(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a, b, c, d) {
    return orientation(a, b, c) * orientation(a, b, d) < 0
        && orientation(c, d, a) * orientation(c, d, b) < 0;
}

function countCrossings(items) {
    let crossings = 0;
    for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
            if (segmentsCross(items[i].cell, items[i].target, items[j].cell, items[j].target)) crossings += 1;
        }
    }
    return crossings;
}

function chooseLayout(slots, targets, profile) {
    const count = slots.length;
    let best = null;
    for (let mask = 0; mask < 2 ** count; mask += 1) {
        const left = [];
        const right = [];
        for (let index = 0; index < count; index += 1) {
            const item = { index, slot: slots[index], target: targets[index] };
            ((mask >> index) & 1 ? right : left).push(item);
        }
        if (!left.length || !right.length || left.length > 4 || right.length > 4) continue;
        const arranged = [
            ...spreadSideSlots(left).map(item => ({ ...item, side: 'left', cell: { x: CRAFT_LAYOUT_PANEL.railLeft, y: item.y } })),
            ...spreadSideSlots(right).map(item => ({ ...item, side: 'right', cell: { x: CRAFT_LAYOUT_PANEL.railRight, y: item.y } })),
        ];
        const crossings = countCrossings(arranged);
        let cost = crossings * 2.8 + Math.abs(left.length - right.length) * 0.04;
        for (const item of arranged) {
            cost += Math.hypot(item.cell.x - item.target.x, item.cell.y - item.target.y);
            const preferred = profile.preferredSides[item.slot.id];
            if (preferred && preferred !== item.side) cost += 0.34;
        }
        if (!best || cost < best.cost) best = { cost, crossings, arranged };
    }
    if (!best) throw new Error(`No valid rail assignment for ${count} slots`);
    const byIndex = new Map(best.arranged.map(item => [item.index, item]));
    return {
        crossings: best.crossings,
        slots: slots.map((slot, index) => {
            const item = byIndex.get(index);
            return {
                ...slot,
                x: round(item.cell.x),
                y: round(item.cell.y),
                lineTarget: { x: round(item.target.x), y: round(item.target.y) },
            };
        }),
    };
}

function generateCandidate(weaponId, config, weaponData) {
    const imagePath = resolveImagePath(weaponData);
    const analysisImage = resolveAnalysisImage(imagePath);
    if (!analysisImage) throw new Error(`Missing panel image: ${imagePath || '(none)'}`);
    if (path.extname(analysisImage.absolute).toLowerCase() !== '.png') throw new Error('Panel image is not PNG');
    const analysis = analyzePng(analysisImage.absolute);
    const slotIds = config.slots.map(slot => slot.id);
    const profileId = resolveCraftLayoutProfile(weaponId, weaponData, slotIds);
    const profile = CRAFT_LAYOUT_PROFILES[profileId];
    if (!profile) throw new Error(`Unknown layout profile: ${profileId}`);
    let unknownAnchors = 0;
    const targets = config.slots.map((slot, index) => {
        const anchor = profile.anchors[slot.id];
        if (anchor) return snapAnchor(anchor, analysis);
        unknownAnchors += 1;
        return snapAnchor([0.50, clamp((index + 1) / (config.slots.length + 1), 0.12, 0.88)], analysis);
    });
    const layout = chooseLayout(config.slots, targets, profile);
    const averageSnapDistance = targets.reduce((sum, target) => sum + target.snapDistance, 0) / targets.length;
    let confidence = 0.95 - unknownAnchors * 0.07 - averageSnapDistance * 1.15 - layout.crossings * 0.08;
    confidence = Math.min(confidence, profile.confidenceCap || 1);
    if (CRAFT_LAYOUT_REVIEW_WEAPONS.has(weaponId)) confidence = Math.min(confidence, 0.84);
    confidence = clamp(confidence, 0.35, 0.98);
    const grade = confidence >= 0.86 ? 'A' : confidence >= 0.68 ? 'B' : 'C';
    return {
        weaponId,
        weaponName: weaponData?.name || weaponId,
        profile: profileId,
        grade,
        confidence: round(confidence, 3),
        imagePath,
        analysisImage: analysisImage.relative,
        metrics: {
            sourceSize: [analysis.width, analysis.height],
            alphaBounds: [analysis.bbox.x0, analysis.bbox.y0, analysis.bbox.x1, analysis.bbox.y1],
            alphaAspect: round(analysis.bbox.width / analysis.bbox.height, 3),
            unknownAnchors,
            averageSnapDistance: round(averageSnapDistance, 4),
            crossings: layout.crossings,
        },
        slots: layout.slots,
    };
}

function xmlEscape(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function createContactSheet(candidates) {
    const columns = 4;
    const cardWidth = 280;
    const cardHeight = 362;
    const panelX = 55;
    const panelY = 40;
    const panelWidth = 170;
    const panelHeight = 300;
    const rows = Math.ceil(candidates.length / columns);
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cardWidth}" height="${rows * cardHeight}" viewBox="0 0 ${columns * cardWidth} ${rows * cardHeight}">`,
        '<style>text{font-family:Segoe UI,Microsoft YaHei,sans-serif}.title{fill:#e4edf1;font-size:13px;font-weight:700}.meta{fill:#91a5af;font-size:10px}.cell{fill:#20272b;stroke:#9fb3bd;stroke-width:1}.line{fill:none;stroke:#8298a3;stroke-width:1;stroke-dasharray:4 3}.line.back{stroke:#8fb9c7;stroke-dasharray:2 3}.target{fill:#11171a;stroke:#d4c5a9;stroke-width:1}.target.back{fill:#25353b;stroke:#9bc8d8}.back-label{fill:#b9dce7;font-size:7px;font-weight:700}.label{fill:#d4e0e5;font-size:7px;text-anchor:middle}.card{fill:#11171a;stroke:#39464c}.panel{fill:#0b0f11;stroke:#53636b;stroke-dasharray:4 3}</style>',
        '<rect width="100%" height="100%" fill="#090d0f"/>',
    ];
    candidates.forEach((candidate, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = col * cardWidth;
        const y = row * cardHeight;
        const imageHref = `../../${candidate.imagePath}`.replaceAll('\\', '/');
        parts.push(`<g transform="translate(${x},${y})">`);
        parts.push(`<rect class="card" x="4" y="4" width="272" height="354" rx="5"/>`);
        parts.push(`<text class="title" x="12" y="23">${xmlEscape(candidate.weaponId)} · ${xmlEscape(candidate.weaponName)}</text>`);
        parts.push(`<text class="meta" x="268" y="23" text-anchor="end">${candidate.grade} ${Math.round(candidate.confidence * 100)}% · ${xmlEscape(candidate.profile)}</text>`);
        parts.push(`<rect class="panel" x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="3"/>`);
        parts.push(`<image href="${xmlEscape(imageHref)}" x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" preserveAspectRatio="xMidYMid meet" opacity="0.92"/>`);
        for (const slot of candidate.slots) {
            const sx = panelX + slot.x * panelWidth;
            const sy = panelY + slot.y * panelHeight;
            const tx = panelX + slot.lineTarget.x * panelWidth;
            const ty = panelY + slot.lineTarget.y * panelHeight;
            const elbowX = slot.x < 0.5 ? Math.min(tx - 6, sx + Math.max(9, (tx - sx) * 0.58)) : Math.max(tx + 6, sx - Math.max(9, (sx - tx) * 0.58));
            const isBackTarget = slot.targetSide === 'back';
            parts.push(`<polyline class="line${isBackTarget ? ' back' : ''}" points="${round(sx, 1)},${round(sy, 1)} ${round(elbowX, 1)},${round(sy, 1)} ${round(tx, 1)},${round(ty, 1)}"/>`);
            parts.push(`<circle class="target${isBackTarget ? ' back' : ''}" cx="${round(tx, 1)}" cy="${round(ty, 1)}" r="${isBackTarget ? 2.5 : 2}"/>`);
            if (isBackTarget) {
                const labelOnRight = tx < panelX + panelWidth * 0.78;
                parts.push(`<text class="back-label" x="${round(tx + (labelOnRight ? 5 : -5), 1)}" y="${round(ty - 5, 1)}" text-anchor="${labelOnRight ? 'start' : 'end'}">背面</text>`);
            }
            parts.push(`<rect class="cell" x="${round(sx - 12, 1)}" y="${round(sy - 12, 1)}" width="24" height="24" rx="2"/>`);
            parts.push(`<text class="label" x="${round(sx, 1)}" y="${round(sy + 2, 1)}">${xmlEscape(slot.name || slot.id)}</text>`);
        }
        parts.push('</g>');
    });
    parts.push('</svg>');
    return `${parts.join('\n')}\n`;
}

function writeOutputs(candidates, skipped) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    const candidateMap = Object.fromEntries(candidates.map(candidate => [candidate.weaponId, {
        profile: candidate.profile,
        grade: candidate.grade,
        confidence: candidate.confidence,
        slots: candidate.slots,
    }]));
    const moduleText = `/**\n * 由 tools/generate-craft-layouts.mjs 生成。\n * 这是可撤销的自动排布候选，不是出厂默认，也不会自动写入 craft-config.json。\n */\nexport const CRAFT_AUTO_LAYOUTS = Object.freeze(${JSON.stringify(candidateMap, null, 2)});\n`;
    fs.writeFileSync(OUTPUT_MODULE, moduleText, 'utf8');
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({ candidates, skipped }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CONTACT_SHEET_PATH, createContactSheet(candidates), 'utf8');
}

const rawData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const rawConfigs = collectWeaponConfigs(rawData);
const weaponDataById = collectWeaponData(EquipDataManager);
const candidates = [];
const skipped = [];
for (const weaponId of [...rawConfigs.keys()].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))) {
    const config = resolveConfig(weaponId, rawConfigs);
    if (!Array.isArray(config?.slots) || !config.slots.length) {
        skipped.push({ weaponId, reason: 'No resolved slots' });
        continue;
    }
    try {
        candidates.push(generateCandidate(weaponId, config, weaponDataById.get(weaponId)));
    } catch (error) {
        skipped.push({ weaponId, reason: error.message });
    }
}
writeOutputs(candidates, skipped);
console.log(`Generated ${candidates.length} craft layout candidates; skipped ${skipped.length}.`);
console.log(path.relative(ROOT, CONTACT_SHEET_PATH));
