import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(root, '../_settlement_building_pack_20260821/wheat_windmill/wheat_windmill_v2_5080_s48_seed122844_raw.png');
const maskPath = path.join(root, 'rendered', 'sails_mask.png');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
const mask = PNG.sync.read(fs.readFileSync(maskPath));
if (source.width !== mask.width || source.height !== mask.height) {
    throw new Error(`size mismatch: source ${source.width}x${source.height}, mask ${mask.width}x${mask.height}`);
}

const width = source.width;
const height = source.height;
const radius = 12;
const binary = new Uint8Array(width * height);
for (let i = 0; i < binary.length; i++) {
    const p = i * 4;
    binary[i] = (mask.data[p + 3] > 16 && mask.data[p] > 96) ? 1 : 0;
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

const outMask = new PNG({ width, height });
const overlay = new PNG({ width, height });
for (let i = 0; i < dilated.length; i++) {
    const p = i * 4;
    const value = dilated[i] ? 255 : 0;
    outMask.data[p] = value;
    outMask.data[p + 1] = value;
    outMask.data[p + 2] = value;
    outMask.data[p + 3] = 255;
    if (dilated[i]) {
        overlay.data[p] = Math.round(source.data[p] * 0.35 + 255 * 0.65);
        overlay.data[p + 1] = Math.round(source.data[p + 1] * 0.35);
        overlay.data[p + 2] = Math.round(source.data[p + 2] * 0.35);
    } else {
        overlay.data[p] = source.data[p];
        overlay.data[p + 1] = source.data[p + 1];
        overlay.data[p + 2] = source.data[p + 2];
    }
    overlay.data[p + 3] = 255;
}

fs.writeFileSync(path.join(root, 'sails_inpaint_mask.png'), PNG.sync.write(outMask));
fs.writeFileSync(path.join(root, 'sails_mask_overlay.png'), PNG.sync.write(overlay));
