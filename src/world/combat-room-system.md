/**
 * ============================================================
 * CombatRoomSystem — 接口文档
 * ============================================================
 *
 * 文件：game-dev/src/world/combat-room-system.js
 *
 * 概述：
 *   CombatRoomSystem 负责战斗场地的生成、管理和销毁。
 *   支持普通战斗（1024-2048 随机大小）和 Boss 战（4096 固定大小）。
 *   战斗完成后自动恢复原始场景（墙壁、地形、相机）。
 */

// ==================== 配置对象 ====================
//
// COMBAT_ROOM_CONFIG — 战斗场地全局配置
//
// 属性说明：
//   roomSize.min          — 最小场地大小（默认 1024）
//   roomSize.max          — 最大场地大小（默认 2048）
//   roomSize.boss         — Boss 战固定场地大小（默认 4096）
//   roomSize.default      — 默认回退大小（默认 1024）
//   walls.thickness       — 边界墙壁厚度（默认 20）
//   walls.margin          — 安全区域内边距（默认 20）
//   playerSpawn.offsetFromEdge — 玩家距边界偏移（默认 60）
//   playerSpawn.edgeCandidates — 可选进入边 [0,1,2,3]（0=上,1=右,2=下,3=左）
//   monsterSpawn.margin   — 怪物距边界最低距离（默认 40）
//   monsterSpawn.spawnDepth — 对边生成区域深度（默认 120）
//   monsterSpawn.count.normal — 普通战斗怪物数量（默认 3）
//   monsterSpawn.count.boss   — Boss 战怪物数量（默认 1）
//   terrain.floorColor    — 地板颜色（默认 '#1a1a1a'）
//   terrain.gridColor     — 网格线颜色（默认 'rgba(50,50,50,0.3)'）
//   terrain.gridSize      — 网格大小（默认 20）
//   terrain.edgeHighlight — 边缘高亮颜色（默认 'rgba(80,80,80,0.5)'）
//   monsterPool.normal    — 普通怪物类数组
//   monsterPool.boss      — Boss 怪物类数组
//   cleanup.countdownMs   — 打扫战场倒计时（默认 10000ms）
//   cleanup.goldReward.normal.min/max — 普通战斗金币奖励范围
//   cleanup.goldReward.boss — Boss 战固定金币奖励
//
// 使用方式：
//   import { COMBAT_ROOM_CONFIG } from './combat-room-system.js';
//   COMBAT_ROOM_CONFIG.roomSize.min = 1280; // 运行时修改

// ==================== 核心 API ====================

/**
 * CombatRoomSystem.enterCombatRoom(player, isBoss, options)
 * ----------------------------------------------------------------
 * 进入战斗场地，自动生成场地、放置玩家、生成墙壁。
 *
 * 参数：
 *   player   {Object}  玩家实体（必须）
 *   isBoss   {boolean} 是否为 Boss 战（默认 false）
 *   options  {Object}  可选配置覆盖：
 *            - roomSize:      {number} 指定场地大小
 *            - monsterCount:  {number} 怪物数量
 *            - monsterClasses:{Array}  自定义怪物类数组
 *
 * 返回：
 *   {Object|null} 场地信息：
 *     { size, bounds: {minX, maxX, minY, maxY, cx, cy}, entranceEdge, oppositeEdge }
 *
 * 示例：
 *   import { CombatRoomSystem } from './combat-room-system.js';
 *   CombatRoomSystem.enterCombatRoom(player, false);
 */

/**
 * CombatRoomSystem.spawnMonsters(count, isBoss, customClasses)
 * ----------------------------------------------------------------
 * 在场地对边生成怪物。
 *
 * 参数：
 *   count          {number} 怪物数量（默认从配置读取）
 *   isBoss         {boolean} 是否使用 Boss 怪物池
 *   customClasses  {Array}  自定义怪物类数组（可选）
 *
 * 返回：
 *   {Array} 生成的怪物实体数组
 *
 * 示例：
 *   CombatRoomSystem.spawnMonsters(5, false); // 生成5只普通怪物
 */

/**
 * CombatRoomSystem.isCombatComplete()
 * ----------------------------------------------------------------
 * 检查当前战斗是否完成（所有怪物死亡）。
 *
 * 返回：
 *   {boolean} true = 所有怪物已死亡
 *
 * 示例：
 *   if (CombatRoomSystem.isCombatComplete()) { ... }
 */

/**
 * CombatRoomSystem.getGoldReward(isBoss)
 * ----------------------------------------------------------------
 * 获取本次战斗的奖励金币数。
 *
 * 参数：
 *   isBoss {boolean} 是否为 Boss 战
 *
 * 返回：
 *   {number} 金币数量
 */

/**
 * CombatRoomSystem.cleanupRoom()
 * ----------------------------------------------------------------
 * 清理战斗场地并恢复原始场景。
 * 删除所有战斗怪物，恢复墙壁、地形、相机、世界尺寸。
 *
 * 示例：
 *   CombatRoomSystem.cleanupRoom();
 */

