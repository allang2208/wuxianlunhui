import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public/data/player-anim-config.json'), 'utf8'));
const weaponConfig = JSON.parse(fs.readFileSync(path.join(root, 'public/data/weapon-anim-config.json'), 'utf8'));
const aim = config.gun_idle.twist.aimFrames;
const analysis = JSON.parse(fs.readFileSync(path.join(here, 'aim-arm-components.json'), 'utf8'));
// This stage owns the preserved hand-bearing main arm. The current aim.src is
// the downstream handless atlas produced by build-firing-hand-layer.mjs and
// must not be overwritten when the support-arm stage is rebuilt.
const runtimePath = path.join(root, 'assets/player/gun_aim_frames.png');
const sourcePath = path.join(here, 'gun_aim_frames-original.png');
if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, fs.readFileSync(runtimePath));

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const fw = aim.frameWidth;
const fh = aim.frameHeight;
const frameCount = aim.frameCount;
const mainOutput = new PNG({ width: fw * frameCount, height: fh });
const supportRuntimePaths = {
  rifleLmg: path.join(root, aim.supportSrc || 'assets/player/gun_aim_support_frames.png'),
  shotgun: path.join(root, aim.supportVariants?.shotgun || 'assets/player/gun_aim_support_frames_shotgun.png'),
};
const supportOutputs = {
  rifleLmg: new PNG({ width: fw * frameCount, height: fh }),
  shotgun: new PNG({ width: fw * frameCount, height: fh }),
};
const combinedPaths = {
  rifleLmg: path.join(here, 'corrected-aim-combined-frames.png'),
  shotgun: path.join(here, 'corrected-aim-combined-frames-shotgun.png'),
};
const combinedOutputs = {
  rifleLmg: new PNG({ width: fw * frameCount, height: fh }),
  shotgun: new PNG({ width: fw * frameCount, height: fh }),
};
const handPoseSourcePaths = {
  rifleLmg: path.join(here, 'hand-poses-rifle-lmg-v2-raw.png'),
  shotgun: path.join(here, 'hand-poses-shotgun-v2-raw.png'),
};

function labelFrame(frameIndex) {
  const alpha = new Uint8Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const si = (y * source.width + frameIndex * fw + x) * 4;
      alpha[y * fw + x] = source.data[si + 3] > 40 ? 1 : 0;
    }
  }
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
  const queue = new Int32Array(alpha.length);
  let componentCount = 0;
  for (let start = 0; start < dilated.length; start++) {
    if (!dilated[start] || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = componentCount;
    while (head < tail) {
      const p = queue[head++];
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
            labels[np] = componentCount;
            queue[tail++] = np;
          }
        }
      }
    }
    componentCount++;
  }
  const hand = aim.hands[frameIndex];
  let trackedId = labels[Math.round(hand.y) * fw + Math.round(hand.x)];
  if (trackedId < 0) {
    let nearest = null;
    for (let y = Math.max(0, Math.round(hand.y) - 10); y <= Math.min(fh - 1, Math.round(hand.y) + 10); y++) {
      for (let x = Math.max(0, Math.round(hand.x) - 10); x <= Math.min(fw - 1, Math.round(hand.x) + 10); x++) {
        if (!alpha[y * fw + x]) continue;
        const distance = Math.hypot(x - hand.x, y - hand.y);
        if (!nearest || distance < nearest.distance) nearest = { distance, id: labels[y * fw + x] };
      }
    }
    trackedId = nearest?.id ?? -1;
  }
  return { alpha, labels, trackedId };
}

function nearestRole(labels, trackedId, x, y) {
  const own = labels[y * fw + x];
  if (own >= 0) return own === trackedId ? 'main' : 'support';
  for (let radius = 1; radius <= 5; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = y + oy;
      if (yy < 0 || yy >= fh) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        const xx = x + ox;
        if (xx < 0 || xx >= fw) continue;
        const id = labels[yy * fw + xx];
        if (id >= 0) return id === trackedId ? 'main' : 'support';
      }
    }
  }
  return null;
}

function pointSegmentDistance(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const denom = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / denom));
  return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
}

