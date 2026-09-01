import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const readJson = (filePath) => {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
};

const playerConfig = readJson(path.join(root, 'data/player-anim-config.json'));
const weaponConfig = readJson(path.join(root, 'data/weapon-anim-config.json'));
const legacyAudit = readJson(path.join(here, 'corrected-support-grip-audit.json'));
const aim = playerConfig.gun_idle.twist.aimFrames;
const frame = aim.frameCount - 1;
const mainSheet = PNG.sync.read(fs.readFileSync(path.join(root, aim.src)));
const supportSheets = {
  rifle_lmg: PNG.sync.read(fs.readFileSync(path.join(root, aim.supportSrc))),
  shotgun: PNG.sync.read(fs.readFileSync(path.join(root, aim.supportVariants.shotgun))),
};
const firingSheet = PNG.sync.read(fs.readFileSync(path.join(root, aim.firingHandSrc)));
const weaponListSource = fs.readFileSync(path.join(here, 'build-support-grip-audit.ps1'), 'utf8');
const runtimeByTexture = Object.fromEntries(
  [...weaponListSource.matchAll(/Label='([^']+)'; Config='([^']+)'; Texture='([^']+)'; Runtime='([^']+)'/g)]
    .map((match) => [match[3], { label: match[1], config: match[2], runtime: match[4] }])
);

const cellWidth = 444;
const cellHeight = 250;
const columns = 4;
const contactScale = 1.5;
const rearScreen = { x: 105, y: 105 };
const rearFrame = aim.hands[frame];
const shoulderFrame = aim.supportShoulders[frame];
const contacts = {
  rifle_lmg: aim.supportContacts[frame],
  shotgun: aim.supportContactVariants.shotgun[frame],
};

function compositePixel(output, x, y, rgba) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= output.width || y < 0 || y >= output.height || rgba[3] <= 0) return;
  const index = (y * output.width + x) * 4;
  const sourceAlpha = rgba[3] / 255;
  const targetAlpha = output.data[index + 3] / 255;
  const alpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel++) {
    output.data[index + channel] = Math.round(
      (rgba[channel] * sourceAlpha + output.data[index + channel] * targetAlpha * (1 - sourceAlpha))
      / Math.max(0.0001, alpha)
    );
  }
  output.data[index + 3] = Math.round(alpha * 255);
}

// Matrix maps local source-frame pixels to output pixels:
// x' = a*x + c*y + tx; y' = b*x + d*y + ty.
function drawAffine(output, source, sourceRect, matrix, clip) {
  const corners = [
    [0, 0], [sourceRect.width, 0], [0, sourceRect.height], [sourceRect.width, sourceRect.height],
  ].map(([x, y]) => ({
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  }));
  const minX = Math.max(clip.x, Math.floor(Math.min(...corners.map((point) => point.x))) - 1);
  const maxX = Math.min(clip.x + clip.width - 1, Math.ceil(Math.max(...corners.map((point) => point.x))) + 1);
  const minY = Math.max(clip.y, Math.floor(Math.min(...corners.map((point) => point.y))) - 1);
  const maxY = Math.min(clip.y + clip.height - 1, Math.ceil(Math.max(...corners.map((point) => point.y))) + 1);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - matrix.tx;
      const dy = y - matrix.ty;
      const sourceX = (matrix.d * dx - matrix.c * dy) / determinant;
      const sourceY = (-matrix.b * dx + matrix.a * dy) / determinant;
      const sx = Math.round(sourceX);
      const sy = Math.round(sourceY);
      if (sx < 0 || sx >= sourceRect.width || sy < 0 || sy >= sourceRect.height) continue;
      const sourceIndex = ((sourceRect.y + sy) * source.width + sourceRect.x + sx) * 4;
      compositePixel(output, x, y, [
        source.data[sourceIndex],
        source.data[sourceIndex + 1],
        source.data[sourceIndex + 2],
        source.data[sourceIndex + 3],
      ]);
    }
  }
}

function fillRect(output, x, y, width, height, color) {
  for (let py = Math.max(0, y); py < Math.min(output.height, y + height); py++) {
    for (let px = Math.max(0, x); px < Math.min(output.width, x + width); px++) {
      const index = (py * output.width + px) * 4;
      output.data[index] = color[0];
      output.data[index + 1] = color[1];
      output.data[index + 2] = color[2];
      output.data[index + 3] = color[3];
    }
  }
}

