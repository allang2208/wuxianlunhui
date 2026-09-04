import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/player-anim-config.json'), 'utf8'));
const aim = config.gun_idle.twist.aimFrames;
const frame = aim.frameCount - 1;
const variants = {
  rifle_lmg: { path: aim.supportSrc, contact: aim.supportContacts[frame] },
  shotgun: { path: aim.supportVariants.shotgun, contact: aim.supportContactVariants.shotgun[frame] },
};

function paintMarker(image, x, y, color) {
  const radius = 8;
  for (let py = Math.max(0, y - radius); py <= Math.min(image.height - 1, y + radius); py++) {
    for (let px = Math.max(0, x - radius); px <= Math.min(image.width - 1, x + radius); px++) {
      const dx = px - x;
      const dy = py - y;
      if (Math.abs(Math.hypot(dx, dy) - radius * 0.72) > 1.2 && Math.abs(dx) > 1 && Math.abs(dy) > 1) continue;
      const index = (py * image.width + px) * 4;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
      image.data[index + 3] = 255;
    }
  }
}

for (const [variant, entry] of Object.entries(variants)) {
  const sheet = PNG.sync.read(fs.readFileSync(path.join(root, entry.path)));
  const crop = { x: 350, y: 35, width: 162, height: 150 };
  const scale = 4;
  const output = new PNG({ width: crop.width * scale, height: crop.height * scale });
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const sourceIndex = ((crop.y + y) * sheet.width + frame * aim.frameWidth + crop.x + x) * 4;
      const alpha = sheet.data[sourceIndex + 3] / 255;
      for (let oy = 0; oy < scale; oy++) {
        for (let ox = 0; ox < scale; ox++) {
          const outputIndex = ((y * scale + oy) * output.width + x * scale + ox) * 4;
          output.data[outputIndex] = Math.round(sheet.data[sourceIndex] * alpha + 214 * (1 - alpha));
          output.data[outputIndex + 1] = Math.round(sheet.data[sourceIndex + 1] * alpha + 214 * (1 - alpha));
          output.data[outputIndex + 2] = Math.round(sheet.data[sourceIndex + 2] * alpha + 214 * (1 - alpha));
          output.data[outputIndex + 3] = 255;
        }
      }
    }
  }
  paintMarker(
    output,
    Math.round((entry.contact.x - crop.x) * scale),
    Math.round((entry.contact.y - crop.y) * scale),
    [255, 145, 24]
  );
  const outputPath = path.join(here, `support-palm-anchor-${variant}-4x.png`);
  fs.writeFileSync(outputPath, PNG.sync.write(output));
  console.log(outputPath);
}
