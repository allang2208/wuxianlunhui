import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const playerConfigPath = path.join(root, 'public', 'data', 'player-anim-config.json');
const playerConfig = JSON.parse(fs.readFileSync(playerConfigPath, 'utf8'));
const aim = playerConfig.gun_idle.twist.aimFrames;
const arm = playerConfig.gun_idle.twist.arm;

const rawPath = path.join(here, 'hand-poses-firing-grip-v5-raw.png');
// Always rebuild from the preserved hand-bearing main-arm atlas. aim.src points
// at this script's handless output after integration and must not become a
// self-referential input on subsequent calibration passes.
const sourcePath = path.join(root, 'assets', 'player', 'gun_aim_frames.png');
const cleanPath = path.join(here, 'hand-poses-firing-grip-v5-clean.png');
const previewPath = path.join(here, 'right-firing-hand-layer-preview.png');
const previewZoomPath = path.join(here, 'right-firing-hand-layer-preview-4x.png');
const manifestPath = path.join(here, 'right-firing-hand-build.json');
const armOutputPath = path.join(root, 'assets', 'player', 'gun_aim_arm_frames.png');
const handOutputPath = path.join(root, 'assets', 'player', 'gun_aim_firing_hand_frames.png');

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const raw = PNG.sync.read(fs.readFileSync(rawPath));
const frameWidth = aim.frameWidth;
const frameHeight = aim.frameHeight;
const frameCount = aim.frameCount;
const handFrameWidth = 128;
const handFrameHeight = 128;
const handAnchor = { x: 64, y: 64 };
const poseCount = 5;
const selectedPose = 2;

function isExteriorLight(image, pixelIndex) {
  const i = pixelIndex * 4;
  if (image.data[i + 3] <= 8) return true;
  const r = image.data[i];
  const g = image.data[i + 1];
  const b = image.data[i + 2];
  return Math.min(r, g, b) >= 202 && Math.max(r, g, b) - Math.min(r, g, b) <= 34;
}

function removeExteriorLightBackground(image) {
  const result = new PNG({ width: image.width, height: image.height });
  image.data.copy(result.data);
  const visited = new Uint8Array(image.width * image.height);
  const queue = new Int32Array(image.width * image.height);
  let head = 0;
  let tail = 0;
  const enqueue = (pixelIndex) => {
    if (visited[pixelIndex] || !isExteriorLight(result, pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[tail++] = pixelIndex;
  };
  for (let x = 0; x < image.width; x++) {
    enqueue(x);
    enqueue((image.height - 1) * image.width + x);
  }
  for (let y = 0; y < image.height; y++) {
    enqueue(y * image.width);
    enqueue(y * image.width + image.width - 1);
  }
  while (head < tail) {
    const pixelIndex = queue[head++];
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < image.width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - image.width);
    if (y + 1 < image.height) enqueue(pixelIndex + image.width);
  }
  for (let pixelIndex = 0; pixelIndex < visited.length; pixelIndex++) {
    if (visited[pixelIndex]) result.data[pixelIndex * 4 + 3] = 0;
  }
  return result;
}

function isNeonGuide(r, g, b, a) {
  return a > 24 && g >= 125 && g >= r * 1.35 && g >= b * 1.18 && g - Math.max(r, b) >= 38;
}

function findOpaqueBounds(image, minX, maxX) {
  const bounds = { minX: maxX, minY: image.height - 1, maxX: minX, maxY: 0 };
  for (let y = 0; y < image.height; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= 24) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new Error('No firing-hand pixels found in selected pose');
  }
  return bounds;
}

function sampleBilinear(image, x, y) {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) return [0, 0, 0, 0];
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const samples = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ];
  let alpha = 0;
  const premul = [0, 0, 0];
  for (const [sx, sy, weight] of samples) {
    const i = (sy * image.width + sx) * 4;
    const sampleAlpha = image.data[i + 3] / 255 * weight;
    alpha += sampleAlpha;
    for (let channel = 0; channel < 3; channel++) premul[channel] += image.data[i + channel] * sampleAlpha;
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round(premul[0] / alpha),
    Math.round(premul[1] / alpha),
    Math.round(premul[2] / alpha),
    Math.round(Math.min(1, alpha) * 255),
  ];
}