function compositePixel(output, frameIndex, x, y, rgba, weight = 1) {
  if (x < 0 || x >= fw || y < 0 || y >= fh || weight <= 0) return;
  const di = (y * output.width + frameIndex * fw + x) * 4;
  const srcAlpha = (rgba[3] / 255) * weight;
  if (srcAlpha <= 0) return;
  const dstAlpha = output.data[di + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  for (let channel = 0; channel < 3; channel++) {
    const srcPremul = rgba[channel] * srcAlpha;
    const dstPremul = output.data[di + channel] * dstAlpha * (1 - srcAlpha);
    output.data[di + channel] = Math.round((srcPremul + dstPremul) / Math.max(0.0001, outAlpha));
  }
  output.data[di + 3] = Math.round(outAlpha * 255);
}

function splat(output, frameIndex, x, y, rgba, weight = 1) {
  // Keep the opaque core of the original line art; the weighted neighbours only
  // antialias the rotated edge. Pure weighted forward splats made the arm fade.
  compositePixel(output, frameIndex, Math.round(x), Math.round(y), rgba, weight);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  compositePixel(output, frameIndex, x0, y0, rgba, weight * (1 - fx) * (1 - fy));
  compositePixel(output, frameIndex, x0 + 1, y0, rgba, weight * fx * (1 - fy));
  compositePixel(output, frameIndex, x0, y0 + 1, rgba, weight * (1 - fx) * fy);
  compositePixel(output, frameIndex, x0 + 1, y0 + 1, rgba, weight * fx * fy);
}

function rotatePoint(point, origin, targetOrigin, angle) {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: targetOrigin.x + x * cos - y * sin,
    y: targetOrigin.y + x * sin + y * cos,
  };
}

