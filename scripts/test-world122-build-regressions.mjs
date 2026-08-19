/**
 * 世界-122 最近建造/升级回归：
 * - 建造判定忽略可清除散布障碍，但普通墙仍阻挡；
 * - 兵种/能力全局升级可存档、恢复、新局重置；
 * - 草地清除区有场景生命周期，拖墙/4格门走批处理；
 * - 铁匠铺持续升级与复用面板不留下悬空状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WallSystem } = await import('../src/world/wall-system.js');
const unitStore = await import('../src/world/unit-upgrade-store.js');
const abilityStore = await import('../src/world/ability-store.js');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const oldWalls = WallSystem.walls;
const oldSegs = WallSystem.isoSegments;
const oldTrees = WallSystem.trees;
WallSystem.walls = [{ x: 0, y: 0, w: 80, h: 80, _scatterSource: { _scatter: true } }];
WallSystem.isoSegments = [];
WallSystem.trees = [];
check('普通移动被散布障碍阻挡', WallSystem.canMoveTo(40, 40, 10) === false);
check('建造判定忽略散布障碍', WallSystem.canBuildAt(40, 40, 10) === true);
WallSystem.walls = [{ x: 0, y: 0, w: 80, h: 80 }];
check('建造判定仍被普通墙阻挡', WallSystem.canBuildAt(40, 40, 10) === false);
WallSystem.walls = oldWalls;
WallSystem.isoSegments = oldSegs;
WallSystem.trees = oldTrees;

unitStore.resetUnitUpgrades();
unitStore.raiseUnitUpgradeLevel('militia', 'damage');
const unitSnapshot = unitStore.serializeUnitUpgrades();
unitStore.resetUnitUpgrades();
check('兵种升级新局可重置', unitStore.getUnitUpgradeLevel('militia', 'damage') === 0);
unitStore.restoreUnitUpgrades(unitSnapshot);
check('兵种升级可存档恢复', unitStore.getUnitUpgradeLevel('militia', 'damage') === 1);
unitStore.resetUnitUpgrades();

abilityStore.resetAbilityLevels();
abilityStore.raiseAbilityLevel('poison_arrow');
const abilitySnapshot = abilityStore.serializeAbilityLevels();
abilityStore.resetAbilityLevels();
check('能力升级新局可重置', abilityStore.getAbilityLevel('poison_arrow') === 0);
abilityStore.restoreAbilityLevels(abilitySnapshot);
check('能力升级可存档恢复', abilityStore.getAbilityLevel('poison_arrow') === 1);
abilityStore.resetAbilityLevels();

const floorSrc = fs.readFileSync(path.join(ROOT, 'src/world/dungeon-floor-texture.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const saveSrc = fs.readFileSync(path.join(ROOT, 'src/ui/game-ui-manager.js'), 'utf8');
const gateIconToolSrc = fs.readFileSync(path.join(ROOT, 'tools/compose-gate4-icon.py'), 'utf8');

check('装饰清除区提供 reset 并接入世界-122离场/入场',
    /export function clearDecoClearZones/.test(floorSrc)
    && (sceneSrc.match(/clearDecoClearZones\(\)/g) || []).length >= 2);
check('地板装饰支持批量登记/每块只重烘焙一次',
    /export function registerDecoClearZones/.test(floorSrc)
    && /eraseDecoBatch\(zones\)/.test(gameSceneSrc));
check('拖墙与4格门统一批量清障',
    /this\._clearBuildZones\(clearZones\)/.test(buildingSrc)
    && /cells\.map\(\(\[cx, cy\]\) => \(\{ x: cx, y: cy, radius: 70 \}\)\)/.test(buildingSrc));
check('4格门预览由真实方块墙+真实栅栏组成，不再使用合成图作场景幽灵',
    /_createGate4Preview\(scene, item\.visualGrade \|\| item\.grade\)/.test(buildingSrc)
    && /scene\.add\.sprite\(0, 0, 'obstacle_block'\)/.test(buildingSrc)
    && /const barsKey = `cover_gate_\$\{grade\}_bars`/.test(buildingSrc)
    && /scene\.add\.sprite\(0, 0, barsKey, 0\)/.test(buildingSrc)
    && /this\._ghost\.setVisible\(false\)/.test(buildingSrc));
check('4格门预览与实体共用缩放/脚底参数和裁剪窗',
    /GATE4_VISUAL\.scaleX/.test(buildingSrc)
    && /GATE4_VISUAL\.scaleY/.test(buildingSrc)
    && /GATE4_VISUAL\.footOffsetY/.test(buildingSrc)
    && /GATE_GEOM\.barCrop/.test(buildingSrc)
    && /const GATE4_VISUAL =/.test(defenseSrc));
check('4格门 e1 实体与预览统一镜像，替换预览隐藏中间两墙',
    /mirror: dir === 'e1'/.test(buildingSrc)
    && /parts\.bars\.setFlipX\(dir === 'e1'\)/.test(buildingSrc)
    && /_hideGate4ReplacementBlocks\(cells\)/.test(buildingSrc));
check('4格门F切换使用原始鼠标坐标，不再把半格锚点二次舍入',
    /_gate4Hover: null/.test(buildingSrc)
    && /const hover = this\._gate4Hover/.test(buildingSrc)
    && /this\._snapGate4Grid\(hover\.x, hover\.y\)/.test(buildingSrc)
    && !/this\._snapGate4Grid\(this\._snapped\.x, this\._snapped\.y\)/.test(buildingSrc));
const gateIcon = fs.readFileSync(path.join(ROOT, 'assets/terrain/gate_4cell.png'));
check('建筑面板门图标来自实际关闭帧+真实两端方块墙',
    gateIcon.readUInt32BE(16) === 344
    && gateIcon.readUInt32BE(20) === 324
    && /frame 0 是静止关闭状态/.test(gateIconToolSrc)
    && /cover_gate_D_bars\.png/.test(gateIconToolSrc)
    && /obstacle_block\.png/.test(gateIconToolSrc)
    && /后柱 → 关闭栅栏 → 前柱/.test(gateIconToolSrc));
check('生产建筑面板按能力/仓库/被动模式显式切换单位选择区',
    /unitTypeEl\.style\.display = \(isAbilityShop \|\| isWarehouse \|\| isPassive \|\| isPortal\) \? 'none' : ''/.test(producerSrc));
check('持续升级不在启动前预置 _continuous',
    !/b\._continuous = abilityId;\s*this\._notify\([^]*if \(!b\._upgrade\)/.test(producerSrc)
    && /if \(b\._upgrade\)/.test(producerSrc)
    && /const res = b\.startAbilityUpgrade\(abilityId, true\)/.test(producerSrc));
check('世界-122升级写入主存档并可读回',
    /unitUpgrades: serializeUnitUpgrades\(\)/.test(saveSrc)
    && /abilityLevels: serializeAbilityLevels\(\)/.test(saveSrc)
    && /restoreUnitUpgrades\(data\.world122\?\.unitUpgrades\)/.test(saveSrc)
    && /restoreAbilityLevels\(data\.world122\?\.abilityLevels\)/.test(saveSrc));
check('新方块墙与4格门统一使用C级数值/400能源',
    /C_GRADE_WALL_COST/.test(buildingSrc)
    && /kind: 'block', grade: 'C'/.test(buildingSrc)
    && /kind: 'gate4', grade: 'C'/.test(buildingSrc));
check('旧F-A长墙与旧门已从建筑清单移除',
    !/id: `cover_\$\{grade\}_v`/.test(buildingSrc)
    && !/id: `gate_\$\{grade\}_v`/.test(buildingSrc));
check('详情面板提供真实方块/4格门信息与半价回收',
    /_renderBlockDetail\(det, e\)/.test(buildingSrc)
    && /4格门（C级数值）/.test(buildingSrc)
    && /_recycleBuilding\(\)/.test(buildingSrc)
    && /Math\.floor\(totalCost \* 0\.5\)/.test(buildingSrc)
    && /part\._buildGroupRoot = gate/.test(buildingSrc)
    && /grid-template-columns:repeat\(3/.test(buildingSrc));
check('面板外左键或右键关闭墙门及全部独立建筑详情',
    /_closeBuildingDetailsFromOutside\(e\)/.test(buildingSrc)
    && /e\.button !== 0 && e\.button !== 2/.test(buildingSrc)
    && /DefenseSystem\?\._panel/.test(buildingSrc)
    && /HamsterBarracksSystem\?\._panel/.test(buildingSrc)
    && /ProducerBuildingSystem\?\._panel/.test(buildingSrc)
    && /panel\.isOpen && typeof panel\.close === 'function'/.test(buildingSrc));
check('空白场景点击关闭主建筑面板，建筑点击与放置操作不被误关',
    /window\.addEventListener\('mousedown', this\._downFn, true\)/.test(buildingSrc)
    && /!this\._placing && !this\._eventHitsBuilding\(e\)/.test(buildingSrc)
    && /this\.close\(\)/.test(buildingSrc)
    && /pointInIsoFootprint/.test(buildingSrc));
check('铁匠铺能力目标显示中文，研究院改用目标效果标签',
    /shooter: '仓鼠射手'/.test(producerSrc)
    && /guard: '仓鼠盾卫'/.test(producerSrc)
    && /warrior: '仓鼠战士'/.test(producerSrc)
    && /scout: '仓鼠斥候'/.test(producerSrc)
    && /const targetLabel = isResearch \? '目标效果' : '目标兵种'/.test(producerSrc)
    && /\$\{targetLabel\}：\$\{targetText\}/.test(producerSrc));
check('放置判定使用实际半径与完整footprint边界',
    /_itemPlacementRadius\(item\)/.test(buildingSrc)
    && /_entityPlacementRadius\(e\)/.test(buildingSrc)
    && /_fitsPlacementBounds\(item, x, y\)/.test(buildingSrc)
    && /radius \+ this\._entityPlacementRadius\(e\) \+ 4/.test(buildingSrc));
check('拖墙支持失焦/画布外取消',
    /window\.addEventListener\('blur', this\._blurFn\)/.test(buildingSrc)
    && /!p \|\| !p\.overCanvas/.test(buildingSrc)
    && /_cancelDragPlacement\(\)/.test(buildingSrc));
check('拖墙逐块扣费并按余额停止',
    /_placeBlockRow\(cells\)[\s\S]{0,500}_deductBuildCost\(item\.currency, item\.cost\)/.test(buildingSrc)
    && /资源不足已停止/.test(buildingSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
