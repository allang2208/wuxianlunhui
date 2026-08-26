import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const writeJson = (rel, value, indent = 2) => fs.writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, indent)}\n`);
const clone = (value) => JSON.parse(JSON.stringify(value));

const specs = [
  readJson('tools/ai-gen/weapon-specs/frontier-rifle.json'),
  readJson('tools/ai-gen/weapon-specs/vengeance-rifle.json'),
];

function equipmentFromSpec(spec) {
  const item = {
    weaponId: spec.weaponId,
    name: spec.name,
    type: spec.type,
    icon: spec.icon,
    iconImage: spec.assets.iconImage,
    slotImage: spec.assets.slotImage,
    dropImage: spec.assets.dropImage,
    equipImage: spec.assets.equipImage,
    category: spec.category,
    rarity: spec.rarity,
    level: spec.level,
    price: spec.price,
    weaponCategory: spec.weaponCategory,
    weaponType: spec.weaponType,
    weaponTypeTag: spec.weaponTypeTag,
    isTwoHanded: spec.isTwoHanded,
    weaponAsset: { image: spec.assets.weaponAssetImage, muzzleImage: 'assets/effects/muzzle_flash_01.png' },
    stats: clone(spec.statsJson),
    desc: spec.desc,
    equipSlot: spec.equipSlot,
    attack: clone(spec.attack),
    animation: clone(spec.animation),
    attackKey: spec.attackKey,
    animConfigKey: spec.animConfigKey,
    fireSound: spec.fireSound,
    equipSound: spec.equipSound,
    canvasImageProp: spec.canvasImageProp,
    ammoConfig: clone(spec.ammoConfig),
    fireMode: spec.fireMode,
    attackFormula: clone(spec.attackFormula),
    spreadParams: clone(spec.spreadParams),
  };
  if (spec.burstMode) item.burstMode = spec.burstMode;
  return item;
}

const equipment = readJson('data/equipment.json');
equipment.equipment.frontier_rifle = equipmentFromSpec(specs[0]);
equipment.equipment.vengeance_rifle = equipmentFromSpec(specs[1]);
writeJson('data/equipment.json', equipment, 4);
writeJson('public/data/equipment.json', equipment, 4);

const craft = readJson('data/craft-config.json');
const universalSights = clone(craft.weapon7.options.sight);

const frontier = clone(craft.weapon21);
frontier.options.barrel = frontier.options.barrel.filter((option) => option.id !== 'piston_tuning');
frontier.options.stock = frontier.options.stock.filter((option) => option.id !== 'hk_stock');
frontier.options.sight = universalSights;
frontier.options.barrel.push(
  {
    id: 'frontier_overdrive_bolt',
    name: '边境超驱枪机',
    icon: 'assets/icons/craft-cold-steel/frontier_overdrive_bolt.png',
    desc: '攻击间隔-10ms，最大散布角度+3°',
    specialModification: true,
    ticketCost: 4,
    effects: { attackIntervalDelta: -10, maxSpreadAngleDelta: 3 },
  },
  {
    id: 'frontier_ceramic_handguard',
    name: '陶瓷散热护木',
    icon: 'assets/icons/craft-cold-steel/frontier_ceramic_handguard.png',
    desc: '散布开始延后约3发，最大散布角度-2°',
    ticketCost: 2,
    effects: { spreadStartDelta: 240, maxSpreadAngleDelta: -2 },
  },
);
frontier.options.bullet.push({
  id: 'frontier_light_core_round',
  name: '边境轻芯弹',
  icon: 'assets/icons/craft-cold-steel/frontier_light_core_round.png',
  desc: '弹速+12%，射程+120px，伤害-4%',
  ticketCost: 2,
  effects: { projectileSpeedPercent: 0.12, rangeDelta: 120, damagePercent: -0.04 },
});
frontier.options.stock.push({
  id: 'frontier_countermass_stock',
  name: '配重缓冲枪托',
  icon: 'assets/icons/craft-cold-steel/frontier_countermass_stock.png',
  desc: '后坐恢复时间-120ms，移动速度-2%',
  ticketCost: 2,
  effects: { recoilRecoveryDelta: -120, moveSpeedPercent: -0.02 },
});
craft.weapon25 = frontier;

const vengeance = clone(craft.weapon7);
vengeance.options.sight = universalSights;
vengeance.options.barrel.push({
  id: 'vengeance_burst_regulator',
  name: '三连发谐振调节器',
  icon: 'assets/icons/craft-cold-steel/vengeance_burst_regulator.png',
  desc: '三连发周期-40ms，最大散布角度+2°',
  ticketCost: 2,
  effects: { attackIntervalDelta: -40, maxSpreadAngleDelta: 2 },
});
vengeance.options.bullet.push({
  id: 'vengeance_heavy_core_round',
  name: '复仇重芯弹',
  icon: 'assets/icons/craft-cold-steel/vengeance_heavy_core_round.png',
  desc: '伤害+10%，弹速-8%，击退+2px',
  ticketCost: 2,
  effects: { damagePercent: 0.10, projectileSpeedPercent: -0.08, knockbackDelta: 2 },
});
vengeance.options.stock.push({
  id: 'vengeance_resonance_stock',
  name: '谐振配重枪托',
  icon: 'assets/icons/craft-cold-steel/vengeance_resonance_stock.png',
  desc: '后坐恢复时间-140ms，静止散布-12%',
  ticketCost: 2,
  effects: { recoilRecoveryDelta: -140, stationarySpreadPercent: -0.12 },
});
vengeance.options.grip.push({
  id: 'vengeance_full_auto_core',
  name: '复仇协议机芯',
  icon: 'assets/icons/craft-cold-steel/vengeance_full_auto_core.png',
  desc: '改为全自动，攻击间隔-190ms，伤害-20%，全自动最大散布+8°',
  specialModification: true,
  ticketCost: 4,
  effects: {
    fireModeOverride: 'fullAuto',
    attackIntervalDelta: -190,
    damagePercent: -0.20,
    autoSpreadStartDelta: -240,
    autoMaxSpreadAngleDelta: 8,
    recoilRecoveryDelta: 80,
  },
});
craft.weapon26 = vengeance;

writeJson('data/craft-config.json', craft, 4);
writeJson('public/data/craft-config.json', craft, 4);

const anim = readJson('public/data/weapon-anim-config.json');
anim.frontier_rifle = clone(anim.m416);
anim.frontier_rifle.timingMul = 0.08;
anim.frontier_rifle.recoilAmount = 0.08;
anim.frontier_rifle.grip = { x: 0.39, y: 0.62 };
anim.frontier_rifle.muzzle = { x: 0.96, y: 0.52 };
anim.vengeance_rifle = clone(anim.akm);
anim.vengeance_rifle.timingMul = 0.30;
anim.vengeance_rifle.recoilAmount = 0.16;
anim.vengeance_rifle.grip = { x: 0.37, y: 0.63 };
anim.vengeance_rifle.muzzle = { x: 0.96, y: 0.50 };
writeJson('public/data/weapon-anim-config.json', anim);

console.log('wrote equipment weapon25/weapon26, craft configs, and animation configs');