function mapSegmentPoint(point, sourceA, sourceB, targetA, targetB) {
  const sourceDx = sourceB.x - sourceA.x;
  const sourceDy = sourceB.y - sourceA.y;
  const sourceLength = Math.max(0.001, Math.hypot(sourceDx, sourceDy));
  const sourceUx = sourceDx / sourceLength;
  const sourceUy = sourceDy / sourceLength;
  const targetDx = targetB.x - targetA.x;
  const targetDy = targetB.y - targetA.y;
  const targetLength = Math.max(0.001, Math.hypot(targetDx, targetDy));
  const targetUx = targetDx / targetLength;
  const targetUy = targetDy / targetLength;
  const localX = (point.x - sourceA.x) * sourceUx + (point.y - sourceA.y) * sourceUy;
  const localY = -(point.x - sourceA.x) * sourceUy + (point.y - sourceA.y) * sourceUx;
  const stretchedX = localX * (targetLength / sourceLength);
  return {
    x: targetA.x + targetUx * stretchedX - targetUy * localY,
    y: targetA.y + targetUy * stretchedX + targetUx * localY,
  };
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function removeExteriorLightBackground(image) {
  let hasTransparency = false;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] < 250) {
      hasTransparency = true;
      break;
    }
  }
  if (hasTransparency) return image;

  const result = new PNG({ width: image.width, height: image.height });
  image.data.copy(result.data);
  const visited = new Uint8Array(image.width * image.height);
  const queue = new Int32Array(image.width * image.height);
  let head = 0;
  let tail = 0;
  const isExteriorLight = (pixelIndex) => {
    const i = pixelIndex * 4;
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    return Math.min(r, g, b) >= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 28;
  };
  const enqueue = (pixelIndex) => {
    if (visited[pixelIndex] || !isExteriorLight(pixelIndex)) return;
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

function findBrightComponents(image, bbox) {
  const width = bbox.maxX - bbox.minX + 1;
  const height = bbox.maxY - bbox.minY + 1;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  const isBright = (x, y) => {
    const i = (y * image.width + x) * 4;
    return image.data[i + 3] >= 180
      && (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3 >= 205;
  };
  for (let localY = 0; localY < height; localY++) {
    for (let localX = 0; localX < width; localX++) {
      const start = localY * width + localX;
      if (visited[start] || !isBright(bbox.minX + localX, bbox.minY + localY)) continue;
      let head = 0;
      let tail = 0;
      let minX = localX;
      let maxX = localX;
      let minY = localY;
      let maxY = localY;
      let sumX = 0;
      let sumY = 0;
      queue[tail++] = start;
      visited[start] = 1;
      while (head < tail) {
        const point = queue[head++];
        const x = point % width;
        const y = Math.floor(point / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const xx = x + ox;
            const yy = y + oy;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
            const next = yy * width + xx;
            if (visited[next] || !isBright(bbox.minX + xx, bbox.minY + yy)) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      components.push({
        area: tail,
        minX: bbox.minX + minX,
        maxX: bbox.minX + maxX,
        minY: bbox.minY + minY,
        maxY: bbox.minY + maxY,
        x: bbox.minX + sumX / tail,
        y: bbox.minY + sumY / tail,
      });
    }
  }
  return components;
}

function extractHandPoses(filePath) {
  const image = removeExteriorLightBackground(PNG.sync.read(fs.readFileSync(filePath)));
  const poses = [];
  const poseCount = 5;
  for (let poseIndex = 0; poseIndex < poseCount; poseIndex++) {
    const cellMinX = Math.round((poseIndex * image.width) / poseCount);
    const cellMaxX = Math.round(((poseIndex + 1) * image.width) / poseCount) - 1;
    const bbox = { minX: cellMaxX, minY: image.height - 1, maxX: cellMinX, maxY: 0 };
    for (let y = 0; y < image.height; y++) {
      for (let x = cellMinX; x <= cellMaxX; x++) {
        const alpha = image.data[(y * image.width + x) * 4 + 3];
        if (alpha <= 24) continue;
        bbox.minX = Math.min(bbox.minX, x);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxY = Math.max(bbox.maxY, y);
      }
    }
    if (bbox.maxX < bbox.minX || bbox.maxY < bbox.minY) throw new Error(`No hand pixels in ${filePath} pose ${poseIndex}`);

    const bboxWidth = bbox.maxX - bbox.minX + 1;
    const bboxHeight = bbox.maxY - bbox.minY + 1;
    const components = findBrightComponents(image, bbox);
    const wristCandidates = components.filter((component) => {
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const relativeX = (component.x - bbox.minX) / bboxWidth;
      const aspect = componentWidth / Math.max(1, componentHeight);
      return component.area >= 40
        && component.area <= bboxWidth * bboxHeight * 0.08
        && relativeX >= 0.12
        && relativeX <= 0.48
        && aspect >= 0.55
        && aspect <= 1.8;
    });
    wristCandidates.sort((a, b) => {
      const score = (component) => {
        const componentWidth = component.maxX - component.minX + 1;
        const componentHeight = component.maxY - component.minY + 1;
        const relativeX = (component.x - bbox.minX) / bboxWidth;
        const compactness = component.area / Math.max(1, componentWidth * componentHeight);
        return Math.abs(relativeX - 0.30) * 4 + Math.abs(componentWidth / componentHeight - 1) + Math.abs(compactness - 0.72);
      };
      return score(a) - score(b);
    });
    const wrist = wristCandidates[0] || {
      x: bbox.minX + bboxWidth * 0.30,
      y: bbox.minY + bboxHeight * 0.55,
    };

    let weightSum = 0;
    let gripX = 0;
    let gripY = 0;
    const palmMinX = wrist.x + bboxWidth * 0.055;
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = Math.max(bbox.minX, Math.floor(palmMinX)); x <= bbox.maxX; x++) {
        const alpha = image.data[(y * image.width + x) * 4 + 3] / 255;
        if (alpha <= 0) continue;
        weightSum += alpha;
        gripX += x * alpha;
        gripY += y * alpha;
      }
    }
    const grip = {
      x: gripX / Math.max(0.001, weightSum),
      y: gripY / Math.max(0.001, weightSum),
    };
    poses.push({ image, bbox, wrist: { x: wrist.x, y: wrist.y }, grip });
  }
  return poses;
}

function samplePosePixel(pose, x, y) {
  if (x < pose.bbox.minX - 1 || x > pose.bbox.maxX + 1 || y < pose.bbox.minY - 1 || y > pose.bbox.maxY + 1) return [0, 0, 0, 0];
  const x0 = Math.max(0, Math.min(pose.image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(pose.image.height - 1, Math.floor(y)));
  const x1 = Math.min(pose.image.width - 1, x0 + 1);
  const y1 = Math.min(pose.image.height - 1, y0 + 1);
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
    const i = (sy * pose.image.width + sx) * 4;
    const sampleAlpha = (pose.image.data[i + 3] / 255) * weight;
    alpha += sampleAlpha;
    for (let channel = 0; channel < 3; channel++) premul[channel] += pose.image.data[i + channel] * sampleAlpha;
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round(premul[0] / alpha),
    Math.round(premul[1] / alpha),
    Math.round(premul[2] / alpha),
    Math.round(Math.min(1, alpha) * 255),
  ];
}

function drawHandPose(output, frameIndex, pose, target, targetAngle, targetReach, opacity = 1) {
  if (opacity <= 0) return;
  const sourceVectorX = pose.grip.x - pose.wrist.x;
  const sourceVectorY = pose.grip.y - pose.wrist.y;
  const sourceReach = Math.max(1, Math.hypot(sourceVectorX, sourceVectorY));
  const scale = targetReach / sourceReach;
  const angle = targetAngle - Math.atan2(sourceVectorY, sourceVectorX);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    { x: pose.bbox.minX, y: pose.bbox.minY },
    { x: pose.bbox.maxX, y: pose.bbox.minY },
    { x: pose.bbox.minX, y: pose.bbox.maxY },
    { x: pose.bbox.maxX, y: pose.bbox.maxY },
  ].map((point) => {
    const dx = (point.x - pose.grip.x) * scale;
    const dy = (point.y - pose.grip.y) * scale;
    return { x: target.x + dx * cos - dy * sin, y: target.y + dx * sin + dy * cos };
  });
  const minX = Math.floor(Math.min(...corners.map((point) => point.x))) - 2;
  const maxX = Math.ceil(Math.max(...corners.map((point) => point.x))) + 2;
  const minY = Math.floor(Math.min(...corners.map((point) => point.y))) - 2;
  const maxY = Math.ceil(Math.max(...corners.map((point) => point.y))) + 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - target.x;
      const dy = y - target.y;
      const sourceX = pose.grip.x + (dx * cos + dy * sin) / scale;
      const sourceY = pose.grip.y + (-dx * sin + dy * cos) / scale;
      const rgba = samplePosePixel(pose, sourceX, sourceY);
      if (rgba[3] > 0) compositePixel(output, frameIndex, x, y, rgba, opacity);
    }
  }
}

