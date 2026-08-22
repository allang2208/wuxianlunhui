import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(root, '../_settlement_building_pack_20260821/wheat_windmill/wheat_windmill_v2_5080_s48_seed122844_raw.png');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
const output = new PNG({ width: source.width, height: source.height });

for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
        const p = (y * source.width + x) * 4;
        const r = source.data[p];
        const g = source.data[p + 1];
        const b = source.data[p + 2];
        const yellow = r > 205 && g > 195 && b < 105;
        const paleSurface = r > 135 && g > 120 && b > 100 && Math.max(r, g, b) - Math.min(r, g, b) < 75;
        if (yellow || paleSurface) {
            const grain = 0.88 + 0.12 * Math.sin(x * 0.071) * Math.sin(y * 0.049);
            output.data[p] = Math.round(92 * grain);
            output.data[p + 1] = Math.round(49 * grain);
            output.data[p + 2] = Math.round(31 * grain);
        } else {
            output.data[p] = r;
            output.data[p + 1] = g;
            output.data[p + 2] = b;
        }
        output.data[p + 3] = 255;
    }
}

const outputPath = path.join(root, 'sail_projection_texture.png');
fs.writeFileSync(outputPath, PNG.sync.write(output));
console.log(outputPath);
