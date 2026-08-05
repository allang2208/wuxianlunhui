// 剑类改造图标提示词生成器（一次性工具）
// 用法: node tools/ai-gen/_sword_prompts.js
// 输出: tools/ai-gen/_sword_prompts/<key>.txt（本地），再复制到 Y: 供 comfyui-gen.py 读取
const fs = require('fs');
const path = require('path');

const SWORD_WEAPONS = ['weapon2', 'weapon4', 'weapon5'];

// key: 唯一组件标识（即图标文件名）；zh: 中文名；sub: 英文主体描述
// light_pommel 与 light_blade_body 同名"轻量化剑身"，共享 light_blade_body 图；
// eagle_eye_rune 复用法杖已有图标，不在此生成列表。
const COMPONENTS = [
  { key: 'light_blade', zh: '轻量化剑刃', sub: 'a single lightweight sword blade, slim steel blade with several oval cutout slots and a shallow fuller, silver polished metal, completely inside the frame with generous white margins' },
  { key: 'hardened_edge', zh: '淬火硬化刃口', sub: 'a single quench-hardened sword blade edge, steel blade with a distinct blue-black tempered edge zone and a visible hardening line, high detail' },
  { key: 'heavy_blunt', zh: '厚重钝化', sub: 'a single heavy blunt sword blade, thick dark steel blade with a squared dull edge and broad spine, heavy sturdy look, completely inside the frame with generous white margins' },
  { key: 'sharpened_edge', zh: '精细研磨开锋', sub: 'a single razor-sharp polished sword blade, one continuous mirror-bright steel edge with a fine sharpened bevel catching light, exactly one blade, one piece, no second blade, no detached pieces' },
  { key: 'magic_blade', zh: '魔力刀刃', sub: 'a single arcane magic sword blade, steel blade with glowing blue-violet magical energy running along the edge, single blade only' },
  { key: 'vulnerability_blade', zh: '易伤刀刃', sub: 'a single cursed sword blade, pale steel blade with sickly green magical corruption glow along the edge, single blade only' },
  { key: 'enchanted_blade', zh: '附魔刀刃', sub: 'a single enchanted sword blade, silver steel blade etched with softly glowing golden runes along its length, single blade only' },
  { key: 'small_disc_guard', zh: '小型圆盘护手', sub: 'a single small round disc sword guard, a small circular steel disc with a central slot hole for the blade, standalone guard only, no blade, no grip' },
  { key: 'wide_cross_guard', zh: '宽十字护手', sub: 'a single wide crossguard, long straight steel crossguard bar with slightly flared quillon tips and a central blade slot, standalone guard only, no blade, no grip' },
  { key: 'no_guard', zh: '无护手', sub: 'a single bare sword grip, dark leather-wrapped handle with a bare metal tang extending from the top and a plain pommel at the bottom, absolutely no crossguard, no quillon, no disc guard, no hand protection anywhere between grip and tang, standalone grip part only, completely inside the frame with generous white margins' },
  { key: 'wrapped_long_grip', zh: '缠绳附加长柄', sub: 'a single long sword grip wrapped in cord and dark leather with visible cross-wrap pattern, slightly extended length, standalone grip only, completely inside the frame with generous white margins' },
  { key: 'short_compact_grip', zh: '短柄紧凑型握把', sub: 'a single short compact sword grip, small leather-wrapped handle, noticeably short, standalone grip only' },
  { key: 'damascus_steel', zh: '大马士革钢', sub: 'a single sword blade made of damascus steel, steel surface with intricate swirling wavy layered pattern like flowing water, single blade only, completely inside the frame with generous white margins' },
  { key: 'quench_hardened', zh: '淬火硬化', sub: 'a single quenched sword blade with a visible hamon temper line, wavy white hardening boundary along the cutting edge separating hard bright edge from darker spine, single blade only' },
  { key: 'extended_blade', zh: '延长剑身', sub: 'a single extra-long sword blade, very long narrow steel blade with a central fuller, noticeably longer than a normal blade, completely inside the frame with generous white margins' },
  { key: 'light_blade_body', zh: '轻量化剑身', sub: 'a single lightweight openwork sword blade, steel blade with a row of oval cutout windows and a slim profile, single blade only, completely inside the frame with generous white margins' },
  { key: 'hollow_blade', zh: '镂空', sub: 'a single openwork hollow sword blade, steel blade with large decorative hollow cutouts and a deep central fuller, single blade only, completely inside the frame with generous white margins' },
  { key: 'rune_restructure', zh: '符文重构', sub: 'a single sword blade reconstructed from glowing arcane runes, blade formed by bright blue magical rune fragments, single blade only' },
  { key: 'sharp_rune', zh: '锐利符文', sub: 'a single sword blade with sharp-edged runes, steel blade etched with angular glowing cyan runes, single blade only' },
  { key: 'destruction_rune', zh: '毁灭符文', sub: 'a single sword blade with destruction runes, dark steel blade etched with glowing crimson red runes, single blade only' },
  { key: 'weighted_pommel', zh: '配重锤增重', sub: 'a single heavy sword pommel, large flanged steel counterweight ball with a central tang hole, heavy sturdy design, standalone pommel only, no blade, no grip' },
  { key: 'hollow_orb', zh: '镂空小球', sub: 'a single hollow openwork sword pommel, round steel sphere with decorative cutout windows and a central tang hole, standalone pommel only, no blade, no grip' },
];