const handPoses = {
  rifleLmg: extractHandPoses(handPoseSourcePaths.rifleLmg),
  shotgun: extractHandPoses(handPoseSourcePaths.shotgun),
};
const cleanedHandPosePaths = {
  rifleLmg: path.join(here, 'hand-poses-rifle-lmg-clean.png'),
  shotgun: path.join(here, 'hand-poses-shotgun-clean.png'),
};
for (const variant of Object.keys(handPoses)) {
  fs.writeFileSync(cleanedHandPosePaths[variant], PNG.sync.write(handPoses[variant][0].image));
}

const sourceRig = analysis.frames[0];
const shoulder0 = sourceRig.supportPivot;
const elbow0 = sourceRig.supportElbow;
// The component extremum lands near the fingertips. The approved static arm
// config records the actual palm/grip centre, which is the correct IK endpoint.
const hand0 = {
  x: config.gun_idle.twist.arm.handX,
  y: config.gun_idle.twist.arm.handY,
};
const upperAngle0 = Math.atan2(elbow0.y - shoulder0.y, elbow0.x - shoulder0.x);
const foreAngle0 = Math.atan2(hand0.y - elbow0.y, hand0.x - elbow0.x);
const upperLength = Math.hypot(elbow0.x - shoulder0.x, elbow0.y - shoulder0.y);
const foreLength = Math.hypot(hand0.x - elbow0.x, hand0.y - elbow0.y);
const frame0Labels = labelFrame(0);
const upperPixels = [];
const forePixels = [];
for (let y = 0; y < fh; y++) {
  for (let x = 0; x < fw; x++) {
    const si = (y * source.width + x) * 4;
    if (source.data[si + 3] === 0 || nearestRole(frame0Labels.labels, frame0Labels.trackedId, x, y) !== 'support') continue;
    const point = { x, y };
    const pixel = { point, rgba: Array.from(source.data.subarray(si, si + 4)) };
    const upperDistance = pointSegmentDistance(point, shoulder0, elbow0);
    const foreDistance = pointSegmentDistance(point, elbow0, hand0);
    (upperDistance <= foreDistance ? upperPixels : forePixels).push(pixel);
  }
}

