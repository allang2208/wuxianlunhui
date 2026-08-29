/** 世界位面、地牢进度与五日入侵的跨系统契约回归。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const configBytes = fs.readFileSync(path.join(ROOT, 'data/world-system.json'));
const publicConfigBytes = fs.readFileSync(path.join(ROOT, 'public/data/world-system.json'));
const config = JSON.parse(configBytes);
const dungeonSource = read('src/world/dungeon-map-system.js');
const sceneSource = read('src/world/scene-manager.js');
const gameSceneSource = read('src/phaser/scenes/GameScene.js');
const invasionSource = read('src/world/world-invasion-system.js');
const gameSource = read('src/game.js');
const worldSwitchSource = read('src/ui/world-switch-panel.js');
const devToolsSource = read('src/ui/panels/dev-tools.js');
const snapshotSource = read('src/world/world122-snapshot.js');
const resetPolicySource = read('src/world/world-reset-policy.js');
const energyNodeSource = read('src/world/energy-node-system.js');
const world125EnvironmentSource = read('src/world/world125-environment.js');
const world126EnvironmentSource = read('src/world/world126-environment.js');

const {
    WorldProgressionSystem, WORLD_LIFECYCLE_STATUS,
} = await import('../src/world/world-progression-system.js');
const {
    getWorldSnapshot, resetWorldSnapshot, restoreWorldScenes,
} = await import('../src/world/world122-snapshot.js');
const { GoldManager } = await import('../src/systems/gold-manager.js');
const { EnergyManager } = await import('../src/systems/energy-manager.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

check('data/public 两份世界系统配置一致', configBytes.equals(publicConfigBytes));
check('世界-125只由僵尸初级地牢完成状态解锁',
    config.worlds?.scene11?.constructionEnabled === true
    && config.worlds.scene11.requirements?.completedDungeons?.length === 1
    && config.worlds.scene11.requirements.completedDungeons[0] === 'zombieBeginner');
check('世界-126只由废弃矿洞初级完成状态解锁',
    config.worlds?.scene12?.constructionEnabled === true
    && config.worlds.scene12.requirements?.completedDungeons?.length === 1
    && config.worlds.scene12.requirements.completedDungeons[0] === 'abandonedMineBeginner');
check('世界-124只由沼泽初级地牢完成状态解锁',
    config.worlds?.scene10?.constructionEnabled === true
    && config.worlds.scene10.requirements?.completedDungeons?.length === 1
    && config.worlds.scene10.requirements.completedDungeons[0] === 'swampBeginner');
check('世界-123只由冰封世界初级地牢完成状态解锁',
    config.worlds?.scene9?.constructionEnabled === true
    && config.worlds.scene9.requirements?.completedDungeons?.length === 1
    && config.worlds.scene9.requirements.completedDungeons[0] === 'frozenBeginner');
check('五日周期、F-A进度和怪物扩展表均由配置提供',
    config.invasion?.intervalDays === 5
    && JSON.stringify(config.invasion.dungeonProgressByGrade) === JSON.stringify({
        F: 0.1, E: 0.2, D: 0.3, C: 0.4, B: 0.5, A: 0.6,
    })
    && Array.isArray(config.invasion.monsters)
    && config.invasion.monsters.every((monster) => monster.type && monster.weight > 0));
check('每个世界都继承配置化重置策略并声明独立基础种子',
    config.version === 2
    && config.resetPolicyDefaults?.baseTemplate === 'portal_only_v1'
    && config.resetPolicyDefaults?.seedStrategy === 'per_world_epoch'
    && config.resetPolicyDefaults?.resourceRule === 'energy_clusters_v2'
    && Object.values(config.worlds || {}).every((world) => Number.isInteger(world.resetPolicy?.baseSeed)));
check('毁灭清除项与全局保留项在配置中明确分层',
    ['snapshot', 'playerPosition', 'structures', 'units', 'drops', 'resourceNodes', 'roads', 'activeInvasion']
        .every((scope) => config.resetPolicyDefaults.clearOnDestroy.includes(scope))
    && ['dungeonProgress', 'globalClock', 'invasionProgress', 'playerInventory', 'globalUpgrades']
        .every((scope) => config.resetPolicyDefaults.preserveOnDestroy.includes(scope)));
check('新建重建保护期和传送门分段预警由配置提供',
    config.resetPolicyDefaults.rebuildProtectionDays > 0
    && Array.isArray(config.invasion.portalWarnings)
    && [0.5, 0.25, 0.1].every((ratio) =>
        config.invasion.portalWarnings.some((entry) => entry.ratio === ratio && entry.text)));

WorldProgressionSystem.reset();
const initialGeneration = WorldProgressionSystem.getWorldGenerationContext('scene8');
const initialRandomA = WorldProgressionSystem.createWorldRandom('scene8', 'contract');
const initialRandomB = WorldProgressionSystem.createWorldRandom('scene8', 'contract');
check('新游戏仅世界-122传送门已构造，世界-125不可构造',
    WorldProgressionSystem.isPortalConstructed('scene8')
    && WorldProgressionSystem.getPortalState('scene8').status === WORLD_LIFECYCLE_STATUS.ACTIVE
    && WorldProgressionSystem.getWorldEpoch('scene8') === 1
    && WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.LOCKED
    && !WorldProgressionSystem.isPortalConstructed('scene11')
    && WorldProgressionSystem.getConstructableWorlds().length === 0);
check('同一世界世代与用途盐会复现相同生成随机流',
    initialGeneration.generationVersion === 2
    && initialGeneration.seed > 0
    && [initialRandomA(), initialRandomA(), initialRandomA()].join(',')
        === [initialRandomB(), initialRandomB(), initialRandomB()].join(','));
check('LOCKED位面不能被错误标记为已摧毁',
    WorldProgressionSystem.markPortalDestroyed('scene11') === false
    && WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.LOCKED);

WorldProgressionSystem.recordDungeonRun('zombieBeginner', 'failed');
WorldProgressionSystem.recordDungeonRun('zombieBeginner', 'abandoned');
check('失败和主动离开会记录探险结果，但不会解锁位面',
    !WorldProgressionSystem.hasCompletedDungeon('zombieBeginner')
    && WorldProgressionSystem.serialize().dungeonRuns.zombieBeginner.failed === 1
    && WorldProgressionSystem.serialize().dungeonRuns.zombieBeginner.abandoned === 1);

WorldProgressionSystem.recordDungeonRun('zombieBeginner', 'success');
const candidates = WorldProgressionSystem.getConstructableWorlds();
check('成功完成僵尸初级地牢后，世界-125成为唯一免费首建候选',
    candidates.length === 1
    && candidates[0].sceneId === 'scene11'
    && WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.AVAILABLE
    && candidates[0].firstConstruction === true
    && candidates[0].cost.gold === 0
    && candidates[0].cost.energy === 0);

WorldProgressionSystem.recordDungeonRun('frozenBeginner', 'success');
const snowCandidates = WorldProgressionSystem.getConstructableWorlds();
check('成功完成冰封世界初级地牢后，世界-123雪原成为免费首建候选',
    snowCandidates.some((entry) => entry.sceneId === 'scene9'
        && entry.firstConstruction === true
        && entry.cost.gold === 0
        && entry.cost.energy === 0)
    && WorldProgressionSystem.getPortalState('scene9').status === WORLD_LIFECYCLE_STATUS.AVAILABLE);
const snowBuild = WorldProgressionSystem.constructPortal('scene9');
check('世界-123首次构造免费并进入可传送列表',
    snowBuild.ok && snowBuild.firstConstruction
    && WorldProgressionSystem.getTravelWorlds().some((world) => world.sceneId === 'scene9'));

const firstBuild = WorldProgressionSystem.constructPortal('scene11');
check('世界-125首次构造免费并进入可传送列表',
    firstBuild.ok && firstBuild.firstConstruction
    && WorldProgressionSystem.getTravelWorlds().some((world) => world.sceneId === 'scene11')
    && WorldProgressionSystem.isWorldInvasionProtected('scene11'));
WorldProgressionSystem.recordDungeonRun('swampBeginner', 'success');
const forestCandidates = WorldProgressionSystem.getConstructableWorlds();
check('成功完成沼泽初级地牢后，世界-124林地成为免费首建候选',
    forestCandidates.length === 1
    && forestCandidates[0].sceneId === 'scene10'
    && WorldProgressionSystem.getPortalState('scene10').status === WORLD_LIFECYCLE_STATUS.AVAILABLE
    && forestCandidates[0].firstConstruction === true
    && forestCandidates[0].cost.gold === 0
    && forestCandidates[0].cost.energy === 0);
const firstBaseSnapshot = getWorldSnapshot('scene11');
check('传送门构造成功后立即建立可后台结算的基础位面快照',
    firstBaseSnapshot?.initializedByPortal === true
    && firstBaseSnapshot.sceneId === 'scene11'
    && firstBuild.worldEpoch === 1
    && firstBaseSnapshot.worldEpoch === 1
    && firstBaseSnapshot.reset?.baseTemplate === 'portal_only_v1'
    && firstBaseSnapshot.reset?.resourceRule === 'energy_clusters_v2'
    && firstBaseSnapshot.generation?.seed === firstBuild.generation?.seed
    && firstBaseSnapshot.structures?.some((entry) => entry.cfgKey === 'portal' && entry.hp > 0));

WorldProgressionSystem.markPortalDestroyed('scene11');
check('ACTIVE位面被毁后只进入DESTROYED且保留当前世代',
    WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.DESTROYED
    && WorldProgressionSystem.getWorldEpoch('scene11') === 1
    && !WorldProgressionSystem.isWorldInvasionProtected('scene11'));
const backpack = [{ slot: 0, category: 'gold', name: '金币', stack: 2000 }];
const warehouse = { id: 'world-system-test', active: true, storedEnergy: 5000 };
GoldManager.setBackpackRef(backpack);
GoldManager.setMaxBackpackSlots(20);
EnergyManager.resetWarehouses();
EnergyManager.registerWarehouse(warehouse, 5000);
const rebuild = WorldProgressionSystem.constructPortal('scene11');
check('被毁传送门按配置扣除1000金币和2500能源后恢复',
    rebuild.ok && !rebuild.firstConstruction
    && rebuild.worldEpoch === 2
    && GoldManager.getGold() === 1000
    && EnergyManager.getEnergy() === 2500
    && WorldProgressionSystem.isPortalConstructed('scene11')
    && WorldProgressionSystem.getPortalProtection('scene11').remainingDays > 0);
check('重建传送门会覆盖意外残留并生成新的空建设基础快照',
    getWorldSnapshot('scene11')?.initializedByPortal === true
    && getWorldSnapshot('scene11')?.worldEpoch === 2
    && rebuild.generation?.seed !== firstBuild.generation?.seed
    && getWorldSnapshot('scene11')?.generation?.seed === rebuild.generation?.seed
    && getWorldSnapshot('scene11')?.structures?.length === 1);

const saved = WorldProgressionSystem.serialize();
WorldProgressionSystem.reset();
WorldProgressionSystem.restore(saved);
check('地牢完成与传送门状态可序列化恢复',
    WorldProgressionSystem.hasCompletedDungeon('zombieBeginner')
    && WorldProgressionSystem.hasCompletedDungeon('frozenBeginner')
    && WorldProgressionSystem.hasCompletedDungeon('swampBeginner')
    && WorldProgressionSystem.isPortalConstructed('scene9')
    && WorldProgressionSystem.isPortalConstructed('scene11')
    && WorldProgressionSystem.getPortalState('scene10').status === WORLD_LIFECYCLE_STATUS.AVAILABLE
    && WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.ACTIVE
    && WorldProgressionSystem.getWorldEpoch('scene11') === 2);

WorldProgressionSystem.restore({
    version: 1,
    completedDungeons: { zombieBeginner: 1 },
    portals: {
        scene8: { everConstructed: true, constructed: true, destroyed: false, hp: 4200 },
        scene11: { everConstructed: true, constructed: false, destroyed: true, hp: 0 },
    },
});
check('v1布尔位面存档会迁移为状态机并获得初始世代号',
    WorldProgressionSystem.getPortalState('scene8').status === WORLD_LIFECYCLE_STATUS.ACTIVE
    && WorldProgressionSystem.getWorldEpoch('scene8') === 1
    && WorldProgressionSystem.getPortalState('scene8').generationVersion === 2
    && WorldProgressionSystem.getPortalState('scene8').generationSeed > 0
    && WorldProgressionSystem.getPortalState('scene11').status === WORLD_LIFECYCLE_STATUS.DESTROYED
    && WorldProgressionSystem.getWorldEpoch('scene11') === 1);

restoreWorldScenes({
    scene8: { version: 1, structures: [], nodes: [] },
    scene11: { version: 1, structures: [{ kind: 'producer', cfgKey: 'portal' }], nodes: [{ id: 'old-node' }] },
});
const removed = resetWorldSnapshot('scene11');
check('位面摧毁只删除目标世界完整快照，不影响其他世界',
    removed
    && getWorldSnapshot('scene11') === null
    && getWorldSnapshot('scene8')?.version === 1);

check('地牢四类结束路径均汇入统一记录接口',
    /_recordRunResult\('failed'\)/.test(dungeonSource)
    && /_recordRunResult\('success'\)/.test(dungeonSource)
    && /_recordRunResult\('safe_evac'\)/.test(dungeonSource)
    && /_recordRunResult\('abandoned'\)/.test(dungeonSource));
check('入侵接口不区分成败，统一按评级增加倒计时进度',
    /WorldProgressionSystem\.recordDungeonRun\(dungeonType, outcome\)/.test(invasionSource)
    && /cfg\.dungeonProgressByGrade\?\.\[grade\]/.test(invasionSource)
    && /const addedMs = intervalMs\(\) \* fraction/.test(invasionSource)
    && /state\.progressMs \+= addedMs/.test(invasionSource));
check('地牢运行期间世界时钟和入侵倒计时使用零增量冻结',
    /const dungeonTimeFrozen = SceneManager\.currentScene === 'scene7'/.test(gameSceneSource)
    && /const worldDelta = worldClockRunning \? _delta : 0/.test(gameSceneSource)
    && /const invasionDelta = Math\.max\(0, worldTimeAfter - worldTimeBefore\)/.test(gameSceneSource)
    && /WorldInvasionSystem\?\.update\?\.\(invasionDelta/.test(gameSceneSource));
check('scene8~scene12全部接入共用持久世界运行时',
    ['scene8', 'scene9', 'scene10', 'scene11', 'scene12'].every((sceneId) =>
        sceneSource.includes(`this._setupPersistentWorld('${sceneId}', player, diamond)`)));
check('主神空间入口在开局和每次回城时按传送网络状态重新同步',
    /syncMainHubWorldPortals\(\)/.test(gameSource)
    && /isPortalConstructed\?\.\(entry\.targetScene\)/.test(gameSource)
    && /Game\.syncMainHubWorldPortals\?\.\(\)/.test(sceneSource));
check('传送门摧毁会清空世界快照、旧坐标与主城入口，并结束当前位面',
    /function destroyWorldRecords\(sceneId, worldEpoch\)/.test(invasionSource)
    && /resetWorldSnapshot\(sceneId\)/.test(invasionSource)
    && /delete Game\._worldPlayerPos\[sceneId\]/.test(invasionSource)
    && /SceneManager\.destroyWorld\(sceneId, this\._worldEpoch\)/.test(sceneSource)
    && /Game\._observerHomeScene === sceneId/.test(sceneSource)
    && /if \(departingWorldDestroyed\) \{[\s\S]*?delete g\._worldPlayerPos\[this\.currentScene\]/.test(sceneSource)
    && /Game\.syncMainHubWorldPortals\?\.\(\)/.test(sceneSource)
    && /this\.switchScene\('main', Game\.player, undefined, \{ worldDestructionTx: stored \}\)/.test(sceneSource));
check('未搭建传送门时禁止加载位面，重建后无快照则走基础生成规则',
    /this\._isPersistentWorld\(sceneId\) && !WorldProgressionSystem\.isPortalConstructed\(sceneId\)/.test(sceneSource)
    && /if \(getWorldSnapshot\(sceneId\)\) result = applyWorldSnapshot\(sceneId\)/.test(sceneSource));
check('全传送网络断线时主城仅允许应急重建旧传送门',
    /WorldProgressionSystem\.getTravelWorlds\(\)\.length === 0/.test(worldSwitchSource)
    && /getConstructableWorlds\(\)\.filter\(\(entry\) => entry\.rebuild\)/.test(worldSwitchSource)
    && /Game\.syncMainHubWorldPortals\?\.\(\)/.test(worldSwitchSource));
check('新游戏、读档和入侵前都会补齐已建世界基础快照',
    /WorldProgressionSystem\.ensureConstructedWorldSnapshots\(\)/.test(sceneSource)
    && /this\.ensureConstructedWorldSnapshots\(\)/.test(read('src/world/world-progression-system.js'))
    && /ensureWorldBaseSnapshot\(world\.sceneId/.test(invasionSource));
check('状态机和worldEpoch会阻断旧入侵回调与旧传送门实体',
    /WORLD_LIFECYCLE_STATUS = Object\.freeze/.test(read('src/world/world-progression-system.js'))
    && /isWorldEpochCurrent\(active\.targetWorld, active\.worldEpoch\)/.test(invasionSource)
    && /token\.id !== active\.id \|\| token\.worldEpoch !== active\.worldEpoch/.test(invasionSource)
    && /onPortalDestroyed\(sceneId, worldEpoch\)/.test(invasionSource)
    && /portal\._worldEpoch = portalState\.worldEpoch/.test(sceneSource));
check('毁灭事务按sceneId与worldEpoch幂等，并且强制回城不保留通用回滚状态',
    /const transactionId = `\$\{sceneId\}:\$\{worldEpoch\}`/.test(sceneSource)
    && /existing\?\.transactionId === transactionId/.test(sceneSource)
    && /if \(opts\.worldDestructionTx\) this\._clearRollbackState\(\)/.test(sceneSource)
    && /if \(opts\.worldDestructionTx\) this\._handleWorldDestructionSwitchFailure/.test(sceneSource));
check('强制回城失败会彻底清场并进行有限重试，不会回滚复活已毁位面',
    /_handleWorldDestructionSwitchFailure\(tx\)/.test(sceneSource)
    && /clearAllEntitySprites/.test(sceneSource)
    && /WallSystem\?\.init\?\.\(0, 0\)/.test(sceneSource)
    && /stored\.attempts >= 3/.test(sceneSource)
    && /_scheduleWorldDestructionReturn\(stored\)/.test(sceneSource));
check('位面标记毁灭后，实况捕获与主存档序列化都拒绝重新写入旧记录',
    /if \(canPersistWorld && !canPersistWorld\(sceneId\)\) return null/.test(snapshotSource)
    && /canPersistWorld: \(sceneId\) => WorldProgressionSystem\.isPortalConstructed\(sceneId\)/.test(sceneSource)
    && /if \(canPersistWorld && !canPersistWorld\('scene8'\)\)/.test(snapshotSource)
    && /delete _storedByWorld\[sceneId\]/.test(snapshotSource));
check('基础模板、生成版本、世代种子和资源规则由统一重置策略解析',
    /export function getWorldResetPolicy\(sceneId\)/.test(resetPolicySource)
    && /export function createWorldGenerationContext\(sceneId, worldEpoch\)/.test(resetPolicySource)
    && /BASE_SNAPSHOT_TEMPLATES/.test(snapshotSource)
    && /portal_only_v1: _portalOnlyBaseTemplate/.test(snapshotSource));
check('五世界地表、障碍和资源生成均消费按世代派生的独立随机流',
    ['scene8', 'scene9', 'scene10', 'scene12'].every((sceneId) =>
        sceneSource.includes(`getWorldGenerationSeed('${sceneId}', 'floor_deco')`))
    && ['scene8', 'scene9', 'scene10', 'scene11', 'scene12'].every((sceneId) =>
        sceneSource.includes(`createWorldRandom('${sceneId}', 'obstacles')`))
    && /setup\(\{ random = Math\.random \} = \{\}\)/.test(energyNodeSource)
    && /\{ random = Math\.random \} = \{\}/.test(world125EnvironmentSource)
    && /\{ random = Math\.random \} = \{\}/.test(world126EnvironmentSource));
check('毁灭清理入口按resetPolicy读取快照与旧坐标范围',
    /shouldClearWorldScope\(sceneId, 'snapshot'\)/.test(sceneSource)
    && /shouldClearWorldScope\(sceneId, 'playerPosition'\)/.test(sceneSource)
    && /shouldClearWorldScope\(sceneId, scope\)/.test(resetPolicySource));
check('入侵候选池排除保护位面，HUD提供分段预警与本体支援',
    /!WorldProgressionSystem\.isWorldInvasionProtected\(world\.sceneId, nowGameTimeMs\)/.test(invasionSource)
    && /portalWarningForRatio\(portalHpRatio\)/.test(invasionSource)
    && /supportActiveInvasion\(\)/.test(worldSwitchSource)
    && /SceneManager\.currentScene === 'scene7'/.test(worldSwitchSource)
    && /observer: false/.test(worldSwitchSource));
check('开发工具可查看位面模型、受控推进统一时钟并执行正式毁门入口',
    /getDebugModel\(\)/.test(invasionSource)
    && /EnvironmentLightingSystem\.advanceTime\(advancedMs\)/.test(invasionSource)
    && /debugDestroyPortal\(sceneId\)/.test(invasionSource)
    && /data\.tab = 'world'|dataset\.tab = 'world'/.test(devToolsSource)
    && /模拟毁门/.test(devToolsSource));

EnergyManager.resetWarehouses();
GoldManager.setBackpackRef([]);
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
