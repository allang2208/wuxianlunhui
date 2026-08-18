/** 仓鼠火枪与靶场契约测试。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { default: cfg } = await import('../data/hamster-musketeer-config.json');
const { default: producerCfg } = await import('../data/producer-buildings.json');
const { Companion } = await import('../src/entities/companion.js');
const { getAbilityValue } = await import('../src/world/ability-store.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
}

const unit = new Companion(cfg);
check('生命150与六维配置', unit.maxHp === 150
    && unit.data.str === 8 && unit.data.dex === 30 && unit.data.int === 3
    && unit.data.con === 12 && unit.data.wis === 3 && unit.data.luck === 16);
check('怪物公式派生数值', unit.data.atk === 19 && unit.data.def === 20
    && unit.data.matk === 3 && unit.data.mdef === 4
    && unit.data.crit === 18 && unit.data.critRes === 12);
check('AI数值：120移速/80伤害/2.5秒/第10帧/1248弹速',
    cfg.ai.walkSpeed === 120 && cfg.ai.attackDamage === 80 && cfg.ai.attackInterval === 2500
    && cfg.ai.attackLaunchFrame === 10 && cfg.ai.projectileSpeed === 1248);
check('动画帧数9/11/21/15',
    cfg.animations.idle.frameCount === 9 && cfg.animations.walk.frameCount === 11
    && cfg.animations.attack.frameCount === 21 && cfg.animations.dying.frameCount === 15);
check('火枪音效路径正确', cfg.sounds.attack === 'assets/companions/hamster_musketeer/fire.mp3');
check('火枪模型尺寸与射手统一', cfg.displaySize === 226 && cfg.spriteOffsetY === -36);

const piercing = producerCfg.blacksmith?.abilities?.armor_piercing_round;
check('铁匠铺穿甲弹：Lv1 25%，之后每级 +2.5%',
    piercing?.target === 'musketeer'
    && piercing.firstLevel === 0.25
    && piercing.per === 0.025
    && getAbilityValue(piercing, 0) === 0
    && getAbilityValue(piercing, 1) === 0.25
    && Math.abs(getAbilityValue(piercing, 2) - 0.275) < 1e-9);

for (const [name, expected] of [['idle.png', [4096, 2048]], ['running.png', [4096, 2048]],
    ['attacking.png', [4096, 2048]], ['dying.png', [4096, 2048]]]) {
    const png = fs.readFileSync(path.join(ROOT, 'assets/companions/hamster_musketeer', name));
    check(`${name} 8×4帧表`, png.readUInt32BE(16) === expected[0] && png.readUInt32BE(20) === expected[1]);
}

const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-musketeer-ai.js'), 'utf8');
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-musketeer.js'), 'utf8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(ROOT, 'src/world/unit-upgrade-store.js'), 'utf8');
const barracksSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf8');

check('AI只攻击最近enemy并跳过矿点', /e\._faction !== 'enemy' \|\| e\._isEnergyNode/.test(aiSrc));
check('AimHelper提前量瞄准目标贴图中心', /AimHelper\.lead/.test(aiSrc)
    && /target\._phaserSprite/.test(aiSrc));
check('第10帧出膛同步播放fire音效', /attackLaunchFrame \?\? 10/.test(aiSrc)
    && /m\.sounds\?\.attack/.test(aiSrc) && /SoundManager\?\.playWorld/.test(aiSrc));
check('黄色Phaser曳光弹', /musketTracer: true/.test(aiSrc)
    && /0xffd34d/.test(gameSceneSrc) && /add\.rectangle/.test(gameSceneSrc));
check('实体受击死亡与升级接线', /_isHamsterMusketeer = true/.test(entSrc)
    && /takeDamage\(/.test(entSrc) && /applyBarracksUpgrades/.test(entSrc));
check('火枪穿甲复用现有武器改造机制且远程伤害标记正确',
    /getCurrentWeapon\(\)/.test(entSrc)
    && /armorPenetrationPercent: 0\.25 \+ 0\.025 \* \(level - 1\)/.test(entSrc)
    && /takeDamage\?\.\(this\._attackDamage, m, 'physical', false\)/.test(aiSrc));
check('BootScene加载并注册火枪动画', /hamsterMusketeerConfig/.test(bootSrc));
check('靶场生成火枪和射手并带升级进度',
    producerCfg.shooting_range?.defaultUnitType === 'musketeer'
    && producerCfg.shooting_range.unitTypes.some((u) => u.key === 'musketeer')
    && producerCfg.shooting_range.unitTypes.some((u) => u.key === 'shooter')
    && producerCfg.shooting_range.spawnIntervalMs === 60000);
check('靶场按兵种区分产出速度（火枪60s/射手45s，2026-08-18）',
    producerCfg.shooting_range.unitTypes.find((u) => u.key === 'musketeer')?.spawnIntervalMs === 60000
    && producerCfg.shooting_range.unitTypes.find((u) => u.key === 'shooter')?.spawnIntervalMs === 45000
    && /_unitSpawnIntervalMs/.test(producerSrc));
check('产兵建筑切换兵种重新计时（重置 _spawnTimer，2026-08-18）',
    /if \(type === this\.unitType\) return false;/.test(producerSrc)
    && /this\._spawnTimer = this\.recruitIntervalMs\(\);/.test(producerSrc));
check('产兵系统注册火枪配置与实体', /musketeer: musketeerCfg/.test(producerSrc)
    && /musketeer: HamsterMusketeer/.test(producerSrc));
check('全局升级识别火枪', /musketeer: musketeerCfg/.test(storeSrc)
    && /_isHamsterMusketeer/.test(storeSrc));
check('兵营不再允许生成射手', !/\$\{btn\('shooter'\)\}/.test(barracksSrc)
    && /!\['warrior', 'guard'\]\.includes\(this\.unitType\)/.test(barracksSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
