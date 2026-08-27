import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));

function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        const crosses = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
        if (crosses) inside = !inside;
    }
    return inside;
}

function isGreenScreen(source, x, y) {
    const p = (y * source.width + x) * 4;
    const r = source.data[p];
    const g = source.data[p + 1];
    const b = source.data[p + 2];
    return g > 110 && g > r * 1.35 && g > b * 1.25;
}

function markPolygon(binary, source, points, rejectGreen = false) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(source.width - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (!pointInPolygon(x + 0.5, y + 0.5, points)) continue;
            if (rejectGreen && isGreenScreen(source, x, y)) continue;
            binary[y * source.width + x] = 1;
        }
    }
}

function markRing(binary, source, outer, inner) {
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(source.width - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            if (!pointInPolygon(x + 0.5, y + 0.5, outer)) continue;
            if (pointInPolygon(x + 0.5, y + 0.5, inner)) continue;
            if (isGreenScreen(source, x, y)) continue;
            binary[y * source.width + x] = 1;
        }
    }
}

function boxBlur(binary, width, height, radius) {
    const horizontal = new Float32Array(binary.length);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = -radius; x < width + radius; x++) {
            const addX = x + radius;
            const removeX = x - radius - 1;
            if (addX >= 0 && addX < width) sum += binary[y * width + addX];
            if (removeX >= 0 && removeX < width) sum -= binary[y * width + removeX];
            if (x >= 0 && x < width) horizontal[y * width + x] = sum / (radius * 2 + 1);
        }
    }
    const blurred = new Float32Array(binary.length);
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = -radius; y < height + radius; y++) {
            const addY = y + radius;
            const removeY = y - radius - 1;
            if (addY >= 0 && addY < height) sum += horizontal[addY * width + x];
            if (removeY >= 0 && removeY < height) sum -= horizontal[removeY * width + x];
            if (y >= 0 && y < height) blurred[y * width + x] = sum / (radius * 2 + 1);
        }
    }
    return blurred;
}

function writeMask({ sourcePath, maskPath, overlayPath, paint }) {
    const source = PNG.sync.read(fs.readFileSync(sourcePath));
    const binary = new Uint8Array(source.width * source.height);
    paint(binary, source);
    const softened = boxBlur(binary, source.width, source.height, 14);
    const mask = new PNG({ width: source.width, height: source.height });
    const overlay = new PNG({ width: source.width, height: source.height });
    for (let i = 0; i < softened.length; i++) {
        const p = i * 4;
        const x = i % source.width;
        const y = Math.floor(i / source.width);
        const value = isGreenScreen(source, x, y)
            ? 0
            : Math.max(0, Math.min(255, Math.round(softened[i] * 255)));
        mask.data[p] = value;
        mask.data[p + 1] = value;
        mask.data[p + 2] = value;
        mask.data[p + 3] = 255;
        const blend = (value / 255) * 0.68;
        overlay.data[p] = Math.round(source.data[p] * (1 - blend) + 255 * blend);
        overlay.data[p + 1] = Math.round(source.data[p + 1] * (1 - blend));
        overlay.data[p + 2] = Math.round(source.data[p + 2] * (1 - blend));
        overlay.data[p + 3] = 255;
    }
    fs.writeFileSync(maskPath, PNG.sync.write(mask));
    fs.writeFileSync(overlayPath, PNG.sync.write(overlay));
    console.log(`${path.relative(root, maskPath)} ${source.width}x${source.height}`);
}

const lv6Dir = path.join(root, 'house_lv6');
writeMask({
    sourcePath: path.join(lv6Dir, 'refine_48step_v02_seed123370', 'house_lv6', 'house_lv6_refine_v01_raw.png'),
    maskPath: path.join(lv6Dir, 'house_lv6_local_correction_mask.png'),
    overlayPath: path.join(lv6Dir, 'house_lv6_local_correction_mask_review.png'),
    paint(binary, source) {
        markRing(
            binary,
            source,
            [[74, 788], [514, 1018], [950, 790], [512, 560]],
            [[170, 650], [514, 940], [855, 650], [512, 450]],
        );
        markPolygon(binary, source, [[286, 174], [615, 264], [580, 352], [265, 260]]);
    },
});

const lv7Dir = path.join(root, 'house_lv7');
writeMask({
    sourcePath: path.join(lv7Dir, 'refine_48step_doorfix_retry_from_v01_seed123393', 'house_lv7', 'house_lv7_refine_v01_raw.png'),
    maskPath: path.join(lv7Dir, 'house_lv7_canopy_correction_mask.png'),
    overlayPath: path.join(lv7Dir, 'house_lv7_canopy_correction_mask_review.png'),
    paint(binary, source) {
        markPolygon(binary, source, [[615, 800], [744, 786], [818, 849], [686, 916], [607, 862]], true);
        markPolygon(binary, source, [[594, 632], [746, 651], [790, 747], [615, 785]], true);
    },
});

writeMask({
    sourcePath: path.join(lv7Dir, 'refine_48step_canopydepth_from_review_v02_seed123430', 'house_lv7', 'house_lv7_refine_v02_raw.png'),
    maskPath: path.join(lv7Dir, 'house_lv7_ground_ramp_cleanup_mask.png'),
    overlayPath: path.join(lv7Dir, 'house_lv7_ground_ramp_cleanup_mask_review.png'),
    paint(binary, source) {
        markPolygon(binary, source,
            [[586, 824], [746, 808], [824, 864], [681, 930], [580, 886]],
            true);
    },
});