/**
 * CombatRoomSystem.cleanupMonstersOnly()
 * ----------------------------------------------------------------
 * 仅清理怪物，保留场地（用于多波次战斗）。
 *
 * 示例：
 *   CombatRoomSystem.cleanupMonstersOnly();
 *   CombatRoomSystem.spawnMonsters(3); // 生成下一波
 */

/**
 * CombatRoomSystem.getRoomInfo()
 * ----------------------------------------------------------------
 * 获取当前场地信息。
 *
 * 返回：
 *   {Object|null} { size, bounds, entranceEdge, oppositeEdge, state, monsterCount }
 */

// ==================== 便捷函数 ====================

/**
 * enterCombat(player, options)
 * ----------------------------------------------------------------
 * 快速进入普通战斗场地（CombatRoomSystem.enterCombatRoom 的快捷方式）。
 */

/**
 * enterBossRoom(player, options)
 * ----------------------------------------------------------------
 * 快速进入 Boss 战斗场地（CombatRoomSystem.enterCombatRoom 的快捷方式）。
 */

/**
 * spawnCombatMonsters(count, customClasses)
 * ----------------------------------------------------------------
 * 快速生成普通战斗怪物。
 */

/**
 * spawnBossMonsters(count, customClasses)
 * ----------------------------------------------------------------
 * 快速生成 Boss 怪物。
 */

// ==================== 与现有系统集成 ====================

/*
 * 1. dungeon-map-system.js 集成
 * ------------------------------
 * 替换原有的 _generateRoom() 和 _spawnMonsters() 调用：
 *
 *   // 旧代码（_enterCombat 方法中）：
 *   // this._prepareCombatMode(false);
 *   // this._generateRoom(false);
 *   // this._spawnMonsters(3, false);
 *
 *   // 新代码：
 *   import { CombatRoomSystem } from './combat-room-system.js';
 *
 *   _enterCombat(node) {
 *       if (this.dungeonType === 'zombie') {
 *           this._enterZombieCombat(node);
 *           return;
 *       }
 *       this._prepareCombatMode(false);
 *       CombatRoomSystem.enterCombatRoom(this.player, false);
 *       CombatRoomSystem.spawnMonsters(3, false);
 *       EffectManager.add(new FloatingTextEffect(512, 400, "进入战斗！消灭所有敌人", "#ff4444"));
 *   }
 *
 *   _enterBoss(node) {
 *       if (this.dungeonType === 'zombie') {
 *           this._enterZombieCombat(node);
 *           return;
 *       }
 *       this._prepareCombatMode(true);
 *       CombatRoomSystem.enterCombatRoom(this.player, true);
 *       CombatRoomSystem.spawnMonsters(1, true);
 *       EffectManager.add(new FloatingTextEffect(512, 400, "Boss 战！", "#ff0000"));
 *   }
 *
 *   _cleanupCombat() {
 *       // 旧代码保留清理 UI 和状态的部分
 *       // ...
 *       // 新增：调用 CombatRoomSystem 清理场地
 *       CombatRoomSystem.cleanupRoom();
 *   }
 */

/*
 * 2. scene-manager.js 集成
 * ------------------------------
 * 场景切换时确保 CombatRoomSystem 已清理：
 *
 *   switchScene(sceneId, player, mode) {
 *       // 清理当前场景...
 *       if (CombatRoomSystem.active) {
 *           CombatRoomSystem.cleanupRoom();
 *       }
 *       // ...
 *   }
 */

/*
 * 3. game.js update() 集成
 * ------------------------------
 * 在战斗状态检测中使用 CombatRoomSystem：
 *
 *   if (DungeonMapSystem.active &&
 *       (DungeonMapSystem.state === 'combat' || DungeonMapSystem.state === 'boss')) {
 *       // 使用 CombatRoomSystem 检查战斗完成
 *       if (CombatRoomSystem.isCombatComplete() && !CombatRoomSystem._cleanupActive) {
 *           // 开始打扫战场倒计时...
 *       }
 *   }
 */

/*
 * 4. 配置自定义
 * ------------------------------
 * 在应用启动时修改配置：
 *
 *   import { COMBAT_ROOM_CONFIG } from './combat-room-system.js';
 *
 *   // 调整场地大小范围
 *   COMBAT_ROOM_CONFIG.roomSize.min = 1280;
 *   COMBAT_ROOM_CONFIG.roomSize.max = 2560;
 *
 *   // 调整怪物数量
 *   COMBAT_ROOM_CONFIG.monsterSpawn.count.normal = 5;
 *
 *   // 使用自定义怪物池
 *   COMBAT_ROOM_CONFIG.monsterPool.normal = [MyCustomMonster, AnotherMonster];
 */
