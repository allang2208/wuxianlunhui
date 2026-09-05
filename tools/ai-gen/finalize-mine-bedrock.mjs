// Asset preparation only: ImageGen source -> periodic 1024 tile, prop sizing, static previews.
// Mirrors the floor-asset.py offset-wrap and enforce-seamless-edges preparation steps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'tools/ai-gen/_abandoned_mine_bedrock_20260830');
const readPng = file => PNG.sync.read(fs.readFileSync(file));
const savePng = (file, png) => fs.writeFileSync(file, PNG.sync.write(png));
const floorPath = path.join(root, 'assets/terrain/floor_abandoned_mine_seamless.png');
const raw = readPng(path.join(dir, 'generated-bedrock.png'));

function sample(image, x, y, channel) {
    const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
    const x1 = Math.min(image.width - 1, x0 + 1);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fx = Math.max(0, x - x0), fy = Math.max(0, y - y0);
    const at = (px, py) => image.data[(py * image.width + px) * 4 + channel];
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
        + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

const size = 1024;
const resized = new PNG({ width: size, height: size });
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) resized.data[i + c] = Math.round(sample(raw,
        (x + 0.5) * raw.width / size - 0.5, (y + 0.5) * raw.height / size - 0.5, c));
    resized.data[i + 3] = 255;
}
const tile = new PNG({ width: size, height: size });
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let mix = Math.min(x, size - 1 - x, y, size - 1 - y) / (size / 2);
    mix = mix * mix * (3 - 2 * mix);
    const i = (y * size + x) * 4;
    const j = (((y + size / 2) % size) * size + (x + size / 2) % size) * 4;
    for (let c = 0; c < 3; c++) tile.data[i + c] = Math.round(resized.data[i + c] * mix + resized.data[j + c] * (1 - mix));
    tile.data[i + 3] = 255;
}
// Exact opposing edge equality; preserve the generated palette and interior material.
for (const horizontal of [true, false]) for (let offset = 0; offset < 32; offset++) {
    const strength = (1 - offset / 31) ** 2;
    for (let p = 0; p < size; p++) {
        const a = (horizontal ? p * size + offset : offset * size + p) * 4;
        const b = (horizontal ? p * size + size - 1 - offset : (size - 1 - offset) * size + p) * 4;
        for (let c = 0; c < 3; c++) {
            const average = (tile.data[a + c] + tile.data[b + c]) / 2;
            tile.data[a + c] = Math.round(tile.data[a + c] * (1 - strength) + average * strength);
            tile.data[b + c] = Math.round(tile.data[b + c] * (1 - strength) + average * strength);
        }
    }
}
savePng(floorPath, tile);

// Target longest visible alpha dimension in world pixels, not the transparent 256px canvas.
const visibleSizes = {
    slate_rubble: 42, coal_chunks: 44, ore_fragments: 40, broken_sleepers: 60,
    rail_spikes: 30, broken_rail: 74, rotten_planks: 62, timber_offcuts: 54,
    rope_coil: 44, broken_chain: 48, pickaxe: 64, shovel: 64, floor_lantern: 44,
    helmet: 38, dynamite: 38, fuse_spool: 40, minecart_wheel: 56, ore_sack: 46,
};
const weights = {
    slate_rubble: 0.9, coal_chunks: 0.85, ore_fragments: 0.8, broken_sleepers: 0.85,
    rail_spikes: 0.38, broken_rail: 0.72, rotten_planks: 0.55, timber_offcuts: 0.55,
    rope_coil: 0.38, broken_chain: 0.42, pickaxe: 0.45, shovel: 0.35,
    floor_lantern: 0.32, helmet: 0.32, dynamite: 0.24, fuse_spool: 0.26,
    minecart_wheel: 0.48, ore_sack: 0.42,
};
const profiles = {
    plane: { cellSize: 264, density: 0.48, sizeScale: 1 },
    dungeon: { cellSize: 232, density: 0.42, sizeScale: 0.8 },
};
const configPath = path.join(root, 'data/abandoned-mine-terrain.json');
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const props = new Map();
const sizing = cfg.deco.assets.map(asset => {
    const image = readPng(path.join(root, asset.src));
    props.set(asset.key, image);
    let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const name = asset.key.replace('abandoned_mine_prop_', '');
    const visibleSize = visibleSizes[name];
    asset.size = Math.round(visibleSize * image.height / Math.max(x1 - x0 + 1, y1 - y0 + 1));
    asset.weight = weights[name];
    return { key: asset.key, alphaBBox: [x0, y0, x1 + 1, y1 + 1], visibleSize, canvasDisplayHeight: asset.size };
});
for (const relative of ['data/abandoned-mine-terrain.json', 'public/data/abandoned-mine-terrain.json']) {
    const file = path.join(root, relative);
    let text = fs.readFileSync(file, 'utf8').replace(/"version":\s*\d+/, '"version": 2');
    if (!text.includes('"profiles"')) text = text.replace('  "deco": {',
        '  "profiles": {\n    "plane": { "cellSize": 264, "density": 0.48, "sizeScale": 1 },\n    "dungeon": { "cellSize": 232, "density": 0.42, "sizeScale": 0.8 }\n  },\n  "deco": {');
    for (const asset of cfg.deco.assets) {
        text = text.replace(new RegExp(`(\\{ "key": "${asset.key}"[^\\n]+)`), line =>
            line.replace(/"size": [\d.]+/, `"size": ${asset.size}`)
                .replace(/"weight": [\d.]+/, `"weight": ${asset.weight}`));
    }
    fs.writeFileSync(file, text);
}

