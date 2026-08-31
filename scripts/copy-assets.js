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