function getRearGrip(entry) {
  const config = weaponConfig[entry.config];
  return config.textureGrips?.[entry.texture] || config.grip;
}

function getSupportGrip(entry) {
  const config = weaponConfig[entry.config];
  return config.textureSupportGrips?.[entry.texture] || config.supportGrip;
}

const reportEntries = [];
const transitionContacts = [];
for (const [variant, sheet] of Object.entries(supportSheets)) {
  const points = variant === 'shotgun' ? aim.supportContactVariants.shotgun : aim.supportContacts;
  points.forEach((point, frameIndex) => {
    const pixelIndex = (
      Math.round(point.y) * sheet.width
      + frameIndex * aim.frameWidth
      + Math.round(point.x)
    ) * 4;
    transitionContacts.push({
      variant,
      frame: frameIndex,
      point,
      alpha: sheet.data[pixelIndex + 3],
    });
  });
}
for (const family of ['rifles', 'shotguns', 'machine_guns']) {
  const entries = legacyAudit.entries.filter((entry) => entry.family === family);
  const rows = Math.ceil(entries.length / columns);
  const oldSheetPath = path.join(here, `right-grip-contact-closeups-${family}.png`);
  const output = fs.existsSync(oldSheetPath)
    ? PNG.sync.read(fs.readFileSync(oldSheetPath))
    : new PNG({ width: columns * cellWidth, height: rows * cellHeight });
  const supportVariant = family === 'shotguns' ? 'shotgun' : 'rifle_lmg';
  const supportSheet = supportSheets[supportVariant];
  const sourceContact = contacts[supportVariant];
  const sourceContactIndex = (
    Math.round(sourceContact.y) * supportSheet.width
    + frame * aim.frameWidth
    + Math.round(sourceContact.x)
  ) * 4;
  const sourceContactAlpha = supportSheet.data[sourceContactIndex + 3];

  entries.forEach((entry, index) => {
    const runtime = runtimeByTexture[entry.texture];
    if (!runtime) throw new Error(`Missing runtime path for ${entry.texture}`);
    const weapon = PNG.sync.read(fs.readFileSync(path.join(root, runtime.runtime)));
    const config = weaponConfig[entry.config];
    const rearGrip = getRearGrip(entry);
    const supportGrip = getSupportGrip(entry);
    const idleScale = Number(config.idleScale) || 1;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    const clip = { x: left + 2, y: top + 2, width: cellWidth - 4, height: 211 };
    fillRect(output, clip.x, clip.y, clip.width, clip.height, [214, 214, 214, 255]);

    const poseOrigin = {
      x: left + rearScreen.x - rearFrame.x * contactScale,
      y: top + rearScreen.y - rearFrame.y * contactScale,
    };
    const shoulderWorld = {
      x: poseOrigin.x + shoulderFrame.x * contactScale,
      y: poseOrigin.y + shoulderFrame.y * contactScale,
    };
    const gunWidth = 126 * idleScale * (512 / 144) * contactScale;
    const gunHeight = 126 * idleScale * (516 / 144) * contactScale;
    const gunOrigin = {
      x: left + rearScreen.x - rearGrip.x * gunWidth,
      y: top + rearScreen.y - rearGrip.y * gunHeight,
    };
    const target = {
      x: gunOrigin.x + supportGrip.x * gunWidth,
      y: gunOrigin.y + supportGrip.y * gunHeight,
    };
    const sourceVector = {
      x: (sourceContact.x - shoulderFrame.x) * contactScale,
      y: (sourceContact.y - shoulderFrame.y) * contactScale,
    };
    const targetVector = { x: target.x - shoulderWorld.x, y: target.y - shoulderWorld.y };
    const supportScale = Math.hypot(targetVector.x, targetVector.y) / Math.max(0.001, Math.hypot(sourceVector.x, sourceVector.y));
    const rotation = Math.atan2(targetVector.y, targetVector.x) - Math.atan2(sourceVector.y, sourceVector.x);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const factor = contactScale * supportScale;
    const supportMatrix = {
      a: factor * cos,
      b: factor * sin,
      c: -factor * sin,
      d: factor * cos,
      tx: shoulderWorld.x - factor * cos * shoulderFrame.x + factor * sin * shoulderFrame.y,
      ty: shoulderWorld.y - factor * sin * shoulderFrame.x - factor * cos * shoulderFrame.y,
    };

    const frameRect = { x: frame * aim.frameWidth, y: 0, width: aim.frameWidth, height: aim.frameHeight };
    drawAffine(output, mainSheet, frameRect, {
      a: contactScale, b: 0, c: 0, d: contactScale, tx: poseOrigin.x, ty: poseOrigin.y,
    }, clip);
    drawAffine(output, supportSheet, frameRect, supportMatrix, clip);
    drawAffine(output, weapon, { x: 0, y: 0, width: weapon.width, height: weapon.height }, {
      a: gunWidth / weapon.width, b: 0, c: 0, d: gunHeight / weapon.height, tx: gunOrigin.x, ty: gunOrigin.y,
    }, clip);
    const handWidth = aim.firingHandFrameWidth * contactScale;
    const handHeight = aim.firingHandFrameHeight * contactScale;
    drawAffine(output, firingSheet, {
      x: frame * aim.firingHandFrameWidth,
      y: 0,
      width: aim.firingHandFrameWidth,
      height: aim.firingHandFrameHeight,
    }, {
      a: handWidth / aim.firingHandFrameWidth,
      b: 0,
      c: 0,
      d: handHeight / aim.firingHandFrameHeight,
      tx: left + rearScreen.x - aim.firingHandAnchor.x * contactScale,
      ty: top + rearScreen.y - aim.firingHandAnchor.y * contactScale,
    }, clip);

    const solvedContact = {
      x: supportMatrix.a * sourceContact.x + supportMatrix.c * sourceContact.y + supportMatrix.tx,
      y: supportMatrix.b * sourceContact.x + supportMatrix.d * sourceContact.y + supportMatrix.ty,
    };
    reportEntries.push({
      family,
      config: entry.config,
      texture: entry.texture,
      label: runtime.label,
      sourceContact,
      sourceContactAlpha,
      rearGrip,
      supportGrip,
      supportScale: Number(supportScale.toFixed(5)),
      contactError: Number(Math.hypot(solvedContact.x - target.x, solvedContact.y - target.y).toFixed(8)),
      weaponAlphaDistance: entry.supportAlphaContactPx,
    });
  });

  const outputPath = path.join(here, `runtime-support-contact-${family}.png`);
  fs.writeFileSync(outputPath, PNG.sync.write(output));
  console.log(outputPath);
}

