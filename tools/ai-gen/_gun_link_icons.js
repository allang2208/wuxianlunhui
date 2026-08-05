// 枪械改造图标入库：把 data/public 双份 craft-config.json 的枪械选项 icon 指向 assets/icons/craft/<key>.png
// 用法: node tools/ai-gen/_gun_link_icons.js
const fs = require('fs');
const path = require('path');

const GUN_WEAPONS = ['weapon6','weapon7','weapon8','weapon9','weapon10','weapon11','weapon12','weapon13','weapon15','weapon18','weapon19'];
const SHARED = { shotgun_suppressor: 'suppressor', light_extended_mag: 'light_extended' };

const root = process.cwd();
const files = [path.join(root, 'data', 'craft-config.json'), path.join(root, 'public', 'data', 'craft-config.json')];

function keyOf(id) {
  return SHARED[id] || id;
}

let changed = 0;
for (const f of files) {
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const w of GUN_WEAPONS) {
    const wp = cfg[w];
    if (!wp || !wp.options) continue;
    for (const slot of Object.keys(wp.options)) {
      for (const opt of wp.options[slot]) {
        const icon = `assets/icons/craft/${keyOf(opt.id)}.png`;
        if (opt.icon !== icon) {
          opt.icon = icon;
          changed++;
        }
      }
    }
  }
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

console.log(`updated options: ${changed}`);

// 校验：双份一致 + 引用的图标文件都存在
const a = fs.readFileSync(files[0], 'utf8');
const b = fs.readFileSync(files[1], 'utf8');
console.log('data/public identical:', a === b);

const refs = new Set();
for (const f of files) {
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const w of GUN_WEAPONS) {
    for (const slot of Object.keys(cfg[w].options)) {
      for (const opt of cfg[w].options[slot]) refs.add(opt.icon);
    }
  }
}
const missing = [...refs].filter((p) => !fs.existsSync(path.join(root, p)));
console.log(`unique icon refs: ${refs.size}, missing files: ${missing.length}`);
if (missing.length) console.log('MISSING:', missing.join(', '));
