const fs = require('fs');
const path = require('path');

function findJsFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      findJsFiles(full, list);
    } else if (entry.endsWith('.js')) {
      list.push(full);
    }
  }
  return list;
}

// globalName -> source file relative to src/
const globalMap = {
  CONFIG: 'config/config.js',
  MathUtils: 'config/math-utils.js',
  Easing: 'config/math-utils.js',
  AttackFormula: 'config/attack-formula.js',
  GAME_CONFIG: 'config/game-config.js',
  COMBAT_CONFIG: 'config/combat-config.js',
  COMBAT_FORMULAS: 'config/combat-formulas.js',
  ANIMATION_CONFIG: 'config/animation-config.js',
  DamagePipeline: 'combat/damage-pipeline.js'
};

const files = findJsFiles('src');
let changedFiles = 0;

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const needs = new Map(); // sourcePath -> Set(names)
  let modified = false;

  for (const [globalName, sourcePath] of Object.entries(globalMap)) {
    if (path.normalize(file) === path.normalize(path.join('src', sourcePath))) continue;
    const regex = new RegExp(`\\b${globalName}\\b`, 'g');
    if (!regex.test(s)) continue;
    // Check if already imported from this source
    const rel = path.relative(path.dirname(file), path.join('src', sourcePath)).replace(/\\/g, '/');
    const importPath = rel.startsWith('.') ? rel : './' + rel;
    const existingImport = new RegExp(
      `import\\s+\\{[^}]*\\b${globalName}\\b[^}]*\\}\\s+from\\s+['"]${importPath.replace(/\//g, '\\/')}['"]`
    ).test(s);
    if (existingImport) continue;
    if (!needs.has(importPath)) needs.set(importPath, new Set());
    needs.get(importPath).add(globalName);
  }

  if (needs.size === 0) continue;

  for (const [importPath, names] of needs) {
    const importLine = `import { ${Array.from(names).join(', ')} } from '${importPath}';`;
    const lastImport = s.lastIndexOf('import ');
    if (lastImport >= 0) {
      const endLine = s.indexOf('\n', lastImport);
      s = s.slice(0, endLine + 1) + importLine + '\n' + s.slice(endLine + 1);
    } else {
      s = importLine + '\n' + s;
    }
  }

  fs.writeFileSync(file, s);
  changedFiles++;
  console.log(file);
}

console.log('changed files:', changedFiles);
