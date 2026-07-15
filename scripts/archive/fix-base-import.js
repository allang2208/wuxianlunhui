#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const basePath = path.resolve(__dirname, '../src/entities/player/base.js');
let content = fs.readFileSync(basePath, 'utf-8');

// 在文件开头添加导入
content = "import { computeWeaponAttack } from '../../config/attack-formula.js';\n\n" + content;

fs.writeFileSync(basePath, content);
console.log('Added computeWeaponAttack import to base.js');

// 验证
const acorn = require('acorn');
try {
  acorn.parse(fs.readFileSync(basePath, 'utf-8'), { ecmaVersion: 2022, sourceType: 'module' });
  console.log('✓ base.js valid');
} catch (e) {
  console.error('✗ base.js error:', e.message);
}
