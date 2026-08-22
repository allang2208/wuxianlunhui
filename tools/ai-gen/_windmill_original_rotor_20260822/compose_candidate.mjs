import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(root, '../_settlement_building_pack_20260821/wheat_windmill/wheat_windmill_v2_5080_s48_seed122844_raw.png');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
const base = PNG.sync.read(fs.readFileSync(path.join(root, 'windmill_no_sails_inpaint_v4.png')));
const oldSailMask = PNG.sync.read(fs.readFileSync(path.join(root, 'rendered', 'sails_mask.png')));
const inpaintMask = PNG.sync.read(fs.readFileSync(path.join(root, 'sails_inpaint_mask.png')));
const frameCount = 16;
const columns = 4;
const rows = 4;
const width = source.width;
const height = source.height;
const sailOffset = { x: 22, y: 5 };
const hub = { x: 632, y: 444, radiusX: 43, radiusY: 54 };

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

function matteAlpha(image, p) {
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    const yellowStrength = Math.min((r - 205) / 30, (g - 205) / 30, (100 - b) / 50);
    return Math.round(255 * (1 - clamp(yellowStrength, 0, 1)));
}

function dilateMask(maskImage, radius) {
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < binary.length; i++) {
        const p = i * 4;
        binary[i] = maskImage.data[p + 3] > 16 && maskImage.data[p] > 96 ? 1 : 0;
    }
    const horizontal = new Uint8Array(binary.length);
    for (let y = 0; y < height; y++) {
        let count = 0;
        for (let x = -radius; x < width + radius; x++) {
            const addX = x + radius;
            const removeX = x - radius - 1;
            if (addX >= 0 && addX < width) count += binary[y * width + addX];
            if (removeX >= 0 && removeX < width) count -= binary[y * width + removeX];
            if (x >= 0 && x < width) horizontal[y * width + x] = count > 0 ? 1 : 0;
        }
    }
    const dilated = new Uint8Array(binary.length);
    for (let x = 0; x < width; x++) {
        let count = 0;
        for (let y = -radius; y < height + radius; y++) {
            const addY = y + radius;
            const removeY = y - radius - 1;
            if (addY >= 0 && addY < height) count += horizontal[addY * width + x];
            if (removeY >= 0 && removeY < height) count -= horizontal[removeY * width + x];
            if (y >= 0 && y < height) dilated[y * width + x] = count > 0 ? 1 : 0;
        }
    }
    return radius > 0 ? dilated : binary;
}

function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h /= 6;
        if (h < 0) h += 1;
    }
    return [h, max === 0 ? 0 : delta / max, max];
}

function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const sector = Math.floor(h * 6);
    const fraction = h * 6 - sector;
    const p = v * (1 - s);
    const q = v * (1 - fraction * s);
    const t = v * (1 - (1 - fraction) * s);
    const choices = [
        [v, t, p], [q, v, p], [p, v, t],
        [p, q, v], [t, p, v], [v, p, q],
    ];
    return choices[sector % 6].map((channel) => Math.round(channel * 255));
}

function median(values) {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
}

function colorStats(image, pixelAllowed) {
    const hues = [];
    const saturations = [];
    const values = [];
    for (let i = 0; i < width * height; i++) {
        const p = i * 4;
        if (!pixelAllowed(i, p)) continue;
        const [h, s, v] = rgbToHsv(image.data[p], image.data[p + 1], image.data[p + 2]);
        if (s < 0.18 || v < 0.10 || v > 0.92) continue;
        hues.push(h);
        saturations.push(s);
        values.push(v);
    }
    const sinMean = hues.reduce((sum, h) => sum + Math.sin(h * Math.PI * 2), 0) / Math.max(1, hues.length);
    const cosMean = hues.reduce((sum, h) => sum + Math.cos(h * Math.PI * 2), 0) / Math.max(1, hues.length);
    let hue = Math.atan2(sinMean, cosMean) / (Math.PI * 2);
    if (hue < 0) hue += 1;
    return { hue, saturation: median(saturations), value: median(values), samples: hues.length };
}

function buildColorMatch(render) {
    const isBrown = (image, p) => image.data[p] > image.data[p + 1] * 1.08 && image.data[p + 1] > image.data[p + 2] * 1.04;
    const target = colorStats(source, (i, p) => oldSailMask.data[p] > 96 && isBrown(source, p));
    const current = colorStats(render, (i, p) => render.data[p + 3] > 160 && isBrown(render, p));
    let hueShift = target.hue - current.hue;
    if (hueShift > 0.5) hueShift -= 1;
    if (hueShift < -0.5) hueShift += 1;
    return {
        hueShift,
        saturationScale: clamp(target.saturation / Math.max(0.01, current.saturation), 0.70, 1.45),
        valueScale: clamp(target.value / Math.max(0.01, current.value), 0.70, 1.45),
        target,
        current,
    };
}