// The rig endpoint is the palm/grip centre, not the anatomical wrist. Preserve
// the generated forearm up to the wrist cut, then replace the old permanently
// open hand with the five authored curl poses. Keeping the same 31 px wrist-to-
// grip reach means all existing shoulder, IK and weapon-contact coordinates stay
// valid while the fingers visibly close around the fore-end.
const foreUnit = {
  x: (hand0.x - elbow0.x) / foreLength,
  y: (hand0.y - elbow0.y) / foreLength,
};
const handReach = 31;
const wristCut0 = {
  x: hand0.x - foreUnit.x * handReach,
  y: hand0.y - foreUnit.y * handReach,
};
const retainedForePixels = forePixels.filter((pixel) => {
  const along = (pixel.point.x - wristCut0.x) * foreUnit.x + (pixel.point.y - wristCut0.y) * foreUnit.y;
  return along <= 1.5;
});
const replacedHandPixelCount = forePixels.length - retainedForePixels.length;

// Author the final arm against the actual AKM ADS contact instead of a generic
// short two-hand separation. The AKM is the approved visual baseline: its grip
// remains the weapon pivot, its -5 px art offset seats the stock rearward, and
// its support point lands on the wooden handguard. Per-weapon runtime IK may
// extend or shorten this arm for each real fore-end/pump location.
const playerDisplaySize = 144;
const akm = weaponConfig.akm;
const akmWeaponDisplaySize = 126 * (Number(akm.idleScale) || 1);
const canonicalWorldDelta = {
  x: (akm.supportGrip.x - akm.grip.x) * akmWeaponDisplaySize + (Number(akm.aimSpriteOffsetX) || 0),
  y: (akm.supportGrip.y - akm.grip.y) * akmWeaponDisplaySize + (Number(akm.aimSpriteOffsetY) || 0),
};
const canonicalDelta = {
  x: canonicalWorldDelta.x / (playerDisplaySize / fw),
  y: canonicalWorldDelta.y / (playerDisplaySize / fh),
};
const finalShoulder = analysis.frames[frameCount - 1].supportPivot;
const mainHand0 = aim.hands[0];
const carryTracking = 0.35;
const buildFrames = [];

