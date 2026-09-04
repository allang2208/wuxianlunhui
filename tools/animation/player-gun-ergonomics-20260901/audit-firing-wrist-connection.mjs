import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'player-anim-config.json'), 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'verify-shots', 'gun-ads-runtime-20260901', 'runtime-metadata.json'), 'utf8'));
const build = JSON.parse(fs.readFileSync(path.join(here, 'right-firing-hand-build.json'), 'utf8'));
const aim = config.gun_idle.twist.aimFrames;
const arm = config.gun_idle.twist.arm;
const armAtlas = PNG.sync.read(fs.readFileSync(path.join(root, aim.src)));
const handAtlas = PNG.sync.read(fs.readFileSync(path.join(root, aim.firingHandSrc)));
const supportAtlases = {
  rifle_lmg: PNG.sync.read(fs.readFileSync(path.join(root, aim.supportSrc))),
  shotgun: PNG.sync.read(fs.readFileSync(path.join(root, aim.supportVariants.shotgun))),
};

const frameWidth = aim.frameWidth;
const frameHeight = aim.frameHeight;
const frameCount = aim.frameCount;
const handFrameWidth = aim.firingHandFrameWidth;
const handFrameHeight = aim.firingHandFrameHeight;
const handAnchor = aim.firingHandAnchor;
const alphaThreshold = 8;

function armAlpha(frameIndex, x, y) {
  if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) return 0;
  return armAtlas.data[(y * armAtlas.width + frameIndex * frameWidth + x) * 4 + 3];
}

function handAlpha(frameIndex, x, y) {
  if (x < 0 || y < 0 || x >= handFrameWidth || y >= handFrameHeight) return 0;
  return handAtlas.data[(y * handAtlas.width + frameIndex * handFrameWidth + x) * 4 + 3];
}

function auditFrame(frameIndex) {
  const hand = aim.hands[frameIndex];
  let seed = null;
  let seedDistance = Infinity;
  for (let y = Math.floor(hand.y) - 3; y <= Math.ceil(hand.y) + 3; y++) {
    for (let x = Math.floor(hand.x) - 3; x <= Math.ceil(hand.x) + 3; x++) {
      if (armAlpha(frameIndex, x, y) <= alphaThreshold) continue;
      const distance = Math.hypot(x - hand.x, y - hand.y);
      if (distance < seedDistance) {
        seedDistance = distance;
        seed = { x, y };
      }
    }
  }
  if (!seed) {
    return { frameIndex, connected: false, reason: 'no opaque arm pixel at shared rear-grip origin' };
  }

  const visited = new Uint8Array(frameWidth * frameHeight);
  const queueX = new Int16Array(frameWidth * frameHeight);
  const queueY = new Int16Array(frameWidth * frameHeight);
  let head = 0;
  let tail = 0;
  queueX[tail] = seed.x;
  queueY[tail] = seed.y;
  tail++;
  visited[seed.y * frameWidth + seed.x] = 1;
  const vectorX = hand.x - arm.pivotX;
  const vectorY = hand.y - arm.pivotY;
  const vectorLength = Math.max(1, Math.hypot(vectorX, vectorY));
  const unitX = vectorX / vectorLength;
  const unitY = vectorY / vectorLength;
  let reachesForearm = false;
  let componentPixels = 0;
  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head++;
    componentPixels++;
    const along = (x - hand.x) * unitX + (y - hand.y) * unitY;
    if (along <= -build.wristCutReach) reachesForearm = true;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= frameWidth || ny >= frameHeight) continue;
        const vi = ny * frameWidth + nx;
        if (visited[vi] || armAlpha(frameIndex, nx, ny) <= alphaThreshold) continue;
        visited[vi] = 1;
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail++;
      }
    }
  }

  return {
    frameIndex,
    connected: reachesForearm && handAlpha(frameIndex, handAnchor.x, handAnchor.y) > alphaThreshold,
    rearGrip: hand,
    nearestArmPixel: seed,
    nearestArmPixelDistance: Number(seedDistance.toFixed(3)),
    armComponentPixels: componentPixels,
    reachesSurvivingForearm: reachesForearm,
    firingHandAnchorAlpha: handAlpha(frameIndex, handAnchor.x, handAnchor.y),
  };
}

