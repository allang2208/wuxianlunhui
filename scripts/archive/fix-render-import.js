#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const renderPath = path.resolve(__dirname, '../src/entities/player/render.js');
let content = fs.readFileSync(renderPath, 'utf-8');

// 删除所有 WeaponAnimConfig 导入行
content = content.replace(/import \{ WeaponAnimConfig[^}]+\} from[^;]+;\r?\n/g, '');

// 在 gun-ammo 导入后添加正确的导入
content = content.replace(
  /import \{ isGunWeapon, isTwoHanded \} from '\.\.\/..\/config\/gun-ammo\.js';\r?\n/,
  "import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';\nimport { WeaponAnimConfig, getWeaponStateConfig } from '../../items/weapon-anim-config.js';\n"
);

fs.writeFileSync(renderPath, content);
console.log('Fixed render.js');

// 验证
const acorn = require('acorn');
try {
  acorn.parse(fs.readFileSync(renderPath, 'utf-8'), { ecmaVersion: 2022, sourceType: 'module' });
  console.log('✓ render.js valid');
} catch (e) {
  console.error('✗ render.js error:', e.message);
}