for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
  const labelled = labelFrame(frameIndex);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const si = (y * source.width + frameIndex * fw + x) * 4;
      if (source.data[si + 3] === 0 || nearestRole(labelled.labels, labelled.trackedId, x, y) !== 'main') continue;
      const rgba = Array.from(source.data.subarray(si, si + 4));
      compositePixel(mainOutput, frameIndex, x, y, rgba);
      for (const output of Object.values(combinedOutputs)) compositePixel(output, frameIndex, x, y, rgba);
    }
  }

  const t = frameIndex / Math.max(1, frameCount - 1);
  // Use a near-linear reach path so the extra handguard travel is distributed
  // across all 14 frames instead of accelerating late in the transition.
  const blend = t;
  const handPoseBlend = smoothstep(t);
  // The source video's component detector changes shoulders/components around
  // frames 7-9. Feeding those raw points into IK creates a visible elbow snap.
  // Keep the approved first/final anatomy, but author one continuous shoulder
  // path between them instead of following segmentation noise.
  const shoulder = lerpPoint(shoulder0, finalShoulder, blend);
  const finalTarget = {
    x: aim.hands[frameIndex].x + canonicalDelta.x,
    y: aim.hands[frameIndex].y + canonicalDelta.y,
  };
  // The support palm starts at the approved hip-fire palm. It inherits only a
  // small part of the rear-hand/body drift while travelling toward the guard;
  // the rest is a smooth ergonomic reach. This removes the source jump without
  // changing either endpoint or the AKM full-ADS contact.
  const carryTarget = {
    x: hand0.x + (aim.hands[frameIndex].x - mainHand0.x) * carryTracking,
    y: hand0.y + (aim.hands[frameIndex].y - mainHand0.y) * carryTracking,
  };
  const target = lerpPoint(carryTarget, finalTarget, blend);
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  // A real rifle fore-end sits farther forward than the old pistol-like target.
  // Extend both mechanical bone links uniformly only as much as required; the
  // perpendicular line-art thickness is preserved by mapSegmentPoint below.
  const sourceMaxReach = upperLength + foreLength;
  // Keep a small ergonomic bend at full ADS instead of locking the elbow on
  // the last frame; 20% is still modest for this deliberately long mechanical
  // arm and removes the late straight-arm snap.
  const authoredStretch = 1 + 0.20 * blend;
  const linkScale = Math.max(authoredStretch, distance / sourceMaxReach + 0.001);
  const solvedUpperLength = upperLength * linkScale;
  const solvedForeLength = foreLength * linkScale;
  const minReach = Math.abs(solvedUpperLength - solvedForeLength) + 0.001;
  const maxReach = solvedUpperLength + solvedForeLength - 0.001;
  const solvedDistance = Math.max(minReach, Math.min(maxReach, distance));
  const ux = dx / Math.max(0.001, distance);
  const uy = dy / Math.max(0.001, distance);
  const base = (solvedUpperLength * solvedUpperLength - solvedForeLength * solvedForeLength + solvedDistance * solvedDistance) / (2 * solvedDistance);
  const height = Math.sqrt(Math.max(0, solvedUpperLength * solvedUpperLength - base * base));
  const elbow = {
    x: shoulder.x + ux * base - uy * height,
    y: shoulder.y + uy * base + ux * height,
  };
  const solvedTarget = {
    x: shoulder.x + ux * solvedDistance,
    y: shoulder.y + uy * solvedDistance,
  };
  const upperAngle = Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x);
  const foreAngle = Math.atan2(solvedTarget.y - elbow.y, solvedTarget.x - elbow.x);
  for (const variant of Object.keys(supportOutputs)) {
    for (const pixel of upperPixels) {
      const transformed = mapSegmentPoint(pixel.point, shoulder0, elbow0, shoulder, elbow);
      splat(supportOutputs[variant], frameIndex, transformed.x, transformed.y, pixel.rgba);
      splat(combinedOutputs[variant], frameIndex, transformed.x, transformed.y, pixel.rgba);
    }
    for (const pixel of retainedForePixels) {
      const transformed = mapSegmentPoint(pixel.point, elbow0, hand0, elbow, solvedTarget);
      splat(supportOutputs[variant], frameIndex, transformed.x, transformed.y, pixel.rgba);
      splat(combinedOutputs[variant], frameIndex, transformed.x, transformed.y, pixel.rgba);
    }

    const posePosition = handPoseBlend * (handPoses[variant].length - 1);
    const lowerPoseIndex = Math.floor(posePosition);
    const upperPoseIndex = Math.min(handPoses[variant].length - 1, lowerPoseIndex + 1);
    const poseBlend = posePosition - lowerPoseIndex;
    drawHandPose(supportOutputs[variant], frameIndex, handPoses[variant][lowerPoseIndex], solvedTarget, foreAngle, handReach, 1 - poseBlend);
    drawHandPose(combinedOutputs[variant], frameIndex, handPoses[variant][lowerPoseIndex], solvedTarget, foreAngle, handReach, 1 - poseBlend);
    if (upperPoseIndex !== lowerPoseIndex) {
      drawHandPose(supportOutputs[variant], frameIndex, handPoses[variant][upperPoseIndex], solvedTarget, foreAngle, handReach, poseBlend);
      drawHandPose(combinedOutputs[variant], frameIndex, handPoses[variant][upperPoseIndex], solvedTarget, foreAngle, handReach, poseBlend);
    }
  }
  buildFrames.push({
    frame: frameIndex,
    blend: Number(blend.toFixed(4)),
    shoulder: { x: Number(shoulder.x.toFixed(2)), y: Number(shoulder.y.toFixed(2)) },
    carryTarget: { x: Number(carryTarget.x.toFixed(2)), y: Number(carryTarget.y.toFixed(2)) },
    elbow: { x: Number(elbow.x.toFixed(2)), y: Number(elbow.y.toFixed(2)) },
    target: { x: Number(solvedTarget.x.toFixed(2)), y: Number(solvedTarget.y.toFixed(2)) },
    finalTarget: { x: Number(finalTarget.x.toFixed(2)), y: Number(finalTarget.y.toFixed(2)) },
    linkScale: Number(linkScale.toFixed(4)),
    handPose: Number((handPoseBlend * 4).toFixed(4)),
    reachError: Number(Math.max(0, distance - solvedDistance).toFixed(4)),
  });
}

