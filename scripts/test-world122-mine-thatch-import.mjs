/**
 * 本轮矿场与茅草屋贴图导入回归。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const producer = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const hutSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-hut-system.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/environment-lighting-assets.json'), 'utf8'));
const expected = {
    mine: { size: [847, 663], displayW: 277, displayH: 217, foot: 109 },
    thatch_hut: { size: [794, 650], displayW: 275, displayH: 225, foot: 113 },
};

let fail = 0;
function check(name, condition, detail = '') {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!condition) fail++;
}

for (const [key, want] of Object.entries(expected)) {
    const image = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain', `${key}.png`)));
    let x0 = image.width; let y0 = image.height; let x1 = -1; let y1 = -1;
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            if (image.data[(y * image.width + x) * 4 + 3] <= 16) continue;
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    }
    check(`${key} 紧身透明 PNG 尺寸正确`,
        image.width === want.size[0] && image.height === want.size[1]
        && x0 === 0 && y0 === 0 && x1 === image.width - 1 && y1 === image.height - 1);
    const configOk = key === 'mine'
        ? new RegExp(`displayW:\\s*${want.displayW},[\\s\\S]{0,80}displayH:\\s*${want.displayH},[\\s\\S]{0,80}footOffsetY:\\s*${want.foot}`).test(hutSrc)
        : producer.thatch_hut?.displayW === want.displayW
            && producer.thatch_hut?.displayH === want.displayH
            && producer.thatch_hut?.footOffsetY === want.foot;
    check(`${key} 显示比例与脚底锚点已同步`, configOk);
    const light = manifest.assets?.[key];
    check(`${key} 光照派生图和 manifest 已重建`,
        light?.size?.width === want.size[0] && light?.size?.height === want.size[1]
        && ['silhouette', 'projection', 'height', 'normal'].every((field) =>
            typeof light?.[field] === 'string' && fs.existsSync(path.join(ROOT, light[field]))));
}

console.log(`\n结果: ${6 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
