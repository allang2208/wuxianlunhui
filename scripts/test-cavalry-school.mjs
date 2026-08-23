/**
 * 骑兵学校（猫舍式马厩）导入与产兵回归。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const boot = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/environment-lighting-assets.json'), 'utf8'));
const image = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/cavalry_school.png')));
const school = cfg.cavalry_school;

let fail = 0;
function check(name, condition, detail = '') {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`);
    if (!condition) fail++;
}

check('骑兵学校配置为 2×2 能源产兵建筑',
    school?.cost === 1500 && school.hp === 2000 && school.radius === 128
    && school.spawnIntervalMs === 90000 && school.unitCap == null);
check('骑兵学校生产仓鼠骑士与仓鼠轻骑',
    school?.defaultUnitType === 'knight'
    && school.unitTypes?.some((unit) => unit.key === 'knight' && unit.spawnIntervalMs === 90000)
    && school.unitTypes?.some((unit) => unit.key === 'light_cavalry' && unit.spawnIntervalMs === 60000)
    && !(cfg.thatch_hut?.unitTypes || []).some((unit) => unit.key === 'knight'));
check('骑兵学校关联独立骑兵升级项目', school?.upgradeProject === 'cavalry_charge');
check('猫舍式马厩贴图紧身裁剪并标定显示',
    image.width === 940 && image.height === 713
    && school?.displayW === 266 && school?.displayH === 202 && school?.footOffsetY === 101);
check('BootScene 加载骑兵学校及投影图',
    /this\.load\.image\('cavalry_school', 'assets\/terrain\/cavalry_school\.png'\)/.test(boot)
    && /'cavalry_school', 'portal'\]/.test(boot));
check('光照派生图和 manifest 已生成',
    manifest.assets?.cavalry_school?.size?.width === 940
    && manifest.assets?.cavalry_school?.size?.height === 713
    && ['silhouette', 'projection', 'height', 'normal'].every((field) =>
        typeof manifest.assets?.cavalry_school?.[field] === 'string'
        && fs.existsSync(path.join(ROOT, manifest.assets.cavalry_school[field]))));

console.log(`\n结果: ${6 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
