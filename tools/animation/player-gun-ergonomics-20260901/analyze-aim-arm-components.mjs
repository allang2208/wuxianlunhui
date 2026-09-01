import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const playerConfig = JSON.parse(fs.readFileSync(path.join(root, 'public/data/player-anim-config.json'), 'utf8'));
const aim = playerConfig.gun_idle.twist.aimFrames;
const arm = playerConfig.gun_idle.twist.arm;
const preservedSource = path.join(here, 'gun_aim_frames-original.png');
const analysisSource = fs.existsSync(preservedSource) ? preservedSource : path.join(root, aim.src);
const sheet = PNG.sync.read(fs.readFileSync(analysisSource));
const fw = aim.frameWidth;
const fh = aim.frameHeight;
const previewCols = 7;
const preview = new PNG({
  width: fw * previewCols,
  height: fh * Math.ceil(aim.frameCount / previewCols),
});
const sourcePreview = new PNG({ width: preview.width, height: preview.height });
for (let i = 0; i < sourcePreview.data.length; i += 4) {
  sourcePreview.data[i] = 210;
  sourcePreview.data[i + 1] = 210;
  sourcePreview.data[i + 2] = 210;
  sourcePreview.data[i + 3] = 255;
}

function analyzeFrame(frameIndex) {
  const alpha = new Uint8Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const si = (y * sheet.width + frameIndex * fw + x) * 4;
      alpha[y * fw + x] = sheet.data[si + 3] > 40 ? 1 : 0;
    }
  }

  // Skeleton joints are separated by one-to-three transparent pixels. Dilate only
  // for component labelling, then measure the untouched source pixels.
  const dilated = new Uint8Array(alpha.length);
  const radius = 4;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (!alpha[y * fw + x]) continue;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= fh) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          const xx = x + ox;
          if (xx >= 0 && xx < fw) dilated[yy * fw + xx] = 1;
        }
      }
    }
  }

  const labels = new Int32Array(alpha.length);
  labels.fill(-1);
  const components = [];
  const queue = new Int32Array(alpha.length);
  for (let start = 0; start < dilated.length; start++) {
    if (!dilated[start] || labels[start] !== -1) continue;
    const id = components.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    let dilatedArea = 0;
    while (head < tail) {
      const p = queue[head++];
      dilatedArea++;
      const x = p % fw;
      const y = Math.floor(p / fw);
      for (let oy = -1; oy <= 1; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= fh) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const xx = x + ox;
          if (xx < 0 || xx >= fw) continue;
          const np = yy * fw + xx;
          if (dilated[np] && labels[np] === -1) {
            labels[np] = id;
            queue[tail++] = np;
          }
        }
      }
    }
    components.push({ id, dilatedArea, area: 0, minX: fw, minY: fh, maxX: -1, maxY: -1, sumX: 0, sumY: 0 });
  }

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const p = y * fw + x;
      if (!alpha[p]) continue;
      const c = components[labels[p]];
      c.area++;
      c.minX = Math.min(c.minX, x);
      c.minY = Math.min(c.minY, y);
      c.maxX = Math.max(c.maxX, x);
      c.maxY = Math.max(c.maxY, y);
      c.sumX += x;
      c.sumY += y;
    }
  }

  const tracked = aim.hands[frameIndex];
  const tx = Math.max(0, Math.min(fw - 1, Math.round(tracked.x)));
  const ty = Math.max(0, Math.min(fh - 1, Math.round(tracked.y)));
  let trackedId = labels[ty * fw + tx];
  if (trackedId < 0) {
    let best = null;
    for (let y = Math.max(0, ty - 10); y <= Math.min(fh - 1, ty + 10); y++) {
      for (let x = Math.max(0, tx - 10); x <= Math.min(fw - 1, tx + 10); x++) {
        if (!alpha[y * fw + x]) continue;
        const d = Math.hypot(x - tracked.x, y - tracked.y);
        if (!best || d < best.d) best = { d, id: labels[y * fw + x] };
      }
    }
    trackedId = best?.id ?? -1;
  }

  const tileX = (frameIndex % previewCols) * fw;
  const tileY = Math.floor(frameIndex / previewCols) * fh;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const p = y * fw + x;
      if (!alpha[p]) continue;
      const di = ((tileY + y) * preview.width + tileX + x) * 4;
      const trackedPixel = labels[p] === trackedId;
      preview.data[di] = trackedPixel ? 255 : 40;
      preview.data[di + 1] = trackedPixel ? 80 : 220;
      preview.data[di + 2] = trackedPixel ? 70 : 255;
      preview.data[di + 3] = 255;
      const si = (y * sheet.width + frameIndex * fw + x) * 4;
      const alphaValue = sheet.data[si + 3] / 255;
      sourcePreview.data[di] = Math.round(sheet.data[si] * alphaValue + 210 * (1 - alphaValue));
      sourcePreview.data[di + 1] = Math.round(sheet.data[si + 1] * alphaValue + 210 * (1 - alphaValue));
      sourcePreview.data[di + 2] = Math.round(sheet.data[si + 2] * alphaValue + 210 * (1 - alphaValue));
      sourcePreview.data[di + 3] = 255;
    }
  }

  const measured = components
    .filter((c) => c.area >= 40)
    .map((c) => ({
      id: c.id,
      role: c.id === trackedId ? 'tracked-grip-arm' : 'other',
      area: c.area,
      bbox: [c.minX, c.minY, c.maxX, c.maxY],
      centroid: [Number((c.sumX / c.area).toFixed(2)), Number((c.sumY / c.area).toFixed(2))],
    }))
    .sort((a, b) => b.area - a.area);
  const otherPixels = [];
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const p = y * fw + x;
      if (alpha[p] && labels[p] !== trackedId) otherPixels.push({ x, y });
    }
  }
  const minOtherY = Math.min(...otherPixels.map((p) => p.y));
  const maxOtherY = Math.max(...otherPixels.map((p) => p.y));
  const minOtherX = Math.min(...otherPixels.map((p) => p.x));
  const top = otherPixels.filter((p) => p.y <= minOtherY + 26);
  const topMaxX = Math.max(...top.map((p) => p.x));
  const shoulderCluster = top.filter((p) => p.x >= topMaxX - 10);
  const bottom = otherPixels.filter((p) => p.y >= maxOtherY - 34);
  const bottomMaxX = Math.max(...bottom.map((p) => p.x));
  const handCluster = bottom.filter((p) => p.x >= bottomMaxX - 18);
  const centroid = (points) => ({
    x: Number((points.reduce((sum, p) => sum + p.x, 0) / points.length).toFixed(1)),
    y: Number((points.reduce((sum, p) => sum + p.y, 0) / points.length).toFixed(1)),
  });
  const supportPivot = centroid(shoulderCluster);
  const supportHand = centroid(handCluster);
  const elbowCluster = otherPixels.filter((p) => p.x <= minOtherX + 14);
  const supportElbow = centroid(elbowCluster);
  const drawMarker = (point, rgb) => {
    for (let oy = -5; oy <= 5; oy++) {
      for (let ox = -5; ox <= 5; ox++) {
        if (Math.abs(ox) !== 5 && Math.abs(oy) !== 5) continue;
        const px = Math.round(point.x) + ox;
        const py = Math.round(point.y) + oy;
        if (px < 0 || px >= fw || py < 0 || py >= fh) continue;
        const di = ((tileY + py) * preview.width + tileX + px) * 4;
        preview.data[di] = rgb[0];
        preview.data[di + 1] = rgb[1];
        preview.data[di + 2] = rgb[2];
        preview.data[di + 3] = 255;
      }
    }
  };
  drawMarker(supportPivot, [255, 230, 0]);
  drawMarker(supportHand, [0, 255, 80]);
  drawMarker(supportElbow, [255, 0, 255]);
  return {
    frame: frameIndex,
    tracked,
    pivot: { x: arm.pivotX, y: arm.pivotY },
    supportPivot,
    supportElbow,
    supportHand,
    trackedId,
    components: measured,
  };
}

const report = {
  source: path.relative(root, analysisSource).replaceAll('\\', '/'),
  frameWidth: fw,
  frameHeight: fh,
  frameCount: aim.frameCount,
  dilationRadius: 4,
  frames: Array.from({ length: aim.frameCount }, (_, i) => analyzeFrame(i)),
};
const output = path.join(here, 'aim-arm-components.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
const previewOutput = path.join(here, 'aim-arm-components.png');
fs.writeFileSync(previewOutput, PNG.sync.write(preview));
const sourcePreviewOutput = path.join(here, 'aim-arm-source-alpha.png');
fs.writeFileSync(sourcePreviewOutput, PNG.sync.write(sourcePreview));
console.log(output);
console.log(previewOutput);
console.log(sourcePreviewOutput);
for (const frame of report.frames) {
  console.log(`frame ${frame.frame}:`, frame.components.map((c) => `${c.role} area=${c.area} bbox=${c.bbox.join(',')}`).join(' | '));
}
