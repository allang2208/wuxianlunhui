/**
 * 本轮五座建筑贴图正式导入回归：
 * 兵营、靶场、研究院、教堂、铁匠铺必须紧身裁剪、比例驱动显示尺寸，
 * 并具备更新后的环境光照派生图和 manifest。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const producer = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/environment-lighting-assets.json'), 'utf8'));

const expected = {
    barracks: { size: [737, 620], displayW: 275, displayH: 231, foot: 116 },
    shooting_range: { size: [786, 627], displayW: 272, displayH: 217, foot: 109 },
    research_institute: { size: [859, 720], displayW: 267, displayH: 224, foot: 112 },
    church: { size: [904, 927], displayW: 270, displayH: 277, foot: 139 },
    blacksmith: { size: [910, 743], displayW: 267, displayH: 218, foot: 109 },
};

let fail = 0;
function check(name, condition, detail = '') {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!condition) fail++;
}

for (const [key, want] of Object.entries(expected)) {
    const image = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain', `${key}.png`)));
    let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1;
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            if (image.data[(y * image.width + x) * 4 + 3] <= 16) continue;
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    }
    const tight = x0 <= 3 && y0 <= 3 && x1 >= image.width - 4 && y1 >= image.height - 4;
    check(`${key} 紧身透明 PNG 尺寸正确`,
        image.width === want.size[0] && image.height === want.size[1] && tight,
        `${image.width}×${image.height}`);

    const conf = key === 'barracks' ? null : producer[key];
    const configOk = key === 'barracks'
        ? new RegExp(`displayW:\\s*${want.displayW},[\\s\\S]{0,80}displayH:\\s*${want.displayH},[\\s\\S]{0,80}footOffsetY:\\s*${want.foot}`).test(barracksSrc)
        : conf?.displayW === want.displayW && conf?.displayH === want.displayH && conf?.footOffsetY === want.foot;
    check(`${key} 显示比例与脚底锚点已同步`, configOk);

    const light = manifest.assets?.[key];
    check(`${key} 光照派生图和 manifest 已重建`,
        light?.size?.width === want.size[0]
        && light?.size?.height === want.size[1]
        && light?.shadow?.anchorMode === 'footprint_center'
        && ['silhouette', 'projection', 'height', 'normal'].every((field) =>
            typeof light?.[field] === 'string' && fs.existsSync(path.join(ROOT, light[field]))));
}

console.log(`\n结果: ${15 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
