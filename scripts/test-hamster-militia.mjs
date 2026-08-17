/**
 * 仓鼠民兵契约测试（2026-08-17）：
 * - 数据契约：HP 125、六维 力量8/敏捷10/智力3/体质6/精神3/幸运7（怪物公式派生）、
 *   移速 150、攻击 20/2s、攻击动画 15 帧单次播放且第 8 帧判定伤害
 *   （延迟 = (8-1)/12 = 583ms）、walk 12 帧、dying 14 帧；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 只打 enemy 阵营且不攻击矿点、兵营/产兵建筑 unit.militia
 *   生成/升级、GameScene 渲染攻击单次播放 + 移动朝向 vx、BootScene 加载。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-militia.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: militiaCfg } = await import('../data/hamster-militia-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测）----
const m = new Companion(militiaCfg);
check('生命值 = 125（baseMaxHp 覆盖：con=6 公式 160 → 125）',
    m.data.maxHp === 125 && m.data.hp === 125, `maxHp=${m.data.maxHp}`);
check('六维初始值 力量8/敏捷10/智力3/体质6/精神3/幸运7',
    m.data.str === 8 && m.data.dex === 10 && m.data.int === 3
    && m.data.con === 6 && m.data.wis === 3 && m.data.luck === 7,
    `str=${m.data.str} dex=${m.data.dex} int=${m.data.int} con=${m.data.con} wis=${m.data.wis} luck=${m.data.luck}`);
check('statFormula = enemy（六维走怪物同款公式）', militiaCfg.statFormula === 'enemy');
check('派生数值挂钩：物攻 = round(8×0.5 + 10×0.5) = 9（怪物公式）',
    m.data.atk === 9, `atk=${m.data.atk}`);
check('派生数值挂钩：物防 = floor(6×1.5 + 8×0.3) = 11（怪物公式）',
    m.data.def === 11, `def=${m.data.def}`);
check('派生数值挂钩：魔攻 = floor(3×0.5 + 3×0.5) = 3（怪物公式）',
    m.data.matk === 3, `matk=${m.data.matk}`);
check('派生数值挂钩：魔防 = floor(3×1.2 + 3×0.3) = 4（怪物公式）',
    m.data.mdef === 4, `mdef=${m.data.mdef}`);
check('派生数值挂钩：暴击 = floor(2 + 7) = 9（怪物公式）',
    m.data.crit === 9, `crit=${m.data.crit}`);
check('派生数值挂钩：暴抗 = floor(6) = 6（怪物公式）',
    m.data.critRes === 6, `critRes=${m.data.critRes}`);
check('移动速度 = 150', militiaCfg.ai.walkSpeed === 150 && militiaCfg.ai.runSpeed === 150,
    `walkSpeed=${militiaCfg.ai.walkSpeed}`);
check('攻击间隔 = 2000ms / 伤害 = 20 物理', militiaCfg.ai.attackInterval === 2000
    && militiaCfg.ai.attackDamage === 20);
check('攻击第 8 帧判定伤害：attackDamageFrame=8 / attackAnimFps=12 → 延迟 583ms',
    militiaCfg.ai.attackDamageFrame === 8 && militiaCfg.ai.attackAnimFps === 12
    && Math.abs((militiaCfg.ai.attackDamageFrame - 1) / militiaCfg.ai.attackAnimFps * 1000 - 583.3333) < 1e-3);
check('近战攻击距离 / 交战半径配置存在',
    typeof militiaCfg.ai.attackRange === 'number' && typeof militiaCfg.ai.engageRange === 'number');
check('idle 动画 = 1 帧', militiaCfg.animations.idle.frameCount === 1
    && militiaCfg.animations.idle.frames[0] === 0);
check('walk（移动）动画 = 12 帧 [0,11] 循环', militiaCfg.animations.walk.frameCount === 12
    && militiaCfg.animations.walk.frames[0] === 0 && militiaCfg.animations.walk.frames[1] === 11
    && militiaCfg.animations.walk.repeat === -1);
check('attack 动画 = 15 帧 [0,14]，单次播放（repeat 0）@12fps = 1.25s',
    militiaCfg.animations.attack.frameCount === 15
    && militiaCfg.animations.attack.frames[0] === 0 && militiaCfg.animations.attack.frames[1] === 14
    && militiaCfg.animations.attack.frameRate === 12 && militiaCfg.animations.attack.repeat === 0);
check('dying 动画 = 14 帧 [0,13]，只播一次', militiaCfg.animations.dying.frameCount === 14
    && militiaCfg.animations.dying.frames[0] === 0 && militiaCfg.animations.dying.frames[1] === 13
    && militiaCfg.animations.dying.repeat === 0);
check('帧布局 512×512 / 8列4行', Object.values(militiaCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8 && a.rows === 4));
check('素材帧脚底非 480，带 spriteOffsetY 补偿',
    typeof militiaCfg.spriteOffsetY === 'number' && militiaCfg.spriteOffsetY < 0);
check('攻击音效挂接（与战士/盾卫共用鼠鼠战士音效）',
    militiaCfg.sounds && militiaCfg.sounds.attack === 'assets/sounds/friendly/hamster_melee_attack.mp3');

// ---- 2. 源码接线：AI 只打敌人、不攻击矿点、第 8 帧判定 ----
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-militia-ai.js'), 'utf-8');
check('AI 索敌只认 _faction===\'enemy\'', /_faction !== 'enemy'/.test(aiSrc));
check('AI 不攻击能源矿点（_isEnergyNode 跳过，用户口径）',
    /_isEnergyNode/.test(aiSrc) && /_nearestEnemy/.test(aiSrc));
check('AI 攻击动画第 8 帧判定伤害（damageDelayMs=(frame-1)/fps×1000）',
    /_damageDelayMs = Math\.max\(0, \(damageFrame - 1\) \/ fps \* 1000\)/.test(aiSrc)
    && /_applyDamage\(\)/.test(aiSrc));
check('AI 挥击出伤走 takeDamage(attackDamage, m, physical)',
    /e\.takeDamage\(this\._attackDamage, m, 'physical', true\)/.test(aiSrc));
check('AI 移动复用 MovementSystem、挥击站定', /MovementSystem\.update\(m, dt, entities\)/.test(aiSrc)
    && /_swingActive/.test(aiSrc));
check('AI 无敌跟随玩家 + 到达清路径归零速度', /_followOffset/.test(aiSrc)
    && /_clearPath/.test(aiSrc));

// ---- 3. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-militia.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡流程', /takeDamage\(damage, source/.test(entSrc)
    && /_startDying\(\)/.test(entSrc));
check('死亡状态 = dying', /_animState = 'dying'/.test(entSrc));
check('实体脚底/深度补偿（spriteOffsetY ↔ footOffsetY）', /footOffsetY = 55/.test(entSrc)
    && /spriteOffsetY/.test(entSrc));
check('死亡动画时长 = 14 帧 @12fps = 1167ms', /DYING_DURATION_MS = 1167/.test(entSrc));

// ---- 4. 源码接线：渲染 / 加载 / 兵营生成 / 产兵建筑 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 民兵攻击单次播放（_isHamsterMilitia 并入射手/盾卫分支）',
    /member\._isHamsterMilitia/.test(gsSrc) && /_attackSwing/.test(gsSrc));
check('GameScene 民兵移动朝向 vx（不倒退走路）',
    /member\._isHamsterGuard \|\| member\._isHamsterMilitia \|\| member\._isHamsterScout\) && moving/.test(gsSrc)
    && /faceRight = member\.vx > 0/.test(gsSrc));
check('GameScene 民兵受击白闪', /member\._isHamsterMilitia/.test(gsSrc)
    && /member\.hitFlash > 0/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠民兵精灵图',
    /hamsterMilitiaConfig/.test(bootSrc) && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const barSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf-8');
check('兵营注册民兵单位（unit.militia + 导入）',
    /militia: \{ key: 'militia', name: '仓鼠民兵'/.test(barSrc) && /new HamsterMilitia/.test(barSrc));
check('兵营升级走全局兵种表（applyGlobalUpgradesToKind + 面板读全局等级）',
    /applyGlobalUpgradesToKind\(this\.unitType, BARRACKS_CONFIG\.modules\)/.test(barSrc)
    && /getUnitUpgradeLevel\(b\.unitType, mid\)/.test(barSrc));
check('兵营面板生成单位类型按钮含民兵', /\$\{btn\('militia'\)\}/.test(barSrc));

const prodSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf-8');
check('产兵建筑注册民兵（PRODUCER_UNIT_CFG/CLASS + 全局升级）',
    /militia: militiaCfg/.test(prodSrc) && /militia: HamsterMilitia/.test(prodSrc)
    && /applyGlobalUpgradesToKind\(this\.unitType, this\._cfg\.modules\)/.test(prodSrc));

const storeSrc = fs.readFileSync(path.join(ROOT, 'src/world/unit-upgrade-store.js'), 'utf-8');
check('全局兵种升级表（GLOBAL_UNIT_UPGRADES + militia 识别）',
    /GLOBAL_UNIT_UPGRADES/.test(storeSrc) && /_isHamsterMilitia\) return 'militia'/.test(storeSrc)
    && /applyGlobalUpgradesToKind/.test(storeSrc));
const prodCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf-8'));
check('草屋（thatch_hut）单位类型含民兵',
    (prodCfg.thatch_hut?.unitTypes || []).some((t) => t.key === 'militia' && t.name === '仓鼠民兵'));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
