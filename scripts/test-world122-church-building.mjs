/**
 * 世界-122建筑贴图替换回归：
 * - 素材紧身裁剪后的尺寸与配置显示参数匹配；
 * - 新建文件夹中的同名建筑批量替换后，同步重建环境投影资产；
 * - 不改变既有建筑玩法，只更新贴图与视觉标定。
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
const portalPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/portal.png')));
const researchPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/research_institute.png')));
const thatchPng = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/thatch_hut.png')));
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');
const lightingManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/environment-lighting-assets.json'), 'utf8'));

check('教堂数值正确', church?.cost === 600 && church.hp === 2500 && church.def === 80 && church.mdef === 120);
check('教堂贴图已注册', /this\.load\.image\('church', 'assets\/terrain\/church\.png'\)/.test(boot));
check('教堂贴图紧身裁剪尺寸正确', churchPng.width === 1209 && churchPng.height === 1182);
check('教堂显示参数按裁剪比例标定',
    church.displayW === 256 && church.displayH === 250 && church.footOffsetY === 125);
check('铁匠铺贴图已按新素材紧身裁剪并重标',
    blacksmithPng.width === 1243 && blacksmithPng.height === 1193
    && blacksmith.displayW === 288 && blacksmith.displayH === 276 && blacksmith.footOffsetY === 138);
check('仓鼠兵营贴图已按新素材紧身裁剪并重标',
    barracksPng.width === 1358 && barracksPng.height === 1086
    && /displayW:\s*288,[\s\S]{0,80}displayH:\s*230,[\s\S]{0,80}footOffsetY:\s*115/.test(barracksSrc));
check('靶场贴图已按新素材紧身裁剪并重标',
    shootingRangePng.width === 1240 && shootingRangePng.height === 1169
    && cfg.shooting_range?.displayW === 288
    && cfg.shooting_range?.displayH === 272
    && cfg.shooting_range?.footOffsetY === 136);
check('草屋与研究院贴图已按新素材紧身裁剪并重标',
    thatchPng.width === 1359 && thatchPng.height === 1089
    && cfg.thatch_hut?.displayH === 231 && cfg.thatch_hut?.footOffsetY === 116
    && researchPng.width === 1238 && researchPng.height === 1190
    && cfg.research_institute?.displayH === 277 && cfg.research_institute?.footOffsetY === 139);
check('传送门贴图已按新素材紧身裁剪、重标并重建投影',
    portalPng.width === 1029 && portalPng.height === 1208
    && cfg.portal?.displayW === 288 && cfg.portal?.displayH === 293 && cfg.portal?.footOffsetY === 147
    && fs.existsSync(path.join(ROOT, 'assets/terrain/lighting/portal_projection.png')));
check('传送门建筑配置四个目的地并接入正常场景切换',
    cfg.portal?.panelMode === 'portal'
    && cfg.portal.destinations?.map((entry) => entry.sceneId).join(',') === 'main,scene9,scene10,scene11,scene12'
    && /const isPortal = cfg\.panelMode === 'portal'/.test(producer)
    && /SceneManager\.switchScene\(sceneId, player\)/.test(producer));
check('SKILL 已登记建筑开发标准流程与批量替换实例',
    /建筑开发标准工作流/.test(skill)
    && /新建文件夹/.test(skill));
check('替换后的建筑投影派生资产已重建',
    ['barracks', 'church', 'research_institute', 'thatch_hut', 'blacksmith', 'shooting_range']
        .every((key) => fs.existsSync(path.join(ROOT, 'assets/terrain/lighting', `${key}_projection.png`))
            && lightingManifest.assets?.[key]?.projection));

console.log(`\n结果: ${12 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
