/**
 * 世界-122建筑详情面板定位回归：
 * 墙/门、基地、防御塔、小屋、兵营、生产建筑、陷阱必须同在右上角顶部基线。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'game-style.css'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/ui/panels/building-detail-header.js'), 'utf8');
const panelSources = {
    tower: fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8'),
    hut: fs.readFileSync(path.join(ROOT, 'src/world/hamster-hut-system.js'), 'utf8'),
    barracks: fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8'),
    producer: fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8'),
    trap: fs.readFileSync(path.join(ROOT, 'src/world/defense-trap-system.js'), 'utf8'),
    base: fs.readFileSync(path.join(ROOT, 'src/world/world122-tribute-system.js'), 'utf8'),
    walls: fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8'),
};
const classes = [
    'defense-tower-panel',
    'hamster-hut-panel',
    'hamster-barracks-panel',
    'producer-building-panel',
    'defense-trap-panel',
    'world122-base-panel',
];
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (!condition) fail++;
}

check('墙/门建筑详情面板固定右上角', /\.wall-editor-panel\s*\{[^}]*right:\s*26px;[^}]*top:\s*26px;/s.test(css));
for (const className of classes) {
    check(`${className} 纳入统一建筑详情定位`, css.includes(`.${className}`));
}
const rule = css.match(/\.defense-tower-panel,[\s\S]*?\.world122-base-panel\s*\{([\s\S]*?)\}/);
check('统一规则锁定右上角顶部基线',
    !!rule && /right:\s*26px\s*!important/.test(rule[1])
    && /top:\s*26px\s*!important/.test(rule[1])
    && /transform:\s*none\s*!important/.test(rule[1]));
check('统一详情头部先展示缩略图与名称，再展示生命条/耐久百分比',
    /thumbnail/.test(headerSrc)
    && /耐久 \$\{current\} \/ \$\{max\}（\$\{pct\}%）/.test(headerSrc)
    && /world122-building-detail-header/.test(headerSrc));
for (const [name, src] of Object.entries(panelSources)) {
    check(`${name} 面板接入统一详情头部`, /renderBuildingDetailHeader/.test(src));
}
check('墙/门/方块墙/射击台详情均复用统一头部',
    (panelSources.walls.match(/renderBuildingDetailHeader/g) || []).length >= 4);

console.log(`\n结果: ${classes.length + 11 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
