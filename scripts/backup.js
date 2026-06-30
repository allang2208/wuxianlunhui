#!/usr/bin/env node
/**
 * 完整备份脚本
 * 每次构建前自动备份：src/ + game-style.css + index.html + data/
 */
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
    ensureDir(path.dirname(dest));
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        ensureDir(dest);
        fs.readdirSync(src).forEach(item => {
            copyRecursive(path.join(src, item), path.join(dest, item));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const backupDir = path.join(process.cwd(), 'backup', `v${timestamp}`);

const sources = [
    'src',
    'game-style.css',
    'index.html',
    'data',
    'package.json',
    'vite.config.js',
    'package-lock.json',
];

let copied = 0;
for (const src of sources) {
    const srcPath = path.join(process.cwd(), src);
    if (fs.existsSync(srcPath)) {
        copyRecursive(srcPath, path.join(backupDir, src));
        copied++;
    }
}

// 记录备份元数据
const metaPath = path.join(backupDir, 'backup-meta.json');
fs.writeFileSync(metaPath, JSON.stringify({
    timestamp: now.toISOString(),
    sources: sources.filter(s => fs.existsSync(path.join(process.cwd(), s))),
    copiedFiles: copied
}, null, 2));

console.log(`[Backup] 完成: ${backupDir}`);