function matchSailColor(rgb, match) {
    const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    return hsvToRgb(
        h + match.hueShift,
        clamp(s * match.saturationScale, 0, 1),
        clamp(v * match.valueScale, 0, 1),
    );
}

function over(dst, p, rgb, alpha) {
    const srcA = alpha / 255;
    const dstA = dst.data[p + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    for (let channel = 0; channel < 3; channel++) {
        dst.data[p + channel] = Math.round((rgb[channel] * srcA + dst.data[p + channel] * dstA * (1 - srcA)) / outA);
    }
    dst.data[p + 3] = Math.round(outA * 255);
}

const firstRender = PNG.sync.read(fs.readFileSync(path.join(root, 'rendered', 'sails_00.png')));
const colorMatch = buildColorMatch(firstRender);
const repairMask = dilateMask(inpaintMask, 0);
const frames = [];

for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const sailPath = path.join(root, 'rendered', `sails_${String(frameIndex).padStart(2, '0')}.png`);
    const sail = PNG.sync.read(fs.readFileSync(sailPath));
    const output = new PNG({ width, height });

    for (let i = 0; i < width * height; i++) {
        const p = i * 4;
        const backgroundImage = repairMask[i] ? base : source;
        output.data[p] = backgroundImage.data[p];
        output.data[p + 1] = backgroundImage.data[p + 1];
        output.data[p + 2] = backgroundImage.data[p + 2];
        output.data[p + 3] = matteAlpha(backgroundImage, p);

        const x = i % width;
        const y = Math.floor(i / width);
        const sailX = x - sailOffset.x;
        const sailY = y - sailOffset.y;
        if (sailX >= 0 && sailX < width && sailY >= 0 && sailY < height) {
            const sailP = (sailY * width + sailX) * 4;
            const sailA = sail.data[sailP + 3];
            if (sailA > 0) {
                const rgb = matchSailColor([sail.data[sailP], sail.data[sailP + 1], sail.data[sailP + 2]], colorMatch);
                over(output, p, rgb, sailA);
            }
        }

        const hubDistance = ((x - hub.x) / hub.radiusX) ** 2 + ((y - hub.y) / hub.radiusY) ** 2;
        if (hubDistance < 1) {
            const hubFeather = clamp((1 - hubDistance) / 0.16, 0, 1);
            const edgeAlpha = Math.round(matteAlpha(source, p) * hubFeather);
            over(output, p, [source.data[p], source.data[p + 1], source.data[p + 2]], edgeAlpha);
        }
    }
    frames.push(output);
    fs.writeFileSync(path.join(root, `candidate_v2_frame_${String(frameIndex).padStart(2, '0')}.png`), PNG.sync.write(output));
}

const sheet = new PNG({ width: width * columns, height: height * rows });
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const cellX = (frameIndex % columns) * width;
    const cellY = Math.floor(frameIndex / columns) * height;
    PNG.bitblt(frames[frameIndex], sheet, 0, 0, width, height, cellX, cellY);
}
const sheetPath = path.join(root, 'windmill_original_perspective_rotation_v2_sheet.png');
fs.writeFileSync(sheetPath, PNG.sync.write(sheet));

const previewCell = 384;
const contact = new PNG({ width: previewCell * columns, height: previewCell * rows });
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frame = frames[frameIndex];
    const cellX = (frameIndex % columns) * previewCell;
    const cellY = Math.floor(frameIndex / columns) * previewCell;
    for (let y = 0; y < previewCell; y++) {
        const sy = Math.min(height - 1, Math.floor(y * height / previewCell));
        for (let x = 0; x < previewCell; x++) {
            const sx = Math.min(width - 1, Math.floor(x * width / previewCell));
            const sp = (sy * width + sx) * 4;
            const dp = ((cellY + y) * contact.width + cellX + x) * 4;
            const checker = (((x >> 4) + (y >> 4)) & 1) ? 86 : 112;
            const alpha = frame.data[sp + 3] / 255;
            for (let channel = 0; channel < 3; channel++) {
                contact.data[dp + channel] = Math.round(frame.data[sp + channel] * alpha + checker * (1 - alpha));
            }
            contact.data[dp + 3] = 255;
        }
    }
}
const contactPath = path.join(root, 'windmill_original_perspective_rotation_v2_contact.png');
fs.writeFileSync(contactPath, PNG.sync.write(contact));

const metadata = {
    frameWidth: width,
    frameHeight: height,
    frameCount,
    columns,
    rows,
    sequence: 'left-to-right, top-to-bottom',
    sailOffset,
    hub,
    colorMatch,
    source: path.basename(sourcePath),
    base: 'windmill_no_sails_inpaint_v4.png',
};
fs.writeFileSync(path.join(root, 'windmill_original_perspective_rotation_v2_sheet.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({ sheetPath, contactPath, sailOffset, hub, colorMatch }, null, 2));
