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

function stripComments(code) {
  // Remove JSDoc/block comments /* ... */ and line comments // ...
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function isDeclared(code, name) {
  const patterns = [
    `\\bclass\\s+${name}\\b`,
    `\\bfunction\\s+${name}\\b`,
    `\\b(?:const|let|var)\\s+${name}\\b`,
    `\\bimport\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+['"]`
  ];
  return patterns.some(p => new RegExp(p).test(code));
}

// Configure per batch by uncommenting the desired map
const globalMap = {
  // Batch A (done)
  // CONFIG: 'config/config.js',
  // MathUtils: 'config/math-utils.js',
  // Easing: 'config/math-utils.js',
  // AttackFormula: 'config/attack-formula.js',
  // GAME_CONFIG: 'config/game-config.js',
  // COMBAT_CONFIG: 'config/combat-config.js',
  // COMBAT_FORMULAS: 'config/combat-formulas.js',
  // ANIMATION_CONFIG: 'config/animation-config.js',
  // DamagePipeline: 'combat/damage-pipeline.js'

  // Batch C: UI systems
  NPCDialogue: 'ui/npc-dialogue.js',
  ShopSystem: 'ui/shop-system.js',
  EnhanceSystem: 'ui/enhance-system.js',
  CraftSystem: 'ui/craft-system.js',
  EnchantSystem: 'ui/enchant-system.js',
  QuestSystem: 'ui/quest-system.js',
  QuestState: 'ui/quest-system.js',
  QuestTracker: 'ui/quest-system.js',
  LevelUpSystem: 'ui/quest-system.js',
  RiftSystem: 'quest/rift-system.js',
  RewardSystem: 'ui/reward-system.js',
  EnhancementItems: 'ui/reward-system.js',
  SkillManager: 'ui/skill-manager.js',
  QuickBar: 'ui/quick-bar.js',
  EquipManager: 'ui/equip-manager.js',
  EquipTooltipManager: 'ui/equip-tooltip-manager.js',
  BackpackDialogManager: 'ui/backpack-dialog-manager.js',
  EquipDataManager: 'ui/equip-data-manager.js',
  GameUIManager: 'ui/game-ui-manager.js',
  CodexManager: 'ui/codex-manager.js',
  SystemUI: 'ui/system-ui.js',
  UI_DATA_CONFIG: 'ui/system-ui.js',
  DevTool: 'ui/dev-tool.js',
  NpcPortraitTool: 'ui/npc-portrait-tool.js',

  // Batch D: world systems
  DungeonMapSystem: 'world/dungeon-map-system.js',
  ExpeditionSystem: 'ui/expedition-system.js'
};

const files = findJsFiles('src');
let changedFiles = 0;

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const needs = new Map(); // sourcePath -> Set(names)
  const codeWithoutComments = stripComments(s);

  for (const [globalName, sourcePath] of Object.entries(globalMap)) {
    if (path.normalize(file) === path.normalize(path.join('src', sourcePath))) continue;
    if (isDeclared(s, globalName)) continue;
    const regex = new RegExp(`\\b${globalName}\\b`, 'g');
    if (!regex.test(codeWithoutComments)) continue;
    const rel = path.relative(path.dirname(file), path.join('src', sourcePath)).replace(/\\/g, '/');
    const importPath = rel.startsWith('.') ? rel : './' + rel;
    if (!needs.has(importPath)) needs.set(importPath, new Set());
    needs.get(importPath).add(globalName);
  }

  if (needs.size === 0) continue;

  for (const [importPath, names] of needs) {
    const importLine = `import { ${Array.from(names).join(', ')} } from '${importPath}';`;
    const lastImport = s.lastIndexOf('import ');
    if (lastImport >= 0) {
      const endSemi = s.indexOf(';', lastImport);
      if (endSemi >= 0) {
        const insertPos = endSemi + 1;
        s = s.slice(0, insertPos) + '\n' + importLine + s.slice(insertPos);
      } else {
        const endLine = s.indexOf('\n', lastImport);
        s = s.slice(0, endLine + 1) + importLine + '\n' + s.slice(endLine + 1);
      }
    } else {
      s = importLine + '\n' + s;
    }
  }

  fs.writeFileSync(file, s);
  changedFiles++;
  console.log(file);
}

console.log('changed files:', changedFiles);
