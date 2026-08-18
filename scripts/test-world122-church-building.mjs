/**
 * 世界-122教堂/建筑素材替换回归：
 * - 素材紧身裁剪后的尺寸与配置显示参数匹配；
 * - 教堂为纯详情建筑，不会进入生产或能力工坊；
 * - 铁匠铺使用最新素材库贴图并按裁剪内容重新标定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const boot = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const producer = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (!condition) fail++;
}

const church = cfg.church;
const blacksmith = cfg.blacksmith;
const churchPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/church.png')));
const blacksmithPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/blacksmith.png')));
const barracksPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/barracks.png')));
const shootingRangePng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/shooting_range.png')));
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');

check('教堂配置为纯详情建筑',
    church?.panelMode === 'detail'
    && church.spawnEnabled === false
    && Array.isArray(church.unitTypes) && church.unitTypes.length === 0
    && Object.keys(church.modules || {}).length === 0);
check('教堂数值正确', church?.cost === 600 && church.hp === 2500 && church.def === 80 && church.mdef === 120);
check('教堂贴图已注册', /this\.load\.image\('church', 'assets\/terrain\/church\.png'\)/.test(boot));
check('教堂贴图紧身裁剪尺寸正确', churchPng.width === 1012 && churchPng.height === 1170);
check('教堂显示参数按裁剪比例标定',
    church.displayW === 256 && church.displayH === 296 && church.footOffsetY === 148);
check('纯详情模式不进入能力工坊',
    /const isPassive = cfg\.panelMode === 'detail'/.test(producer)
    && /!isWarehouse && !isPassive/.test(producer)
    && /if \(isPassive\)/.test(producer)
    && /该建筑暂未配置额外功能/.test(producer));
check('铁匠铺贴图已按新素材紧身裁剪并重标',
    blacksmithPng.width === 1230 && blacksmithPng.height === 1133
    && blacksmith.displayW === 288 && blacksmith.displayH === 265 && blacksmith.footOffsetY === 133);
check('仓鼠兵营贴图已按新素材紧身裁剪并重标',
    barracksPng.width === 987 && barracksPng.height === 967
    && /displayW:\s*288,[\s\S]{0,80}displayH:\s*282,[\s\S]{0,80}footOffsetY:\s*141/.test(barracksSrc));
check('靶场贴图已按新素材紧身裁剪并重标',
    shootingRangePng.width === 1197 && shootingRangePng.height === 1198
    && cfg.shooting_range?.displayW === 288
    && cfg.shooting_range?.displayH === 288
    && cfg.shooting_range?.footOffsetY === 144);
check('SKILL 已登记建筑开发标准流程与教堂实例',
    /建筑开发标准工作流/.test(skill)
    && /panelMode:"detail"/.test(skill)
    && /教堂：素材库/.test(skill));

console.log(`\n结果: ${10 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