function findNearestOpaque(image, frameIndex, point, radius = 4) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (let y = Math.floor(point.y) - radius; y <= Math.ceil(point.y) + radius; y++) {
    for (let x = Math.floor(point.x) - radius; x <= Math.ceil(point.x) + radius; x++) {
      if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) continue;
      const alpha = image.data[(y * image.width + frameIndex * frameWidth + x) * 4 + 3];
      if (alpha <= alphaThreshold) continue;
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { x, y };
      }
    }
  }
  return nearest ? { point: nearest, distance: nearestDistance } : null;
}

function auditSupportFrame(variant, frameIndex) {
  const image = supportAtlases[variant];
  const shoulder = aim.supportShoulders[frameIndex];
  const contacts = variant === 'shotgun' ? aim.supportContactVariants.shotgun : aim.supportContacts;
  const contact = contacts[frameIndex];
  const contactSeed = findNearestOpaque(image, frameIndex, contact);
  const shoulderSeed = findNearestOpaque(image, frameIndex, shoulder);
  if (!contactSeed || !shoulderSeed) {
    return { variant, frameIndex, connected: false, reason: 'missing opaque shoulder or support-contact pixel' };
  }
  const visited = new Uint8Array(frameWidth * frameHeight);
  const queueX = new Int16Array(frameWidth * frameHeight);
  const queueY = new Int16Array(frameWidth * frameHeight);
  let head = 0;
  let tail = 0;
  queueX[tail] = contactSeed.point.x;
  queueY[tail] = contactSeed.point.y;
  tail++;
  visited[contactSeed.point.y * frameWidth + contactSeed.point.x] = 1;
  let componentPixels = 0;
  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head++;
    componentPixels++;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= frameWidth || ny >= frameHeight) continue;
        const vi = ny * frameWidth + nx;
        const alpha = image.data[(ny * image.width + frameIndex * frameWidth + nx) * 4 + 3];
        if (visited[vi] || alpha <= alphaThreshold) continue;
        visited[vi] = 1;
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail++;
      }
    }
  }
  const connected = visited[shoulderSeed.point.y * frameWidth + shoulderSeed.point.x] === 1;
  return {
    variant,
    frameIndex,
    connected,
    shoulder,
    contact,
    shoulderPixelDistance: Number(shoulderSeed.distance.toFixed(3)),
    contactPixelDistance: Number(contactSeed.distance.toFixed(3)),
    armComponentPixels: componentPixels,
  };
}

function compositePixel(target, x, y, rgba) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height || rgba[3] <= 0) return;
  const i = (y * target.width + x) * 4;
  const sourceA = rgba[3] / 255;
  const destinationA = target.data[i + 3] / 255;
  const outA = sourceA + destinationA * (1 - sourceA);
  if (outA <= 0) return;
  target.data[i] = Math.round((rgba[0] * sourceA + target.data[i] * destinationA * (1 - sourceA)) / outA);
  target.data[i + 1] = Math.round((rgba[1] * sourceA + target.data[i + 1] * destinationA * (1 - sourceA)) / outA);
  target.data[i + 2] = Math.round((rgba[2] * sourceA + target.data[i + 2] * destinationA * (1 - sourceA)) / outA);
  target.data[i + 3] = Math.round(outA * 255);
}

function fill(target, rgba) {
  for (let i = 0; i < target.data.length; i += 4) {
    target.data[i] = rgba[0];
    target.data[i + 1] = rgba[1];
    target.data[i + 2] = rgba[2];
    target.data[i + 3] = rgba[3];
  }
}

function naturalAngle(frameIndex, facingRight) {
  const hand = aim.hands[frameIndex];
  const natural = Math.atan2(hand.y - arm.pivotY, hand.x - arm.pivotX);
  return facingRight ? natural : Math.PI - natural;
}

