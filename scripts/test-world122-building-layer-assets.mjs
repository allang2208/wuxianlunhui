/**
 * 世界-122建筑贴图替换后的图层/投影回归：
 * 裁后内容必须水平居中、贴底；显示高度按宽高比；投影 manifest 与 footprint 深度链完整。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/environment-lighting-assets.json'), 'utf8'));
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
const skill = fs.readFileSync(path.join(ROOT, 'skill/06-dungeon-scene.md'), 'utf8');
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (!condition) fail++;
}

const items = [
    ['barracks', { displayW: 275, displayH: 231, foot: 116 }],
    ['church', { displayW: 256, displayH: 301, foot: 150 }],
    ['research_institute', { displayW: 256, displayH: 303, foot: 152 }],
    ['thatch_hut', { displayW: 275, displayH: 225, foot: 113 }],
    ['blacksmith', { displayW: 267, displayH: 218, foot: 109 }],
    ['shooting_range', { displayW: 272, displayH: 217, foot: 109 }],
    ['cavalry_school', { displayW: 266, displayH: 202, foot: 101 }],
];

for (const [key, expected] of items) {
    const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain', `${key}.png`)));
    let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            if (png.data[(y * png.width + x) * 4 + 3] <= 16) continue;
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    }
    const centered = Math.abs((x0 + x1) / 2 - (png.width - 1) / 2) <= 1;
    const bottomAligned = y1 === png.height - 1;
    const expectedH = Math.round(expected.displayW * png.height / png.width);
    const conf = key === 'barracks' ? null : cfg[key];
    const cfgOk = key === 'barracks'
        ? new RegExp(`displayW:\\s*${expected.displayW},[\\s\\S]{0,80}displayH:\\s*${expected.displayH},[\\s\\S]{0,80}footOffsetY:\\s*${expected.foot}`).test(barracksSrc)
        : conf?.displayW === expected.displayW && conf?.displayH === expected.displayH && conf?.footOffsetY === expected.foot;
    const light = manifest.assets?.[key];
    const rawAssetHash = expected.rawCanvas === true
        ? createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets/terrain', `${key}.png`))).digest('hex').toUpperCase()
        : null;
    const rawCanvasOk = expected.rawCanvas === true
        && conf?.assetRawCanvas === true
        && conf?.assetSourceHash === rawAssetHash
        && png.width === expected.canvasW && png.height === expected.canvasH;
    check(`${key} 贴图居中贴底、显示锚点与投影资产一致`,
        (rawCanvasOk || (centered && bottomAligned && expectedH === expected.displayH && expected.foot === Math.round(expected.displayH / 2)))
        && light?.shadow?.anchorMode === 'footprint_center'
        && fs.existsSync(path.join(ROOT, light?.projection || 'missing')));
    check(`${key} 配置显示参数正确`, cfgOk);
}

check('生产建筑和兵营均走统一footprint+接地线深度链',
    /applyBuildingFootprint\(this, 2\)/.test(producerSrc)
    && /setupStructureDepth\(this\)/.test(producerSrc)
    && /applyBuildingFootprint\(this, 2\)/.test(barracksSrc)
    && /setupStructureDepth\(this\)/.test(barracksSrc));
check('教堂与研究院可配置标准 2×2 石基座',
    ['church', 'research_institute'].every((key) =>
        cfg[key]?.foundation?.key === 'building_foundation_2x2'
        && cfg[key].foundation.displayW === 256
        && cfg[key].foundation.displayH === 128)
    && /load\.image\('building_foundation_2x2'/.test(bootSrc)
    && /foundation: cfg\.foundation/.test(producerSrc)
    && /foundationSprite\.setPosition\(e\.x, e\.y - foundationH \* 0\.5\)/.test(sceneSrc)
    && /foundationSprite\.setDepth\(dd - 0\.2\)/.test(sceneSrc));
check('SKILL 已登记贴图替换后的阴影工作流', /建筑贴图替换后的阴影工作流/.test(skill));

console.log(`\n结果: ${items.length * 2 + 2 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
