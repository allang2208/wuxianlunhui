import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(root, '../_settlement_building_pack_20260821/wheat_windmill/wheat_windmill_v2_5080_s48_seed122844_raw.png');
const previewPath = path.join(root, 'rendered', 'no_sails_preview.png');
const maskPath = path.join(root, 'sails_inpaint_mask.png');

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const preview = PNG.sync.read(fs.readFileSync(previewPath));
const mask = PNG.sync.read(fs.readFileSync(maskPath));
if (source.width !== preview.width || source.height !== preview.height ||
    source.width !== mask.width || source.height !== mask.height) {
    throw new Error('source, preview and mask dimensions must match');
}

const output = new PNG({ width: source.width, height: source.height });
const matte = [source.data[0], source.data[1], source.data[2]];

for (let i = 0; i < source.width * source.height; i++) {
    const p = i * 4;
    const masked = mask.data[p] > 127;
    const previewAlpha = preview.data[p + 3] / 255;

    if (!masked) {
        output.data[p] = source.data[p];
        output.data[p + 1] = source.data[p + 1];
        output.data[p + 2] = source.data[p + 2];
    } else {
        output.data[p] = Math.round(preview.data[p] * previewAlpha + matte[0] * (1 - previewAlpha));
        output.data[p + 1] = Math.round(preview.data[p + 1] * previewAlpha + matte[1] * (1 - previewAlpha));
        output.data[p + 2] = Math.round(preview.data[p + 2] * previewAlpha + matte[2] * (1 - previewAlpha));
    }
    output.data[p + 3] = 255;
}

const outputPath = path.join(root, 'windmill_masked_inpaint_init.png');
fs.writeFileSync(outputPath, PNG.sync.write(output));
console.log(outputPath);
