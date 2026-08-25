/**
 * 仓鼠射手契约测试（2026-08-16）：
 * - 数据契约：HP 150、六维属性、移速 150、攻击 60/2s、远程配置
 *   （attackRange 600 / projectileSpeed 600 / 第 10 帧出膛 = 9/12 = 750ms）；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 参考露娜 AimHelper.lead 提前量瞄准贴图中心、只打 enemy 且不攻击矿点、
 *   GameScene 渲染箭矢、BootScene 加载、世界-122 生成/拆除；
 * - 复核：仓鼠战士伤害类型 = physical。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-shooter.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: shooterCfg } = await import('../data/hamster-shooter-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测）----
const s = new Companion(shooterCfg);
check('生命值 = 150（baseMaxHp 覆盖，con=10 公式 200 → 150）',
    s.data.maxHp === 150 && s.data.hp === 150, `maxHp=${s.data.maxHp}`);
check('六维初始值 力量12/敏捷20/智力3/体质10/精神3/幸运10',
    s.data.str === 12 && s.data.dex === 20 && s.data.int === 3
    && s.data.con === 10 && s.data.wis === 3 && s.data.luck === 10,
    `str=${s.data.str} dex=${s.data.dex} int=${s.data.int} con=${s.data.con} wis=${s.data.wis} luck=${s.data.luck}`);
check('派生数值挂钩：物攻使用怪物公式 = 16',
    s.data.atk === 16, `atk=${s.data.atk}`);
check('派生数值挂钩：物防使用怪物公式 = 18',
    s.data.def === 18, `def=${s.data.def}`);
check('派生数值挂钩：魔攻使用怪物公式 = 3',
    s.data.matk === 3, `matk=${s.data.matk}`);
check('移动速度 = 150', shooterCfg.ai.walkSpeed === 150 && shooterCfg.ai.runSpeed === 150,
    `walkSpeed=${shooterCfg.ai.walkSpeed}`);
check('攻击间隔 = 2000ms / 伤害 = 60 物理', shooterCfg.ai.attackInterval === 2000
    && shooterCfg.ai.attackDamage === 60);
check('远程配置：射程 600 / 交战 900 / 弹速 600',
    shooterCfg.ai.attackRange === 600 && shooterCfg.ai.engageRange === 900
    && shooterCfg.ai.projectileSpeed === 600);
check('插帧后第 19 帧出膛：延迟 = (19-1)/24fps = 750ms < 2s 间隔',
    shooterCfg.ai.attackLaunchFrame === 19 && shooterCfg.ai.attackAnimFps === 24
    && Math.abs((shooterCfg.ai.attackLaunchFrame - 1) / shooterCfg.ai.attackAnimFps * 1000
        - 750) < 1e-6);
check('idle 动画 = 1 帧', shooterCfg.animations.idle.frameCount === 1
    && shooterCfg.animations.idle.frames[0] === 0);
check('walk 插帧后 = 22 帧，播放 [2,21] @24fps 循环', shooterCfg.animations.walk.frameCount === 22
    && shooterCfg.animations.walk.frames[0] === 2 && shooterCfg.animations.walk.frames[1] === 21
    && shooterCfg.animations.walk.frameRate === 24
    && shooterCfg.animations.walk.repeat === -1);
check('attack 插帧后 = 25 帧 [0,24] 单次 @24fps',
    shooterCfg.animations.attack.frameCount === 25
    && shooterCfg.animations.attack.frames[0] === 0 && shooterCfg.animations.attack.frames[1] === 24
    && shooterCfg.animations.attack.frameRate === 24 && shooterCfg.animations.attack.repeat === 0);
check('dying 插帧后 = 19 帧 [0,18]，只播一次', shooterCfg.animations.dying.frameCount === 19
    && shooterCfg.animations.dying.frames[0] === 0 && shooterCfg.animations.dying.frames[1] === 18
    && shooterCfg.animations.dying.frameRate === 24
    && shooterCfg.animations.dying.repeat === 0);
check('projectile 贴图 = 1 帧', shooterCfg.animations.projectile.frameCount === 1
    && shooterCfg.animations.projectile.frames[0] === 0);
check('帧布局保持 512×512 / 8列', Object.values(shooterCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8));

// ---- 2. 源码接线：AI 远程提前量 / 只打敌人 / 不攻击矿点 ----
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-shooter-ai.js'), 'utf-8');
check('AI 参考露娜 AimHelper.lead 提前量瞄准',
    /AimHelper\.lead/.test(aiSrc));
check('AI 瞄准目标贴图中心（_targetAimY）',
    /_targetAimY/.test(aiSrc) && /_phaserSprite\.y/.test(aiSrc));
check('AI 索敌只认 _faction===\'enemy\' 且跳过能源矿点',
    /_faction !== 'enemy'/.test(aiSrc) && /_isEnergyNode/.test(aiSrc));
check('AI 伤害 60 物理（takeDamage(…, m, \'physical\')）',
    /getPhysicalAttackDamage\(this\._attackDamage, hit\)/.test(aiSrc)
    && /_attackDamage = this\.cfg\.attackDamage \?\? 60/.test(aiSrc));
check('AI 第 10 帧出膛计时（_launchDelayMs = (launchFrame-1)/fps）',
    /_launchDelayMs = Math\.max\(0, \(launchFrame - 1\) \/ fps \* 1000\)/.test(aiSrc)
    && /_shotTimer/.test(aiSrc));
check('AI 投射物飞行推进 + 命中结算（_updateProjectile）',
    /_updateProjectile\(dt\)/.test(aiSrc) && /b\.dist >= b\.maxDist/.test(aiSrc));
check('AI 移动复用 MovementSystem、射击站定、无敌跟随玩家',
    /MovementSystem\.update\(m, dt, entities\)/.test(aiSrc)
    && /_shotActive/.test(aiSrc) && /_followOffset/.test(aiSrc));

// ---- 3. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-shooter.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡流程', /takeDamage\(damage, source/.test(entSrc)
    && /_startDying\(\)/.test(entSrc));
check('死亡状态 = dying + 清飞行投射物', /_animState = 'dying'/.test(entSrc)
    && /_basic = null/.test(entSrc));
check('实体脚底/深度补偿读取配置（spriteOffsetY ↔ footOffsetY）',
    Math.abs(shooterCfg.render.footOffsetY + shooterCfg.spriteOffsetY) < 1e-6
    && /renderConfig/.test(entSrc));

// ---- 4. 源码接线：渲染 / 加载 / 生成 / 仇恨 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 射手攻击单次重播（shooterSwing + _attackSwing）',
    /member\._isHamsterShooter/.test(gsSrc) && /shooterSwing/.test(gsSrc)
    && /member\._attackSwing/.test(gsSrc));
check('GameScene 箭矢渲染（projective 贴图 + 旋转）',
    /_syncCompanionBasics/.test(gsSrc) && /companion_\$\{m\.animId \|\| m\.id\}_projectile/.test(gsSrc)
    && /setRotation\(\(b\.visualAngle \?\? b\.angle\) \+ \(tipLeft \? Math\.PI : 0\)\)/.test(gsSrc));
check('GameScene 射手移动朝向 vx（不倒退走路）',
    /member\._isHamsterShooter \|\|/.test(gsSrc)
    && /&& moving\) \{\s*faceRight = member\.vx > 0/.test(gsSrc));
check('GameScene 射手受击白闪', /member\._isHamsterShooter/.test(gsSrc)
    && /member\.hitFlash > 0/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠射手精灵图',
    /hamsterShooterConfig/.test(bootSrc) && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const smSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf-8');
const producerCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
check('仓鼠射手由靶场生产', producerCfg.shooting_range?.unitTypes?.some((u) => u.key === 'shooter'));
check('场景生命周期由通用产兵系统管理',
    /ProducerBuildingSystem\.setup\(\)/.test(smSrc) && /ProducerBuildingSystem\.teardown\(\)/.test(smSrc));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

// ---- 5. 顺查：仓鼠战士伤害类型 = 物理（用户要求复核）----
const warSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-warrior-ai.js'), 'utf-8');
check('仓鼠战士伤害类型 = physical（50 物理伤害）',
    /getPhysicalAttackDamage\(this\._attackDamage, e\)/.test(warSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