function writePngIfChanged(filePath, image) {
  const encoded = PNG.sync.write(image);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(encoded)) return false;
  fs.writeFileSync(filePath, encoded);
  return true;
}

writePngIfChanged(runtimePath, mainOutput);
for (const variant of Object.keys(supportOutputs)) {
  writePngIfChanged(supportRuntimePaths[variant], supportOutputs[variant]);
  writePngIfChanged(combinedPaths[variant], combinedOutputs[variant]);
}

function persistRuntimeRig(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const nextConfig = JSON.parse(original);
  const runtimeAim = nextConfig.gun_idle.twist.aimFrames;
  runtimeAim.supportShoulders = buildFrames.map((frame) => frame.shoulder);
  runtimeAim.supportHands = buildFrames.map((frame) => frame.target);
  runtimeAim.supportContacts = supportContactFrames.rifleLmg.map(({ x, y }) => ({ x, y }));
  runtimeAim.supportContactVariants = {
    shotgun: supportContactFrames.shotgun.map(({ x, y }) => ({ x, y })),
  };
  fs.writeFileSync(filePath, JSON.stringify(nextConfig, null, 2).replaceAll('\n', eol) + eol);
}
function maxFrameStep(field) {
  let max = 0;
  for (let i = 1; i < buildFrames.length; i++) {
    max = Math.max(max, Math.hypot(
      buildFrames[i][field].x - buildFrames[i - 1][field].x,
      buildFrames[i][field].y - buildFrames[i - 1][field].y,
    ));
  }
  return Number(max.toFixed(4));
}
const continuity = {
  maxShoulderStep: maxFrameStep('shoulder'),
  maxElbowStep: maxFrameStep('elbow'),
  maxPalmStep: maxFrameStep('target'),
};

// supportHands is the anatomical IK endpoint used while authoring the arm, but
// the generated curl poses can leave that point inside the palm opening.  The
// weapon supportGrip values describe the *underside* of each fore-end, so bind
// an actual opaque palm/finger pixel to that underside instead of binding an
// invisible cavity centre.  Prefer the nearest rendered pixel below the IK
// endpoint: this keeps the hand under the gun rather than pulling the thumb
// down onto the top rail.
function findRenderedPalmContact(image, frameIndex, target) {
  let best = null;
  const minX = Math.max(0, Math.floor(target.x - 48));
  const maxX = Math.min(fw - 1, Math.ceil(target.x + 48));
  const minY = Math.max(0, Math.ceil(target.y));
  const maxY = Math.min(fh - 1, Math.ceil(target.y + 48));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const index = (y * image.width + frameIndex * fw + x) * 4;
      const alpha = image.data[index + 3];
      if (alpha < 96) continue;
      const distance = Math.hypot(x - target.x, y - target.y);
      if (!best || distance < best.distance || (distance === best.distance && alpha > best.alpha)) {
        best = { x, y, alpha, distance };
      }
    }
  }
  if (!best) throw new Error(`No opaque support-palm contact near frame ${frameIndex}`);
  return {
    x: Number(best.x.toFixed(2)),
    y: Number(best.y.toFixed(2)),
    alpha: best.alpha,
    offsetX: Number((best.x - target.x).toFixed(2)),
    offsetY: Number((best.y - target.y).toFixed(2)),
  };
}

const supportContactFrames = Object.fromEntries(
  Object.entries(supportOutputs).map(([variant, image]) => [
    variant,
    buildFrames.map((frame) => findRenderedPalmContact(image, frame.frame, frame.target)),
  ])
);
for (const relative of ['public/data/player-anim-config.json', 'data/player-anim-config.json']) {
  persistRuntimeRig(path.join(root, relative));
}

