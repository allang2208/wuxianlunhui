/**
 * 仓鼠盾卫契约测试（2026-08-16）：
 * - 数据契约：HP 350、六维属性、移速 100、攻击 30/2s、攻击动画 12 帧
 *   单次播放且第 10 帧判定伤害（延迟 = (10-1)/12 = 750ms）、walk 17 帧、dying 15 帧；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 只打 enemy 阵营且不攻击矿点、兵营 unit.guard 生成/升级、
 *   GameScene 渲染攻击单次播放 + 移动朝向 vx、BootScene 加载。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-guard.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: guardCfg } = await import('../data/hamster-guard-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测）----
const g = new Companion(guardCfg);
check('生命值 = 350（baseMaxHp 覆盖；con=25 公式 100+250=350 一致）',
    g.data.maxHp === 350 && g.data.hp === 350, `maxHp=${g.data.maxHp}`);
check('六维初始值 力量13/敏捷10/智力3/体质25/精神3/幸运3',
    g.data.str === 13 && g.data.dex === 10 && g.data.int === 3
    && g.data.con === 25 && g.data.wis === 3 && g.data.luck === 3,
    `str=${g.data.str} dex=${g.data.dex} int=${g.data.int} con=${g.data.con} wis=${g.data.wis} luck=${g.data.luck}`);
check('派生数值挂钩：物攻 = round(10 + 13×0.05 + 10×0.1) = 12',
    g.data.atk === 12, `atk=${g.data.atk}`);
check('派生数值挂钩：物防 = round(25×1.2 + 13×0.3) = 34（公式实际走 Math.round）',
    g.data.def === 34, `def=${g.data.def}`);
check('派生数值挂钩：魔攻 = floor(3×1.5 + 3×0.5) = 6',
    g.data.matk === 6, `matk=${g.data.matk}`);
check('移动速度 = 100', guardCfg.ai.walkSpeed === 100 && guardCfg.ai.runSpeed === 100,
    `walkSpeed=${guardCfg.ai.walkSpeed}`);
check('攻击间隔 = 2000ms / 伤害 = 30', guardCfg.ai.attackInterval === 2000 && guardCfg.ai.attackDamage === 30);
check('攻击第 10 帧判定伤害：attackDamageFrame=10 / attackAnimFps=12 → 延迟 750ms',
    guardCfg.ai.attackDamageFrame === 10 && guardCfg.ai.attackAnimFps === 12
    && Math.abs((guardCfg.ai.attackDamageFrame - 1) / guardCfg.ai.attackAnimFps * 1000 - 750) < 1e-6);
check('近战攻击距离 / 交战半径配置存在',
    typeof guardCfg.ai.attackRange === 'number' && typeof guardCfg.ai.engageRange === 'number');
check('idle 动画 = 1 帧', guardCfg.animations.idle.frameCount === 1
    && guardCfg.animations.idle.frames[0] === 0);
check('walk（移动）动画 = 17 帧 [0,16] 循环', guardCfg.animations.walk.frameCount === 17
    && guardCfg.animations.walk.frames[0] === 0 && guardCfg.animations.walk.frames[1] === 16
    && guardCfg.animations.walk.repeat === -1);
check('attack 动画 = 12 帧 [0,11]，单次播放（repeat 0）@12fps = 1.0s',
    guardCfg.animations.attack.frameCount === 12
    && guardCfg.animations.attack.frames[0] === 0 && guardCfg.animations.attack.frames[1] === 11
    && guardCfg.animations.attack.frameRate === 12 && guardCfg.animations.attack.repeat === 0);
check('dying 动画 = 15 帧 [0,14]，只播一次', guardCfg.animations.dying.frameCount === 15
    && guardCfg.animations.dying.frames[0] === 0 && guardCfg.animations.dying.frames[1] === 14
    && guardCfg.animations.dying.repeat === 0);
check('帧布局 512×512 / 8列4行', Object.values(guardCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8 && a.rows === 4));
check('素材帧脚底非 480，带 spriteOffsetY 补偿',
    typeof guardCfg.spriteOffsetY === 'number' && guardCfg.spriteOffsetY < 0);

// ---- 2. 源码接线：AI 只打敌人、不攻击矿点、第 10 帧判定 ---- 
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-guard-ai.js'), 'utf-8');
check('AI 索敌只认 _faction===\'enemy\'', /_faction !== 'enemy'/.test(aiSrc));
check('AI 不攻击能源矿点（_isEnergyNode 跳过，用户口径）',
    /_isEnergyNode/.test(aiSrc) && /_nearestEnemy/.test(aiSrc));
check('AI 攻击动画第 10 帧判定伤害（damageDelayMs=(frame-1)/fps×1000）',
    /_damageDelayMs = Math\.max\(0, \(damageFrame - 1\) \/ fps \* 1000\)/.test(aiSrc)
    && /_applyDamage\(\)/.test(aiSrc));
check('AI 挥击出伤走 takeDamage(attackDamage, m, physical)',
    /e\.takeDamage\(this\._attackDamage, m, 'physical', true\)/.test(aiSrc));
check('AI 移动复用 MovementSystem、挥击站定', /MovementSystem\.update\(m, dt, entities\)/.test(aiSrc)
    && /_swingActive/.test(aiSrc));
check('AI 无敌跟随玩家 + 到达清路径归零速度', /_followOffset/.test(aiSrc)
    && /_clearPath/.test(aiSrc));

// ---- 3. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-guard.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡流程', /takeDamage\(damage, source/.test(entSrc)
    && /_startDying\(\)/.test(entSrc));
check('死亡状态 = dying', /_animState = 'dying'/.test(entSrc));
check('实体脚底/深度补偿（spriteOffsetY ↔ footOffsetY）', /footOffsetY = 44/.test(entSrc)
    && /spriteOffsetY/.test(entSrc));
check('死亡动画时长 = 15 帧 @12fps = 1250ms', /DYING_DURATION_MS = 1250/.test(entSrc));

// ---- 4. 源码接线：渲染 / 加载 / 兵营生成 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 盾卫攻击单次播放（_isHamsterGuard 并入射手分支）',
    /member\._isHamsterGuard/.test(gsSrc) && /_attackSwing/.test(gsSrc));
check('GameScene 盾卫移动朝向 vx（不倒退走路）',
    /member\._isHamsterGuard\) && moving/.test(gsSrc) && /faceRight = member\.vx > 0/.test(gsSrc));
check('GameScene 盾卫受击白闪', /member\._isHamsterGuard/.test(gsSrc)
    && /member\.hitFlash > 0/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠盾卫精灵图',
    /hamsterGuardConfig/.test(bootSrc) && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const barSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf-8');
check('兵营注册盾卫单位（unit.guard + 导入）',
    /guard: \{ key: 'guard', name: '仓鼠盾卫'/.test(barSrc) && /new HamsterGuard/.test(barSrc));
check('兵营升级同步按 _isHamsterGuard 映射基准配置',
    /unit\._isHamsterGuard \? 'guard' : 'shooter'/.test(barSrc));
check('兵营面板生成单位类型按钮含盾卫', /\$\{btn\('guard'\)\}/.test(barSrc));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