const report = {
  reference: 'right-facing full ADS; runtime-equivalent per-weapon support transform',
  frame,
  fullAdsDirectContact: true,
  transitionPolicy: 'preserve 150ms authored reach; visible contact endpoint replaces anatomical cavity endpoint',
  counts: Object.fromEntries(['rifles', 'shotguns', 'machine_guns'].map((family) => [
    family,
    reportEntries.filter((entry) => entry.family === family).length,
  ])),
  minSourceContactAlpha: Math.min(...reportEntries.map((entry) => entry.sourceContactAlpha)),
  minTransitionContactAlpha: Math.min(...transitionContacts.map((entry) => entry.alpha)),
  maxContactError: Math.max(...reportEntries.map((entry) => entry.contactError)),
  maxWeaponAlphaDistance: Math.max(...reportEntries.map((entry) => entry.weaponAlphaDistance)),
  transitionContacts,
  entries: reportEntries,
};
report.pass = Object.values(report.counts).reduce((sum, count) => sum + count, 0) === 34
  && report.minSourceContactAlpha >= 96
  && report.minTransitionContactAlpha >= 96
  && report.maxContactError <= 1e-6
  && report.maxWeaponAlphaDistance <= 2;
const reportPath = path.join(here, 'runtime-support-contact-audit.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  report: reportPath,
  pass: report.pass,
  counts: report.counts,
  minSourceContactAlpha: report.minSourceContactAlpha,
  minTransitionContactAlpha: report.minTransitionContactAlpha,
  maxContactError: report.maxContactError,
  maxWeaponAlphaDistance: report.maxWeaponAlphaDistance,
}, null, 2));
if (!report.pass) process.exitCode = 1;