const reportPath = path.join(here, 'corrected-aim-arm-geometry.json');
fs.writeFileSync(reportPath, JSON.stringify({
  source: path.relative(root, sourcePath).replaceAll('\\', '/'),
  outputs: {
    mainHandBearingSource: path.relative(root, runtimePath).replaceAll('\\', '/'),
    mainRuntime: aim.src,
    support: Object.fromEntries(Object.entries(supportRuntimePaths).map(([variant, filePath]) => [variant, path.relative(root, filePath).replaceAll('\\', '/')])),
    combinedPreviewSource: Object.fromEntries(Object.entries(combinedPaths).map(([variant, filePath]) => [variant, path.relative(root, filePath).replaceAll('\\', '/')])),
  },
  sourceRig: { shoulder: shoulder0, elbow: elbow0, hand: hand0, upperLength, foreLength },
  handArt: {
    rawSources: Object.fromEntries(Object.entries(handPoseSourcePaths).map(([variant, filePath]) => [variant, path.relative(root, filePath).replaceAll('\\', '/')])),
    cleanedSources: Object.fromEntries(Object.entries(cleanedHandPosePaths).map(([variant, filePath]) => [variant, path.relative(root, filePath).replaceAll('\\', '/')])),
    wristCut: wristCut0,
    wristToGripReach: handReach,
    replacedSourcePixels: replacedHandPixelCount,
    poseMetrics: Object.fromEntries(Object.entries(handPoses).map(([variant, poses]) => [variant, poses.map((pose, index) => ({
      index,
      bbox: pose.bbox,
      wrist: pose.wrist,
      grip: pose.grip,
      wristToGrip: Number(Math.hypot(pose.grip.x - pose.wrist.x, pose.grip.y - pose.wrist.y).toFixed(3)),
    }))])),
  },
  playerDisplaySize,
  canonicalWorldDelta: {
    x: Number(canonicalWorldDelta.x.toFixed(3)),
    y: Number(canonicalWorldDelta.y.toFixed(3)),
  },
  canonicalTextureDelta: canonicalDelta,
  motionModel: 'smooth shoulder endpoints + carry path tracking 35% of rear-hand drift',
  continuity,
  supportContactFrames,
  frames: buildFrames,
}, null, 2));

const previewCols = 7;
const previewPaths = {};
for (const variant of Object.keys(combinedOutputs)) {
  const preview = new PNG({ width: fw * previewCols, height: fh * 2 });
  for (let i = 0; i < preview.data.length; i += 4) {
    preview.data[i] = 218;
    preview.data[i + 1] = 218;
    preview.data[i + 2] = 218;
    preview.data[i + 3] = 255;
  }
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const tileX = (frameIndex % previewCols) * fw;
    const tileY = Math.floor(frameIndex / previewCols) * fh;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const si = (y * combinedOutputs[variant].width + frameIndex * fw + x) * 4;
        const alpha = combinedOutputs[variant].data[si + 3] / 255;
        if (alpha <= 0) continue;
        const di = ((tileY + y) * preview.width + tileX + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          preview.data[di + channel] = Math.round(combinedOutputs[variant].data[si + channel] * alpha + 218 * (1 - alpha));
        }
      }
    }
  }
  const suffix = variant === 'rifleLmg' ? '' : '-shotgun';
  previewPaths[variant] = path.join(here, `corrected-aim-arm-poses${suffix}.png`);
  fs.writeFileSync(previewPaths[variant], PNG.sync.write(preview));
}
console.log(runtimePath);
for (const filePath of Object.values(supportRuntimePaths)) console.log(filePath);
for (const filePath of Object.values(combinedPaths)) console.log(filePath);
console.log(reportPath);
for (const filePath of Object.values(previewPaths)) console.log(filePath);
console.log(`source links: upper=${upperLength.toFixed(2)} fore=${foreLength.toFixed(2)} maxReach=${(upperLength + foreLength).toFixed(2)}`);
console.log(`hand replacement: ${replacedHandPixelCount} source pixels, wrist-to-grip=${handReach.toFixed(2)}px`);
console.log(`max reach error: ${Math.max(...buildFrames.map((frame) => frame.reachError)).toFixed(4)}px`);
console.log(`continuity: shoulder=${continuity.maxShoulderStep.toFixed(4)} elbow=${continuity.maxElbowStep.toFixed(4)} palm=${continuity.maxPalmStep.toFixed(4)}px/frame`);