function copyPixel(output, x, y, rgba) {
  if (x < 0 || x >= output.width || y < 0 || y >= output.height) return;
  const i = (y * output.width + x) * 4;
  output.data[i] = rgba[0];
  output.data[i + 1] = rgba[1];
  output.data[i + 2] = rgba[2];
  output.data[i + 3] = rgba[3];
}

function retainLargestOpaqueComponent(image) {
  const labels = new Int32Array(image.width * image.height);
  labels.fill(-1);
  const queue = new Int32Array(labels.length);
  const areas = [];
  let component = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1 || image.data[start * 4 + 3] <= 16) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = component;
    while (head < tail) {
      const point = queue[head++];
      const x = point % image.width;
      const y = Math.floor(point / image.width);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || xx >= image.width || yy < 0 || yy >= image.height) continue;
          const next = yy * image.width + xx;
          if (labels[next] !== -1 || image.data[next * 4 + 3] <= 16) continue;
          labels[next] = component;
          queue[tail++] = next;
        }
      }
    }
    areas.push(tail);
    component++;
  }
  const keep = areas.indexOf(Math.max(...areas));
  for (let pixelIndex = 0; pixelIndex < labels.length; pixelIndex++) {
    if (labels[pixelIndex] !== keep) image.data[pixelIndex * 4 + 3] = 0;
  }
}

function compositePixel(output, x, y, rgba) {
  if (x < 0 || x >= output.width || y < 0 || y >= output.height || rgba[3] <= 0) return;
  const i = (y * output.width + x) * 4;
  const sourceAlpha = rgba[3] / 255;
  const destinationAlpha = output.data[i + 3] / 255;
  const finalAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel++) {
    const sourcePremultiplied = rgba[channel] * sourceAlpha;
    const destinationPremultiplied = output.data[i + channel] * destinationAlpha * (1 - sourceAlpha);
    output.data[i + channel] = Math.round((sourcePremultiplied + destinationPremultiplied) / Math.max(0.0001, finalAlpha));
  }
  output.data[i + 3] = Math.round(finalAlpha * 255);
}

let cleanedRaw = removeExteriorLightBackground(raw);
const cellMinX = Math.round(selectedPose * cleanedRaw.width / poseCount);
const cellMaxX = Math.round((selectedPose + 1) * cleanedRaw.width / poseCount) - 1;
let guideX = 0;
let guideY = 0;
let guideWeight = 0;
for (let y = 0; y < cleanedRaw.height; y++) {
  for (let x = cellMinX; x <= cellMaxX; x++) {
    const i = (y * cleanedRaw.width + x) * 4;
    const [r, g, b, a] = cleanedRaw.data.subarray(i, i + 4);
    if (!isNeonGuide(r, g, b, a)) continue;
    const weight = a / 255;
    guideX += x * weight;
    guideY += y * weight;
    guideWeight += weight;
    cleanedRaw.data[i + 3] = 0;
  }
}
if (guideWeight <= 0) throw new Error('Neon firing-grip guide not found');
const sourceAnchor = { x: guideX / guideWeight, y: guideY / guideWeight };
cleanedRaw = removeExteriorLightBackground(cleanedRaw);
const bounds = findOpaqueBounds(cleanedRaw, cellMinX, cellMaxX);

const margin = 5;
const available = {
  left: handAnchor.x - margin,
  right: handFrameWidth - 1 - margin - handAnchor.x,
  top: handAnchor.y - margin,
  bottom: handFrameHeight - 1 - margin - handAnchor.y,
};
const distances = {
  left: Math.max(1, sourceAnchor.x - bounds.minX),
  right: Math.max(1, bounds.maxX - sourceAnchor.x),
  top: Math.max(1, sourceAnchor.y - bounds.minY),
  bottom: Math.max(1, bounds.maxY - sourceAnchor.y),
};
// The generated reference is intentionally large and legible. Normalize it to
// the established in-game skeletal-hand footprint instead of letting it fill
// the whole 128 px helper cell (which would make the hand larger than the grip).
const poseScale = 0.72 * Math.min(
  available.left / distances.left,
  available.right / distances.right,
  available.top / distances.top,
  available.bottom / distances.bottom
);