function armRotationForFrame(entry, frameIndex) {
  const facingRight = !entry.weaponFlipY;
  const finalNatural = naturalAngle(frameCount - 1, facingRight);
  const aimAngle = entry.armRotation + finalNatural;
  return aimAngle - naturalAngle(frameIndex, facingRight);
}

function renderPose(target, tileX, tileY, tileSize, entry, frameIndex) {
  const facingRight = !entry.weaponFlipY;
  const grip = aim.hands[frameIndex];
  const centerX = tileX + Math.floor(tileSize / 2);
  const centerY = tileY + Math.floor(tileSize / 2);
  const zoom = 2;
  const armRotation = armRotationForFrame(entry, frameIndex);
  const cosArm = Math.cos(armRotation);
  const sinArm = Math.sin(armRotation);
  const cosHand = Math.cos(entry.weaponRotation);
  const sinHand = Math.sin(entry.weaponRotation);
  const armRadius = tileSize / zoom * 0.48;

  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      let dx = x - grip.x;
      const dy = y - grip.y;
      if (!facingRight) dx = -dx;
      if (Math.hypot(dx, dy) > armRadius) continue;
      const sourceIndex = (y * armAtlas.width + frameIndex * frameWidth + x) * 4;
      const rgba = Array.from(armAtlas.data.subarray(sourceIndex, sourceIndex + 4));
      if (rgba[3] <= 0) continue;
      const tx = centerX + Math.round((dx * cosArm - dy * sinArm) * zoom);
      const ty = centerY + Math.round((dx * sinArm + dy * cosArm) * zoom);
      for (let oy = 0; oy < zoom; oy++) for (let ox = 0; ox < zoom; ox++) compositePixel(target, tx + ox, ty + oy, rgba);
    }
  }

  for (let y = 0; y < handFrameHeight; y++) {
    for (let x = 0; x < handFrameWidth; x++) {
      const sourceIndex = (y * handAtlas.width + frameIndex * handFrameWidth + x) * 4;
      const rgba = Array.from(handAtlas.data.subarray(sourceIndex, sourceIndex + 4));
      if (rgba[3] <= 0) continue;
      const dx = x - handAnchor.x;
      const dy = facingRight ? y - handAnchor.y : -(y - handAnchor.y);
      const tx = centerX + Math.round((dx * cosHand - dy * sinHand) * zoom);
      const ty = centerY + Math.round((dx * sinHand + dy * cosHand) * zoom);
      for (let oy = 0; oy < zoom; oy++) for (let ox = 0; ox < zoom; ox++) compositePixel(target, tx + ox, ty + oy, rgba);
    }
  }

  for (let d = -4; d <= 4; d++) {
    compositePixel(target, centerX + d, centerY, [63, 255, 125, 210]);
    compositePixel(target, centerX, centerY + d, [63, 255, 125, 210]);
  }
}

const frameAudits = Array.from({ length: frameCount }, (_, frameIndex) => auditFrame(frameIndex));
const badFrames = frameAudits.filter((entry) => !entry.connected);
if (badFrames.length) {
  throw new Error(`Disconnected wrist frames: ${badFrames.map((entry) => entry.frameIndex).join(', ')}`);
}
const supportFrameAudits = Object.keys(supportAtlases).flatMap((variant) => (
  Array.from({ length: frameCount }, (_, frameIndex) => auditSupportFrame(variant, frameIndex))
));
const badSupportFrames = supportFrameAudits.filter((entry) => !entry.connected);
if (badSupportFrames.length) {
  throw new Error(`Disconnected support-arm frames: ${badSupportFrames.map((entry) => `${entry.variant}:${entry.frameIndex}`).join(', ')}`);
}

