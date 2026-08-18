/**
 * 世界-122 传送门建筑回归（2026-08-18，占位素材先行接入）：
 * - 传送门为纯详情建筑（panelMode:"detail"），不产兵、不进能力工坊；
 * - 配置数值唯一真源校验（producer-buildings.json）；
 * - 贴图已注册、按标准工作流紧身裁剪标定；光照派生图已生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const boot = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (!condition) fail++;
}

const portal = cfg.portal;
const portalPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/portal.png')));

check('传送门配置为纯详情建筑',
    portal?.panelMode === 'detail'
    && portal.spawnEnabled === false
    && Array.isArray(portal.unitTypes) && portal.unitTypes.length === 0
    && Object.keys(portal.modules || {}).length === 0);
check('传送门数值正确（2000能源/HP3000/def80/mdef80/回收50%）',
    portal?.cost === 2000 && portal.hp === 3000 && portal.def === 80 && portal.mdef === 80
    && portal.sellRefundRatio === 0.5);
check('传送门文案指向多世界并行系统（功能未开放）',
    /多世界并行/.test(portal?.panelDescription || ''));
check('传送门贴图已注册（BootScene load + 投影清单）',
    /this\.load\.image\('portal', 'assets\/terrain\/portal\.png'\)/.test(boot)
    && /'thatch_hut', 'portal'\]/.test(boot));
check('传送门贴图紧身裁剪尺寸正确', portalPng.width === 615 && portalPng.height === 921);
check('传送门显示参数按裁剪比例标定',
    portal.displayW === 288 && portal.displayH === 431 && portal.footOffsetY === 216);
check('传送门光照派生图已生成',
    ['portal_projection.png', 'portal_silhouette.png', 'portal_height.png', 'portal_normal.png']
        .every((f) => fs.existsSync(path.join(ROOT, 'assets/terrain/lighting', f))));

console.log(`\n结果: ${7 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
