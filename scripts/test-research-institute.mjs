/**
 * 世界-122研究院回归：
 * - 配置/建筑面板/预留资产路径；
 * - 墙门生命研究立即与新建生效；
 * - 被动能源每级每秒 +1；
 * - 研究等级沿用 ability-store 存档真源。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: producerCfg } = await import('../data/producer-buildings.json');
const abilityStore = await import('../src/world/ability-store.js');
const {
    ResearchSystem, RESEARCH_IDS, applyResearchHp, migrateLegacyResearchLevels,
    getRecruitSpeedBonus, getRecruitIntervalMs,
} = await import('../src/world/research-system.js');
const { EnergyManager } = await import('../src/systems/energy-manager.js');

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

const cfg = producerCfg.research_institute;
check('研究院配置存在且为能力工坊', cfg && cfg.spawnEnabled === false && cfg.workshopType === 'research');
check('研究院正式贴图已接入', cfg.tex === 'research_institute'
    && cfg.assetPending !== true
    && fs.existsSync(path.join(ROOT, 'assets/terrain/research_institute.png')));
check('研究项目齐全', cfg.abilities?.[RESEARCH_IDS.STRUCTURE_HP]
    && cfg.abilities?.[RESEARCH_IDS.PASSIVE_ENERGY]
    && cfg.abilities?.[RESEARCH_IDS.RECRUIT_SPEED]);
check('墙门生命合并为同一研究且每级 +10%',
    cfg.abilities[RESEARCH_IDS.STRUCTURE_HP].per === 0.1
    && cfg.abilities[RESEARCH_IDS.STRUCTURE_HP].target === '方块墙与4格门'
    && !cfg.abilities[RESEARCH_IDS.LEGACY_WALL_HP]
    && !cfg.abilities[RESEARCH_IDS.LEGACY_GATE_HP]);
check('被动能源每级每秒 +1', cfg.abilities[RESEARCH_IDS.PASSIVE_ENERGY].per === 1);
const recruit = cfg.abilities[RESEARCH_IDS.RECRUIT_SPEED];
check('快速募兵：Lv1 +10%，之后每级 +2%',
    recruit.firstLevel === 0.1
    && recruit.per === 0.02
    && getRecruitSpeedBonus(0) === 0
    && getRecruitSpeedBonus(1) === 0.1
    && Math.abs(getRecruitSpeedBonus(2) - 0.12) < 1e-9);
check('募兵速度按生产率缩短周期',
    getRecruitIntervalMs(30000, 0) === 30000
    && getRecruitIntervalMs(30000, 1) === 27273
    && getRecruitIntervalMs(30000, 2) === 26786);

abilityStore.resetAbilityLevels();
const wall = { _isBlockCover: true, hp: 1200, maxHp: 1600, data: { hp: 1200, maxHp: 1600 } };
abilityStore.raiseAbilityLevel(RESEARCH_IDS.STRUCTURE_HP);
applyResearchHp(wall, 1600);
check('墙研究 Lv1：1600→1760，当前生命同步 +160', wall.maxHp === 1760 && wall.hp === 1360,
    `hp=${wall.hp}/${wall.maxHp}`);

const gate = { _isGate4: true, hp: 1600, maxHp: 1600, data: { hp: 1600, maxHp: 1600 } };
applyResearchHp(gate, 1600);
check('共享研究 Lv1 同时强化4格门', gate.maxHp === 1760 && gate.hp === 1760,
    `hp=${gate.hp}/${gate.maxHp}`);
abilityStore.raiseAbilityLevel(RESEARCH_IDS.STRUCTURE_HP);
applyResearchHp(gate, 1600);
check('共享研究 Lv2：墙门统一 1600→1920', gate.maxHp === 1920 && gate.hp === 1920,
    `hp=${gate.hp}/${gate.maxHp}`);

abilityStore.resetAbilityLevels();
abilityStore.GLOBAL_ABILITY_LEVELS[RESEARCH_IDS.LEGACY_WALL_HP] = 2;
abilityStore.GLOBAL_ABILITY_LEVELS[RESEARCH_IDS.LEGACY_GATE_HP] = 3;
check('旧墙/门独立等级迁移为共享较高等级',
    migrateLegacyResearchLevels() === 3
    && abilityStore.getAbilityLevel(RESEARCH_IDS.STRUCTURE_HP) === 3
    && abilityStore.getAbilityLevel(RESEARCH_IDS.LEGACY_WALL_HP) === 0
    && abilityStore.getAbilityLevel(RESEARCH_IDS.LEGACY_GATE_HP) === 0);

abilityStore.raiseAbilityLevel(RESEARCH_IDS.PASSIVE_ENERGY);
abilityStore.raiseAbilityLevel(RESEARCH_IDS.PASSIVE_ENERGY);
const oldAddEnergy = EnergyManager.addEnergy;
let gained = 0;
EnergyManager.addEnergy = (amount) => { gained += amount; return amount; };
ResearchSystem.resetTimer();
ResearchSystem.update(999);
check('被动能源不足1秒不结算', gained === 0);
ResearchSystem.update(1);
check('被动能源 Lv2 每秒 +2', gained === 2, `gained=${gained}`);
ResearchSystem.update(2500);
check('跨多秒按完整秒结算', gained === 6, `gained=${gained}`);
EnergyManager.addEnergy = oldAddEnergy;
abilityStore.resetAbilityLevels();

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const saveSrc = fs.readFileSync(path.join(ROOT, 'src/ui/game-ui-manager.js'), 'utf8');
check('BootScene 加载研究院正式资产路径',
    /research_institute', 'assets\/terrain\/research_institute\.png'/.test(bootSrc));
check('研究完成调用 ResearchSystem 并驱动被动能源',
    /ResearchSystem\.onResearchLeveled\(abilityId\)/.test(producerSrc)
    && /ResearchSystem\.update\(dt\)/.test(producerSrc));
check('墙门构造时自动应用研究生命',
    /if \(isBlock\) applyResearchHp\(this, hp\)/.test(defenseSrc)
    && /if \(this\._isGate4\) applyResearchHp\(this, hp\)/.test(defenseSrc));
check('研究院面板复用能力读条并显示研究文案',
    /cfg\.workshopType === 'research'/.test(producerSrc)
    && /研究完成后立即作用于场上与后续新建结构/.test(producerSrc)
    && /const targetLabel = isResearch \? '目标效果' : '目标兵种'/.test(producerSrc));
check('读档恢复研究等级后刷新现有墙门',
    /ResearchSystem\.refreshWorld\(\)/.test(saveSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