const cleanPose = new PNG({ width: handFrameWidth, height: handFrameHeight });
for (let y = 0; y < handFrameHeight; y++) {
  for (let x = 0; x < handFrameWidth; x++) {
    const sourceX = sourceAnchor.x + (x - handAnchor.x) / poseScale;
    const sourceY = sourceAnchor.y + (y - handAnchor.y) / poseScale;
    const rgba = sourceX < bounds.minX || sourceX > bounds.maxX
      || sourceY < bounds.minY || sourceY > bounds.maxY
      ? [0, 0, 0, 0]
      : sampleBilinear(cleanedRaw, sourceX, sourceY);
    copyPixel(cleanPose, x, y, rgba);
  }
}
retainLargestOpaqueComponent(cleanPose);

const firingHandAtlas = new PNG({ width: handFrameWidth * frameCount, height: handFrameHeight });
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
  for (let y = 0; y < handFrameHeight; y++) {
    for (let x = 0; x < handFrameWidth; x++) {
      const sourceIndex = (y * handFrameWidth + x) * 4;
      const destinationIndex = (y * firingHandAtlas.width + frameIndex * handFrameWidth + x) * 4;
      cleanPose.data.copy(firingHandAtlas.data, destinationIndex, sourceIndex, sourceIndex + 4);
    }
  }
}

const armAtlas = new PNG({ width: source.width, height: source.height });
source.data.copy(armAtlas.data);
const wristCutReach = 27;
// Keep the old palm/fingers removed, but restore a narrow strip of the original
// wrist between the surviving forearm and the shared rear-grip origin.  The
// firing hand rotates with the weapon while the arm rotates around the
// shoulder, so a shared opaque grip pixel is the only connection that remains
// exact at every aim angle.  Reusing source pixels also preserves the accepted
// arm silhouette without painting a synthetic straight connector.
const wristBridgeHalfWidth = 7;
const wristBridgeEndReach = 3;
const removedByFrame = [];
const wristBridgeByFrame = [];
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
  const hand = aim.hands[frameIndex];
  const vectorX = hand.x - arm.pivotX;
  const vectorY = hand.y - arm.pivotY;
  const vectorLength = Math.max(1, Math.hypot(vectorX, vectorY));
  const unitX = vectorX / vectorLength;
  const unitY = vectorY / vectorLength;
  let bridgeStart = null;
  let bridgeStartDistance = Infinity;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const globalX = frameIndex * frameWidth + x;
      const i = (y * source.width + globalX) * 4;
      if (source.data[i + 3] <= 0) continue;
      const along = (x - hand.x) * unitX + (y - hand.y) * unitY;
      if (along > -wristCutReach) continue;
      const distance = Math.hypot(x - hand.x, y - hand.y);
      if (distance < bridgeStartDistance) {
        bridgeStartDistance = distance;
        bridgeStart = { x, y };
      }
    }
  }
  if (!bridgeStart) {
    throw new Error(`Unable to locate surviving forearm endpoint for aim frame ${frameIndex}`);
  }
  const bridgeVectorX = hand.x - bridgeStart.x;
  const bridgeVectorY = hand.y - bridgeStart.y;
  const bridgeLength = Math.max(1, Math.hypot(bridgeVectorX, bridgeVectorY));
  const bridgeUnitX = bridgeVectorX / bridgeLength;
  const bridgeUnitY = bridgeVectorY / bridgeLength;
  let removed = 0;
  let bridgeKept = 0;
  let gripOpaque = false;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const globalX = frameIndex * frameWidth + x;
      const i = (y * armAtlas.width + globalX) * 4;
      if (armAtlas.data[i + 3] <= 0) continue;
      const along = (x - hand.x) * unitX + (y - hand.y) * unitY;
      if (along <= -wristCutReach) continue;
      const bridgeAlong = (x - bridgeStart.x) * bridgeUnitX + (y - bridgeStart.y) * bridgeUnitY;
      const bridgeAcross = Math.abs(
        (x - bridgeStart.x) * -bridgeUnitY + (y - bridgeStart.y) * bridgeUnitX
      );
      const bridgeProgress = Math.max(0, Math.min(1, bridgeAlong / bridgeLength));
      const taperedHalfWidth = wristBridgeHalfWidth - bridgeProgress * 2;
      const keepWristBridge = bridgeAlong >= -1
        && bridgeAlong <= bridgeLength + wristBridgeEndReach
        && bridgeAcross <= taperedHalfWidth;
      if (keepWristBridge) {
        bridgeKept++;
        if (Math.hypot(x - hand.x, y - hand.y) <= 1.5) gripOpaque = true;
        continue;
      }
      armAtlas.data[i + 3] = 0;
      removed++;
    }
  }
  removedByFrame.push(removed);
  wristBridgeByFrame.push({
    start: bridgeStart,
    end: hand,
    length: Number(bridgeLength.toFixed(3)),
    keptPixels: bridgeKept,
    gripOpaque,
  });
  if (!gripOpaque) {
    throw new Error(`Wrist bridge does not reach the rear-grip origin in aim frame ${frameIndex}`);
  }
}

