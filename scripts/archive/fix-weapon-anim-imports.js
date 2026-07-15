#!/usr/bin/env node
/**
 * 修复缺失的导入
 */
const fs = require('fs');
const path = require('path');

const playerDir = path.resolve(__dirname, '../src/entities/player');

// 修复 render.js
const renderPath = path.join(playerDir, 'render.js');
let renderContent = fs.readFileSync(renderPath, 'utf-8');
renderContent = renderContent.replace(
  "import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';",
  "import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';\nimport { WeaponAnimConfig, getWeaponStateConfig } from '../../items/weapon-anim-config.js';"
);
fs.writeFileSync(renderPath, renderContent);
console.log('Fixed render.js');

// 修复 subsystems.js
const subsystemsPath = path.join(playerDir, 'subsystems.js');
let subsystemsContent = fs.readFileSync(subsystemsPath, 'utf-8');
subsystemsContent = subsystemsContent.replace(
  "import { isGunWeapon } from '../../config/gun-ammo.js';",
  "import { isGunWeapon } from '../../config/gun-ammo.js';\nimport { WeaponAnimConfig, getWeaponStateConfig } from '../../items/weapon-anim-config.js';"
);
fs.writeFileSync(subsystemsPath, subsystemsContent);
console.log('Fixed subsystems.js');

// 修复 weapon-anim.js
const weaponAnimPath = path.join(playerDir, 'weapon-anim.js');
let weaponAnimContent = fs.readFileSync(weaponAnimPath, 'utf-8');
weaponAnimContent = weaponAnimContent.replace(
  "import { isTwoHanded } from '../../config/gun-ammo.js';",
  "import { isTwoHanded } from '../../config/gun-ammo.js';\nimport { WeaponAnimConfig } from '../../items/weapon-anim-config.js';"
);
fs.writeFileSync(weaponAnimPath, weaponAnimContent);
console.log('Fixed weapon-anim.js');

// 验证
const acorn = require('acorn');
for (const file of ['render.js', 'subsystems.js', 'weapon-anim.js']) {
  try {
    acorn.parse(fs.readFileSync(path.join(playerDir, file), 'utf-8'), { ecmaVersion: 2022, sourceType: 'module' });
    console.log(`✓ ${file}`);
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
  }
}
