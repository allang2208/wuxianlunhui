import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public/data/player-anim-config.json'), 'utf8'));
const corrected = JSON.parse(fs.readFileSync(path.join(here, 'corrected-aim-arm-geometry.json'), 'utf8'));
const aim = config.gun_idle.twist.aimFrames;
const sheet = PNG.sync.read(fs.readFileSync(path.join(root, aim.src)));
const frameIndex = aim.frameCount - 1;
const scale = 3;
const out = new PNG({ width: aim.frameWidth * scale, height: aim.frameHeight * scale });

const bg = [38, 44, 54, 255];
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = bg[0];
  out.data[i + 1] = bg[1];
  out.data[i + 2] = bg[2];
  out.data[i + 3] = bg[3];
}

const xOffset = frameIndex * aim.frameWidth;
for (let y = 0; y < aim.frameHeight; y++) {
  for (let x = 0; x < aim.frameWidth; x++) {
    const si = (y * sheet.width + xOffset + x) * 4;
    const alpha = sheet.data[si + 3] / 255;
    for (let yy = 0; yy < scale; yy++) {
      for (let xx = 0; xx < scale; xx++) {
        const di = ((y * scale + yy) * out.width + x * scale + xx) * 4;
        out.data[di] = Math.round(sheet.data[si] * alpha + bg[0] * (1 - alpha));
        out.data[di + 1] = Math.round(sheet.data[si + 1] * alpha + bg[1] * (1 - alpha));
        out.data[di + 2] = Math.round(sheet.data[si + 2] * alpha + bg[2] * (1 - alpha));
        out.data[di + 3] = 255;
      }
    }
  }
}

function paintPoint(x, y, color, radius = 5) {
  const cx = Math.round(x * scale);
  const cy = Math.round(y * scale);
  const rr = radius * scale;
  for (let py = Math.max(0, cy - rr); py <= Math.min(out.height - 1, cy + rr); py++) {
    for (let px = Math.max(0, cx - rr); px <= Math.min(out.width - 1, cx + rr); px++) {
      const dx = px - cx;
      const dy = py - cy;
      const ring = Math.abs(Math.hypot(dx, dy) - rr * 0.72) <= 2 || Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
      if (!ring) continue;
      const di = (py * out.width + px) * 4;
      out.data[di] = color[0];
      out.data[di + 1] = color[1];
      out.data[di + 2] = color[2];
      out.data[di + 3] = 255;
    }
  }
}

const pivot = config.gun_idle.twist.arm;
const tracked = aim.hands[frameIndex];
const support = corrected.frames[frameIndex].target;
paintPoint(pivot.pivotX, pivot.pivotY, [255, 214, 64], 4);
paintPoint(tracked.x, tracked.y, [80, 255, 90], 5);
paintPoint(support.x, support.y, [255, 160, 48], 5);

const output = path.join(here, 'corrected-aim-final-frame-components.png');
fs.writeFileSync(output, PNG.sync.write(out));
console.log(output);