const entries = runtime.entries.filter((entry) => entry.aimMode && entry.armVisible && entry.weaponVisible);
const transformAudits = [];
for (const entry of entries) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    transformAudits.push({
      name: entry.name,
      family: entry.family,
      pose: entry.pose,
      frameIndex,
      facing: entry.weaponFlipY ? 'left' : 'right',
      weaponRotation: Number(entry.weaponRotation.toFixed(6)),
      armRotation: Number(armRotationForFrame(entry, frameIndex).toFixed(6)),
      sharedRearGripOrigin: true,
      connectedFrame: frameAudits[frameIndex].connected,
    });
  }
}

const angleOrder = [
  ['AKM', 'right_up'],
  ['AKM', 'right_level'],
  ['SAIGA-12K', 'right_level'],
  ['AKM', 'right_down'],
  ['AKM', 'left_up'],
  ['AKM', 'left_level'],
  ['M416', 'left_level'],
  ['AKM', 'left_down'],
];
const angleEntries = angleOrder.map(([name, pose]) => {
  const entry = entries.find((candidate) => candidate.name === name && candidate.pose === pose);
  if (!entry) throw new Error(`Missing runtime transform reference for ${name} ${pose}`);
  return entry;
});
const angleTileSize = 280;
const angleSheet = new PNG({ width: angleTileSize * 4, height: angleTileSize * 2 });
fill(angleSheet, [16, 18, 22, 255]);
angleEntries.forEach((entry, index) => {
  renderPose(angleSheet, (index % 4) * angleTileSize, Math.floor(index / 4) * angleTileSize, angleTileSize, entry, frameCount - 1);
});

const transitionEntry = entries.find((entry) => entry.name === 'AKM' && entry.pose === 'right_level');
if (!transitionEntry) throw new Error('Missing AKM right_level runtime transform reference');
const transitionTileSize = 220;
const transitionSheet = new PNG({ width: transitionTileSize * 7, height: transitionTileSize * 2 });
fill(transitionSheet, [16, 18, 22, 255]);
for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
  renderPose(
    transitionSheet,
    (frameIndex % 7) * transitionTileSize,
    Math.floor(frameIndex / 7) * transitionTileSize,
    transitionTileSize,
    transitionEntry,
    frameIndex
  );
}

const angleSheetPath = path.join(here, 'firing-wrist-angle-audit.png');
const transitionSheetPath = path.join(here, 'firing-wrist-transition-audit.png');
const reportPath = path.join(here, 'firing-wrist-contact-audit.json');
fs.writeFileSync(angleSheetPath, PNG.sync.write(angleSheet));
fs.writeFileSync(transitionSheetPath, PNG.sync.write(transitionSheet));
fs.writeFileSync(reportPath, JSON.stringify({
  assetRevision: 'firing-hand-v5-wrist-bridge-v1',
  method: 'source-pixel wrist bridge joins the arm component to the exact rear-grip sprite origin; old palm and fingers remain removed',
  runtimeTransformReference: 'tools/verify-shots/gun-ads-runtime-20260901/runtime-metadata.json',
  note: 'runtime metadata supplies transforms only; the audited arm and hand pixels are the current rebuilt assets',
  frameAudits,
  supportFrameAudits,
  transformSamples: transformAudits.length,
  transformFailures: transformAudits.filter((entry) => !entry.sharedRearGripOrigin || !entry.connectedFrame),
  anglePreviewOrder: angleEntries.map((entry) => ({ name: entry.name, family: entry.family, pose: entry.pose })),
  transitionPreview: { name: transitionEntry.name, pose: transitionEntry.pose, frames: [0, frameCount - 1] },
  outputs: {
    angleSheet: path.relative(root, angleSheetPath).replaceAll('\\', '/'),
    transitionSheet: path.relative(root, transitionSheetPath).replaceAll('\\', '/'),
  },
}, null, 2));

console.log(JSON.stringify({
  reportPath,
  frameCount,
  connectedFrames: frameAudits.filter((entry) => entry.connected).length,
  connectedSupportFrames: supportFrameAudits.filter((entry) => entry.connected).length,
  transformSamples: transformAudits.length,
  transformFailures: 0,
  maxGripPixelDistance: Math.max(...frameAudits.map((entry) => entry.nearestArmPixelDistance)),
}, null, 2));
