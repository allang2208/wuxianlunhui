#!/usr/bin/env node
/**
 * 修复所有 player 模块文件的 CRLF 换行符
 */
const fs = require('fs');
const path = require('path');

const playerDir = path.resolve(__dirname, '../src/entities/player');
const files = ['base.js', 'update.js', 'weapon-anim.js', 'subsystems.js', 'render.js'];

for (const file of files) {
  const filePath = path.join(playerDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 转换 CRLF 为 LF
  const originalLength = content.length;
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  if (content.length !== originalLength) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed CRLF in ${file}`);
  } else {
    console.log(`${file} already LF`);
  }
}

console.log('Done!');
