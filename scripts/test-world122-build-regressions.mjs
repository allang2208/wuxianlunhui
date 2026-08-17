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
    /_createGate4Preview\(scene\)/.test(buildingSrc)
    && /scene\.add\.sprite\(0, 0, 'obstacle_block'\)/.test(buildingSrc)
    && /scene\.add\.sprite\(0, 0, 'cover_gate_D_bars', 0\)/.test(buildingSrc)
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
check('铁匠铺面板每次刷新显式恢复单位选择区',
    /unitTypeEl\.style\.display = isAbilityShop \? 'none' : ''/.test(producerSrc));
check('持续升级不在启动前预置 _continuous',
    !/b\._continuous = abilityId;\s*this\._notify\([^]*if \(!b\._upgrade\)/.test(producerSrc)
    && /if \(b\._upgrade\)/.test(producerSrc)
    && /const res = b\.startAbilityUpgrade\(abilityId, true\)/.test(producerSrc));
check('世界-122升级写入主存档并可读回',
    /unitUpgrades: serializeUnitUpgrades\(\)/.test(saveSrc)
    && /abilityLevels: serializeAbilityLevels\(\)/.test(saveSrc)
    && /restoreUnitUpgrades\(data\.world122\?\.unitUpgrades\)/.test(saveSrc)
    && /restoreAbilityLevels\(data\.world122\?\.abilityLevels\)/.test(saveSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
