// 一次性盘点：装备/技能图标接线情况、改造覆盖、审计遗留
const fs = require('fs');
const path = require('path');

const root = process.cwd();

// 1. craft 改造图标覆盖
const craft = JSON.parse(fs.readFileSync(path.join(root, 'data', 'craft-config.json'), 'utf8'));
let craftEmoji = 0, craftImg = 0, craftTotal = 0;
for (const w of Object.keys(craft)) {
  for (const s of Object.keys(craft[w].options)) {
    for (const o of craft[w].options[s]) {
      craftTotal++;
      if (String(o.icon).startsWith('assets/')) craftImg++; else craftEmoji++;
    }
  }
}
console.log(`[craft] 武器=${Object.keys(craft).length} 选项=${craftTotal} 有图=${craftImg} emoji=${craftEmoji}`);

// 2. equipment.json 物品图标（icon/iconImage/dropImage/slotImage/equipImage/image）
const eq = JSON.parse(fs.readFileSync(path.join(root, 'data', 'equipment.json'), 'utf8')).equipment;
const ids = Object.keys(eq);
const imgFieldNames = ['iconImage', 'dropImage', 'slotImage', 'equipImage', 'image'];
const noRefs = [];
for (const id of ids) {
  const it = eq[id];
  const has = imgFieldNames.some((k) => typeof it[k] === 'string' && it[k].startsWith('assets/'));
  if (!has) noRefs.push(id);
}
console.log(`[equipment] 条目=${ids.length} 有图片引用=${ids.length - noRefs.length} 无图片引用=${noRefs.length}`);
console.log('  无图:', noRefs.join(', ') || '(无)');

// 引用的文件是否实际存在
const broken = [];
for (const id of ids) {
  const it = eq[id];
  for (const k of imgFieldNames) {
    const v = it[k];
    if (typeof v === 'string' && v.startsWith('assets/') && !fs.existsSync(path.join(root, v))) {
      broken.push(`${id}.${k}=${v}`);
    }
  }
}
console.log(`[equipment] 引用缺失文件=${broken.length}`);
if (broken.length) console.log('  ' + broken.join('\n  '));

// 3. skills.json 图标（所有图片类字段）
const skJson = JSON.parse(fs.readFileSync(path.join(root, 'data', 'skills.json'), 'utf8'));
const topKeys = Object.keys(skJson);
console.log('[skills] top keys:', topKeys.join(', '));
const list = skJson.skills;
const skillArr = Array.isArray(list) ? list : (list ? Object.values(list) : []);
const imgKeys = ['icon', 'iconImage', 'image', 'skillImage', 'iconPath'];
let skWithImg = 0;
const skMissing = [];
for (const it of skillArr) {
  const has = imgKeys.some((k) => typeof it[k] === 'string' && it[k].startsWith('assets/'));
  if (has) skWithImg++; else skMissing.push(it.id || it.name || JSON.stringify(it).slice(0, 80));
}
console.log(`[skills] 条目=${skillArr.length} 有图片引用=${skWithImg} 无图片引用=${skMissing.length}`);
if (skMissing.length) console.log('  无图:', skMissing.join(', '));
console.log('[skills] 示例条目字段:', Object.keys(skillArr[0] || {}).join(', '));

// 4. 审计遗留关键词（简化：只列相关文件里的 TODO/FIXME 数量）
const auditFiles = ['weapon-code-audit.md', '代码审查报告.md', '优化清单.md', 'tech-debt-report.md', 'code-review-report.md'];
for (const f of auditFiles) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  console.log(`[audit] ${f}: ${txt.length} 字符`);
}
