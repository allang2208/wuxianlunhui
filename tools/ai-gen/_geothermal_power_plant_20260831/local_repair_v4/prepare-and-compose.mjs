import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(folder, '../structure_correction_v3_12step/geothermal_power_plant/geothermal_power_plant_structure_v01_raw.png');
const maskPath = path.join(folder, 'geothermal_local_repair_mask.png');
const source = PNG.sync.read(fs.readFileSync(sourcePath));
const { width, height } = source;
if (width !== 1024 || height !== 1024) throw new Error('Mask coordinates require the selected 1024x1024 V01');

// These regions limit editing permission; they do not replace authored Depth geometry.
const regions = [
  [[620, 461], [675, 442], [677, 500], [619, 520]],
  [[316, 672], [489, 713], [521, 733], [506, 762], [466, 782], [456, 752], [480, 741], [449, 731], [317, 700]],
  [[314, 707], [418, 750], [416, 782], [312, 741]],
  [[327, 625], [370, 638], [440, 680], [468, 708], [467, 751], [410, 753], [410, 715], [327, 674]],
];
const protectedRegions = [
  [[270, 650], [314, 650], [325, 692], [322, 746], [341, 760], [337, 781], [291, 797], [244, 780], [240, 756], [265, 742]],
  [[408, 715], [445, 710], [466, 720], [470, 739], [459, 750], [414, 749], [403, 736]],
  [[416, 746], [459, 745], [460, 782], [477, 803], [483, 820], [471, 840], [429, 851], [390, 834], [382, 814], [402, 789], [411, 780]],
];

function polygonField(x, y, points) {
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return inside ? distance : -distance;
}

if (process.argv[2] !== 'compose') {
  const mask = new PNG({ width, height });
  const overlay = new PNG({ width, height });
  let editablePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    let permission = Math.max(0, ...regions.map(points => polygonField(x + 0.5, y + 0.5, points)));
    for (const points of protectedRegions) permission = Math.min(permission, Math.max(0, -polygonField(x + 0.5, y + 0.5, points)));
    const value = Math.round(255 * Math.min(1, permission / 4));
    if (value > 0) editablePixels++;
    mask.data.set([value, value, value, 255], p);
    const blend = value / 255 * 0.55;
    overlay.data.set([
      Math.round(source.data[p] * (1 - blend) + 255 * blend),
      Math.round(source.data[p + 1] * (1 - blend)),
      Math.round(source.data[p + 2] * (1 - blend)), 255,
    ], p);
  }
  fs.writeFileSync(maskPath, PNG.sync.write(mask));
  fs.writeFileSync(path.join(folder, 'mask_review.png'), PNG.sync.write(overlay));
  console.log(JSON.stringify({ maskPath, sourcePath, editablePixels, canvasPixels: width * height }));
} else {
  const mask = PNG.sync.read(fs.readFileSync(maskPath));
  for (const candidatePath of process.argv.slice(3)) {
    const candidate = PNG.sync.read(fs.readFileSync(candidatePath));
    if (candidate.width !== width || candidate.height !== height) throw new Error('Candidate dimensions differ');
    const output = new PNG({ width, height });
    for (let p = 0; p < source.data.length; p += 4) {
      const amount = mask.data[p] / 255;
      for (let channel = 0; channel < 3; channel++) {
        output.data[p + channel] = Math.round(source.data[p + channel] * (1 - amount) + candidate.data[p + channel] * amount);
      }
      output.data[p + 3] = source.data[p + 3];
    }
    const outputPath = path.join(folder, path.basename(candidatePath).replace('_raw.png', '_local_locked.png'));
    fs.writeFileSync(outputPath, PNG.sync.write(output));
    console.log(outputPath);
  }
}
