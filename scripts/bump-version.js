#!/usr/bin/env node
/**
 * 自动递增版本号（patch 级别）
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parts = pkg.version.split('.');
parts[2] = parseInt(parts[2]) + 1;
pkg.version = parts.join('.');
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[Version] ${pkg.version}`);
