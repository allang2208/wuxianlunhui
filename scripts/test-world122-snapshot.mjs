/**
 * 世界-122 场景快照（M0）回归：
 * - 快照模块 API 齐备（捕获/驻留/恢复/存档序列化/新游戏重置）；
 * - 覆盖对象口径：塔/方块墙/4格门/射击台/矿场/兵营/产兵建筑/矿点/波次/基地；
 * - 关键语义锁定：败北不存、波次进行中离开回场重开本波、系统建筑防双计、
 *   仓库存量按快照覆盖、矿工恢复先挂模块再补员；
 * - 场景钩子顺序：离场先捕获后 teardown；入场各系统 setup 后恢复；
 * - 主存档接入：save 写 world122.scene，load 恢复驻留快照。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const snap = read('src/world/world122-snapshot.js');
const sceneMgr = read('src/world/scene-manager.js');
const uiMgr = read('src/ui/game-ui-manager.js');
const gameSrc = read('src/game.js');
const nodeSys = read('src/world/energy-node-system.js');

let fail = 0;
let pass = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

// ---- 1. API 齐备 ----
check('快照模块 API 齐备',
    /export function captureWorld122\(\)/.test(snap)
    && /export function captureAndStoreWorld122\(\)/.test(snap)
    && /export function getWorld122Snapshot\(\)/.test(snap)
    && /export function resetWorld122Snapshot\(\)/.test(snap)
    && /export function serializeWorld122Scene\(\)/.test(snap)
    && /export function restoreWorld122Scene\(data\)/.test(snap)
    && /export function applyWorld122Snapshot\(/.test(snap));

// ---- 2. 捕获口径 ----
check('败北世界不持久化（defeated → null）',
    /if \(DefenseSystem\.defeated\) return null/.test(snap));
check('系统持有建筑防双计（huts/barracks/buildings 进 systemOwned 集合）',
    /systemOwned\.add/.test(snap)
    && /systemOwned\.has\(e\)/.test(snap));
check('覆盖塔/方块墙/4格门/射击台/矿场/兵营/产兵七类结构',
    /_isDefenseTower/.test(snap) && /_isBlockCover/.test(snap) && /_isGate4/.test(snap)
    && /_isFiringPlatform/.test(snap) && /kind: 'hut'/.test(snap)
    && /kind: 'barracks'/.test(snap) && /kind: 'producer'/.test(snap));
check('塔快照含武器/芯片/改造模块',
    /weaponItem: e\.weaponItem/.test(snap) && /chip:/.test(snap) && /modules:/.test(snap));
check('4格门整组存（ pillars + 门主体 ）', /pillars/.test(snap) && /_buildGroupRoot === e/.test(snap));
check('产兵建筑快照含读条与持续升级',
    /upgrade: p\._upgrade/.test(snap) && /continuous: p\._continuous/.test(snap));
check('仓库快照含本仓存量',
    /storedEnergy: p\._isEnergyWarehouse/.test(snap));
check('波次进行中离开 → 回场 break 阶段重开本波',
    /wave\.phase === 'wave'/.test(snap) && /phase: 'break'/.test(snap));
check('矿点快照含位置/余量/枯竭计时（位置每局随机必须入快照）',
    /depleted: !!n\._depleted/.test(snap) && /respawnTimer: n\._respawnTimer/.test(snap));

// ---- 3. 恢复语义 ----
check('矿场恢复先挂模块再补员（矿工吃到升级）',
    snap.indexOf('hut.modules = ') < snap.indexOf('hut.spawnMiner()'));
check('仓库恢复按快照覆盖本仓存量（防 pending 灌入重复计数）',
    /producer\.storedEnergy = Math\.max\(0, Math\.min\(producer\.storageCapacity/.test(snap));
check('兵营旧档兵种纠偏（非战士/盾卫 → 战士）',
    /!\['warrior', 'guard'\]\.includes\(s\.unitType\)/.test(snap));
check('恢复后刷新研究 HP（ResearchSystem.refreshWorld 兜底）',
    /ResearchSystem\.refreshWorld\(\)/.test(snap));
check('胜利状态恢复且不重复发奖（_victoryGranted）',
    /DefenseSystem\.victory = true/.test(snap) && /_victoryGranted = true/.test(snap));
check('矿点系统提供 restoreNodes（按快照重建，不随机重铺）',
    /restoreNodes\(list\)/.test(nodeSys) && /node\._respawnTimer = Math\.max\(0, s\.respawnTimer/.test(nodeSys));

// ---- 4. 场景钩子顺序 ----
check('矿点快照恢复沿用当前矿簇、基地禁区与建筑碰撞约束',
    /const clusters = \(ENERGY_CONFIG && ENERGY_CONFIG\.clusters\)/.test(nodeSys)
    && /const baseExclusion = ENERGY_CONFIG && ENERGY_CONFIG\.baseExclusion/.test(nodeSys)
    && /WallSystem\.canMoveTo\(s\.x, s\.y, ENERGY_CONFIG\.nodeRadius\)/.test(nodeSys));
check('矿点快照恢复后立即清理旧坐标，不等待周期巡检',
    /EnergyNodeSystem\.restoreNodes\(snap\.nodes\);[\s\S]*?EnergyNodeSystem\.sweepStacked\(\)/.test(snap));

const captureIdx = sceneMgr.indexOf('captureAndStoreWorld122();');
const teardownIdx = sceneMgr.indexOf('DefenseSystem.teardown();');
check('离场钩子：先捕获后 teardown', captureIdx > 0 && teardownIdx > captureIdx);
const minerSetupIdx = sceneMgr.indexOf('HamsterMinerSystem.setup(player);');
const applyIdx = sceneMgr.indexOf('applyWorld122Snapshot()');
check('入场钩子：各系统 setup 之后恢复快照', minerSetupIdx > 0 && applyIdx > minerSetupIdx);

// ---- 5. 存档与新游戏 ----
check('主存档写入 world122.scene', /scene: serializeWorld122Scene\(\)/.test(uiMgr));
check('读档恢复驻留快照', /restoreWorld122Scene\(data\.world122\?\.scene\)/.test(uiMgr));
check('新游戏重置快照', /resetWorld122Snapshot\(\)/.test(gameSrc));

// ---- 6. M1 后台结算接线 ----
check('塔 DPS 实机口径入快照（后台结算唯一 DPS 真源）', /dps: _towerDps\(e\)/.test(snap));
check('军事单位合计 DPS 入快照（兵营/产兵）', /unitDps: _unitsDps/.test(snap));
check('波次/结算参数随快照封存（config 块）', /config: \{[\s\S]*?waveBudgetBase/.test(snap));
check('回场先结算后物化（settleWorld122 commit 模式）',
    /settleWorld122\(snap, elapsed, \{[\s\S]*?commit: true/.test(snap));
check('后台失守快照作废重开', /report\.defeated/.test(snap) && /_stored = null/.test(snap));
check('被毁建筑不复活（hp<=0 跳过恢复）', /if \(!\(s\.hp > 0\)\) continue/.test(snap));
check('预览接口零副作用（commit: false）', /previewWorld122Report/.test(snap)
    && /settleWorld122\(_stored, elapsed, \{ commit: false \}\)/.test(snap));

// ---- 7. 世界切换面板 ----
const switchPanel = read('src/ui/world-switch-panel.js');
const mainSrc = read('src/main.js');
check('世界切换面板挂侧边菜单按钮并注册全局', /worldSwitchBtn/.test(switchPanel)
    && /window\.WorldSwitchPanel = WorldSwitchPanel/.test(mainSrc)
    && /WorldSwitchPanel\.init\(\)/.test(mainSrc));
check('传送走 SceneManager.switchScene（观察模式口径，2026-08-19）',
    /SceneManager\.switchScene\(target, Game\.player, undefined, \{ observer \}\)/.test(switchPanel)
    && /RTSCommand\.setEnabled\(observer\)/.test(switchPanel));
check('面板打开期间自动刷新（后台 tick 实况）', /setInterval\(.*1200\)/.test(switchPanel)
    && /onClose.*_clearRefresh|_clearRefresh\(\)/.test(switchPanel));

// ---- 8. M2 阶段一：后台 1Hz 活 tick 驱动 ----
const driver = read('src/world/world-sim-driver.js');
check('后台驱动 1Hz tick 且前台全真时停 tick', /TICK_MS = 1000/.test(driver)
    && /isWorld122Live\(\)/.test(driver));
check('驱动以快照 capturedAt 为结算锚点（读档离线时长可完整结算）',
    /elapsed = Date\.now\(\) - \(snap\.capturedAt/.test(driver));
check('后台失守作废快照并通知', /report\.defeated/.test(driver)
    && /resetWorld122Snapshot\(\)/.test(driver));
check('驱动注册进启动流程', /WorldSimDriver\.init\(\)/.test(mainSrc));

// ---- 9. 性能前置优化（2026-08-19） ----
check('分离碰撞走空间网格宽相（O(n²) 移除）',
    /SpatialPartitionSystem\.queryRadius\(a\.x, a\.y, a\.groundRadius \+ 340/.test(gameSrc)
    && /indexOf\.get\(bRaw\)/.test(gameSrc));
check('静态实体休眠带（聚合 dt 1/4 帧率）', /_dormantBand/.test(gameSrc)
    && /_dormantAcc < 66/.test(gameSrc));
check('休眠标记落到墙/门/台/矿点',
    (read('src/world/defense-system.js').match(/_dormantBand = true/g) || []).length >= 3
    && /_dormantBand = true/.test(read('src/world/energy-node-system.js')));
check('小地图动态层 100ms 降频', /_minimapNextAt/.test(read('src/phaser/scenes/GameScene.js')));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