// 共享映射：light_pommel（剑首"轻量化剑身"）与 light_blade_body（剑身"轻量化剑身"）同名共用
const SHARED = {
  light_pommel: 'light_blade_body',
};

const TEMPLATE = [
  'game equipment icon, realistic dark fantasy RPG item icon, centered single item occupying most of frame, pure white background, no text, no watermark, no human, high detail, dramatic rim lighting,',
  '(exactly one {key}:1.5), {sub}, (isolated single object:1.3), centered with generous white margin,',
  'no blurry, no low quality, no watermark, no text, no signature, no frame, no border, no multiple subjects, no hands, no character, no circular halo, no glowing circle behind object, no magic circle, no base, no pedestal, no stand, no chain, no rope, no floating debris, no particles, no sparkles, no second object, no detached pieces,',
  'no multiple views, no duplicate items, no whole sword, no full weapon',
].join('\n');

const root = process.cwd();
const cfgPath = path.join(root, 'data', 'craft-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const optionIds = [];
for (const w of SWORD_WEAPONS) {
  const wp = cfg[w];
  if (!wp || !wp.options) { console.error('missing weapon', w); process.exit(1); }
  for (const slot of Object.keys(wp.options)) {
    for (const opt of wp.options[slot]) optionIds.push(opt.id);
  }
}

const keyById = new Map();
for (const c of COMPONENTS) keyById.set(c.key, c.key);
for (const [id, key] of Object.entries(SHARED)) keyById.set(id, key);
// 复用法杖已有图标
const REUSE = { eagle_eye_rune: 'eagle_eye_rune' };
for (const [id, key] of Object.entries(REUSE)) keyById.set(id, key);

const missing = [];
for (const id of optionIds) if (!keyById.has(id)) missing.push(id);
if (missing.length) {
  console.error('未覆盖的选项 id:', missing.join(', '));
  process.exit(1);
}

const usedKeys = new Set(optionIds.map((id) => keyById.get(id)));
const orphanKeys = COMPONENTS.filter((c) => !usedKeys.has(c.key)).map((c) => c.key);
if (orphanKeys.length) {
  console.error('未使用的组件（不会被任何选项引用）:', orphanKeys.join(', '));
  process.exit(1);
}

const outDir = path.join(root, 'tools', 'ai-gen', '_sword_prompts');
fs.mkdirSync(outDir, { recursive: true });
for (const c of COMPONENTS) {
  const prompt = TEMPLATE.replace('{key}', c.key).replace('{sub}', c.sub);
  fs.writeFileSync(path.join(outDir, `${c.key}.txt`), prompt, 'utf8');
}

const counts = new Map();
for (const id of optionIds) {
  const key = keyById.get(id);
  counts.set(key, (counts.get(key) || 0) + 1);
}
console.log(`选项总数: ${optionIds.length}, 唯一组件: ${usedKeys.size}, 新生成: ${COMPONENTS.length}, 复用: ${Object.keys(REUSE).length}`);
console.log('共享映射:', JSON.stringify(SHARED));
console.log('复用映射:', JSON.stringify(REUSE));
for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}x  ${key}`);
}
