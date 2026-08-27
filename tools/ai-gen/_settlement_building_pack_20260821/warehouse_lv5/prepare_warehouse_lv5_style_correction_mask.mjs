import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(
    root, 'refine_style_retry2', 'warehouse_lv5', 'warehouse_lv5_refine_v01_raw.png',
);
const maskPath = path.join(root, 'warehouse_lv5_style_correction_mask.png');
const reviewPath = path.join(root, 'warehouse_lv5_style_correction_mask_review.png');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
const binary = new Uint8Array(source.width * source.height);

function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (((yi > y) !== (yj > y))
                && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function isGreenScreen(x, y) {
    const p = (y * source.width + x) * 4;
    const r = source.data[p];
    const g = source.data[p + 1];
    const b = source.data[p + 2];
    return g > 110 && g > r * 1.35 && g > b * 1.25;
}

function markPolygon(points) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(source.width - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (pointInPolygon(x + 0.5, y + 0.5, points) && !isGreenScreen(x, y)) {
                binary[y * source.width + x] = 1;
            }
        }
    }
}

function boxBlur(input, radius) {
    const horizontal = new Float32Array(input.length);
    const output = new Float32Array(input.length);
    for (let y = 0; y < source.height; y++) {
        let sum = 0;
        for (let x = -radius; x < source.width + radius; x++) {
            const addX = x + radius;
            const removeX = x - radius - 1;
            if (addX >= 0 && addX < source.width) sum += input[y * source.width + addX];
            if (removeX >= 0 && removeX < source.width) sum -= input[y * source.width + removeX];
            if (x >= 0 && x < source.width) horizontal[y * source.width + x] = sum / (radius * 2 + 1);
        }
    }
    for (let x = 0; x < source.width; x++) {
        let sum = 0;
        for (let y = -radius; y < source.height + radius; y++) {
            const addY = y + radius;
            const removeY = y - radius - 1;
            if (addY >= 0 && addY < source.height) sum += horizontal[addY * source.width + x];
            if (removeY >= 0 && removeY < source.height) sum -= horizontal[removeY * source.width + x];
            if (y >= 0 && y < source.height) output[y * source.width + x] = sum / (radius * 2 + 1);
        }
    }
    return output;
}

// Lower duplicate cyan fitting. Keep the main core above it outside the mask.
markPolygon([[296, 758], [350, 753], [372, 807], [339, 844], [292, 820]]);
// Balcony service equipment only; preserve the railing and pointed window surrounds.
markPolygon([[595, 594], [760, 548], [783, 609], [617, 671], [586, 643]]);

const softened = boxBlur(binary, 12);
const mask = new PNG({ width: source.width, height: source.height });
const review = new PNG({ width: source.width, height: source.height });
for (let i = 0; i < softened.length; i++) {
    const p = i * 4;
    const x = i % source.width;
    const y = Math.floor(i / source.width);
    const value = isGreenScreen(x, y) ? 0 : Math.round(Math.max(0, Math.min(1, softened[i])) * 255);
    mask.data[p] = value;
    mask.data[p + 1] = value;
    mask.data[p + 2] = value;
    mask.data[p + 3] = 255;
    const blend = (value / 255) * 0.68;
    review.data[p] = Math.round(source.data[p] * (1 - blend) + 255 * blend);
    review.data[p + 1] = Math.round(source.data[p + 1] * (1 - blend));
    review.data[p + 2] = Math.round(source.data[p + 2] * (1 - blend));
    review.data[p + 3] = 255;
}

fs.writeFileSync(maskPath, PNG.sync.write(mask));
fs.writeFileSync(reviewPath, PNG.sync.write(review));
console.log(`${path.basename(maskPath)} ${source.width}x${source.height}`);
