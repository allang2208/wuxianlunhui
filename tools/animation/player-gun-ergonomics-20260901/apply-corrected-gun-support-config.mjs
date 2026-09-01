import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
// 正式收口只消费最终几何清单；旧错误 support-grip-geometry.json 已作为废案删除。
// 脚本因此保持幂等：读取最终清单、按下方显式测量覆盖，再重写同一报告。
const sourceGeometry = JSON.parse(
  fs.readFileSync(path.join(here, 'corrected-support-grip-geometry.json'), 'utf8').replace(/^\uFEFF/, '')
);
const currentPublicConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'public/data/weapon-anim-config.json'), 'utf8')
);

// Pixel-measured underside contacts. Each point lies on opaque fore-end/pump
// art instead of preserving a synthetic rear-to-front hand separation in empty
// canvas. Coordinates stay in each unflipped 512x512 weapon texture's space.
const foreEndOverrides = {
  weapon_akm: { x: 0.588, y: 0.520 },
  weapon_stg44: { x: 0.625, y: 0.479 },
  weapon_m416: { x: 0.629, y: 0.496 },
  weapon_qbz95: { x: 0.738, y: 0.523 },
  weapon_frontier_rifle: { x: 0.664, y: 0.537 },
  weapon_vengeance_rifle: { x: 0.648, y: 0.561 },
  weapon_astral_tide_rifle: { x: 0.629, y: 0.537 },
  weapon_zero_point_rifle: { x: 0.600, y: 0.537 },
  weapon_corona_cadence_rifle: { x: 0.631, y: 0.518 },
  weapon_terminal_echo_rifle: { x: 0.682, y: 0.557 },
  weapon_qbz191: { x: 0.629, y: 0.406 },
  weapon_super90: { x: 0.578, y: 0.564 },
  weapon_saiga12k: { x: 0.639, y: 0.518 },
  weapon_s686: { x: 0.629, y: 0.521 },
  weapon_m870_breacher: { x: 0.619, y: 0.549 },
  weapon_ksg12: { x: 0.658, y: 0.555 },
  weapon_spas12: { x: 0.588, y: 0.545 },
  weapon_aa12: { x: 0.629, y: 0.520 },
  weapon_winchester1887: { x: 0.639, y: 0.510 },
  weapon_terminus_pendulum: { x: 0.639, y: 0.545 },
  weapon_void_funeral_tide: { x: 0.607, y: 0.535 },
  weapon_black_sun_verdict: { x: 0.598, y: 0.539 },
  weapon_royal_hunt_finale: { x: 0.639, y: 0.520 },
  weapon_pkm: { x: 0.619, y: 0.531 },
  weapon_rpd: { x: 0.607, y: 0.521 },
  weapon_m249: { x: 0.607, y: 0.574 },
  weapon_ultimax100: { x: 0.600, y: 0.564 },
  weapon_mg42: { x: 0.586, y: 0.557 },
  weapon_fusion_core_lmg: { x: 0.660, y: 0.564 },
  weapon_singularity_loom_lmg: { x: 0.648, y: 0.551 },
  weapon_celestial_cartographer_lmg: { x: 0.641, y: 0.555 },
  weapon_grave_covenant_cantor_lmg: { x: 0.641, y: 0.537 },
  weapon_qjb201: { x: 0.678, y: 0.520 },
  weapon_energy_lmg: { x: 0.650, y: 0.545 },
};
const rearGripOverrides = {
  weapon_s686: { x: 0.346, y: 0.539 },
  weapon_void_funeral_tide: { x: 0.307, y: 0.541 },
  weapon_rpd: { x: 0.264, y: 0.574 },
  weapon_ultimax100: { x: 0.285, y: 0.551 },
  weapon_grave_covenant_cantor_lmg: { x: 0.307, y: 0.576 },
};
const correctedSupportByConfig = {};
const correctedSupportByShotgunTexture = {};
const correctedRearByConfig = {};
const correctedRearByShotgunTexture = {};
for (const entry of sourceGeometry.entries) {
  const corrected = foreEndOverrides[entry.texture] || entry.supportGrip;
  if (entry.config === 'shotgun') correctedSupportByShotgunTexture[entry.texture] = corrected;
  else correctedSupportByConfig[entry.config] = corrected;
  const correctedRear = rearGripOverrides[entry.texture] || entry.rearGrip;
  if (entry.config === 'shotgun') correctedRearByShotgunTexture[entry.texture] = correctedRear;
  else correctedRearByConfig[entry.config] = correctedRear;
}

const machineBaseline = {
  pkm: { preciseAds: false, aimAdjustY: null },
  rpd: { preciseAds: true, aimAdjustY: 3 },
  m249: { preciseAds: true, aimAdjustY: 3 },
  ultimax100: { preciseAds: true, aimAdjustY: 1 },
  mg42: { preciseAds: true, aimAdjustY: 1 },
  fusion_core_lmg: { preciseAds: true, aimAdjustY: 1 },
  singularity_loom_lmg: { preciseAds: true, aimAdjustY: 1 },
  celestial_cartographer_lmg: { preciseAds: true, aimAdjustY: 1 },
  grave_covenant_cantor_lmg: { preciseAds: true, aimAdjustY: 3 },
  qjb201: { preciseAds: false, aimAdjustX: -5, aimAdjustY: -2 },
  energy_lmg: { preciseAds: false, aimAdjustY: -1 },
};

function updateFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const output = [];
  let currentConfig = null;
  let pendingRearGrip = null;
  let inShotgunRear = false;
  let inShotgunSupport = false;

  for (let line of lines) {
    const topLevel = line.match(/^  "([^"]+)": \{$/);
    if (topLevel) {
      currentConfig = topLevel[1];
      pendingRearGrip = null;
      inShotgunRear = false;
      inShotgunSupport = false;
    }
    if (currentConfig === 'shotgun' && /^    "textureGrips": \{$/.test(line)) {
      inShotgunRear = true;
    } else if (inShotgunRear && /^    \},?$/.test(line)) {
      inShotgunRear = false;
    }
    if (currentConfig === 'shotgun' && /^    "textureSupportGrips": \{$/.test(line)) {
      inShotgunSupport = true;
    } else if (inShotgunSupport && /^    \},?$/.test(line)) {
      inShotgunSupport = false;
    }

    const machine = machineBaseline[currentConfig];
    if (machine) {
      if (/^    "aimSpriteOffsetX": -5,$/.test(line)) continue;
      if (/^    "preciseAds": true,$/.test(line) && !machine.preciseAds) continue;
      if (/^    "aimAdjustX": /.test(line)) continue;
      if (/^    "aimAdjustY": /.test(line)) {
        if (machine.aimAdjustY === null) continue;
        if (machine.aimAdjustX !== undefined) output.push(`    "aimAdjustX": ${machine.aimAdjustX},`);
        const comma = line.trimEnd().endsWith(',') ? ',' : '';
        line = `    "aimAdjustY": ${machine.aimAdjustY}${comma}`;
      }
    }

    if (correctedRearByConfig[currentConfig] && /^    "grip": \{/.test(line)) {
      const corrected = correctedRearByConfig[currentConfig];
      if (/^    "grip": \{$/.test(line)) pendingRearGrip = corrected;
      line = line
        .replace(/"x": [-\d.]+/, `"x": ${corrected.x}`)
        .replace(/"y": [-\d.]+/, `"y": ${corrected.y}`);
    }
    if (pendingRearGrip && /^      "x": /.test(line)) {
      line = line.replace(/"x": [-\d.]+/, `"x": ${pendingRearGrip.x}`);
    }
    if (pendingRearGrip && /^      "y": /.test(line)) {
      line = line.replace(/"y": [-\d.]+/, `"y": ${pendingRearGrip.y}`);
      pendingRearGrip = null;
    }
    if (inShotgunRear) {
      const texture = line.match(/^      "([^"]+)": \{/);
      if (texture && correctedRearByShotgunTexture[texture[1]]) {
        const corrected = correctedRearByShotgunTexture[texture[1]];
        line = line
          .replace(/"x": [-\d.]+/, `"x": ${corrected.x}`)
          .replace(/"y": [-\d.]+/, `"y": ${corrected.y}`);
      }
    }
    if (correctedSupportByConfig[currentConfig] && /^    "supportGrip": \{/.test(line)) {
      const corrected = correctedSupportByConfig[currentConfig];
      line = line
        .replace(/"x": [-\d.]+/, `"x": ${corrected.x}`)
        .replace(/"y": [-\d.]+/, `"y": ${corrected.y}`);
    }
    if (inShotgunSupport) {
      const texture = line.match(/^      "([^"]+)": \{/);
      if (texture && correctedSupportByShotgunTexture[texture[1]]) {
        const corrected = correctedSupportByShotgunTexture[texture[1]];
        line = line
          .replace(/"x": [-\d.]+/, `"x": ${corrected.x}`)
          .replace(/"y": [-\d.]+/, `"y": ${corrected.y}`);
      }
    }
    output.push(line);
  }
  fs.writeFileSync(filePath, output.join(eol));
}

for (const relative of ['public/data/weapon-anim-config.json', 'data/weapon-anim-config.json']) {
  const filePath = path.join(root, relative);
  updateFile(filePath);
  console.log(filePath);
}

const publicConfig = JSON.parse(fs.readFileSync(path.join(root, 'public/data/weapon-anim-config.json'), 'utf8'));
const correctedEntries = sourceGeometry.entries.map((entry) => {
  const config = publicConfig[entry.config];
  const rearGrip = entry.config === 'shotgun'
    ? config.textureGrips[entry.texture]
    : config.grip;
  const supportGrip = entry.config === 'shotgun'
    ? config.textureSupportGrips[entry.texture]
    : config.supportGrip;
  const idleScale = Number(config.idleScale) || 1;
  const configuredWorldDx = Number(((supportGrip.x - rearGrip.x) * 126 * idleScale).toFixed(3));
  const configuredWorldDy = Number(((supportGrip.y - rearGrip.y) * 126 * idleScale).toFixed(3));
  return { ...entry, idleScale, rearGrip, supportGrip, configuredWorldDx, configuredWorldDy };
});
const reportPath = path.join(here, 'corrected-support-grip-geometry.json');
fs.writeFileSync(reportPath, JSON.stringify({
  reference: 'AKM screen placement plus per-texture opaque rear-grip and fore-end contacts',
  invariant: 'rendered rear grip drives the firing hand; supportGrip drives the support palm',
  entries: correctedEntries,
}, null, 2));
console.log(reportPath);
