const { execSync } = require('child_process');
const fs = require('fs');

const eslintOutput = execSync('npx eslint src --format json', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
const results = JSON.parse(eslintOutput);

const fileFixes = new Map();

for (const result of results) {
    const filePath = result.filePath;
    for (const msg of result.messages) {
        if (msg.ruleId !== 'no-unused-vars') continue;
        if (!msg.message.includes('is defined but never used')) continue;

        // Extract variable name from message like "'X' is defined but never used"
        const match = msg.message.match(/'([^']+)' is defined but never used/);
        if (!match) continue;
        const varName = match[1];

        // Only consider imports at the top of the file (line should be small)
        if (msg.line > 30) continue; // imports are usually at the top

        if (!fileFixes.has(filePath)) fileFixes.set(filePath, new Set());
        fileFixes.get(filePath).add(varName);
    }
}

for (const [filePath, unusedVars] of fileFixes) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let changed = false;

    for (const varName of unusedVars) {
        // Match import { ... } from '...' containing varName
        const importRe = new RegExp(`^import\\s*\\{([^}]*\\b${varName}\\b[^}]*)\\}\\s*from\\s*(['"][^'"]+['"]);?\\s*$`, 'gm');
        content = content.replace(importRe, (match, inner, source) => {
            changed = true;
            const remaining = inner.split(',')
                .map(s => s.trim())
                .filter(s => s && !new RegExp(`^\\s*${varName}\\s*$`).test(s));
            if (remaining.length === 0) {
                return ''; // remove whole import
            }
            return `import { ${remaining.join(', ')} } from ${source};`;
        });
    }

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Cleaned imports in ${filePath}`);
    }
}
