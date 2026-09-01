import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const publicConfigText = fs.readFileSync(path.join(root, 'public', 'data', 'player-anim-config.json'), 'utf8');
const dataConfigText = fs.readFileSync(path.join(root, 'data', 'player-anim-config.json'), 'utf8');
const config = JSON.parse(publicConfigText);
const aim = config.gun_idle.twist.aimFrames;
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'verify-shots', 'gun-ads-runtime-20260901', 'runtime-metadata.json'), 'utf8'));

const sheetPaths = {
  main: aim.src,
  rifleLmgSupport: aim.supportSrc,
  shotgunSupport: aim.supportVariants?.shotgun,
};

const sheetStats = {};
const decodedSheets = {};
for (const [key, relativePath] of Object.entries(sheetPaths)) {
  const image = PNG.sync.read(fs.readFileSync(path.join(root, relativePath)));
  decodedSheets[key] = image;
  const frames = [];
  for (let frame = 0; frame < aim.frameCount; frame++) {
    let alphaPixels = 0;
    for (let y = 0; y < aim.frameHeight; y++) {
      for (let x = 0; x < aim.frameWidth; x++) {
        const index = (y * image.width + frame * aim.frameWidth + x) * 4;
        if (image.data[index + 3] > 0) alphaPixels++;
      }
    }
    frames.push({ frame, alphaPixels });
  }
  sheetStats[key] = {
    path: relativePath,
    width: image.width,
    height: image.height,
    blankFrames: frames.filter((frame) => frame.alphaPixels === 0).map((frame) => frame.frame),
    frames,
  };
}

const familyFrameDiffs = [];
const rifleSheet = decodedSheets.rifleLmgSupport;
const shotgunSheet = decodedSheets.shotgunSupport;
for (let frame = 0; frame < aim.frameCount; frame++) {
  let differentPixels = 0;
  for (let y = 0; y < aim.frameHeight; y++) {
    for (let x = 0; x < aim.frameWidth; x++) {
      const index = (y * rifleSheet.width + frame * aim.frameWidth + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 4; channel++) {
        if (rifleSheet.data[index + channel] !== shotgunSheet.data[index + channel]) {
          differs = true;
          break;
        }
      }
      if (differs) differentPixels++;
    }
  }
  familyFrameDiffs.push({ frame, differentPixels });
}

const entries = runtime.entries || [];
const failures = {
  incompleteAds: entries.filter((entry) => Math.abs(entry.aimEase - 1) > 1e-9).map((entry) => `${entry.name}/${entry.pose}`),
  hiddenSupport: entries.filter((entry) => !entry.supportArmVisible).map((entry) => `${entry.name}/${entry.pose}`),
  wrongShotgunVariant: entries.filter((entry) => entry.family === 'shotguns' && !String(entry.supportArmTexture).includes('_aimsupport_shotgun')).map((entry) => `${entry.name}/${entry.pose}`),
  shotgunVariantLeak: entries.filter((entry) => entry.family !== 'shotguns' && String(entry.supportArmTexture).includes('_aimsupport_shotgun')).map((entry) => `${entry.name}/${entry.pose}`),
  wrongLeftMirror: entries.filter((entry) => entry.pose.startsWith('left_') && !String(entry.supportArmTexture).endsWith('_flip')).map((entry) => `${entry.name}/${entry.pose}`),
  rearContact: entries.filter((entry) => entry.rearContactError < 0 || entry.rearContactError > 1e-9).map((entry) => `${entry.name}/${entry.pose}`),
  contact: entries.filter((entry) => entry.supportContactError < 0 || entry.supportContactError > 1e-9).map((entry) => `${entry.name}/${entry.pose}`),
  guard: entries.filter((entry) => entry.supportGuardError < 0 || entry.supportGuardError > 1e-9).map((entry) => `${entry.name}/${entry.pose}`),
};

const report = {
  configParity: publicConfigText === dataConfigText,
  frameCount: aim.frameCount,
  sheetStats,
  familyFrameDiffs,
  runtime: {
    candidateCounts: runtime.counts,
    screenshotCount: entries.length,
    maxRearContactError: runtime.maxRearContactError,
    maxSupportContactError: runtime.maxSupportContactError,
    maxSupportGuardError: runtime.maxSupportGuardError,
    shotgunSamples: entries.filter((entry) => entry.family === 'shotguns').length,
    leftMirrorSamples: entries.filter((entry) => entry.pose.startsWith('left_')).length,
  },
  failures,
};
report.pass = report.configParity
  && Object.values(sheetStats).every((sheet) => sheet.width === aim.frameWidth * aim.frameCount && sheet.height === aim.frameHeight && sheet.blankFrames.length === 0)
  && familyFrameDiffs.every((frame) => frame.differentPixels > 0)
  && entries.length === 42
  && Object.values(failures).every((items) => items.length === 0);

const outputPath = path.join(here, 'support-hand-delivery-audit.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  output: path.relative(root, outputPath).replaceAll('\\', '/'),
  pass: report.pass,
  configParity: report.configParity,
  screenshotCount: report.runtime.screenshotCount,
  shotgunSamples: report.runtime.shotgunSamples,
  leftMirrorSamples: report.runtime.leftMirrorSamples,
  maxRearContactError: report.runtime.maxRearContactError,
  maxSupportContactError: report.runtime.maxSupportContactError,
  maxSupportGuardError: report.runtime.maxSupportGuardError,
  blankFrames: Object.fromEntries(Object.entries(sheetStats).map(([key, sheet]) => [key, sheet.blankFrames])),
  failures,
}, null, 2));
if (!report.pass) process.exitCode = 1;
