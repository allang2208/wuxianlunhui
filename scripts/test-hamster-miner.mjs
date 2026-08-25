/**
 * 仓鼠矿工契约测试（2026-08-15 首航；2026-08-23 按矿工营地经济重做口径刷新）：
 * - 数据契约：HP 100、移速 80、攻击 100/2s、背包 300、动画帧配置（mining 两段式 1~19 → 5~19）；
 * - 实体契约：友方阵营、_enemyTargetable、可受击/死亡播 dying；
 * - 源码接线：AI 只打能源矿点、寻最近节点、GameScene 渲染 mining/dying、
 *   PerceptionSystem 放行带标记的友方单位、世界-122 生成/拆除；
 * - 矿工营地经济（2026-08-23）：产出先装个人背包 → 满包返营提交 → 营地实际接收量入仓库，
 *   仓库放不下则留在矿工背包原地等待，容量恢复后自动复工。
 * 说明：HamsterMiner → HamsterMinerAI → MovementSystem 依赖链带 Phaser，
 * node 直接 import 不可行（已在 CDP 探针覆盖真实行为），本测试锁定数据 + 源码接线。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-miner.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: hamsterCfg } = await import('../data/hamster-miner-config.json');
const { default: campCfg } = await import('../data/hamster-miner-camp-building.json');
const { Companion } = await import('../src/entities/companion.js');
const { pickNearestNode } = await import('../src/ai/companion-ai-decision.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '：' + detail : ''}`); }
    else { fail++; console.error(`  ✗ ${name}${detail ? '：' + detail : ''}`); }
}

// ---- 1. 数据契约（Companion 纯数据模型可 node 直测） ----
const miner = new Companion(hamsterCfg);
check('生命值 = 100（baseMaxHp 覆盖）', miner.data.maxHp === 100 && miner.data.hp === 100,
    `maxHp=${miner.data.maxHp}`);
check('移动速度 = 80', hamsterCfg.ai.walkSpeed === 80 && hamsterCfg.ai.runSpeed === 80,
    `walkSpeed=${hamsterCfg.ai.walkSpeed}`);
check('攻击间隔 = 2000ms / 伤害 = 100', hamsterCfg.ai.attackInterval === 2000 && hamsterCfg.ai.attackDamage === 100);
check('采矿/攻击距离 = 50px', hamsterCfg.ai.miningRange === 50, `miningRange=${hamsterCfg.ai.miningRange}`);
check('贴图显示尺寸 = 99（132 × 75%）', hamsterCfg.displaySize === 99, `displaySize=${hamsterCfg.displaySize}`);
check('隐藏背包默认容量 = 300（2026-08-23 矿工营地口径）', hamsterCfg.ai.backpackCapacity === 300,
    `capacity=${hamsterCfg.ai.backpackCapacity}`);
check('idle 动画 = 1 帧', hamsterCfg.animations.idle.frameCount === 1 && hamsterCfg.animations.idle.frames[0] === 0);
check('walking 插帧后两段式 = 起步 [0,22] + 循环 [4,23] @24fps',
    hamsterCfg.animations.walk.frameCount === 24
    && hamsterCfg.animations.walk.startFrames[0] === 0 && hamsterCfg.animations.walk.startFrames[1] === 22
    && hamsterCfg.animations.walk.startRepeat === 0
    && hamsterCfg.animations.walk.loopFrames[0] === 4 && hamsterCfg.animations.walk.loopFrames[1] === 23
    && hamsterCfg.animations.walk.frameRate === 24
    && hamsterCfg.animations.walk.repeat === -1);
check('mining 插帧后 = 37 帧，起步 [0,36] → 单次 [8,36]，waitFrame=10',
    hamsterCfg.animations.mining.frameCount === 37
    && hamsterCfg.animations.mining.startFrames[0] === 0 && hamsterCfg.animations.mining.startFrames[1] === 36
    && hamsterCfg.animations.mining.loopFrames[0] === 8 && hamsterCfg.animations.mining.loopFrames[1] === 36
    && hamsterCfg.animations.mining.startRepeat === 0 && hamsterCfg.animations.mining.repeat === 0
    && hamsterCfg.animations.mining.frameRate === 40 && hamsterCfg.animations.mining.waitFrame === 10);
check('dying 插帧后 = 21 帧 [0,20] @24fps，只播一次', hamsterCfg.animations.dying.frameCount === 21
    && hamsterCfg.animations.dying.frames[0] === 0 && hamsterCfg.animations.dying.frames[1] === 20
    && hamsterCfg.animations.dying.frameRate === 24
    && hamsterCfg.animations.dying.repeat === 0);
check('帧布局保持 512×512 / 8列', Object.values(hamsterCfg.animations).every(a =>
    a.frameWidth === 512 && a.frameHeight === 512 && a.cols === 8));

// ---- 2. 寻最近能源节点（纯函数） ----
const nodes = [
    { x: 1000, y: 1000, active: true, _depleted: false },
    { x: 200, y: 200, active: true, _depleted: false },
    { x: 500, y: 500, active: false, _depleted: false },
    { x: 700, y: 700, active: true, _depleted: true },
];
const nearest = pickNearestNode(nodes, { x: 0, y: 0 });
check('pickNearestNode 选最近有效节点（跳过 inactive/枯竭）', nearest && nearest.x === 200 && nearest.y === 200,
    nearest ? `(${nearest.x},${nearest.y})` : 'null');
check('无有效节点返回 null', pickNearestNode([], { x: 0, y: 0 }) === null);

// ---- 3. 源码接线：AI 只打能源矿点 ----
const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-miner-ai.js'), 'utf-8');
check('AI 使用 pickNearestNode 寻最近矿点', /pickNearestNode/.test(aiSrc));
check('AI 采矿目标只认 _isEnergyNode 且跳过枯竭', /_isEnergyNode/.test(aiSrc) && /_depleted/.test(aiSrc));
check('AI 只采矿不交战：源码无敌人交战分支（用户口径 2026-08-16：只能攻击能源矿点）',
    !/_nearestEnemy\(/.test(aiSrc)
    && !/_tryAttackEnemy\(\)/.test(aiSrc)
    && !/enemy\.takeDamage/.test(aiSrc)
    && /_tryAttack\(\)/.test(aiSrc));
check('AI 采矿攻击只对节点 takeDamage（attackDamage × miningMult，经六维属性换算）',
    /miningDamage = Math\.max\(1, Math\.round\(this\._attackDamage \* this\.miningMult\)\)/.test(aiSrc)
    && /node\.takeDamage\(m\.getPhysicalAttackDamage\(miningDamage, node\)/.test(aiSrc));
check('AI 攻击间隔读取 attackInterval', /this\._attackInterval = this\.cfg\.attackInterval \?\? 2000/.test(aiSrc));
check('AI 移速读取 walkSpeed', /this\.cfg\.walkSpeed \?\? 80/.test(aiSrc));
check('AI 采矿/交战共用 mining 态、移动 walk、无节点 idle',
    /_animState = 'mining'/.test(aiSrc) && /_animState = 'walk'/.test(aiSrc) && /_animState = 'idle'/.test(aiSrc));
check('AI 采矿命中递增 _miningSwingSeq（单调挥锄序号，渲染层据序号播挥锄）',
    /m\._miningSwingSeq = \(Number\(m\._miningSwingSeq\) \|\| 0\) \+ 1/.test(aiSrc));
check('AI 背包物流：work/unload_return/storage_wait + 满包返营提交',
    /_phase = 'work'/.test(aiSrc) && /'unload_return'/.test(aiSrc) && /'storage_wait'/.test(aiSrc)
    && /_startUnloadReturn\(\)/.test(aiSrc) && /hut\.unloadMiner\(m\)/.test(aiSrc));
check('AI 采矿效率仍作用于矿点伤害，产出先装矿工个人背包',
    /this\._attackDamage \* this\.miningMult/.test(aiSrc));
check('AI 寻路可达接近点：无碰撞矿体使用独立采集半径 + 回屋边缘点',
    /const miningRange = this\._miningRange \+ nodeR/.test(aiSrc)
    && /const physicalNodeR = node\.noCollision \? 0/.test(aiSrc)
    && /Math\.min\(Math\.max\(this\._miningRange/.test(aiSrc)
    && /m\._tacticalTarget = \{ x: node\.x \+ \(dx \/ dd\) \* approachDist/.test(aiSrc)
    && /approach = 64/.test(aiSrc));
check('AI 卡死看门狗 + 满包返回阶段',
    /_checkStuck\(dt\)/.test(aiSrc) && /unload_return/.test(aiSrc)
    && /WallSystem\.findSafeSpawn/.test(aiSrc));
check('AI 卡死升级：连续卡死直接传送到矿点旁合法点（终结顶墙死循环）',
    /_stuckEscalation/.test(aiSrc) && /near\.x \+ Math\.cos\(a\) \* 95/.test(aiSrc)
    && /WallSystem\.canMoveTo\(px, py/.test(aiSrc));
check('AI 矿点接近点：物理半径与采集半径分离，仍钳制在采矿范围内（-15）',
    /physicalNodeR \+ \(m\.groundRadius \|\| 26\) \+ 40/.test(aiSrc)
    && /miningRange - 15/.test(aiSrc));

// ---- 4. 源码接线：实体受击/死亡/仇恨 ----
const entSrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-miner.js'), 'utf-8');
check('实体 _faction=companion（复用 Companion）', /super\(archive\)/.test(entSrc));
check('实体带 _enemyTargetable 标记（防守怪可锁定）', /_enemyTargetable = true/.test(entSrc));
check('实体跳过中立兜底圆（_skipNeutralSprite，防棕色大圆）', /_skipNeutralSprite = true/.test(entSrc));
check('实体提供 takeDamage 并触发死亡', /takeDamage\(damage, source/.test(entSrc) && /_startDying\(\)/.test(entSrc));
check('死亡态 = dying', /_animState = 'dying'/.test(entSrc));
check('实体隐藏背包字段 + 死亡丢失携带能量', /_energyCarried = 0/.test(entSrc)
    && /_energyCapacity = this\.aiConfig\?\.backpackCapacity \|\| 300/.test(entSrc)
    && /丢失 \$\{this\._energyCarried\} 能量/.test(entSrc));
check('实体碰撞体积缩小 25%（groundRadius 19.5 / bodyHeight 97.5 / size 63）',
    /this\.groundRadius = Math\.round\(26 \* 0\.75 \* 10\) \/ 10/.test(entSrc)
    && /this\.collisionRadius = this\.groundRadius/.test(entSrc)
    && /this\.bodyHeight = Math\.round\(130 \* 0\.75 \* 10\) \/ 10/.test(entSrc)
    && /this\.size = Math\.round\(84 \* 0\.75\)/.test(entSrc));
check('实体 addMinedEnergy 只装个人背包（返营提交才入仓库）', /addMinedEnergy\(amount\)/.test(entSrc)
    && /this\._energyCarried \+= added/.test(entSrc)
    && !/EnergyManager\.depositEnergy/.test(entSrc));

const ensSrc = fs.readFileSync(path.join(ROOT, 'src/world/energy-node-system.js'), 'utf-8');
check('能量节点：玩家/仓鼠/队友采矿直接入仓库，满仓不扣矿点',
    /EnergyManager\.isFull\(\)/.test(ensSrc)
    && /EnergyManager\.depositEnergy\(energy\)/.test(ensSrc)
    && /appliedDamage = Math\.min/.test(ensSrc));

const hutSrc = fs.readFileSync(path.join(ROOT, 'src/world/hamster-hut-system.js'), 'utf-8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf-8');
const minePng = fs.readFileSync(path.join(ROOT, 'assets/terrain/mine.png'));
check('矿工营地替换仓鼠小屋且玩法配置保持原链路（配置真源 hamster-miner-camp-building.json）',
    /name: config\.name \?\? '矿工营地'/.test(hutSrc)
    && /kind: 'hamster_hut'/.test(buildingSrc)
    && campCfg.name === '矿工营地'
    && campCfg.tex === 'mine'
    && campCfg.cost === 500
    && campCfg.hp === 1500);
check('矿工营地贴图紧身裁剪并按比例显示',
    minePng.readUInt32BE(16) === 882
    && minePng.readUInt32BE(20) === 665
    && campCfg.displayW === 277
    && campCfg.displayH === 209
    && campCfg.footOffsetY === 103);
check('小屋移除已失效的背包扩容模块，面板显示仓库总量',
    !/backpack:\s*\{ name: '背包扩容'/.test(hutSrc)
    && /EnergyManager\.getCapacity\(\)/.test(hutSrc)
    && /仓库能源/.test(hutSrc));
check('营地提交只入仓库实际接收量，放不下的留在矿工背包',
    /unloadMiner\(miner\)/.test(hutSrc) && /EnergyManager\.depositEnergy\(total\)/.test(hutSrc)
    && /miner\._energyCarried = Math\.max\(0, total - added\)/.test(hutSrc));
check('小屋开关门动画已删除（2026-08-17：原模型素材移除，补员/卸货直接生成）',
    !/openDoor\(/.test(hutSrc) && !/closeDoor\(/.test(hutSrc)
    && !/hamster_hut_door/.test(hutSrc));
check('矿工营地被毁丢失暂存能量', /lost > 0 \? `矿工营地被摧毁（暂存 \$\{lost\} 能源丢失）`/.test(hutSrc));
check('小屋旧暂存自动补入仓库', /_storedEnergy = Math\.max\(0, this\._storedEnergy - added\)/.test(hutSrc));
check('满仓后矿工停在营地等待，容量恢复后继续提交并自动复工',
    /_phase === 'unload_return'/.test(aiSrc)
    && /_phase === 'storage_wait'/.test(aiSrc)
    && /_tryUnloadAtHut\(\)/.test(aiSrc)
    && /仓库暂时放不下：停在营地，容量恢复后继续提交/.test(aiSrc));

// ---- 5. 源码接线：渲染 / 生成 / 仇恨 ----
const gsSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
check('GameScene 渲染友方单位（friendlyUnits）', /_game\.friendlyUnits/.test(gsSrc));
check('GameScene 支持 mining/dying 动画状态', /st === 'mining'/.test(gsSrc) && /st === 'dying'/.test(gsSrc));
check('GameScene 采矿 = 挥锄序号触发播放、间隔定格插帧后 waitFrame=10',
    /member\._miningSwingSeq/.test(gsSrc) && /miningStartKey/.test(gsSrc)
    && /anims\.mining\.waitFrame \?\? 10/.test(gsSrc) && /setTexture\(miningKey, miningWaitFrame\)/.test(gsSrc));
check('GameScene 行走两段式 = 起步完整 walking → 循环第 3~12 帧',
    /hamsterWalk/.test(gsSrc) && /walkStartKey/.test(gsSrc));
check('GameScene 移动始终朝向移动方向（walk 按 vx，不倒退）',
    /member\._isHamsterMiner \|\| member\._isHamsterWarrior/.test(gsSrc)
    && /\) && moving/.test(gsSrc) && /faceRight = member\.vx > 0/.test(gsSrc)
    && /_animState === 'walk' \|\| Math\.abs\(member\.vx\) > 5/.test(gsSrc));
check('GameScene 名称/血条按侍从精灵锚定（贴图缩放自动跟随）',
    /this\._companionSprites\[entity\.id\]/.test(gsSrc)
    && /sprite\.displayHeight \* 0\.5/.test(gsSrc));
check('GameScene 中立标签实体跳过 HUD 名字（防建筑重复名字）',
    /this\._neutralSprites && this\._neutralSprites\.has\(entity\)/.test(gsSrc));
check('GameScene 动态深度含友方单位', /window\.Game\.friendlyUnits/.test(gsSrc));

const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
check('BootScene 加载仓鼠矿工精灵图', /hamsterMinerConfig/.test(bootSrc)
    && /companion_\$\{unitConfig\.id\}_/.test(bootSrc));

const smSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf-8');
check('世界-122 进入生成仓鼠矿工', /HamsterMinerSystem\.setup\(player\)/.test(smSrc));
check('场景离场拆除仓鼠矿工', /HamsterMinerSystem\.teardown\(\)/.test(smSrc));

const psSrc = fs.readFileSync(path.join(ROOT, 'src/systems/perception-system.js'), 'utf-8');
check('PerceptionSystem 放行 _enemyTargetable 友方单位', /_enemyTargetable/.test(psSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
