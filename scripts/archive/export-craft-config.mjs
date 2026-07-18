// 一次性脚本：把 craft-system.js 中硬编码的 _WEAPON_CRAFT_CONFIGS（含全部拼接逻辑）
// 求值并导出为 data/craft-config.json（迁移到配置驱动，规则 1）
import fs from 'node:fs';

const SRC = 'src/ui/craft-system.js';
const DST = 'data/craft-config.json';

const src = fs.readFileSync(SRC, 'utf8');

// 花括号匹配：从 "_WEAPON_CRAFT_CONFIGS: {" 提取完整配置对象字面量
function extractObjectLiteral(text, startIdx) {
    const openIdx = text.indexOf('{', startIdx);
    let depth = 0, inStr = null, escape = false;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (escape === false && ch === '\\') { escape = true; continue; }
        if (inStr) {
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(openIdx, i + 1);
        }
    }
    throw new Error('未找到匹配的闭括号');
}

const litStart = src.indexOf('_WEAPON_CRAFT_CONFIGS: {');
const spliceMarker = '// 为其他枪械复制PKM的初始改造栏位结构';
const spliceStart = src.indexOf(spliceMarker);
const exportIdx = src.lastIndexOf('export { CraftSystem };');
if (litStart < 0 || spliceStart < 0 || exportIdx < 0) {
    console.error('边界定位失败', { litStart, spliceStart, exportIdx });
    process.exit(1);
}

const literal = extractObjectLiteral(src, litStart);
const spliceBlock = src.slice(spliceStart, exportIdx);

const CraftSystem = {};
const code = 'CraftSystem._WEAPON_CRAFT_CONFIGS = ' + literal + ';\n' + spliceBlock;
// 配置块为纯数据运算（JSON.parse/stringify 与数学常量），无浏览器依赖
eval(code);

const cfg = CraftSystem._WEAPON_CRAFT_CONFIGS;
const keys = Object.keys(cfg);
fs.writeFileSync(DST, JSON.stringify(cfg, null, 2));
console.log(`导出完成: ${keys.length} 个武器配置 -> ${DST}`);
for (const k of keys) {
    const slots = cfg[k].slots ? cfg[k].slots.length : 0;
    const opts = cfg[k].options ? Object.keys(cfg[k].options).length : 0;
    console.log(`  ${k}: ${slots} slots, ${opts} option groups`);
}
