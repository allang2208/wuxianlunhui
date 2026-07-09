#!/usr/bin/env node
/**
 * 为拆分后的 mixin 文件添加缺失的导入
 */
const fs = require('fs');
const path = require('path');

const playerDir = path.resolve(__dirname, '../src/entities/player');

// 定义每个文件需要的导入
const imports = {
  'update.js': [
    "import { isGunWeapon, isOneHanded, isTwoHanded } from '../../config/gun-ammo.js';"
  ],
  'subsystems.js': [
    "import { isGunWeapon } from '../../config/gun-ammo.js';"
  ],
  'render.js': [
    "import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';"
  ],
  'weapon-anim.js': [
    "import { isTwoHanded } from '../../config/gun-ammo.js';"
  ]
};

for (const [file, importLines] of Object.entries(imports)) {
  const filePath = path.join(playerDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 在文件开头添加导入（在 const mixin = { 之前）
  const importBlock = importLines.join('\n') + '\n\n';
  content = importBlock + content;
  
  fs.writeFileSync(filePath, content);
  console.log(`Added imports to ${file}`);
}

console.log('Done!');
