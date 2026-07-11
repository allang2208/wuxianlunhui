const fs = require('fs');
const path = require('path');

// singleton name -> relative module path from src/
const SINGLETONS = {
    Game: 'game.js'
};

const filesToUpdate = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            walk(full);
        } else if (full.endsWith('.js')) {
            const rel = path.relative('src', full).replace(/\\/g, '/');
            const content = fs.readFileSync(full, 'utf-8');
            const needed = [];
            for (const [name, modulePath] of Object.entries(SINGLETONS)) {
                if (rel === modulePath) continue; // don't import self
                if (!content.includes(name)) continue;
                const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${escapeRegExp(modulePath)}['"]`);
                const genericImportRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"].*${escapeRegExp(path.basename(modulePath))}['"]`);
                if (importRe.test(content) || genericImportRe.test(content)) continue;
                needed.push({ name, modulePath });
            }
            if (needed.length > 0) {
                filesToUpdate.push({ full, rel, needed });
            }
        }
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

walk('src');
console.log(`Found ${filesToUpdate.length} files to update`);

for (const { full, rel, needed } of filesToUpdate) {
    const depth = rel.split('/').length - 1;
    const prefix = depth === 0 ? './' : Array(depth).fill('../').join('');

    const importLines = needed.map(({ name, modulePath }) => {
        return `import { ${name} } from '${prefix}${modulePath}';`;
    });

    let content = fs.readFileSync(full, 'utf-8');
    // Insert at the very top of the file
    content = importLines.join('\n') + '\n' + content;
    fs.writeFileSync(full, content, 'utf-8');
    console.log(`Updated ${rel}: ${needed.map(n => n.name).join(', ')}`);
}
