/**
 * 仓鼠斥候契约测试（2026-08-17）：
 * - 数据契约：HP 100、六维 力量8/敏捷13/智力3/体质7/精神3/幸运10（怪物公式派生）、
 *   移速 150、攻击 25/2.5s、射程 600、投射物 600px/s、攻击动画 18 帧单次播放且
 *   第 11 帧出膛（延迟 = (11-1)/12 ≈ 833ms）、idle 6 帧、walk 15 帧、dying 11 帧；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 只打 enemy 阵营且不攻击矿点、AimHelper 提前量瞄目标贴图中心、
 *   GameScene 投射物渲染（斥候尖头朝右）、BootScene 加载、草屋 unitTypes 含斥候
 *   且铁匠铺不含（只能草屋生成）。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-scout.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: scoutCfg } = await import('../data/hamster-scout-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测）----
const s = new Companion(scoutCfg);
check('生命值 = 100（baseMaxHp 覆盖：con=7 公式 170 → 100）',
    s.data.maxHp === 100 && s.data.hp === 100, `maxHp=${s.data.maxHp}`);
check('六维初始值 力量8/敏捷13/智力3/体质7/精神3/幸运10',
    s.data.str === 8 && s.data.dex === 13 && s.data.int === 3
    && s.data.con === 7 && s.data.wis === 3 && s.data.luck === 10,
    `str=${s.data.str} dex=${s.data.dex} int=${s.data.int} con=${s.data.con} wis=${s.data.wis} luck=${s.data.luck}`);
check('statFormula = enemy（六维走怪物同款公式）', scoutCfg.statFormula === 'enemy');
check('派生数值挂钩：物攻 = round(8×0.5 + 13×0.5) = 11（怪物公式）',
    s.data.atk === 11, `atk=${s.data.atk}`);
check('派生数值挂钩：物防 = floor(7×1.5 + 8×0.3) = 12（怪物公式）',
    s.data.def === 12, `def=${s.data.def}`);
check('派生数值挂钩：魔攻 = floor(3×0.5 + 3×0.5) = 3（怪物公式）',
    s.data.matk === 3, `matk=${s.data.matk}`);
check('派生数值挂钩：魔防 = floor(3×1.2 + 3×0.3) = 4（怪物公式）',
    s.data.mdef === 4, `mdef=${s.data.mdef}`);
check('派生数值挂钩：暴击 = floor(2 + 10) = 12（怪物公式）',
    s.data.crit === 12, `crit=${s.data.crit}`);
check('派生数值挂钩：暴抗 = floor(7) = 7（怪物公式）',
    s.data.critRes === 7, `critRes=${s.data.critRes}`);
check('移动速度 = 150', scoutCfg.ai.walkSpeed === 150 && scoutCfg.ai.runSpeed === 150,
    `walkSpeed=${scoutCfg.ai.walkSpeed}`);
check('攻击间隔 = 2500ms / 伤害 = 25 物理', scoutCfg.ai.attackInterval === 2500
    && scoutCfg.ai.attackDamage === 25);
check('射程 600 / 交战半径 900 / 投射物速度 600', scoutCfg.ai.attackRange === 600
    && scoutCfg.ai.engageRange === 900 && scoutCfg.ai.projectileSpeed === 600);
check('攻击第 11 帧出膛：attackLaunchFrame=11 / attackAnimFps=12 → 延迟 833ms',
    scoutCfg.ai.attackLaunchFrame === 11 && scoutCfg.ai.attackAnimFps === 12
    && Math.abs((scoutCfg.ai.attackLaunchFrame - 1) / scoutCfg.ai.attackAnimFps * 1000 - 833.3333) < 1e-3);
check('idle 动画 = 6 帧 [0,5] 循环（呼吸待机）', scoutCfg.animations.idle.frameCount === 6
    && scoutCfg.animations.idle.frames[0] === 0 && scoutCfg.animations.idle.frames[1] === 5
    && scoutCfg.animations.idle.repeat === -1);
check('walk（移动）动画 = 13 帧 [0,12] 循环（实盘帧13/14为空，2026-08-17修正）',
    scoutCfg.animations.walk.frameCount === 13
    && scoutCfg.animations.walk.frames[0] === 0 && scoutCfg.animations.walk.frames[1] === 12
    && scoutCfg.animations.walk.repeat === -1);
check('attack 动画 = 18 帧 [0,17]，单次播放（repeat 0）@12fps = 1.5s',
    scoutCfg.animations.attack.frameCount === 18
    && scoutCfg.animations.attack.frames[0] === 0 && scoutCfg.animations.attack.frames[1] === 17
    && scoutCfg.animations.attack.frameRate === 12 && scoutCfg.animations.attack.repeat === 0);
check('dying 动画 = 11 帧 [0,10]，只播一次', scoutCfg.animations.dying.frameCount === 11
    && scoutCfg.animations.dying.frames[0] === 0 && scoutCfg.animations.dying.frames[1] === 10
    && scoutCfg.animations.dying.repeat === 0);
check('projectile 投射物贴图 = 1 帧', scoutCfg.animations.projectile.frameCount === 1
    && scoutCfg.animations.projectile.frames[0] === 0);
check('帧布局 512×512 / 8列4行', Object.values(scoutCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8 && a.rows === 4));
check('素材帧脚底非 480，带 spriteOffsetY 补偿',
    typeof scoutCfg.spriteOffsetY === 'number' && scoutCfg.spriteOffsetY < 0);
check('出膛音效挂接（复用射手出膛素材）',
    scoutCfg.sounds && scoutCfg.sounds.attack === 'assets/sounds/friendly/hamster_shooter_attack.mp3');

// ---- 2. 源码接线：AI 只打敌人、不攻击矿点、第 11 帧出膛 + 提前量 ----
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-scout-ai.js'), 'utf-8');
check('AI 索敌只认 _faction===\'enemy\'', /_faction !== 'enemy'/.test(aiSrc));
check('AI 不攻击能源矿点（_isEnergyNode 跳过，用户口径）',
    /_isEnergyNode/.test(aiSrc) && /_nearestEnemy/.test(aiSrc));
check('AI 第 11 帧出膛（launchDelayMs=(launchFrame-1)/fps×1000）',
    /_launchDelayMs = Math\.max\(0, \(launchFrame - 1\) \/ fps \* 1000\)/.test(aiSrc)
    && /_fireProjectile\(\)/.test(aiSrc));
check('AI 用 AimHelper.lead 提前量瞄目标贴图中心', /AimHelper\.lead/.test(aiSrc)
    && /_targetAimY/.test(aiSrc));
check('投射物命中走 takeDamage(attackDamage, m, physical)',
    /hit\.takeDamage\(this\._attackDamage, m, 'physical'\)/.test(aiSrc));
check('AI 移动复用 MovementSystem、射击站定', /MovementSystem\.update\(m, dt, entities\)/.test(aiSrc)
    && /_shotActive/.test(aiSrc));
check('AI 无敌跟随玩家 + 到达清路径归零速度', /_followOffset/.test(aiSrc)
    && /_clearPath/.test(aiSrc));

// ---- 3. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-scout.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡流程', /takeDamage\(damage, source/.test(entSrc)
    && /_startDying\(\)/.test(entSrc));
check('死亡状态 = dying 且清投射物', /_animState = 'dying'/.test(entSrc) && /_basic = null/.test(entSrc));
check('实体脚底/深度补偿（spriteOffsetY ↔ footOffsetY）', /footOffsetY = 17/.test(entSrc)
    && /spriteOffsetY/.test(entSrc));
check('死亡动画时长 = 11 帧 @12fps ≈ 1000ms', /DYING_DURATION_MS = 1000/.test(entSrc));

// ---- 4. 源码接线：渲染 / 加载 / 草屋生成 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 斥候攻击单次播放（_isHamsterScout 并入射手分支）',
    /member\._isHamsterScout/.test(gsSrc) && /_attackSwing/.test(gsSrc));
check('GameScene 斥候投射物渲染（尖头朝右、内容宽 172）',
    /const ranged = m\._isHamsterShooter \|\| m\._isHamsterScout/.test(gsSrc)
    && /tipLeft = m\._isHamsterShooter/.test(gsSrc)
    && /projContentW = m\._isHamsterShooter \? 146 : 172/.test(gsSrc));
check('GameScene 斥候移动朝向 vx（不倒退走路）',
    /member\._isHamsterMusketeer \|\| member\._isHamsterPriest\) && moving/.test(gsSrc)
    && /faceRight = member\.vx > 0/.test(gsSrc));
check('GameScene 斥候受击白闪', /member\._isHamsterScout/.test(gsSrc)
    && /member\.hitFlash > 0/.test(gsSrc));
check('GameScene 多帧待机分支（斥候 6 帧呼吸待机）',
    /anims\.idle\.frameCount \|\| 1\) > 1/.test(gsSrc)
    && /companion_\$\{animId\}_idle/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠斥候精灵图',
    /hamsterScoutConfig/.test(bootSrc) && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const prodSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf-8');
check('产兵建筑注册斥候（PRODUCER_UNIT_CFG/CLASS）',
    /scout: scoutCfg/.test(prodSrc) && /scout: HamsterScout/.test(prodSrc));
const prodCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf-8'));
check('草屋（thatch_hut）单位类型含斥候',
    (prodCfg.thatch_hut?.unitTypes || []).some((t) => t.key === 'scout' && t.name === '仓鼠斥候'));
check('斥候只能草屋生成（铁匠铺不含 scout）',
    !(prodCfg.blacksmith?.unitTypes || []).some((t) => t.key === 'scout'));

const storeSrc = fs.readFileSync(path.join(ROOT, 'src/world/unit-upgrade-store.js'), 'utf-8');
check('全局兵种升级表含斥候（GLOBAL_UNIT_UPGRADES + scout 识别）',
    /GLOBAL_UNIT_UPGRADES/.test(storeSrc) && /_isHamsterScout\) return 'scout'/.test(storeSrc));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