function floorPreview(width, height, zoom) {
    const image = new PNG({ width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.floor(x / zoom) % size;
        const sy = Math.floor(y / (zoom * cfg.base.textureScaleY)) % size;
        const i = (y * width + x) * 4, j = (sy * size + sx) * 4;
        for (let c = 0; c < 4; c++) image.data[i + c] = tile.data[j + c];
    }
    return image;
}
function drawProp(target, source, px, py, height, originY, flip) {
    const width = source.width * height / source.height;
    const left = px - width / 2, top = py - height * originY;
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(target.height, top + height); y++) {
        for (let x = Math.max(0, Math.floor(left)); x < Math.min(target.width, left + width); x++) {
            const sx = (flip ? 1 - (x - left) / width : (x - left) / width) * (source.width - 1);
            const sy = (y - top) / height * (source.height - 1);
            const alpha = sample(source, sx, sy, 3) / 255;
            if (!alpha) continue;
            const i = (y * target.width + x) * 4;
            for (let c = 0; c < 3; c++) target.data[i + c] = Math.round(target.data[i + c] * (1 - alpha) + sample(source, sx, sy, c) * alpha);
        }
    }
}
for (const [name, profile] of Object.entries(profiles)) {
    const zoom = name === 'plane' ? 0.7 : 1;
    const image = floorPreview(1440, 810, zoom);
    let seed = 126030;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const totalWeight = cfg.deco.assets.reduce((sum, a) => sum + a.weight, 0);
    for (let row = 0; row * profile.cellSize * zoom < image.height; row++) {
        for (let col = 0; col * profile.cellSize * zoom < image.width; col++) {
            if (rand() >= profile.density) continue;
            const px = (col + 0.18 + rand() * 0.64) * profile.cellSize * zoom;
            const py = (row + 0.18 + rand() * 0.64) * profile.cellSize * zoom;
            let roll = rand() * totalWeight;
            const asset = cfg.deco.assets.find(a => (roll -= a.weight) <= 0) || cfg.deco.assets.at(-1);
            drawProp(image, props.get(asset.key), px, py, asset.size * profile.sizeScale * zoom * (0.88 + rand() * 0.24), asset.originY, rand() < 0.5);
        }
    }
    savePng(path.join(dir, `${name}-material-preview.png`), image);
}
savePng(path.join(dir, 'floor-repeat-preview.png'), floorPreview(1024, 592, 0.5));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    date: '2026-08-30', generator: 'built-in image_gen', prompt: 'prompt.txt',
    generatedSource: 'generated-bedrock.png', sourceSize: [raw.width, raw.height],
    runtime: 'assets/terrain/floor_abandoned_mine_seamless.png', runtimeSize: [size, size],
    preparation: 'bilinear resize; floor-asset offset wrap; 32px opposing edge blend; original generated palette',
    replacementAuthorization: 'User: 帮我做新的，替代旧的',
    props: 'Existing 18 PNGs preserved; alpha-content dimensions calibrated in configuration only',
    profiles, sizing, previews: ['plane-material-preview.png', 'dungeon-material-preview.png', 'floor-repeat-preview.png'],
    previewScope: 'Offline asset composition, approximate distribution; not a game screenshot or runtime validation',
}, null, 2) + '\n');
console.log('Installed mine bedrock floor, updated 18 prop display sizes, and saved static material previews.');
