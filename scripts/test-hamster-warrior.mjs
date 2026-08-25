/**
 * 仓鼠战士契约测试（2026-08-16）：
 * - 数据契约：HP 225、六维属性、移速 120、攻击 50/2s、动画帧配置
 *   （attack 两段式：起步完整 1~24 帧 → 持续攻击第 6~24 帧循环）；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 只打 enemy 阵营且不攻击矿点、GameScene 渲染 attack 两段式、
 *   BootScene 加载、世界-122 生成/拆除、PerceptionSystem 放行友方单位。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-warrior.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: warriorCfg } = await import('../data/hamster-warrior-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测）----
const w = new Companion(warriorCfg);
check('生命值 = 225（baseMaxHp 覆盖，2026-08-16 用户口径）',
    w.data.maxHp === 225 && w.data.hp === 225, `maxHp=${w.data.maxHp}`);
check('六维初始值 力量20/敏捷12/智力3/体质15/精神3/幸运5',
    w.data.str === 20 && w.data.dex === 12 && w.data.int === 3
    && w.data.con === 15 && w.data.wis === 3 && w.data.luck === 5,
    `str=${w.data.str} dex=${w.data.dex} int=${w.data.int} con=${w.data.con} wis=${w.data.wis} luck=${w.data.luck}`);
check('statFormula = enemy（六维走怪物同款公式）', warriorCfg.statFormula === 'enemy');
check('派生数值挂钩：物攻 = round(20×0.5 + 12×0.5) = 16（怪物公式）',
    w.data.atk === 16, `atk=${w.data.atk}`);
check('派生数值挂钩：物防 = floor(15×1.5 + 20×0.3) = 28（怪物公式）',
    w.data.def === 28, `def=${w.data.def}`);
check('派生数值挂钩：魔攻 = floor(3×0.5 + 3×0.5) = 3（怪物公式）',
    w.data.matk === 3, `matk=${w.data.matk}`);
check('移动速度 = 120', warriorCfg.ai.walkSpeed === 120 && warriorCfg.ai.runSpeed === 120,
    `walkSpeed=${warriorCfg.ai.walkSpeed}`);
check('攻击间隔 = 2000ms / 伤害 = 50', warriorCfg.ai.attackInterval === 2000 && warriorCfg.ai.attackDamage === 50);
check('近战攻击距离 / 交战半径配置存在',
    typeof warriorCfg.ai.attackRange === 'number' && typeof warriorCfg.ai.engageRange === 'number');
check('idle 动画 = 1 帧', warriorCfg.animations.idle.frameCount === 1
    && warriorCfg.animations.idle.frames[0] === 0);
check('walk（移动）动画插帧后 = 30 帧 [0,29] @24fps 循环', warriorCfg.animations.walk.frameCount === 30
    && warriorCfg.animations.walk.frames[0] === 0 && warriorCfg.animations.walk.frames[1] === 29
    && warriorCfg.animations.walk.frameRate === 24
    && warriorCfg.animations.walk.repeat === -1);
check('attack 插帧后 = 48 帧，两段式：起步 [0,46] → 循环 [10,47]',
    warriorCfg.animations.attack.frameCount === 48
    && warriorCfg.animations.attack.startFrames[0] === 0 && warriorCfg.animations.attack.startFrames[1] === 46
    && warriorCfg.animations.attack.startRepeat === 0
    && warriorCfg.animations.attack.loopFrames[0] === 10 && warriorCfg.animations.attack.loopFrames[1] === 47
    && warriorCfg.animations.attack.repeat === -1);
check('attack 插帧与 2s 间隔对齐：起步 48采样位 @24fps、循环38帧 @19fps',
    warriorCfg.animations.attack.startFrameRate === 24
    && warriorCfg.animations.attack.frameRate === 19
    && Math.abs(48 / warriorCfg.animations.attack.startFrameRate
        - warriorCfg.ai.attackInterval / 1000) < 1e-6
    && Math.abs((warriorCfg.animations.attack.loopFrames[1] - warriorCfg.animations.attack.loopFrames[0] + 1)
        / warriorCfg.animations.attack.frameRate
        - warriorCfg.ai.attackInterval / 1000) < 1e-6,
    `start=${48 / warriorCfg.animations.attack.startFrameRate}s loop=${(warriorCfg.animations.attack.loopFrames[1] - warriorCfg.animations.attack.loopFrames[0] + 1) / warriorCfg.animations.attack.frameRate}s interval=${warriorCfg.ai.attackInterval / 1000}s`);
check('dying 插帧后 = 23 帧 [0,22] @24fps，只播一次', warriorCfg.animations.dying.frameCount === 23
    && warriorCfg.animations.dying.frames[0] === 0 && warriorCfg.animations.dying.frames[1] === 22
    && warriorCfg.animations.dying.frameRate === 24
    && warriorCfg.animations.dying.repeat === 0);
check('帧布局保持 512×512 / 8列，行数按插帧后有效帧扩展', Object.values(warriorCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8));
check('素材帧脚底非 480，带 spriteOffsetY 补偿',
    typeof warriorCfg.spriteOffsetY === 'number' && warriorCfg.spriteOffsetY < 0);

// ---- 2. 源码接线：AI 只打敌人、不攻击矿点 ----
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-warrior-ai.js'), 'utf-8');
check('AI 索敌只认 _faction===\'enemy\'', /_faction !== 'enemy'/.test(aiSrc));
check('AI 不攻击能源矿点（_isEnergyNode 跳过，用户口径）',
    /_isEnergyNode/.test(aiSrc) && /_nearestEnemy/.test(aiSrc));
check('AI 每 attackInterval 对目标 takeDamage(attackDamage)',
    /this\._attackTimer = this\._attackInterval/.test(aiSrc)
    && /getPhysicalAttackDamage\(this\._attackDamage, e\)/.test(aiSrc));
check('AI 移动复用 MovementSystem、攻击站定', /MovementSystem\.update\(m, dt, entities\)/.test(aiSrc)
    && /m\._animState === 'attack'/.test(aiSrc));
check('AI 无敌跟随玩家 + 到达清路径归零速度', /_followOffset/.test(aiSrc)
    && /_clearPath/.test(aiSrc));

// ---- 3. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-warrior.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡流程', /takeDamage\(damage, source/.test(entSrc)
    && /_startDying\(\)/.test(entSrc));
check('死亡状态 = dying', /_animState = 'dying'/.test(entSrc));
check('实体脚底/深度补偿读取配置（spriteOffsetY ↔ footOffsetY）',
    Math.abs(warriorCfg.render.footOffsetY + warriorCfg.spriteOffsetY) < 1e-6
    && /renderConfig/.test(entSrc));

// ---- 4. 源码接线：渲染 / 加载 / 生成 / 仇恨 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 仓鼠战士攻击两段式（hamsterAtk + atkStartKey）',
    /member\._isHamsterWarrior/.test(gsSrc) && /hamsterAtk/.test(gsSrc)
    && /atkStartKey/.test(gsSrc));
check('GameScene 仓鼠战士移动朝向 vx（不倒退走路）',
    /member\._isHamsterWarrior.*&& moving/.test(gsSrc) && /faceRight = member\.vx > 0/.test(gsSrc));
check('GameScene 仓鼠战士受击白闪', /member\._isHamsterWarrior/.test(gsSrc)
    && /member\.hitFlash > 0/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠战士精灵图',
    /hamsterWarriorConfig/.test(bootSrc) && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const barSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-barracks-system.js'), 'utf-8');
check('兵营生成仓鼠战士（unit.warrior + new HamsterWarrior）',
    /warrior: \{ key: 'warrior', name: '仓鼠战士'/.test(barSrc)
    && /new HamsterWarrior/.test(barSrc));
check('场景离场由兵营拆除单位（teardown → _despawnUnits）',
    /teardown\(\)/.test(barSrc) && /_despawnUnits\(\)/.test(barSrc));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