const finalFrame = frameCount - 1;
const preview = new PNG({ width: frameWidth, height: frameHeight });
for (let y = 0; y < frameHeight; y++) {
  for (let x = 0; x < frameWidth; x++) {
    const sourceIndex = (y * armAtlas.width + finalFrame * frameWidth + x) * 4;
    const destinationIndex = (y * preview.width + x) * 4;
    armAtlas.data.copy(preview.data, destinationIndex, sourceIndex, sourceIndex + 4);
  }
}
const finalHand = aim.hands[finalFrame];
const handTopLeft = {
  x: Math.round(finalHand.x - handAnchor.x),
  y: Math.round(finalHand.y - handAnchor.y),
};
for (let y = 0; y < handFrameHeight; y++) {
  for (let x = 0; x < handFrameWidth; x++) {
    const i = (y * handFrameWidth + x) * 4;
    compositePixel(preview, handTopLeft.x + x, handTopLeft.y + y, Array.from(cleanPose.data.subarray(i, i + 4)));
  }
}

const previewZoom = new PNG({ width: frameWidth * 4, height: frameHeight * 4 });
for (let y = 0; y < previewZoom.height; y++) {
  for (let x = 0; x < previewZoom.width; x++) {
    const sourceX = Math.floor(x / 4);
    const sourceY = Math.floor(y / 4);
    const sourceIndex = (sourceY * preview.width + sourceX) * 4;
    const destinationIndex = (y * previewZoom.width + x) * 4;
    preview.data.copy(previewZoom.data, destinationIndex, sourceIndex, sourceIndex + 4);
  }
}

fs.writeFileSync(cleanPath, PNG.sync.write(cleanPose));
fs.writeFileSync(armOutputPath, PNG.sync.write(armAtlas));
fs.writeFileSync(handOutputPath, PNG.sync.write(firingHandAtlas));
fs.writeFileSync(previewPath, PNG.sync.write(preview));
fs.writeFileSync(previewZoomPath, PNG.sync.write(previewZoom));
fs.writeFileSync(manifestPath, JSON.stringify({
  direction: 'right',
  weaponAxis: 'muzzle points right',
  sourceAimFrames: path.relative(root, sourcePath).replaceAll('\\', '/'),
  sourceHandReference: path.relative(root, rawPath).replaceAll('\\', '/'),
  selectedPose,
  selectedPoseMeaning: 'closed firing-hand grasp; trigger finger separated toward muzzle',
  rearContact: 'neon guide centroid is the runtime rear-grip origin',
  supportContact: 'unchanged independent support-arm layer; per-texture supportGrip remains authoritative',
  frameSize: { width: handFrameWidth, height: handFrameHeight },
  anchor: handAnchor,
  poseScale: Number(poseScale.toFixed(6)),
  sourceAnchor: { x: Number(sourceAnchor.x.toFixed(2)), y: Number(sourceAnchor.y.toFixed(2)) },
  sourceBounds: bounds,
  wristCutReach,
  wristBridgeHalfWidth,
  wristBridgeEndReach,
  wristBridgeByFrame,
  removedPixelsByFrame: removedByFrame,
  outputArm: path.relative(root, armOutputPath).replaceAll('\\', '/'),
  outputHand: path.relative(root, handOutputPath).replaceAll('\\', '/'),
  referenceFrames: [0, 6, 13],
}, null, 2));

console.log(JSON.stringify({ armOutputPath, handOutputPath, cleanPath, previewPath, poseScale, removedByFrame }, null, 2));
