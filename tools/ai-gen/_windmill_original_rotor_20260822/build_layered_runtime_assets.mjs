import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '../../..');
const bodySource = PNG.sync.read(fs.readFileSync(path.join(root, 'windmill_no_sails_inpaint_v4.png')));
const body = new PNG({ width: bodySource.width, height: bodySource.height });

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

for (let i = 0; i < bodySource.width * bodySource.height; i++) {
    const p = i * 4;
    const r = bodySource.data[p];
    const g = bodySource.data[p + 1];
    const b = bodySource.data[p + 2];
    const yellowStrength = Math.min((r - 190) / 50, (g - 185) / 50, (120 - b) / 80);
    body.data[p] = r;
    body.data[p + 1] = g;
    body.data[p + 2] = b;
    body.data[p + 3] = Math.round(255 * (1 - clamp(yellowStrength, 0, 1)));
}

const terrainDir = path.join(projectRoot, 'assets', 'terrain');
const bodyPath = path.join(terrainDir, 'wheat_windmill_body.png');
fs.writeFileSync(bodyPath, PNG.sync.write(body));

const frameSize = 1024;
const columns = 4;
const rows = 4;
const frameCount = 16;
const sheet = new PNG({ width: frameSize * columns, height: frameSize * rows });
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const framePath = path.join(root, 'rendered', `sails_${String(frameIndex).padStart(2, '0')}.png`);
    const frame = PNG.sync.read(fs.readFileSync(framePath));
    if (frame.width !== frameSize || frame.height !== frameSize) {
        throw new Error(`${framePath} must be ${frameSize}x${frameSize}`);
    }
    const x = (frameIndex % columns) * frameSize;
    const y = Math.floor(frameIndex / columns) * frameSize;
    PNG.bitblt(frame, sheet, 0, 0, frameSize, frameSize, x, y);
}

const rotorPath = path.join(terrainDir, 'wheat_windmill_rotor.png');
fs.writeFileSync(rotorPath, PNG.sync.write(sheet));
console.log(JSON.stringify({ bodyPath, rotorPath, frameSize, frameCount, columns, rows }, null, 2));
