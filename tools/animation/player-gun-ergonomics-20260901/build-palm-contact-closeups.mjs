import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const shotRoot = path.join(root, 'tools', 'verify-shots', 'gun-ads-runtime-20260901');
const outputRoot = path.join(shotRoot, 'palm-review');
fs.mkdirSync(outputRoot, { recursive: true });

const jobs = [
  ['akm-right-level', 'rifles_akm_right_level.png', 125, 75, 235, 205],
  ['m416-right-level', 'rifles_m416_right_level.png', 125, 75, 235, 205],
  ['super90-right-level', 'shotguns_super90_right_level.png', 125, 75, 235, 205],
  ['pkm-right-level', 'machine_guns_pkm_right_level.png', 125, 75, 235, 205],
  ['akm-left-level', 'rifles_akm_left_level.png', 250, 75, 235, 205],
  ['super90-left-level', 'shotguns_super90_left_level.png', 250, 75, 235, 205],
  ['akm-right-up', 'rifles_akm_right_up.png', 100, 85, 235, 205],
  ['akm-right-down', 'rifles_akm_right_down.png', 100, 25, 235, 230],
];

const scale = 4;
for (const [name, sourceName, cropX, cropY, cropW, cropH] of jobs) {
  const source = PNG.sync.read(fs.readFileSync(path.join(shotRoot, sourceName)));
  const output = new PNG({ width: cropW * scale, height: cropH * scale });
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const sourceX = Math.max(0, Math.min(source.width - 1, cropX + x));
      const sourceY = Math.max(0, Math.min(source.height - 1, cropY + y));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      for (let oy = 0; oy < scale; oy++) {
        for (let ox = 0; ox < scale; ox++) {
          const outputIndex = ((y * scale + oy) * output.width + x * scale + ox) * 4;
          for (let channel = 0; channel < 4; channel++) output.data[outputIndex + channel] = source.data[sourceIndex + channel];
        }
      }
    }
  }
  const outputPath = path.join(outputRoot, `${name}-4x.png`);
  fs.writeFileSync(outputPath, PNG.sync.write(output));
  console.log(outputPath);
}
