// 一次性脚本：定位 craft-system.js 配置字面量与拼接段的行边界（供 sed 替换）
import fs from 'node:fs';

const src = fs.readFileSync('src/ui/craft-system.js', 'utf8');

function extractEnd(text, startIdx) {
    const openIdx = text.indexOf('{', startIdx);
    let depth = 0, inStr = null, escape = false;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (inStr) { if (ch === inStr) inStr = null; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

const litStart = src.indexOf('_WEAPON_CRAFT_CONFIGS: {');
const litEnd = extractEnd(src, litStart);
const spliceStart = src.indexOf('// 为其他枪械复制PKM的初始改造栏位结构');
const exportIdx = src.lastIndexOf('export { CraftSystem };');
const lineOf = (idx) => src.slice(0, idx).split('\n').length;

console.log('LIT_START_LINE=' + lineOf(litStart));
console.log('LIT_END_LINE=' + lineOf(litEnd));
console.log('SPLICE_START_LINE=' + lineOf(spliceStart));
console.log('SPLICE_END_LINE=' + (lineOf(exportIdx) - 1));
const lines = src.split('\n');
console.log('--- literal 结束后 3 行 ---');
console.log(lines.slice(lineOf(litEnd) - 1, lineOf(litEnd) + 2).join('\n'));
console.log('--- splice 末尾 3 行 ---');
console.log(lines.slice(lineOf(exportIdx) - 4, lineOf(exportIdx) - 1).join('\n'));
