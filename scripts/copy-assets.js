const fs = require('fs');
const path = require('path');

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// 复制 assets 到 dist/assets
const srcDir = path.join(__dirname, '..', 'assets');
const destDir = path.join(__dirname, '..', 'dist', 'assets');

try {
    copyDir(srcDir, destDir);
    console.log('✅ Assets copied to dist/assets');
} catch (err) {
    console.error('❌ Failed to copy assets:', err.message);
    process.exit(1);
}

// 复制 legacy.js 到 dist/（Vite 不会自动复制非模块 script）
const legacySrc = path.join(__dirname, '..', 'legacy.js');
const legacyDest = path.join(__dirname, '..', 'dist', 'legacy.js');

try {
    if (fs.existsSync(legacySrc)) {
        fs.copyFileSync(legacySrc, legacyDest);
        console.log('✅ legacy.js copied to dist/legacy.js');
    } else {
        console.error('❌ legacy.js not found in project root');
        process.exit(1);
    }
} catch (err) {
    console.error('❌ Failed to copy legacy.js:', err.message);
    process.exit(1);
}
