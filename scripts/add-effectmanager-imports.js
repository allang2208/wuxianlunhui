const fs = require('fs');
const path = require('path');

const filesToUpdate = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            walk(full);
        } else if (full.endsWith('.js')) {
            const rel = path.relative('src', full).replace(/\\/g, '/');
            if (rel === 'effects/effect-manager.js') continue;
            const content = fs.readFileSync(full, 'utf-8');
            if (!content.includes('EffectManager')) continue;
            const importRe = /import\s*\{[^}]*EffectManager[^}]*\}\s*from\s*['"].*effect-manager\.js['"]/;
            if (importRe.test(content)) continue;
            filesToUpdate.push(full);
        }
    }
}

walk('src');
console.log(`Found ${filesToUpdate.length} files to update:`);
for (const p of filesToUpdate) console.log(p);

for (const full of filesToUpdate) {
    const rel = path.relative('src', full).replace(/\\/g, '/');
    const depth = rel.split('/').length - 1;
    const prefix = depth === 0 ? './' : Array(depth).fill('../').join('');
    const importPath = `${prefix}effects/effect-manager.js`;
    const importLine = `import { EffectManager } from '${importPath}';`;

    let content = fs.readFileSync(full, 'utf-8');
    // Insert after the last existing import, or at top if none
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) {
            lastImportIdx = i;
        }
    }
    if (lastImportIdx >= 0) {
        lines.splice(lastImportIdx + 1, 0, importLine);
    } else {
        // Insert at top if no imports
        lines.unshift(importLine);
    }
    fs.writeFileSync(full, lines.join('\n'), 'utf-8');
    console.log(`Updated ${rel}`);
}
