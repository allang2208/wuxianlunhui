# Sprite Pipeline 技能文档

## 版本: 1.6

## 阶段性进度总结（2026-07-13 晚间收尾）

### 本次完成：胖子僵尸、按场次 Buff/Debuff、地牢流程与受击粒子修复

#### 一、胖子僵尸（Fat Zombie）完整机制
1. **贴图放大 25%**：`data/enemy-config.json` 中 `fatZombie.render.spriteSize` 150（120→150），碰撞体积保持 90×120。
2. **尸体腐蚀领域**：死亡后进入 corpse 阶段，继续执行 `_updateAura`；腐蚀区域改为 100×25 并向下偏移 70px，与尸体贴图对齐。
3. **攻击/命中**：`attackRange` 100，`dynamicRange` 120，解决胖子攻击频繁落空问题。

#### 二、战斗系统收尾
1. **远程物理减伤**：`src/entities/damageable-entity.js` 对 `!isMelee && physical` 类型伤害也应用远程减伤。
2. **按场次 buff/debuff 状态栏**：`src/ui/status-bar.js` 支持 `battleRemaining`；统一消耗所有非永久 buff。
3. **僵尸巫师 AI**：`src/entities/enemy-types/zombie-wizard.js` 冰锥/火球入口增加 `castRange` 检查，未进入射程时先普攻/召唤。

#### 三、地牢流程与资源配置
1. **empty 节点通行**：统一在 `_leaveCombatViaPortal` 中标记节点完成，移除普通分支提前置空。
2. **精灵图偏移配置**：`scripts/generate-sprite-offsets.js` 扩展为所有敌人动画表生成 `data/sprite-offsets.json`。
3. **图鉴 idle 放大截取**：使用 `idleSheetColumns` 计算背景尺寸，修正第一帧显示过小。

#### 四、主神空间测试
1. 生成原设定数值的胖子僵尸。
2. 左下角新增“无敌”切换按钮；`SceneManager._mainHubInvincible` 控制主神空间是否受伤。

#### 五、僵尸受击绿色粒子修复
1. **统一触发**：在 `src/entities/damageable-entity.js` `takeDamage()` 扣血后统一调用 `triggerZombieHitParticles`，移除各技能系统的重复触发。
2. **Phaser 4 粒子坐标陷阱**：
   - `this.add.particles(x, y, texture, config)` 把发射器放在 `(x,y)`，但 `explode(count, x, y)` 的参数是相对于发射器的**本地坐标**。
   - 错误写法会让粒子世界坐标变成 `(2x, 2y)`，从而飞出视野。
   - 正确写法：`this.add.particles(0, 0, texture, config)` + `particles.explode(count, worldX, worldY)`。
3. **必须加入 UpdateList**：`this.add.particles()` 默认不会把发射器加入 Scene 的 UpdateList，需要手动调用 `particles.addToUpdateList()`，否则粒子只会静止一帧，不会运动/死亡。
4. 修复后手动调用 `scene.playZombieHitParticles(worldX, worldY, angle)` 可看到绿色粒子爆发。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/entities/damageable-entity.js`
- `src/entities/enemy-types/fat-zombie.js`
- `src/entities/enemy-types/zombie-wizard.js`
- `src/ui/status-bar.js`
- `src/world/dungeon-map-system.js`
- `src/world/scene-manager.js`
- `scripts/generate-sprite-offsets.js`
- `data/enemy-config.json`
- `data/sprite-offsets.json`

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

---

## 伪 3D 碰撞重构记录（进行中）

### Phase 0：统一 Collider 数据层 ✅
1. 新增 `src/physics/collider.js`：
   - 地面 footprint 为圆形（`groundRadius`）。
   - 垂直体积为胶囊体（`height` + `radius`）。
   - 默认高度推导：`config.height > render.spriteSize > collisionHeight > radius*2`。
2. 新增 `src/physics/collision-3d.js`：
   - 3D 线段到胶囊体距离（用于投射物/近战）。
   - 线段到线段最短距离、球体相交等辅助函数。
3. 新增 `src/physics/spatial-grid.js`：2D 空间网格 broadphase。
4. `Entity` 基类接入 `collider`、新增 `groundRadius` / `bodyHeight` 统一入口，不改动现有属性。
5. Player 与 Enemy 在碰撞字段最终确定后调用 `rebuildCollider()`。
6. 新增 `scripts/test-collider.mjs` 跑通推导、3D 命中、空间网格测试。

### Phase 1：地面碰撞统一为圆形 footprint ✅
1. `game.js::resolveCollisions()` 从“矩形/六边形/圆形多套分离”简化为统一的圆-圆分离，使用 `groundRadius`。
2. `MovementSystem`、玩家移动、敌人 AI、冲刺、击退、`PathManager`、`DynamicObstacleMap` 全部改用 `groundRadius`。
3. `WallSystem` 的树木新增 `height` 字段，为未来飞行单位做准备。
4. 玩家 footprint 按方案 A 改为圆形，半径保持 30（与原 `collisionRadius` 一致）。

### Phase 2：投射物判定 3D 化 + 空间网格 broadphase ✅
1. `src/combat/projectile.js` 重写命中判定：
   - 投射物增加 `z` / `prevZ`，轨迹视为 3D 线段。
   - 使用 `segmentIntersectsCapsule` 与目标 Collider 胶囊体做精确检测。
   - 移除旧的 2D 矩形扩张 / 圆心距离判定。
2. Broadphase：
   - 复用现有 `SpatialPartitionSystem.queryRadius`。
   - 以投射物本帧路径中点为中心，查询半径 = `stepLen + 160`，只检测附近实体。
   - SpatialPartitionSystem 不可用时回退到全量遍历。
3. 自然支持高低差：地面投射物 z=0，飞行单位 z>0 时自动打不到；未来抛物线/对空投射物只需设置 z。

### 后续 Phase 状态（2026-07-17 核实，均已完成）
- Phase 3：近战 / 技能 AOE 3D 化 ✅（变更记录 v2.0）
- Phase 4：场景贴图 Y 深度排序 ✅（变更记录 v2.1）
- Phase 5：清理旧命中系统与可视化对齐 ✅（变更记录 v2.2）
- 详见下方"变更记录" v2.0–v2.4

### 补充：投射物躯干矩形判定（方案 B，2026-07-17）✅

**问题**：投射物命中只看脚下 footprint 椭圆（+ 3D 世界胶囊），玩家与目标同一水平轴时，瞄准贴图身体（躯干/头部）子弹会穿过——子弹在地面平面飞行，贴图躯干在"身后"的屏幕行。

**方案**：新增屏幕空间**躯干矩形**判定，仅投射物使用；近战判定（attack.js / skill-shapes.js）不变。

**共享模块 `src/physics/torso-hitbox.js`（唯一推导口径，禁止重复编码）**：
- `getTorsoRect(entity)`：取 `config.render.projectileHitbox`（width/height/offsetX/bottom，锚定 collider 脚底中心）；缺省 = `collisionWidth × 身高`（新怪物零配置自动获得）。
- `segmentHitsTorso(entity, x1, y1, x2, y2, expand)`：枪械投射物扫掠线段判定。
- `pointHitsTorso(entity, px, py, expand)`：技能投射物逐帧点判定，FLYING 免疫（与 GroundCircle 语义对齐）。

**判定并集**：
- 枪械投射物（projectile.js）：footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱；飞行目标仍只查 3D 胶囊。
- 技能投射物飞行命中：冰锥(r=12)/火球(r=20)/符文剑(r=15) = GroundCircle ∪ 躯干矩形；火球爆炸 AOE 维持 GroundCircle 不动。

**逐怪数值**：7 只精灵图怪物按首帧内容边界实测（`scripts/archive/measure-projectile-hitbox.py`，内容宽高 × spriteSize/帧宽）写入 `enemy-config.json` 的 `render.projectileHitbox`。

**调试可视化**：左下"范围"按钮显示**绿色躯干矩形**（GameScene._syncCollisionRadii，与判定同一推导）。

**单测**：`scripts/test-collider.mjs` 22 个躯干矩形用例（含推导/点判定/缺省/FLYING 免疫）。

---

## 技术回顾与清理（2026-07-13）

### 审查范围
对 2026-07-11 至 2026-07-13 的提交进行了渲染、碰撞/AI、地牢流程三个方向的并行审查，重点排查并行系统、冗余代码和潜在 bug。

### 发现并修复的高优先级问题

#### 1. 渲染层：地图模式下 Phaser 对象残留
- **问题**：`GameScene.update()` 的地图模式分支只隐藏了玩家/武器/特效/地形/HUD，遗漏了敌人精灵组、中立实体（NPC/训练靶/传送门标签）和其他施法者特效（僵尸巫师的冰锥/火球）。
- **修复**：在该分支追加隐藏 `this.enemies`、`this._neutralSprites`、`this._magicSprites`；非地图模式恢复显示。
- **优化**：新增 `_mapModeActive` 缓存，避免每帧重复调用 `setBackgroundColor`。

#### 2. 双重碰撞系统：玩家 Phaser collider 与 WallSystem
- **问题**：`setupColliders()` 始终添加 `playerSprite-vs-walls` 的 Phaser collider，但默认模式下 `body.moves=false`，由 `WallSystem.resolve` 处理；若误开 `_useVelocityDrive` 会产生双重阻挡/抖动。
- **修复**：仅在 `_useVelocityDrive === true` 时启用该 collider；`body.moves` 初始值与 `_useVelocityDrive` 同步。

#### 3. 动态障碍图：每帧多次刷新
- **问题**：`PathFinder.findPath()` 每次调用都执行 `dynamicObstacleMap.update()`，每个敌人寻路都会触发一次（内部有 250ms 节流，但仍属多余）。
- **修复**：将刷新移到 `MovementSystem.update()`，每帧最多一次；`PathFinder` 不再主动刷新。

#### 4. Mutant-3 连击突进无限累加
- **问题**：五连击每次命中都向 `_comboLungeDx/Dy` 累加，目标后退时单次连击总突进可能远超预期。
- **修复**：增加单次连击总突进上限 80px，命中时按剩余预算计算本次突进距离。

#### 5. 投射物：阵营检查顺序与 piercing 语义
- **问题**：友军免疫判断在 `hitTargets.has(entity)` 之后，逻辑顺序不当；`piercing < 0` 使 `piercing=1` 需要再命中一次才消失。
- **修复**：将阵营检查提到最早 continue 条件；piercing 判定改为 `<= 0`。

#### 6. 地牢流程 bug
- **empty 节点截断路线**：点击 empty 节点后未更新 `currentNodeId`，导致无法继续向后续节点前进。已改为更新当前节点并揭示邻居。
- **奖励节点卡死**：`_enterReward` 回调未标记节点完成/胜利，玩家领取奖励后卡住。已改为标记 `empty` 并调用 `_showVictory()`。
- **女神祝福不消耗**：`_cleanupCombat()` 是 dead code，正常离开战斗的 `_leaveCombatViaPortal` / `_leaveBossViaPortal` 未调用 `onCombatComplete`。已提取 `_consumeCombatBuffs()` 并在三条离开路径调用。

#### 7. 战斗房配置：`minWallDistance` 未读取
- **问题**：`data/dungeon-config.json` 中的 `spawn.minWallDistance` 未被 `createCombatRoomConfig()` 读取，怪物生成时失效。
- **修复**：在默认配置中增加 `minWallDistance: 0`，并从 JSON 读取覆盖。

### 冗余清理

#### 1. 移除废弃的默认地牢分支
- `DungeonMapSystem.generateMap()` 中 `dungeonType` 分支已废弃（`expedition-system.js` 写死为 `'zombie'`）。
- 删除 `_generateDefaultMap()` 方法、`DungeonMapGenerator` 导入，并将 `generateMap()` 简化为直接调用 `_generateZombieMap()`。

#### 2. 移除僵尸地牢中的占位/死代码
- 删除 `ZombieDungeonEvent` 占位类及其默认导出。
- 删除 `DungeonMapSystem` 中的 `_enterShop()`（无 `shop` 节点调用）、`_enterLegacyEvent()`、`_showEventUI()`、`_showEntryConfirm()` 等死代码。
- 移除不再使用的 `UIState`、`ShopSystem` 导入。

#### 3. 归档一次性脚本
- 将 `scripts/` 下的迁移/重构一次性脚本移入 `scripts/archive/`，保留可复用脚本（`backup.js`、`bump-version.js`、`copy-assets.js`、`diagnose-coordinates.js`、`fps-test-tool.js`）在根目录。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/combat/projectile.js`
- `src/entities/enemy-types/mutant-3.js`
- `src/ai/pathfinder.js`
- `src/systems/movement-system.js`
- `src/world/combat-room-system.js`
- `src/world/dungeon-map-system.js`
- `src/world/zombie-dungeon.js`
- `scripts/archive/`（新增归档目录）

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

### 已完成的后续优化（2026-07-13 续）

#### 1. 投射物 swept 检测
- 在 `projectile.js` 中改为 `_isHittingEntity(entity, prevX, prevY)`：
  - 矩形目标：将碰撞体按投射物 `size` 扩张后，检测线段是否穿过扩张矩形边或端点是否在内。
  - 圆形/其他目标：计算前一点到当前点线段到圆心最近距离，并与扩张半径比较。
- 新增 `_segmentsIntersect` 和 `_segmentPointDistance` 辅助函数。

#### 2. `_tryUnstuck` 瞬移距离缩短
- `MovementSystem._tryUnstuck` 的瞬移距离从固定 `30px` 改为 `Math.max(r * 1.5, 12)`，降低越过薄墙风险。

#### 3. `RegionIndex` 8 方向 Flood Fill
- `region-index.js` 的 Flood Fill 方向从 4 方向扩展为 8 方向，与 `PathFinder` 移动方向一致。

#### 4. `PathFinder` 网格对象池
- 在 `PathFinder` 构造函数中预分配 64×64 的格子对象池。
- `_buildGrid` 在尺寸不超过池大小时复用对象，避免每帧为每个寻路敌人创建大量临时对象。

#### 5. `NPCDialogue` 私有字段访问
- 在 `npc-dialogue.js` 增加公开方法 `isActive()`。
- `ZombieDungeonShop.isClosed()` 改用 `NPCDialogue.isActive()`。

#### 6. 地形纹理同步时机
- `GameScene.update()` 中移除每帧 `_syncTerrain()` 调用。
- `GameScene` 新增公开 `syncTerrain()` 方法，在 `create()` 中调用一次。
- `scene-manager.js` 各 `_loadSceneX()` 设置 `Renderer.terrainTexture` 后调用 `syncTerrain()`。
- `combat-room-system.js` 生成战斗房地板后调用 `syncTerrain()`。

### 新增地牢随机事件（待审核后接入）
- 新增 `src/world/dungeon-event-definitions.js`，定义 10 个互不重复的地牢随机事件。
- 每个事件至少 2 个选择分支，使用力量/敏捷/体质/智力/精神/幸运进行检定。
- 通用处理器 `handleNewDungeonEvent` 支持属性检定、金币/药水/材料/特殊道具、伤害/恢复、战斗、揭示节点、临时 Buff 等结果。
- 接入方式：在 `dungeon-event-system.js` 的 `eventWeights` 注册权重，并在 `handleChoice` 中增加 default 分支调用 `handleNewDungeonEvent`。

### 仍待后续跟进
- 新事件的临时 Buff 需要在 `DungeonBuffSystem.getAtkBonusPercent` 或战斗系统中纳入加成计算。
- 新事件接入后需实机测试检定概率与奖励平衡。

---

## 阶段性进度总结（2026-07-13 续）

### 本次完成：僵尸地牢地板/路线地图修复 + 精英判定/投射物/怪物机制收尾

#### 一、僵尸地牢地板与背景
1. **blackbrick 地板**：`CombatRoomSystem._generateTerrain()` 改为纯黑背景 + `blackbrick.png` 平铺地板（256×256 repeat），并在地板四周叠加 64px 黑→透明渐变，实现与纯黑背景的自然过渡。
2. **贴图加载**：`BootScene.js` 已加载 `assets/terrain/blackbrick.png`；`GameScene._syncTerrain()` 直接使用 `Renderer.terrainTexture` 覆盖地形。
3. **相机背景**：`GameScene` 在非地图模式保持 `setBackgroundColor('#000000')`，确保战斗/主场景外区域纯黑。

#### 二、路线选择地图可见性修复
1. **问题**：设置纯黑相机背景后，路线选择地图被 Phaser Canvas 黑色背景遮挡。
2. **修复**：在 `GameScene.update()` 的地图模式分支中，将相机背景设为透明 `rgba(0,0,0,0)`，露出下方 `Renderer.canvas` 绘制的路线地图；战斗/非地图模式恢复纯黑。

#### 三、起点路线数量修复
1. **问题**：僵尸地牢起点只出现 2 条路线（第 1 列节点随机生成 2~4 个）。
2. **修复**：`ZombieDungeonMapGenerator.generate()` 在节点数调整完成后，强制第 1 列包含所有行（`rows=4`），配合 `_buildEdges` 中“起点连接第 1 列所有节点”的逻辑，确保起点始终 4 条分支。

#### 四、怪物与战斗机制收尾
1. **Mutant-3 五连击突进**：判定距离放宽到 350，突进改为插帧平滑移动（500 px/s，每段最多 35px），带 `WallSystem.resolve` 撞墙校验，不再瞬移。
2. **毒液僵尸投射物**：从头部射出，延迟到攻击动画第 12 帧发射；投射物碰撞与贴图大小统一为配置 `attack.width` 的 3 倍；`projectile.js` 对矩形碰撞体使用 AABB 相交判定。
3. **NPC 立绘**：统一使用固定 `bottom` 像素定位，调整工具仅保留水平拖动；`npc-portrait-tool.js` 默认参数使用 `bottom`。
4. **精英判定唯一来源**：以 `data/enemy-config.json` 的 `rank` 为唯一来源；`ZombieDungeonCombat` 怪物池按 `rank` 动态构建；`Enemy` 实例继承 `rank`/`type`/`category`。
5. **主神空间清理**：移除主神空间的突变体-3 和毒液僵尸测试生成。
6. **毒液僵尸 walking 贴图替换**，并新增独立 `spitter-zombie.js` 类管理延迟吐息。

### 关键改动文件
- `src/world/combat-room-system.js`
- `src/world/zombie-dungeon.js`
- `src/phaser/scenes/GameScene.js`
- `src/phaser/scenes/BootScene.js`
- `src/entities/enemy-types/mutant-3.js`
- `src/entities/enemy-types/spitter-zombie.js`
- `src/entities/enemy.js`
- `src/combat/projectile.js`
- `src/ui/npc-portrait-tool.js`
- `src/game.js`
- `data/enemy-config.json`
- `assets/terrain/blackbrick.png`（新增）
- `assets/enemies/spitter_zombie/walking.png`（新增/替换）

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

---

## 阶段性进度总结（2026-07-13）

### 本次完成：AI 寻路优化 + 僵尸犬修复 + 图鉴修复 + 地牢事件与怪物碰撞优化

#### 一、AI 寻路与怪物拥堵优化
1. **路径跟随期间启用分离力**：`_followPath()` 调用增强版 `_computeSeparation()`，拥挤时允许偏离路径点绕过同伴。
2. **分离力增强**：半径改为 `collisionRadius * 1.8`（24~80），检查数量从 5 提升到 12，加入距离衰减与随机抖动。
3. **攻击范围渐进减速**：`dist <= attackRange * 0.9` 才开始减速，`dist <= attackRange * 0.5` 完全停车，前排不再一进入范围就堵死道路。
4. **CombatSystem 攻击缓冲**：攻击判定距离放宽到 `attackRange * 1.15`。
5. **缩短近战 AI 决策间隔**：普通/次级近战怪 `aiInterval` 从 2000ms 降到 800~1200ms。
6. **侧翼包抄**：`_computeMoveDirection` 中当目标周围 ≥2 个同伴时，向人数更少的一侧偏移 45°~75°，选择 persisted in `_flankSide`。
7. **卡住 reposition**：寻路失败时设置 600ms 临时侧向 `_tacticalTarget`，而不是随机乱转。
8. **动态障碍图**：新增 `src/ai/dynamic-obstacle-map.js`，每 250ms 采样敌人位置，密集区域（≥3 敌人）在 A* 中增加 3.5x 移动成本，让后续怪物主动绕行。
9. **寻路缓存适配动态障碍**：起点/终点附近有动态障碍时跳过缓存，避免使用过期低成本路径。
10. **BFS 预检收紧**：`isReachable()` 步数耗尽后返回 `false`，避免对不可达目标执行昂贵 A*。
11. **性能保护**：侧翼统计每 200ms 缓存一次，使用平方距离避免每帧开方，并限制最多遍历 80 个实体；动态障碍图每 250ms 重建一次，cell 自动衰减清理。

#### 二、僵尸犬攻击动画修复与参数调整
1. **攻击动画不显示修复**：`ZombieDogEnemy` 之前继承 `CircleEnemy`，攻击时 `_attackTimer` 永远不会被设置，导致 `_animState` 无法进入 `attack`。已新增 `_attackDuration = 600` 并覆盖 `triggerWeaponAnim()` 设置 `_attackTimer`；`update()` 中递减 `_attackTimer`。
2. **参数调整**：`aiInterval` 和 `attack.cooldown` 均改为 1500ms（攻击间隔 1.5s）；`speed` 从 168.75 提升到 219.375（+30%）。

#### 三、图鉴模块修复
1. **根因**：`src/items/item-database.js` 静态导入了 `CodexManager`，而 `codex-manager.js` 又静态导入 `ItemDatabase`，形成循环依赖，导致 `ItemDatabase` 在图鉴初始化时为 `undefined`。
2. **修复**：移除 `item-database.js` 的静态导入，改为 `addItem()` 中动态导入刷新；同时初始化 `currentEquipCategory: "all"`，避免装备页默认空白。

#### 四、交互开发工具坐标工具修复
1. **现象**：点击「📐 坐标工具」按钮后，遮罩层/面板无法显示，框选矩形不出现，坐标值不更新，无法记录。
2. **根因**：`coordOverlay` 与 `coordPanel` 被创建在 `uiLayer` 内部，而 `uiLayer` 设置了 `pointer-events: none`；坐标工具代码仅依赖内联 `style.display` 切换显示，未使用 CSS 的 `.active` 类，也未将层提升到 `document.body`，导致事件可能被父层截断或层级受限于 `uiLayer`。
3. **修复**：
   - `_startCoordTool()` 启动时把 `coordOverlay` / `coordPanel` 移动到 `document.body`，脱离 `uiLayer` 的 `pointer-events: none`。
   - 同时添加 `.active` 类并设置 `style.display`，与 CSS 规则保持一致。
   - 启动前调用旧的 `_coordToolCleanup()`，防止重复绑定事件。
   - `mouseup` 事件绑定到 `window`，避免拖出窗口后释放导致框选丢失。
   - 增加 `overlay` / `panel` 缺失的防御性检查，并在控制台输出调试日志。
4. **二次修复（Infinity/NaN）**：
   - 根因：非地牢地图模式下 `Renderer` 会把原始 `gameCanvas` 设为 `display: none`，`getBoundingClientRect()` 返回宽高为 0，导致 `gameCanvas.width / 0 = Infinity`，所有坐标计算变成 `Infinity/NaN`。
   - 修复：`getGameScale()` 中仅当 `canvasRect.width/height > 0` 且计算结果有限时才使用缩放，否则回退到 `scaleX/Y = 1`（即 CSS 像素）。
   - 最终输出统一经过 `safe()` 函数处理，防止任何异常值写入面板。

#### 五、地牢随机事件对话框落地坐标
1. **需求**：将地牢随机事件对话框/选择框/结果框按坐标工具测得的位置摆放：`left: 151px; bottom: 88px; width: 1567px; height: 243px`。
2. **实现**：
   - `DungeonEventSystem._showEventUI()` 与 `_showResultUI()` 的事件面板改为固定定位在上述坐标，不再居中显示。
   - 面板内部改为左右分栏：左侧占满剩余宽度展示标题与剧情描述，右侧固定 420px 放置选择按钮/继续按钮。
   - 全屏遮罩改为半透明暗色（`rgba(0,0,0,0.45)`），保留点击拦截但不遮挡游戏画面。
3. **剧情与判定数值完善**：
   - 5 个事件（女神像、陷阱、补给堆、宝箱、恶魔雕像）的剧情描述扩展为更具氛围的长文本。
   - 陷阱/补给堆选择按钮新增「描述 + 检定属性 + 当前属性值 + 成功率」的副标题。
   - 判定基础成功率调整：解除陷阱 25%（敏）、强行跨越 30%（体）、仔细搜寻 40%（精）、探查四周 35%（敏）。
   - `data/dungeon-config.json` 与 `src/world/dungeon-event-system.js` 默认配置保持一致。

#### 六、地牢事件 UI/流程修复
1. **事件结果不再创建浮动文字**：`_showResultUI()` 中移除 `FloatingTextEffect`，避免事件结束后残留黄/红文字。
2. **事件遮罩改为不透明纯黑**：`_showEventUI()` 与 `_showResultUI()` 的全屏遮罩从 `rgba(0,0,0,0.45)` 改为 `rgba(0,0,0,1)`。
3. **浮动文字主动清理**：`EffectManager.clearFloatingTexts()` 会遍历并销毁 Phaser 文本对象；`DungeonMapSystem._returnToMap()` 调用该方法，确保返回地图时无残留。
4. **事件节点状态流转**：事件结束后节点变为 `empty`；陷阱节点仅在成功解除（`result.success === true`）后才变 `empty`，失败保留可再次尝试。

#### 七、怪物寻路/碰撞优化
1. **分离力修复**：`_computeSeparation` 改为优先使用传入的 `entities` 参数（修复忽略参数的 bug），并回退到 `Game.entities`。
2. **分离力增强**：从加权平均改为反平方累加，近距离排斥更强；贴身战斗时自动降低分离权重，限制最大分离力避免过度漂移。
3. **敌人墙壁碰撞单一权威**：`GameScene.setupColliders()` 移除 `enemies-vs-walls` 的 Phaser collider，保留 `player-vs-walls`，让 `WallSystem.resolve()` 成为敌人碰撞唯一权威，解决贴墙/墙角怪物被 Phaser 物理钉死的问题。
4. **墙壁解析脱困 fallback**：`WallSystem.resolve()` 在标准滑动与步长回退均失败后，尝试沿移动方向切线方向侧向滑动。
5. **卡死恢复**：`MovementSystem._tryUnstuck(enemy)` 在敌人尝试移动但连续 30 帧位移 < 0.5px 时，沿 8 个方向寻找合法位置小幅瞬移；静止或目标在攻击范围内时不触发。
6. **安全生成边距**：`CombatRoomSystem.spawnMonsters()` 生成怪物后，若其碰撞半径位置被墙/障碍阻挡，则调用 `WallSystem.findSafeSpawn()` 沿螺旋外推重新定位。
7. **RegionIndex 树木半径对齐**：`region-index.js` 中树木阻挡半径与 `WallSystem` 一致，使用 `t.collisionRadius || t.radius * 0.6`。

#### 八、僵尸犬奔跑贴图再次修复
1. **补齐 idle 动画**：`BootScene.js` 为 `enemy_zombie_dog_idle` 创建单帧循环动画 `zombie_dog_idle`，避免 idle 状态时调用 `sprite.anims.stop()` 中断动画系统。
2. **动画同步增加 isPlaying 检查**：`GameScene._syncEnemyAnimation()` 在 `current.key !== animKey` 之外增加 `!sprite.anims.isPlaying`，动画意外停止时自动重新播放；找不到动画时不再强制 stop。
3. **相对阈值与滞后**：`ZombieDogEnemy.update()` 将 `run/walk/idle` 阈值从固定 `1.2/0.1` 改为基于 `maxSpeed` 的比例（run≈30%、walk≈5%），并加入滞后区间与 80ms 最小保持时间，防止在攻击范围边缘因摩擦反复切换动画状态导致奔跑贴图“卡住”。

#### 九、战斗完成顶部提示栏
1. **复用场景切换提示样式**：`SceneManager` 新增 `showTopNotification(text, options)`，与 `_showSceneLabel()` 使用相同的 DOM/CSS/动画（`top:210px` 居中、`#d4c5a9`、`48px`、字重 700、`sceneLabelFade` 3 秒淡出）。
2. **战斗完成触发提示**：`DungeonMapSystem.updateCombat()` 在战斗完成并生成出口传送门后，调用 `SceneManager.showTopNotification('已完成战斗，寻找传送门离开')`。

### 关键改动文件
- `src/systems/movement-system.js`
- `src/systems/combat-system.js`
- `src/ai/dynamic-obstacle-map.js`（新增）
- `src/ai/pathfinder.js`
- `src/ai/region-index.js`
- `src/entities/enemy-types.js`
- `src/effects/effect-manager.js`
- `src/items/item-database.js`
- `src/phaser/scenes/BootScene.js`
- `src/phaser/scenes/GameScene.js`
- `src/ui/codex-manager.js`
- `src/ui/dev-tool.js`
- `src/world/combat-room-system.js`
- `src/world/dungeon-event-system.js`
- `src/world/dungeon-map-system.js`
- `src/world/scene-manager.js`
- `src/world/wall-system.js`
- `data/enemy-config.json`
- `data/dungeon-config.json`

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅

---


## 阶段性进度总结（2026-07-12）

### 本次完成
1. **怪物贴图兜底与碰撞扩大**：敌人无 Phaser Sprite 时自动创建 `enemy_circle` 占位；`getOrCreateEnemySprite` 默认纹理改为 `enemy_circle` 并加入缺失回退；敌人碰撞半径在 `_configureEnemyBody` 中扩大一倍。
2. **毒液僵尸投射物调整**：速度从 `1080` → `540` → `270`，纹理改为绿色实心圆，显示尺寸缩小 30%（`this.size * 1.4`）。
3. **地牢全图索敌**：`zombie-dungeon.js` 工厂给所有地牢僵尸覆盖 `aggroRange: 9999`、`alertRange: 9999`、`loseTimeout: 999999`。
4. **战后传送门名称去重**：`_syncEntityHud` 识别 `entity.noNameLabel`，避免 `CombatExitPortal` 被重复画名字。
5. **僵尸犬精灵图动画**：从外部素材库统一为 512×512 帧，输出 `zombie_dog_idle/walk/run/attack.png`；`BootScene` 加载并注册动画；新增 `ZombieDogEnemy` 类；`GameScene` 新增 `_syncEnemyAnimation` 同步纹理/翻转/动画状态。
6. **主神空间测试用怪清理**：删除原来的 5 只测试圆形敌人，改为生成一只僵尸犬；每次回到主神空间自动清理怪物并重新生成。
7. **Bug 修复（武器变圆）**：`_syncEnemyAnimation` 被错误对所有 `_phaserSprite` 实体执行，导致中立实体贴图被强制改为 `enemy_circle`。已限定为 `entity._faction === 'enemy'`。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/phaser/scenes/BootScene.js`
- `src/entities/enemy-types.js`
- `src/world/zombie-dungeon.js`
- `src/world/scene-manager.js`
- `src/game.js`
- `src/combat/projectile.js`
- `data/enemy-config.json`

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅

## 阶段性进度总结（2026-07-11）

### 本次完成
1. **NPC 对话与交互修复**：修复 Phaser viewport 与鼠标坐标换算不一致，NPC 点击正常进入对话。
2. **掉落物拾取**：左键/Z 键拾取后正确销毁 Phaser Sprite 并从实体列表删除，无视觉残留。
3. **玩家与武器显示**：玩家贴图与逻辑位置同步偏差 0.00；武器 Sprite 每帧同步位置/旋转/贴图；根据 `_facingDir` 自动翻转并加入 80ms idle 缓冲避免动画抖动。
4. **HUD 布局还原**：恢复 DOM HUD（顶部栏、底部 HP/体力、武器信息、操作提示、小地图），Phaser 仅保留经验条、Buff/Debuff、屏幕特效。
5. **NPC 名字去重**：`_syncEntityHud` 跳过自带标签的 NPC/训练靶/掉落物。
6. **移动卡顿/瞬移修复（核心）**：敌人 A* 寻路对远距离目标会生成巨大网格，单次 `findPath` 可达 150ms+，跑动越久触发越多导致卡顿。已在 `PathFinder` 限制 `maxSearchRange=800px`，并在 `MovementSystem` 中目标距离超过 800px 时跳过寻路、直接直线移动。

### 关键改动文件
- `src/ai/pathfinder.js`
- `src/systems/movement-system.js`
- `src/phaser/scenes/GameScene.js`
- `src/game.js`
- `src/utils/perf-monitor.js`（临时调试计时器，可后续清理）

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅
- 实机测试：持续跑动不再卡顿

---

## 核心规则

1. **Phaser `spritesheet` 加载时必须带 `endFrame`** — 防御性配置，防止图片高度差1像素导致帧数错误
2. **所有精灵图在入代码前必须跑标准化脚本** — 统一内容大小和中心位置，避免代码手动调 spriteSize
3. **精灵图尺寸必须严格是 `frameSize × cols × rows`** — 不足时脚本自动填充透明行
4. **敌人动画同步必须限定 `_faction === 'enemy'`** — `_syncEnemyAnimation` 这类按实体刷新的逻辑只能作用于敌人，否则会把中立实体/掉落物/特效 Sprite 的纹理错误覆盖为 `enemy_circle`
5. **外部素材导入前先检查实际帧布局** — 如僵尸犬 4096×4096 合并图是 8×8 的 512×512 网格，但有效帧可能只有一行；导入前用脚本/工具确认非空帧数，避免加载空白帧

---

## 流水线流程（以后每个新角色/怪物都走这套）

### 步骤1: 制作原始精灵图

在 Aseprite / Photoshop 中制作，帧大小固定（如 250×215）。

不要求内容精确对齐，因为步骤3会处理。

### 步骤2: 运行标准化脚本

```bash
cd tools
python sprite-normalizer.py \
  --input ../assets/enemies/raw/black_wolf.png ../assets/enemies/raw/black_wolf_attack.png \
  --output ../assets/enemies/ \
  --frame-width 250 --frame-height 215 \
  --cols 4 --rows 2
```

脚本行为：
- 分析每个精灵图的所有帧内容边界
- 取所有输入中的**最大内容宽高**作为目标
- 缩放每帧内容（保持比例，fit 模式）
- 平移使内容中心对齐到帧中心
- 输出到 `--output` 目录

只输出报告不生成文件：
```bash
python sprite-normalizer.py --report ...
```

### 步骤3: BootScene 加载

```javascript
this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', {
    frameWidth: 250, frameHeight: 215, endFrame: 7
});
```

**必须带 `endFrame`**，Phaserv4 即使图片高度差1像素也能正确加载。

### 步骤4: 怪物代码无需手动调 spriteSize

标准化后所有精灵图内容大小一致，代码中统一 spriteSize，无需条件判断：

```javascript
_getPhaserOptions() {
    return {
        spriteSize: 216,  // 统一值，不再根据状态变化
        frame: this._animFrame,
        flipX: this._facing === 'left',
        // ...
    };
}
```

---

## 音效导入工作流（2026-07-17 新增，参照集合体落地）

### 步骤1: 素材复制建档（规则 4）
按类别在项目下建子文件夹，把用户提供的音频复制进去：
```
assets/sounds/enemies/<怪物英文名>/   # 如 assets/sounds/enemies/amalgam/idle.mp3
```

### 步骤2: enemy-config.json 配置 sounds 映射（规则 1，不硬编码）
```json
"sounds": {
  "idle":   "assets/sounds/enemies/amalgam/idle.mp3",
  "throw":  "assets/sounds/enemies/amalgam/idle.mp3",
  "impact": "assets/sounds/enemies/amalgam/hitting.mp3",
  "slamHit":"assets/sounds/enemies/amalgam/hitting.mp3",
  "death":  "assets/sounds/enemies/amalgam/dying.mp3",
  "idleInterval": 3000
}
```
键名按怪物类内事件自定义（idle/throw/impact/slamHit/death/...）；`idleInterval` 为待机环境音间隔（ms）。

### 步骤3: 怪物类内按事件播放
`SoundManager.playFile(path)` 直接播放文件，无需 BootScene 预加载。统一在类内写一个小助手：

```javascript
_playSound(key) {
    const path = this.config?.sounds?.[key];
    if (path && SoundManager && typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path);
    }
}
```

事件触发点（集合体范例）：
- idle 待机：`update()` 中计时器到点播放（间隔读 `sounds.idleInterval`）
- 投掷出手（fireFrame）：`_playSound('throw')`
- 投射物落地：`_playSound('impact')`
- 砸地命中帧（hitFrames）：`_playSound('slamHit')`
- 死亡：`onDeath()` 中 `_playSound('death')`

---

## 常见问题

### 精灵图加载时报 "has no frame X"

原因：图片高度不是 `frameHeight` 的整数倍，Phaser 只识别了整数行数。  
解决：
1. 短期：在 `load.spritesheet` 中加 `endFrame: N`
2. 长期：运行 `sprite-normalizer.py` 自动填充到正确尺寸

### 切换动画时贴图忽大忽小

原因：不同精灵图的内容大小/中心位置不一致，Phaser 按整帧缩放导致内容大小差异。  
解决：运行 `sprite-normalizer.py` 统一所有精灵图的内容大小和中心位置。

---

## 工具文件

- `tools/sprite-normalizer.py` — 精灵图标准化脚本
- `tools/sprite-meta.json` — 脚本输出元数据（记录目标参数）

---

## 怪物 AI 状态机（BlackWolf 示例）

### 设计原则
- **不硬编码**：AI 参数从 `enemy-config.json` 或构造函数 `config.ai` 读取
- **外部系统驱动**：BlackWolf 的 `update()` 只设置目标属性（`target`、`_tacticalTarget`、`_lastKnownTargetPos`），`MovementSystem` 和 `CombatSystem` 在后续帧执行移动/攻击
- **状态机模式**：`pacing` → `chasing` → `lost` → `pacing`

### 状态定义

| 状态 | 速度 | 目标 | 行为 |
|------|------|------|------|
| `pacing` | `maxSpeed * 0.5` | `_tacticalTarget`（200px 内随机点） | 在踱步中心半径 200px 内慢速漫游 |
| `chasing` | `maxSpeed` | `target`（最近玩家） | 向玩家奔跑，进入攻击范围时触发攻击 |
| `lost` | 无（计时中） | 保留 `target` | 目标跑出 800px 后持续 2s 计时，超时回 pacing |

### 参数配置（enemy-config.json）

```json
{
  "blackWolf": {
    "speed": 93.6,
    "dashDistance": 200,
    "ai": {
      "aggroRange": 800,
      "pacingRange": 200,
      "loseTimeout": 2000
    }
  }
}
```

### 代码实现要点

```javascript
// 1. update() 中扫描 + 执行 AI
this._aiScanTimer += dt;
if (this._aiScanTimer >= this._aiScanInterval) {
    this._aiScanTimer = 0;
    this._updateAIState(dt, entities);  // 状态切换
}
this._executeAI(dt, entities);  // 设置 target / _tacticalTarget / maxSpeed

// 2. pacing 状态：设置 _tacticalTarget，让 MovementSystem 读取
this._tacticalTarget = this._pacingTarget;
this.maxSpeed = this._baseSpeed * 0.5;

// 3. chasing 状态：设置 target，让 CombatSystem 读取
this.target = nearestPlayer;
this.maxSpeed = this._baseSpeed;
this._tacticalTarget = null;
```

---

## 状态效果系统（DamageableEntity 统一驱动）

### 设计原则
- **单一来源**：所有伤害型状态效果（中毒、流血、魔法易伤、无人机易伤）的 `_update*` 方法**只存在于 DamageableEntity 基类**
- **子类不重复**：`enemy.js` 和 `combat-system.js` 不再包含 `_updatePoison`/`_updateBleed` 等方法
- **统一入口**：`DamageableEntity.update(dt)` 调用 `updateStatusEffects(dt)` + 4 个 `_update*` 方法

### 属性初始化链
```
Combatant 构造函数 → DamageableEntity 构造函数
  _poisonStacks, _poisonTimer, _poisonTickTimer, _poisonEffectId
  _bleedStacks, _bleedTimer, _bleedTickTimer, _bleedEffectId
  _magicVulnerabilityStacks, _magicVulnerabilityTimer
  _droneVulnerabilityStacks, _droneVulnerabilityTimer

Enemy 构造函数只保留特有属性：
  this._poisonEffect = new PoisonEffect();  // 粒子效果（基类没有）
```

### 为什么之前重复？
`enemy.js` 和 `combat-system.js` 各自维护了一套 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`。
这意味着：当 `CombatSystem.update()` 和 `Enemy.update()` 都被调用时，**状态效果每帧被更新两次**，导致中毒/流血伤害翻倍。

### 重构后调用链
```
Enemy.update() → DamageableEntity.update() → updateStatusEffects() + _updatePoison() + ...
CombatSystem.update() → 不再调用状态效果更新（只负责战斗：眩晕、攻击、武器动画）
```

---

## Dash 偏移计算（_getDashOffset 统一接口）

### 问题
`GameScene.js` 的 `_syncBodiesToPhysics` 中有一段 12 行的 switch 逻辑，用于根据 `_dashAngle` 或 `_dashStartFacing` 计算冲刺偏移量。这段逻辑在 `enemy-types.js`（BlackWolf）中也存在。

### 解决
在 `Enemy` 基类定义 `_getDashOffset()` 方法：
```javascript
_getDashOffset() {
    if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
    if (this._dashAngle !== undefined) {
        return {
            x: Math.cos(this._dashAngle) * this._attackDashOffset,
            y: Math.sin(this._dashAngle) * this._attackDashOffset
        };
    }
    switch (this._dashStartFacing || this._facing) {
        case 'right': return { x: this._attackDashOffset, y: 0 };
        case 'left':  return { x: -this._attackDashOffset, y: 0 };
        case 'down':  return { x: 0, y: this._attackDashOffset };
        case 'up':    return { x: 0, y: -this._attackDashOffset };
        default:      return { x: 0, y: 0 };
    }
}
```

`GameScene.js` 和 `enemy-types.js` 统一调用 `entity._getDashOffset()`，不再重复 switch 逻辑。

---

## 树木碰撞体优化（大怪物卡树问题）

### 问题
黑狼碰撞体积 38 虽然不大，但在树木（视觉半径 25，碰撞半径 25）间移动时仍会被卡住。因为 `canMoveTo` 判定的是 `tree.radius + entity.radius < distance`，视觉半径和碰撞半径未分离。

### 解决
1. **视觉半径和碰撞半径分离**：每棵树的 `collisionRadius = radius × 0.6`（主神空间树木从 25 降到 15）
2. **滑动回退**：`WallSystem.resolve()` 在标准 X/Y 轴滑动都失败后，尝试按 75%/50%/25% 步长找到可移动的最远位置，避免完全卡住

### 新增属性
```javascript
addTree(x, y, radius, ...) {
    const collisionRadius = radius * 0.6;  // 碰撞半径仅为视觉的60%
    // ...
}
```

所有使用 `t.radius` 的位置（`canMoveTo`、`blocked`、Phaser 同步）统一使用 `t.collisionRadius || t.radius * 0.6`。

---

## 常见陷阱：anim.timer === 0（死代码）

### 问题
`enemy.js` 和 `combat-system.js` 的 swing 阶段都有：
```javascript
if (anim.timer === 0 && this._pendingThrust) this._pendingThrust.active = true;
```

这条代码**永远不会触发**：`anim.timer += dt` 后 `dt > 0`，`anim.timer` 不可能为 0。

### 正确做法
`ThrustAttack.execute()` 在创建 `_pendingThrust` 时已经设置 `active = true`：`triggerWeaponAnim()` 没有覆盖 `_pendingThrust`，所以 `active` 始终保持 `true`，无需重新设置。

直接删除这条死代码即可。

---

## 常见陷阱：const 重复声明

### 问题
`shield-system.js` 的 `onDamageTaken` 方法中：
```javascript
const defense = shieldData.defense;  // 行53
// ... 弹反逻辑 ...
const defense = shieldData.defense;  // 行81 ← 重复声明！
```

在块级作用域中（`if` 块内部是 `const` 的作用域），同一个函数中两次 `const defense` 会导致语法错误。

### 解决
弹反逻辑中直接使用行53声明的 `defense` 变量，不再重复声明。或者在弹反块内部改声明为 `const defense = shieldData?.defense || {}`（如果外层 `defense` 不在作用域内）。

---

## 智能寻路系统（参考《环世界》PathManager）

### 设计目标
- **主动预规划**：看到目标时立即计算路径，而不是等卡住才反应
- **定期路径检查**：每 1.5-2.5 秒扫描路径节点，检测新障碍物
- **局部修复**：路径被阻挡时，在障碍物附近搜索替代路线，不重新计算整条路径
- **地形权重**：树木附近增加移动成本，让单位自然绕行

### 架构

```
Enemy
  └── _pathManager: PathManager 实例
        ├── path: {x,y}[]          // 当前路径
        ├── pathIdx: number        // 当前索引
        ├── checkInterval: 1500-2500ms  // 检查间隔（随机，避免同时检查）
        ├── checkTimer: number     // 计时器
        └── isValid: boolean       // 路径是否有效

PathManager
  ├── setPath(path)              // 设置新路径
  ├── update(dt, pathPlanner)   // 每帧：检查有效性
  ├── _checkValidity()         // 扫描路径节点，检测障碍物
  ├── _repairPath(blockedIdx)  // 局部修复（核心）
  ├── getCurrentWaypoint()     // 获取当前目标路径点
  ├── advanceWaypoint()        // 前进到下一个路径点
  └── forceRecalc()            // 强制重算路径

PathPlanner（增强的 PathFinder）
  ├── _getMoveCost(x, y, radius)   // 地形权重计算
  ├── isReachable()               // 区域连通性检查（Flood Fill）
  ├── _pathCache: Map             // 全局路径缓存（3秒有效期）
  └── findPath()                  // A* + 权重 + 缓存
```

### 局部修复算法（核心）

当 PathManager 检测到路径上的节点 `i` 被阻挡时：

1. **策略1：小范围局部搜索**
   - 取 `path[i-2]` 作为修复起点，`path[i+2]` 作为修复终点
   - 在起点和终点之间用 `findPath` 搜索替代路径（搜索范围自然受限）
   - 如果找到：拼接路径 = 前半段 + 替代段 + 后半段
   - 调整 `pathIdx`：如果当前索引在修复范围内，回退到修复起点

2. **策略2：从阻挡点到终点重新计算**
   - 如果策略1失败，从 `path[i-2]` 重新计算到终点的完整路径
   - 拼接：前半段 + 新路径（去掉起点）

3. **策略3：完全失败**
   - 连续 3 次修复失败，清除路径，让 MovementSystem 触发随机逃逸

### 地形权重

在 `PathFinder._buildGrid` 中，每个格子计算 `moveCost`：
- 普通地面：`1.0`
- 树木附近（碰撞半径 × 1.5 范围内）：`+0.5`（总计 1.5）
- 其他单位附近（碰撞半径 × 2.5 范围内）：`+0.3`（总计 1.3）

A* 中移动成本 = `baseMoveCost * terrainCost * gridSize`
- 直线：`1.0 * terrainCost * 40`
- 对角线：`1.414 * terrainCost * 40`

### 区域连通性检查

在 `findPath` 之前，先用 `isReachable` 做 Flood Fill：
- 从起点向 8 方向扩展，检查是否可达目标附近
- 如果不可达，直接返回 `null`，避免昂贵的 A* 计算
- 限制最大步数，防止 Flood Fill 无限扩散

### 路径缓存

- 全局缓存：`Map<key, {path, timestamp}>`
- 缓存 key：`量化起点 + 量化终点 + 碰撞半径`
- 量化：坐标取 `floor(x / gridSize) * gridSize`
- 有效期：3 秒
- 最大容量：50 条路径
- 墙壁变化时调用 `invalidateCache()` 清空缓存

### 使用方式

```javascript
// 1. 在 MovementSystem.update 中主动预规划
if (enemy._pathManager && dist > attackRange * 1.5) {
    if (!enemy._pathManager.hasValidPath()) {
        enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
    }
}

// 2. 每帧更新 PathManager（检查有效性 + 局部修复）
if (enemy._pathManager) {
    enemy._pathManager.update(dt, pathFinder);
}

// 3. 沿路径移动
if (enemy._pathManager.hasValidPath()) {
    const wp = enemy._pathManager.getCurrentWaypoint();
    // ... 向 wp 移动 ...
    if (距离 < 5) enemy._pathManager.advanceWaypoint();
}

// 4. 卡住时 fallback
if (enemy._pathManager) {
    enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
}
```

### 与旧系统的兼容性

- `enemy._path` 和 `enemy._pathIdx` 仍然保留，作为 fallback
- MovementSystem 优先使用 `enemy._pathManager`，没有 PathManager 时使用旧路径
- Enemy 的 `_updateMovement`（fallback 模式）也兼容 PathManager

### 为什么之前被动寻路不好？

旧系统只在卡住（500ms 移动 < 3px）时才触发寻路：
- 单位先撞墙 → 被卡住 → 检测卡住 → 计算路径 → 开始移动
- 这导致单位在撞墙后有明显的"停顿"感

新系统：
- 单位看到目标 → 立即计算路径 → 沿路径移动 → 遇到障碍物时 PathManager 自动修复
- 单位更流畅，不会明显撞墙

---

## 常见陷阱：isReachable 步数限制导致路径计算失败

### 问题
`PathFinder.isReachable()` 使用 Flood Fill 检查区域连通性，但步数限制太死：

```javascript
// 错误：步数 = ceil(maxDist / step) + 5
// 目标距离 383px，gridSize=40，步数 = ceil(383/40)+5 = 15
// 15 步 BFS 根本到不了目标，直接返回 false，A* 根本没跑
const maxSteps = Math.ceil(maxDist / step) + 5;
```

这导致黑狼被卡在树木边缘（距离=53，总阻挡=53）时，路径计算完全失败，单位没有路径，只能直线移动 → 撞墙卡住。

### 修复
```javascript
// 正确：步数 = ceil(maxDist / step) * 3 + 20
// 383px 距离 → 49 步，BFS 能正常探索到目标
const maxSteps = Math.ceil(maxDist / step) * 3 + 20;

// 步数用完也不返回 false，让 A* 继续尝试（A* 有 maxIterations 超时保护）
return true;
```

### 诊断方法
```javascript
// 检查单位附近障碍物
WallSystem.trees.forEach(t => {
    const d = Math.hypot(t.x - wolf.x, t.y - wolf.y);
    const treeR = t.collisionRadius || t.radius * 0.6;
    const inTree = d < treeR + wolf.collisionRadius;
    console.log(`树: 距离=${d}, 在树内=${inTree}`);
});

// 检查四周可移动方向
const dirs = [{x:10,y:0}, {x:-10,y:0}, {x:0,y:10}, {x:0,y:-10}];
dirs.forEach((p, i) => {
    console.log(`方向${i}: 可移动=${WallSystem.canMoveTo(wolf.x+p.x, wolf.y+p.y, wolf.collisionRadius)}`);
});
```

---

## 常见陷阱：四方向 facing 但仅有两方向精灵图时的翻转逻辑

### 问题
怪物只有侧面精灵图（原始面向右），但 facing 逻辑按移动方向分 4 方向（right/left/up/down）。当目标在左上方或左下方时：
- `|vy| > |vx|`，`_facing` 被设为 `up` 或 `down`
- `flipX` 逻辑只处理 `left`/`right`，`up`/`down` 不翻转
- 结果：sprite 始终面向右，但单位实际在向左移动 → 视觉方向与运动方向相反

### 基础修复（v1.6）
`up`/`down` 时，根据 `vx` 符号判断水平运动方向来决定是否翻转：

```javascript
// _getPhaserOptions（Phaser 渲染）
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图，根据 vx 判断水平方向
    flipX = this.vx < 0;
}

// _drawBody（Canvas 渲染）
const shouldFlip = this._facing === 'left' ||
    ((this._facing === 'up' || this._facing === 'down') && this.vx < 0);
if (shouldFlip) ctx.scale(-1, 1);
```

### 优化修复（v1.7）
基础修复有两个问题：
1. **攻击期间**：`_facing` 锁定为 `_dashStartFacing`，但 `up`/`down` 时的 flip 仍依赖 `vx`（攻击前的速度），而非实际冲刺方向 `_dashAngle`
2. **纯垂直移动/idle**：`vx = 0` 时 `flipX = false`，狼永远朝右，无法保持之前的水平朝向

**优化方案**：
- 新增 `_lastHorizontalFacing` 属性，在每次 `_facing` 更新为 `left`/`right` 时保存
- `up`/`down` 时的 flip 优先级：攻击期间用 `_dashAngle` → 移动期间用 `vx` → 静止/纯垂直用 `_lastHorizontalFacing`

```javascript
// 构造函数初始化
this._lastHorizontalFacing = 'right';

// update() 中保存水平朝向
if (this._facing === 'left' || this._facing === 'right') {
    this._lastHorizontalFacing = this._facing;
}

// _getPhaserOptions / _drawBody 中的 flip 逻辑
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图
    if (this._attackTimer > 0 && this._dashAngle !== undefined) {
        // 攻击期间使用冲刺方向决定水平朝向
        flipX = Math.cos(this._dashAngle) < 0;
    } else if (Math.abs(this.vx) > 0.1) {
        flipX = this.vx < 0;
    } else {
        // 纯垂直移动/idle：保持上次水平朝向
        flipX = this._lastHorizontalFacing === 'left';
    }
}
```

---

## 交互式开发工具（DevTool）与攻击动画插帧系统

> 阅读 `src/ui/dev-tool.js`、`src/combat/weapon-transform.js`、`src/entities/player/weapon-anim.js`、`src/items/weapon-anim-config.js`、`src/phaser/scenes/GameScene.js` 后的结构梳理。

### 一、DevTool 整体结构

`src/ui/dev-tool.js` 是一个基于 Canvas 2D 的独立调试面板，与 Phaser 游戏循环解耦，用于武器/动画参数的可视化与持久化。

**核心状态：**
```js
state: { anim, weaponType, frameIndex, playProgress, isPlaying }
weaponParams: { offsetX, offsetY, rotation, scale }
keyframeSystem: { enabled, keyframes, selectedIndex, isRecording }
handAnchorSystem: { enabled, handAnchors: { idle/walk/running/attack }, gripOffset }
```

**四大子系统：**
1. **武器定位面板**：调整 `offsetX/Y`、`rotation`、`scale`，实时预览武器相对角色的位置。
2. **关键帧录制面板**：录制并编辑关键帧，每帧包含 `progress`、`holdOffsetX/Y`、`rotation`、`scale`。
3. **手部挂载点面板**：按 `idle/walk/running/attack` 编辑手部锚点 `handAnchors`，配合 `gripOffset` 让武器跟随手部。
4. **动画/贴图/AI 调试面板**：加载四方向精灵图、逐帧播放、调试敌人贴图与 AI。

**关键方法：**
- `_loadCharacterFrames()`：加载 idle/walk/running/attack 精灵图。
- `_getPerFrameTransform()` / `_getRuntimeKeyframeTransform()`：按进度插值逐帧配置或运行时关键帧。
- `_buildPreviewOverrides()`：把面板中的调整打包成 `WeaponTransform` 可消费的参数。
- `_save()`：写回 `WeaponAnimConfig`，并通过 `window.electronAPI.saveWeaponConfig` 持久化到 `public/data/weapon-anim-config.json`。
- `_draw()`：用 `WeaponTransform` 在 Canvas 上绘制角色、武器与轨迹。

### 二、攻击动画插帧的两条技术路径

#### 路径 A：关键帧系统（Keyframes）
- **配置位置**：`WeaponAnimConfig[weaponType].attack.keyframes`（少量关键帧）。
- **结构**：`{ progress, holdOffsetX/Y, rotation, scale }`（兼容 `handOffsetX/Y`、`offsetX/Y`）。
- **插值**：线性插值。
  - `dev-tool.js`：`_getRuntimeKeyframeTransform()` 负责编辑时预览插值。
  - `weapon-anim.js`：`_playSwordAttackTween()` 在 Tween `onUpdate` 中按 progress 找相邻关键帧并插值，然后调用 `WeaponTransform.getKeyframedWeaponPosition()`。
- **适用**：攻击动作有明确阶段（起手 / 挥击 / 收回），需要程序化控制武器轨迹。

#### 路径 B：逐帧系统（Per-Frame）
- **配置位置**：`WeaponAnimConfig[weaponType].attack.frames`。
- **结构**：`{ offsetX, offsetY, rotation, scale }` 数组，每帧对应攻击动画的一帧。
- **插值**：按 `playProgress` 在相邻两帧之间做线性插值。
  - `weapon-transform.js`：`getInterpolatedPerFramePosition()` 用 `_lerpPerFrame1D/2D` 插值。
  - `weapon-anim.js`：检测到 `attack.type === 'perFrame'` 后，Tween 只驱动 progress；武器 Sprite 的位置/旋转/缩放由 `GameScene.syncWeapon()` 按当前动画帧同步，Tween 只负责命中判定窗口与状态重置。
- **适用**：美术已做出完整攻击动画序列，想让武器完全贴合每帧画面。

| 维度 | 关键帧系统 | 逐帧系统 |
|---|---|---|
| 配置量 | 少（几个关键帧） | 多（每帧一个配置） |
| 插值驱动 | `weapon-anim.js` Tween 直接计算并更新 Sprite | Tween 只提供 progress，`GameScene.syncWeapon` 按帧读取 |
| 与美术动画关系 | 程序控制轨迹，与美术动画解耦 | 与美术动画逐帧绑定 |
| 缓动 | 当前实现为 Linear（可扩展） | Linear |

### 三、坐标变换链

```
dev-tool 调整参数
    ↓
保存为 WeaponAnimConfig[weapon].attack / handAnchors / gripOffset
    ↓
WeaponTransform.getKeyframedWeaponPosition() / getInterpolatedPerFramePosition()
    ↓
GameScene.syncWeapon() / weapon-anim.js Tween
    ↓
Phaser Sprite.x / y / rotation / scale
```

**镜像处理：**
- 玩家朝左时，`facingRight = false`。
- `WeaponTransform` 内部把本地 X 坐标取反，并把旋转角度处理为 `Math.PI - rotation`。
- **不**对武器 Sprite 直接使用 `setFlipX`，避免旋转中心错乱。

**手部挂载链：**
- `handAnchors[state]`：手部在角色本地空间的位置。
- `gripOffset`：武器握把点到武器原点的偏移。
- 最终武器世界位置 ≈ 角色世界位置 + 手部锚点 + 当前帧武器偏移 + 握把修正。

### 四、玩家攻击动画驱动流程

1. 输入触发：`triggerWeaponAnim('main')`。
2. 状态机进入 `swing`。
3. 剑类武器调用 `_playSwordAttackTween()`：
   - 若 `attack.type === 'perFrame'`：Tween 驱动 progress，`syncWeapon()` 逐帧同步。
   - 若存在关键帧：Tween `onUpdate` 直接插值并更新 Sprite。
   - 否则走默认 windup/swing/recover 路径。
4. `onStart` 激活 `_pendingThrust`，在攻击前 500ms 内做命中判定。
5. `onComplete` 结束攻击状态、给经验、武器回到 idle 位置。

### 五、与怪物攻击动画的对比

- **玩家**：由 `weapon-anim.js` Tween + `WeaponAnimConfig` 精确控制武器 Sprite 的位移/旋转/缩放。
- **怪物（如 ZombieDogEnemy）**：仅覆盖 `triggerWeaponAnim()` 设置 `_attackTimer`，用 `_animState = 'attack'` 驱动纹理/帧切换；攻击判定由 `ThrustAttack` 的矩形/动态距离判定处理，**没有**类似玩家的武器 Sprite 插帧系统。

### 六、后续扩展方向

如需为怪物引入攻击动画插帧（例如让 ZombieDog 的爪击也使用逐帧动画）：
1. 在 `enemy-config.json` / `enemy-types.js` 中为怪物增加攻击动画资源引用。
2. 在 `WeaponAnimConfig` 中新增怪物武器/爪击配置，或复用 `perFrame` 结构。
3. 在 `_syncEnemyAnimation()` 中根据 `_animState === 'attack'` 播放对应 spritesheet。
4. 让 `ZombieDogEnemy.triggerWeaponAnim()` 不只是一个 timer，而是真正驱动一帧一帧的动画 progress。

---

## 变更记录

- v1.9 (2026-07-07) — 攻击系统修复（Phaser 4 Tween API 兼容性）
  - 修复 `scene.tweens.createTimeline()` 在 Phaser 4 中不存在的问题，改用 `scene.tweens.chain()` 链式 Tween
  - 添加 `initWeaponAnim()` 调用初始化 `_activeAttackTweens` 数组，修复 `Cannot read properties of undefined (reading 'push')` 错误
  - 延长近战攻击判定时间从 200ms 到 500ms，覆盖 windup + swing 完整阶段
  - 修复 Tween 回调 `this` 绑定问题，使用 `self` 变量替代箭头函数中的 `this`
  - 远程武器在 `triggerAttackAnimation` 中调用 `_fireRanged()` 发射子弹，修复远程攻击无法开枪问题
  - 近战和远程攻击现在都能正常工作

- v1.12 (2026-07-11) — 地牢地图居中显示修复：
  - **问题**：`_centerRouteMap`、`_generateDefaultMap`、`_generateZombieMap` 使用硬编码 `TARGET_AREA = { left: 260, top: 94, width: 1425, height: 724 }`，导致地图位置固定，不随窗口大小变化
  - **修复**：改用 `window.innerWidth` 和 `window.innerHeight` 动态计算地图显示区域，水平垂直均居中显示，留出 `marginX=280`/`marginY=120` 边距给侧边栏
  - **注意**：`CONFIG.VIEW_WIDTH/HEIGHT` 保持固定 1920x1080（用户要求固定像素），但地图居中使用实际窗口尺寸
  - **文件**：`src/world/dungeon-map-system.js`

- v1.11 (2026-07-10) — 修复所有枪械无法开火的问题：
  - **根因**：`data/equipment.json` 中 PKM/AKM/QBZ191/QJB201/Super90/SAIGA-12K 等武器缺少 `ammoConfig`、`fireMode`、`attackFormula`、`attackKey` 等关键字段
  - **修复**：在 `main.js` 中添加 `EquipDataManager` 到 `ItemDatabase` 的字段合并逻辑，确保所有武器配置完整
  - **同步**：更新 `public/data/equipment.json` 到最新版本（Vite 开发服务器优先从 `public/` 提供静态文件）
  - **验证**：所有枪械（手枪、步枪、机枪、霰弹枪）均可正常开火，弹药系统工作正常

- v1.10 (2026-07-10) — 武器位置固定与镜像系统：
  - **需求**：近战武器（剑/弓）在 running 动画时固定位置，不随鼠标旋转；朝左时自动镜像
  - **实现**：
    - `WeaponTransform.getWeaponWorldPosition()`：running 的近战武器使用固定 rotation（0），其他情况使用 `player.rotation`
    - `WeaponTransform.localToWorld()`：running 的近战武器朝左时镜像位置（`x = player.x - (x - player.x)`）
    - `WeaponTransform.getWeaponRotation()`：running 的近战武器朝左时调转 idleRotation（`Math.PI - idleRot`），远程武器使用 `player.rotation`
  - **关键**：`setFlipX` 不适用于武器 Sprite，因为位置已经镜像，贴图翻转会导致双重翻转。改用旋转镜像（`Math.PI - idleRot`）来调转方向
  - **远程武器还原**：枪械类使用 `player.rotation` 计算旋转，保持跟随鼠标方向，不受镜像影响

- v1.8 (2026-07-06) — 红狼王变身机制：
  - **触发条件**：HP < 50%（配置 `transform.hpThreshold: 0.5`）
  - **变身动画**：`redwolfchange.png` 16帧（4×4），3秒内播放完毕（`transform.duration: 3000ms`）
  - **变身期间**：无法移动（`vx=vy=0`）、无法攻击（`triggerWeaponAnim` 直接返回）
  - **变身后效果**：HP 完全恢复（`transform.hpRecover: 1`），攻击力翻倍（`transform.damageMultiplier: 2`）
  - **变身后精灵图**：待机 `redwolfidle.png`（4帧）、奔跑 `2026-07-05-22_57_41.png`（16帧）
  - **实现位置**：`enemy-types.js` RedWolfKing 类新增 `_isTransforming`/`_isTransformed`/`_transformTriggered` 状态，`_getTextureKey`/`_drawBody`/`_getPhaserOptions` 支持变身状态，`_updateAIState` 变身期间不执行，`_executeAI` 变身期间不执行
  - **配置位置**：`enemy-config.json` `redWolfKing.transform` 对象
  - **资源加载**：`BootScene.js` 新增 `enemy_red_wolf_king_change`、`enemy_red_wolf_king_changed_run`、`enemy_red_wolf_king_changed_idle` 三个 spritesheet
  
- v1.7 (2026-07-06) — 优化精灵图朝向翻转：
  - 新增 `_lastHorizontalFacing` 保存机制，解决纯垂直移动/idle时狼永远朝右的问题
  - 攻击期间 `up`/`down` 状态的 flip 改用 `_dashAngle` 而非 `vx`，确保冲刺方向与视觉一致
  - 同步应用到 BlackWolf 和 RedWolfKing
  
- v1.6 (2026-07-06) — 修复黑狼 facing 翻转：四方向 facing 但仅有两方向精灵图时，`up`/`down` 状态下根据 `vx` 符号判断水平方向，确保 sprite 翻转与运动方向一致。修改 `enemy-types.js` 的 `_getPhaserOptions`（flipX）和 `_drawBody`（ctx.scale）

- v1.5 (2026-07-05) — 智能寻路系统（参考《环世界》）：预规划 + 定期路径检查 + 局部修复
  - 新建 `src/ai/path-manager.js`：路径缓存 + 每 1.5-2.5 秒有效性检查 + 局部修复（障碍物附近搜索替代路线）
  - 增强 `src/ai/pathfinder.js`：地形权重（树木 1.5x，拥挤 1.3x）、区域连通性检查（Flood Fill）、全局路径缓存
  - **修复**：`isReachable` Flood Fill 步数限制过死（`ceil(maxDist/step)+5` → `ceil(maxDist/step)*3+20`），导致路径计算完全失败，单位卡在树木边缘无法移动
  - 修改 `src/systems/movement-system.js`：主动预规划（有目标无路径时立即计算）+ PathManager 集成
  - 修改 `src/entities/enemy.js`：fallback `_updateMovement` 兼容 PathManager

- v1.4 (2026-07-05) — 硬编码清理：状态效果统一化、树木碰撞体优化、dash 偏移统一
  - DamageableEntity 基类新增 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`，4种状态效果统一在基类 `update()` 中驱动
  - Enemy 构造函数删除 15 行冗余属性初始化（已在 Combatant 中初始化）
  - `combat-system.js` 删除 85 行重复状态效果代码 + 1 处死代码 `anim.timer === 0`
  - GameScene.js dash 偏移逻辑统一：使用 `entity._getDashOffset()` 替代 inline switch 逻辑
  - wall-system.js 树木碰撞体优化：视觉半径和碰撞半径分离（collisionRadius = radius × 0.6），resolve() 添加逐步缩减步长回退
  - shield-system.js 修复 `const defense` 重复声明语法错误
  - 黑狼碰撞体积从 88 缩小到 38

- v1.3 (2026-07-05) — 增加 Sprite Pipeline 标准化流程，新增 `sprite-normalizer.py` 工具
- v1.2 (2026-07-05) — 怪物渲染模板系统，提取 `Enemy.render()` 通用模板 + 7个钩子方法
- v1.1 (2026-07-04) — 怪物统一配置（enemy-config.json），删除双系统

- v2.0 (2026-07-13) — 3D 碰撞/命中体系 Phase 3：近战与技能 AOE 3D 化
  - 统一技能命中形状：`src/physics/skill-shapes.js` 新增 `GroundCircle` / `GroundRect` / `VerticalSector` / `VerticalRect` / `Sphere`
  - 所有形状通过 `entity.collider` 做 3D（Z 轴高度 + footprint 半径）检测，地面 AOЕ 不再命中飞行单位
  - `SlashAttack` 扇形改为 `VerticalSector`，`ThrustAttack` 矩形改为 `VerticalRect`（支持后摆 backExtension）
  - 技能系统全部迁移：
    - 旋风 `whirlwind-system.js` → `GroundCircle`
    - 火球爆炸/直接命中 `fireball-system.js` → `GroundCircle`
    - 推击 `push-strike-system.js` → `VerticalSector`
    - 夜与火之光束 `special-attack-system.js` → `VerticalRect`
    - 冰锥 `ice-spike-system.js` → `GroundCircle`
    - 无人机 `drone-system.js` → `GroundCircle`
    - 符文剑 `rune-sword-system.js` → `GroundCircle`
    - 冲刺攻击-扇形/突刺 `dash-system.js` → `VerticalSector` / `VerticalRect`
    - 胖子僵尸腐蚀光环 `fat-zombie.js` → `GroundRect`
  - 近战判定复用 `SpatialPartitionSystem.queryRadius` 做 broadphase
  - 验证：`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过

- v2.1 (2026-07-13) — 3D 碰撞/命中体系 Phase 4：动态实体 Y-sort 深度排序
  - 在 `GameScene.update` 中 `_syncBodiesToPhysics()` 后新增 `_updateDynamicDepths()`，每帧统一刷新玩家/敌人/武器/特效深度
  - 玩家与敌人 Sprite 深度基于脚底 Y（`y + displayHeight/2 + bias`），与环境墙壁/树木（`w.y + w.h`、`t.sortY`）使用同一坐标空间
  - 尸体使用较低 bias（+2），存活实体 +10，保持尸体被站立角色遮挡的透视关系
  - 手持武器、盾牌、副手武器跟随玩家深度 + 小偏移，保证武器始终与角色正确分层
  - 防御光环位于玩家深度下方；符文剑/冰锥/火球/飞行投射物/无人机等技能特效按自身 `y + 15` 排序
  - 其他施法者（敌人巫师）的 `_magicSprites` 也纳入同一排序
  - 受击绿色粒子深度改为 `y + 1000`，继续高于普通实体
  - 移除 `GameScene` 中所有硬编码的 `setDepth(50/100/148/149/150/155/160/165)`，避免与动态排序冲突
  - 验证：`npm run lint`、`npx vite build` 通过

- v2.2 (2026-07-13) — 3D 碰撞/命中体系 Phase 5：清理旧命中系统与可视化对齐
  - 删除 legacy `src/components/hitbox.js`（`HexHitbox`）和 `src/combat/hit-detector.js`（`HitDetector`）
  - `src/entities/entity.js` 移除 `hitbox` 字段、`initHitbox` 方法、`getCollisionShape` 六边形分支
  - `src/entities/player/update.js` 移除每帧同步 `hitbox` 的代码
  - `src/utils/collision-helpers.js` 精简为仅保留 `distanceToEntityShape`，内部改用统一 `Collider.groundRadius`
  - `src/entities/enemy-types/mutant-3.js` 攻击范围判定改用 `target.groundRadius`，移除旧矩形/圆形分支
  - `src/effects/attack-range-effect.js` 新增 `backExtension` 参数，支持绘制带后摆的定向矩形
  - `src/entities/components/dash-system.js` 冲刺-突刺范围提示从扇形改为矩形（`triangle` + `backExtension`），与 `VerticalRect` 命中形状一致
  - 验证：`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过

- v2.3 (2026-07-13) — 全 Phase 0-5 回顾检查与 bug 修复
  - **严重问题修复：**
    1. `src/entities/components/rune-sword-system.js`：命中条件被逻辑取反（`!intersectsEntity`），导致符文剑命中范围外目标、范围内目标反而无伤。已修正为 `intersectsEntity` 命中。
    2. `src/systems/spatial-partition-system.js`：
       - `queryRadius` 等返回内部复用数组，并发查询会篡改遍历结果；现每次返回 `.slice(0)` 副本。
       - `maxQueryResults: 64` 在密集场景会静默截断命中目标；已提升至 `2048`。
    3. `src/entities/drop-item.js`：掉落物未排除在实体碰撞分离外，会挤开玩家/敌人；已设置 `this.noCollision = true`。
    4. `src/entities/damageable-entity.js`：子类在 `super()` 后才设置 `size/collisionRadius`，导致 `Collider` 仍是默认半径；已在构造函数末尾调用 `this.rebuildCollider()`。
    5. `src/phaser/scenes/GameScene.js::_configureEnemyBody`：曾把敌人 `collisionWidth/Height` 覆盖为 `spriteSize`（`size*4`），导致 footprint 被放大数倍；现优先保留配置/选项中的 gameplay 尺寸，fallback 使用 `collisionRadius/size` 推导。
  - **深度排序统一：**
    - `src/phaser/scenes/GameScene.js::_syncNeutralEntities` 不再硬编码 `e.y`，改由 `_updateDynamicDepths()` 统一按脚底 Y + 10 排序。
    - `src/combat/projectile.js` 投射物深度从 `this.y` 改为 `this.y + 12`。
    - `src/entities/drop-item.js`、`src/entities/dungeon-chest.js` 掉落物/宝箱深度改为 `y + 5/+6`。
    - `src/phaser/scenes/GameScene.js::_syncCollisionRadii` 调试可视化改为统一画 `groundRadius` 圆，移除矩形分支。
  - **其他修正：**
    - `src/entities/components/special-attack-system.js`：移除 `update()` 中每帧创建范围提示的代码，避免夜与火之剑持续期间堆积特效。
    - `src/combat/attack.js`：`SlashAttack` / `ThrustAttack` 非法角度检查移到消耗体力/CD 之前，避免无意义消耗。
    - `src/entities/components/dash-system.js`：修复变量遮蔽、移除冗余 `hitIndex === 0` 判断。
    - `src/entities/enemy-types/mutant-3.js`：`_spawnBloodMist` 临时精灵深度改为 `y + 10`。
    - `src/physics/index.js`：移除未使用的 `SpatialGrid` 导出（文件保留供测试直接引用）。
  - **验证：** `npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过。

- v2.4 (2026-07-13) — 可移动实体脚底阴影
  - `GameScene` 新增 `entity_shadow` 纹理与 `_shadowSprites` 映射表
  - 新增 `_syncEntityShadows()`，每帧为玩家、敌人、中立实体在脚下生成黑色圆影
  - 阴影半径匹配统一 `Collider.groundRadius`，深度低于实体（`entityDepth - 1`），透明度 0.35
  - 地图模式下自动隐藏所有阴影
  - 阴影随实体移除自动销毁，避免内存泄漏
  - 验证：`npm run lint`、`npx vite build` 通过

- v2.5 (2026-07-17) — 普通僵尸精灵图接入 + 攻击线性突进
  - `assets/enemies/zombie/`：idle 1 帧 / walking 15 帧 / attacking 15 帧，8×4 网格 512×512，素材经 `scripts/archive/prepare-zombie-sprites.py` 统一内容高度（~440px）并对齐底部，与既有僵尸素材比例一致
  - 新建 `src/entities/enemy-types/zombie.js`：`Zombie` 类仿 fat-zombie 模式，攻击动画 1s、间隔 2s（attack.cooldown 2000）、判定距离 100px（attackDistance），显式 `animKey: enemy_zombie_${state}`
  - `enemy.js` 基类新增**配置驱动线性突进**（`attack.lungeDistance`，僵尸配 100）：`triggerWeaponAnim` 锁定突进方向，`_updateLunge` 按攻击计时线性推进，增量式位移 + 每帧 `WallSystem.resolve` 撞墙校验；任何怪物配置后全场景生效
  - 地牢 `createBasicZombie` 从 `CircleEnemy` 圆形占位改用 `Zombie` 类；主神空间 `spawnMainZombie()` 生成测试僵尸
  - 验证：lint / build / test-collider 全部通过
- v2.6 (2026-07-17) — 投射物躯干矩形判定（方案 B）
  - 新建 `src/physics/torso-hitbox.js` 共享模块（详见上方"补充：投射物躯干矩形判定"小节）
  - `projectile.js`：地面目标命中 = footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱
  - 冰锥/火球/符文剑飞行命中接入；爆炸 AOE 与近战判定不变
  - 7 只精灵图怪物写入实测 `render.projectileHitbox`；GameScene 绿色调试矩形
  - 验证：22 个躯干单测全过、lint / build 通过

- v2.7 (2026-07-17) — 战斗/视觉六项调整 + 弹反修复 + 掉落物更新
  - **近战判定地面化**：`skill-shapes.js` 新增 `GroundSector` / `GroundDirectedRect`（只看 footprint、不查 Z、飞行免疫）；`attack.js` 斩击/突刺判定原点归回攻击者脚底（移除 footOffsetY 上移），范围可视化同步；推击/夜与火/冲刺/mutant-3 未动
  - **枪械精准对准**：`syncWeapon` 远程武器贴图旋转改为 `atan2(鼠标世界 − 武器位置)`（主手+副手），消除"脚底→鼠标"枢轴视差导致的固定角度偏移；弹道原本即朝准心，改后贴图=弹道=准心三者一致
  - **玩家 footprint 缩小 25%**：`player-defaults.js` collisionRadius 30→22.5；`Entity.groundRadius` 注释为阴影/footprint/分离/命中判定唯一来源（强绑定，阴影随动缩小）
  - **胖子僵尸攻击位移取消**：`_updateLeanOffset` 攻击分支归 0，攻击时阴影/footprint 不再前移（walk 前倾保留）
  - **僵尸受击粒子**：锚点从脚底改为贴图中心（y − footOffsetY），保留朝源侧偏
  - **枪械蛋壳**：从武器贴图中心弹出，向上抛起后受重力（1000）落至脚下；`shell-casing.js` 新增可选 groundY 参数
  - **地牢刷怪特效**：`playDungeonSpawnParticles`——纯黑、更慢、1.5s、数量+30%，NORMAL 混合（黑色在 ADD 下不可见）；`combat-room-system.spawnMonsters` 逐怪脚下触发
  - **删除金属/奔跑僵尸**：enemy-config 删 armoredZombie/runnerZombie/fastZombie，zombie-dungeon 工厂+映射级联清理，图鉴自动同步
  - **弹反修复（数据缺陷）**：根因非碰撞系统——`旧木盾`装备条目缺 `weaponType: 'shield'` + 整个 `defense` 块，`checkEquipped()` 永远 false 致盾系统不激活；已补全（数值与小圆盾一致，弹反属性未改），双份 equipment.json 同步。**教训**：系统逻辑完好的"功能失效"优先查数据/配置完整性
  - **掉落物**：贴图×1.5（48/悬停60）保持浮动，装备文字固定不浮动；悬停拾取 35→52、Z 键范围 75→112、pickupRange 30→45 匹配
  - **遗留未决**：复活后子弹不从枪口射出——两条死亡路径实测枪口均完好，未复现，待具体场景线索
  - 验证：35 个单测全过（含 13 个地面形状用例）、lint / build 通过

- v2.8 (2026-07-17) — 配置链路修复/实体生命周期/事件背景图/技能经验（五轮合并）
  - **战斗与判定**
    - 近战普攻输入锁：攻击动画未播完（`weaponAnim.state === 'attacking'`）忽略左键，不重播动画、不产生新判定（`player/update.js`；三条近战 Tween 路径均以 attacking 贯穿全程）
    - 胖子僵尸 `attackDistance: 100` 真正生效：`enemy.js` 构造函数补 `attackDistance` 映射——此前 config→实例断链，所有敌人 attackDistance 均为死配置，CombatSystem 实际按 attackRange×1.15 触发
    - footprint 配置优先：`GameScene._configureEnemyBody` 不再无条件用矩形推导覆盖 `collisionRadius`（仅未配置时回退）；毒液 45→7.07（面积-50% 落地）、巫师 45→20、普通僵尸 25→15、突变体3 45→20；spitter/wizard 的 `_getPhaserOptions` 硬编码 30×90 改读 `config.render`
    - HP 调整：僵尸犬 100/僵尸 120/毒液 120/巫师 600（enemy-config.json 单源，地牢工厂/图鉴自动同步）
  - **实体生命周期（重要模式）**
    - `Game.removeEntity(key)`：删除实体前必销毁 `_phaserSprite`/`_phaserLabel`——统一入口，所有清理循环（combat-room/dungeon-map/boss-reward）走这里，杜绝孤儿贴图残留
    - `Game.isPreservedCorpse(e)`：存活尸体（`_preserveCorpse` 且计时器未走完）在波次/房间清理中**跳过删除**——胖子僵尸尸体保留在地面持续腐蚀，只会因持续时间到而消失（7.5s 自毁贴图、8s 扫描移除）
    - **教训**：实体删除 = 贴图销毁 + 尸体豁免，二者都必须经统一入口；贴图孤儿化是"贴图残留"类 bug 的统一根因
  - **场景共享状态陷阱（地牢枪口不同步根因）**
    - 地图模式 `weaponSprite.setActive(false)` 后全代码无任何恢复 → `_getMuzzleWorldPosition` 的 active 守卫失败 → 回退脚底相对算法（主神空间不进地图模式故正常）
    - 修复：非地图模式分支统一 `setActive(true)`（与 playerSprite 同模式）+ 守卫放宽不查 active；**教训**：修改必须落在共享链路上全场景生效（工作规则 原则10/规则5）
  - **地牢视觉**
    - 地板：blackbrick 三张 512×512 覆盖替换（旧 256 图删除）；切割 32×32 小砖（候选池 768）、8 随机朝向（4 旋转×翻转）、均匀概率、相邻不同块、圆角 4px、四边内缩 1px 留 2px 纯黑缝隙、外圈 64px 黑渐变不变
    - 事件背景图：15 事件（10 新 + 5 旧）全覆盖，`assets/scenes/dungeon-events/` 英文命名，`EVENT_BG_IMAGES` 配置映射；`cover` 等比铺满、bottom:0 固定像素；事件/结果面板 `left/right/bottom/height` 固定像素全宽拉伸（2K 不再半宽）；选择副标题简化为 `检定X-成功率Y%`
  - **技能经验修复（两个断点，均沿数据链排查）**
    - 断点1：`DataLoader.buildSkillFromJSON` 漏拷 `expRewards` → 全技能经验恒 0
    - 断点2：运行时 `fetch('/data/skills.json')` 实际由 Vite 提供 `public/data/skills.json`（过期副本：11 技能、无 expRewards、缺 6 技能）→ 已双份同步；**教训**：skills.json 与 equipment.json 同为 `data/ ↔ public/data/` 双份副本，改数据必须双同步（规则2 钩稽链路）
  - **玩家数值**：升级经验 `globalMultiplier` 2→4（翻倍，combat-formulas.json）；升级回满 HP/MP（gainExp 循环内）
  - 验证：lint / build / test-collider 全部通过

- v2.9 (2026-07-17) — 集合体首领/僵尸地牢-初级/三系统审查修复（多轮合并）
  - **集合体（amalgamZombie，boss rank 首领）**
    - 素材 `assets/enemies/amalgam/`（`scripts/archive/prepare-amalgam-sprites.py` 统一内容 480px、底部对齐 496）；新类 `src/entities/enemy-types/amalgam-zombie.js`：站桩 Boss，投掷（落点红色椭圆警示+范围伤害+生成胖子僵尸）、砸地（分圈结算 100/200/500px×1.2/0.7/0.2，取最小圈不叠加）、15s 召唤 2 僵尸、melting 死亡
    - **站桩锁死五通道**：speed 0 显式生效、`noSeparation`（resolveCollisions 中对方承担全部位移）、`applyKnockback` 空覆盖、`_tryUnstuck` 跳过 speed 0 单位、出生点锚点钉死
    - **falsy-0 根因（重要教训）**：移动代码 `maxSpeed || speed || 100` 把显式 0 误回退 100 → 全库改 `??`（空值合并）。**数值回退必须用 ?? 不用 ||**
    - BOSS 战重构：集合体替代大块头（删 BigBoss ~530 行）；arena 1024（玩家下方中心上移 300/boss 上方中心镜像）；地板抽共享模块 `dungeon-floor-texture.js`；BOSS 场地尺寸改读 `combatRoom.bossSize` 配置
    - 主神空间 `spawnMainAmalgam` 测试生成；召唤/投掷生成工厂注入（避免实体层反向依赖 world 层）
  - **僵尸地牢-初级（第二个地牢）**
    - 配置驱动：`data/dungeon-config.json` 新增 `dungeonList`（出征展示元数据）+ `zombieDungeonBeginner`（22 节点/最短 7/起始 3 分支/mainRowMinCombat 3/战斗 40%/精英 0%/bossEncounter 精英遭遇独立副本）
    - 生成器按类型读配置；`mainRowMinCombat` 主通道随机 N 列强制战斗（缺省=全部，向后兼容）；**修正：第 1 列强制全行移到节点数调整之前，且调整候选排除第 1 列**（否则总数超区间/分支数不恒定）
    - `_enterBoss` 对 zombieBeginner 走 `_enterBossCombat`（bossEncounter+普通波次流程，完成→奖励节点→胜利）；`_isZombieFamily()` 共享僵尸战斗体系；出征界面选项/信息面板改由 dungeonList 驱动
  - **地牢审查修复**
    - Boss 完成回调被 cleanup 清空（先取回调再 cleanup）；Boss 战死亡 active 卡死（shutdown 强制 BossRewardSystem.cleanup + cleanupRoom）；宝箱材料 `rewards || items || []` 键兼容；召唤泄漏按 key 前缀兜底（`Game.removeEntitiesByPrefix`，zombieDog_/amalgam_）
    - 中优先级：reward 状态拦截实体更新、波次暂停顺延、商店轮询句柄清理、`_returnToMap` active 守卫、`_checkBossDefeated` 不再把 null 当战胜、补给堆药水=瓶数×单瓶恢复量（POTION_HEAL/MP 导出）、事件结果按钮 300ms 延迟激活防双击穿透、负金币扣除钳制持有量
    - 低优先级：工厂 fallback HP 同步/召唤工厂注入、BOSS 清理恢复地形/树木/世界尺寸+syncTerrain、BOSS 墙 height 60、退出按钮绘制/热区统一、`_entityHudTexts` role 字段、`_onEnemySpawn` rebuildCollider 守卫、iconMap 补 materials、isActive 复位、`_calculateSpawnArea` margin 生效
  - **附魔/改造/强化审查修复**
    - 附魔：`EnchantSystem.init()` 接入 main.js（拖拽放回生效）；魔法粉尘名称统一（MagicDustItem.name=魔法粉尘，匹配点引用模板名）；沉重减速 `_applyEnchantAttackInterval` 统一钩子（空手恢复全部基础冷却，装备/卸下/写回全路径）
    - 改造：穿甲 `armorPenetrationPercent` 补收集写入（生产端断链修复）；G18 weapon9 配置复制移到 weapon10 完整赋值之后；`_getCraftConfig` 无配置返回 null（不再回退 PKM，UI 显示"该武器不可改造"）；同 id 配件不再白扣 4 券；拖入装备栏立即 `_initAmmoForSlot`；registry 补 staminaCostDelta/skillStaminaCostDelta/dashDoubleHit；tooltip 弹夹 magazineOverride 优先
    - 强化：删除改写 `item.stats` 的平方级污染块（无 formula 武器回退读 stats 作 base 曾实战虚高）；强化石先扣金币后消耗；**数值决策**：getAttackFormula 回退 `enhanceFlat: 1`（无 formula 武器强化+1/级）、`expValue` 增 `eliteMultiplier: 2 / bossMultiplier: 10`（boss 经验配置化）、盾牌 `defense.base + perEnhance × 强化等级` 计入玩家 def（防具强化真生效）
  - **事件背景图**：15 张 3072×2048 → 1920×1280 瘦身（93MB→45MB），cover 铺满
  - 验证：lint / build / test-collider 全部通过

- v3.0 (2026-07-17) — 集合体打磨/判定根因系列/召唤物体系（多轮合并）
  - **判定与碰撞根因系列（重要教训沉淀）**
    - `Enemy._updateMovement` 的 `maxSpeed || speed || 100` 把显式 0 误回退 100 → **数值回退必须用 `??` 不用 `||`**（全库 9 处已改）
    - 警示圈/特效残留统一根因：`active=false` 只是逻辑标记，**Phaser graphics 必须显式 destroy**（EffectManager 移除后不会再触发延迟销毁）
    - `resolveCollisions` 曾用实体坐标+世界圆 → 与 footprint 椭圆（colliderOffset 偏移 + Y 透视压缩）错位；**分离判定统一取 collider.x/y + 逆透视变换**（与投射物 footprint 判定同口径），位移量变换回世界空间
    - tint 是乘法：绿色纹理 × 彩色 tint 必偏色 → **自定义色一律用白色纹理**（`impact_dot`）
  - **集合体（amalgamZombie）持续打磨**
    - 判定圆 120→240→**270**、`colliderOffsetY` -50→**-100**（配置驱动，阴影/命中/分离同源）
    - 世界内血条两次下移（topY+188）、名字/数值/标签错开、后删 `Lv.X · 首领` 标签；新增 **BOSS 专属 DOM 血条**（顶部状态栏下方 20px，玩家命中才显示，5s 无命中/Boss 死亡自动隐藏，damageable-entity 在 `rank==='boss' && source._faction==='player'` 触发）
    - 投掷警示圈立即销毁、落点深黄大粒子（0xb8860b）、`AimHelper.lead` 预判拦截点（与僵尸巫师/毒液僵尸同实现）
    - 砸地：CD 到点即放（根因：footprint 扩大后玩家进不了 250 触发范围）、区域 200/400/800 ×1.2/0.7/0.2、范围提示为逐帧红色椭圆冲击波（8px 加粗+正弦闪烁、2:1 透视、600ms 扩散、死亡/战斗结束 `_destroyCustomEffects` 统一清理）
    - 召唤：CD 15s、召唤点地牢刷怪同款黑粒子；站桩/位移免疫五通道（speed 0、每帧归零、applyKnockback 空覆盖、noSeparation、锚点钉死）
    - `parryImmune: true` 弹反免疫（通用机制：配置加标即免眩晕/击退/打断，玩家侧收益不变）；受击粒子配置化 `hitParticleColor`（白纹理+黄 tint）
    - 音效：`sounds` 配置块（idle/throw/impact/slamHit/death/idleInterval）+ `_playSound(key)` 助手 + SKILL.md 音效导入工作流
  - **眩晕双星特效**：`GameScene._syncStunEffects`——眩晕实体头顶两颗四角星旋转（透视压缩+浮动），醒后/实体失效自动销毁，地图模式清理
  - **召唤物统一 `_summoned` 标签（一劳永逸）**：集合体召唤/投掷生成、巫师召唤犬打标；金币+经验（onDeath）、暴击/武器精通/无人机经验（takeDamage 三分支）、7 处技能击杀计数（attack/whirlwind/ice-spike/dash/push-strike/fireball）全部加 `!entity._summoned` 闸门；**未来召唤方打标即被全部闸门拦截，无需改判定**
  - **调试工具**：左下新增「秒杀」按钮（`Game._oneHitKill`，takeDamage 中玩家伤害提到致死量，正常结算）
  - 验证：lint / build / test-collider 全部通过

- v3.1 (2026-07-17) — 遗留 bug 与技术债务分批清理（19 项）
  - **投射物命中快照**：`Projectile._effectSnapshot` 在 `ProjectileFactory.create` 统一快照发射武器的 `_enchantEffects/_craftEffects`，命中按快照判定（切枪不再改弹道效果）；非工厂创建的投射物回退原逻辑
  - **攻击冷却基准固化**：`Attack.baseMaxCooldown` 构造时固化，`_applyEnchantAttackInterval` 改读创建基准并废弃 `_baseCooldowns` 缓存（修复 ramp/改造运行时值被当基准缓存的污染）
  - **附魔界面拖出即刷新**：附魔槽从装备槽拖出武器补 `_applySkillOverrides(equipments[weaponMode])` + `_syncWeaponVisual`
  - **次级格挡**补 `isMelee` 判定；**冲刺体力**删 `staminaCostDelta` 双用；**基类换弹**读 state 存值（计入改造）
  - **registry tooltip**：`getCraftEffectDisplay(name, value, allEffects)` 透传聚合效果；`magicVulnerabilityOnHit` 显示真实层数；`magicVulnerabilityStacks` 显示 `易伤层数×N`
  - **ItemDatabase.getByWeaponId**：懒索引反查替代 craft-system 硬编码 weaponIdMap（load/addItem 自动失效重建，新武器免登记）
  - **地牢 buff 状态键唯一化**：`addStatusEffect` 键 `'buff'` → `goddessBless`/`demonPrayer`/`buffCfg.id`，消耗/清理按同键移除（多 buff 不再互删图标）；`_cleanupEventUI` 先销毁事件打字机再移除 DOM
  - **强化配置化**：`data/game-config.json` 新增 `enhance` 节（maxLevel/baseCost/costGrowth），`enhance-system.js` 经 `_getEnhanceConfig()` 读取（`??` 回退）
  - **材料按 id 匹配**：强化石 `enhancement_stone`/改造券 `reforge_ticket` 模板与地牢事件奖励创建点补 `id`，消耗匹配 id 优先、无 id 旧实例名称兜底
  - **死代码批删**（grep 确认零调用）：`_combatCompleted`、`ZOMBIE_DUNGEON_CONFIG` 三残留字段、`consumeGoddessBless`、`getGradeCost`、Player 空 `_onHitEntity` 覆盖（敌人版是活的，damage-pipeline 调用保留）、`_ticketCost`/`_modifications`/`getWeaponEffects`、registry 五函数、codex `_craftEffects` 死分支、spitter 敌人端 `_craftEffects` 残留
  - 验证：每阶段 lint / build / test-collider / test-craft-sync 全部通过

- v3.2 (2026-07-18) — 改造系统深化：registry 驱动聚合 + craft-system 拆分
  - **三角机制重构（registry 驱动聚合）**：`src/ui/craft/craft-effects.js` 的 `aggregateCraftEffects` 按 registry `applyMode` 聚合（flag=OR / override=后选覆盖 / add·multiply=求和），替代 44 行人工收集；**新增改造效果工作流变为：① craft-config.json 加 effects ② craft-effect-registry.js 注册条目（applyMode+display）③ 消费端读 `_craftEffects.X`——聚合无需再动**
  - **拆分**：`craft/weapon-image.js`（resolveWeaponImageSrc 回退链）；craft-system.js 891→741 行，仅作 UI 控制器，外部 API 不变
  - **test-craft-sync.mjs 适配**：收集腿改结构断言（聚合≡注册），新增 registry 条目结构校验（applyMode 合法+display 存在）
  - 验证：lint / build / test-collider / test-craft-sync / 聚合语义抽样 全部通过

- v3.3 (2026-07-18) — 新怪物：铠甲骑士（精英）
  - **配置驱动全部数值**：`enemy-config.json` armoredKnight——HP 800、speed 同僵尸、六维=突变体-3×1.15、`attackSkills`（combo/charge/block 三技能帧判定/冷却/距离/倍率全集中）；family 骑士（不进僵尸地牢池）
  - **技能机制**：二连击（帧 12/25 判定）、持盾冲锋（900px/s 追踪、命中×2+击退+眩晕、冲锋期间 `_parryImmune`、目标弹反成功只击退）、举盾格挡（玩家攻击临近触发、2s 内 takeDamage 覆写全部按弹反、近战攻击者被眩晕击退；`shieldSystem._lastParried` 代理接入 DamagePipeline）
  - **工作流复用**：素材先复制 `assets/enemies/armored_knight/`（8×4 512×512 切帧）→ 配置 → BootScene 精灵图+动画注册 → enemy-types.js 导出 → game.js 主神空间测试生成（永久警戒）
  - 验证：lint / build / test-collider / test-craft-sync 全部通过

- v3.4 (2026-07-18) — 稀有度扩展/物品栏优化/祭品体系/仓库系统（多轮合并）
  - **稀有度+神话/传说**：`config/rarity.js` 单一来源（RARITY_LABELS/RARITY_COLORS/RARITY_ORDER/getRarityLabel），5 处重复 rarityLabelMap 收编；神话橙/传说红色条
  - **物品栏优化 D2-D5**：消耗品 `useEffect` 数据驱动（config/consumable.js 统一结算）；快捷栏绑定 instanceId（`_findAssignedItem` 实例优先+同名回退）；强化栏单击误删修复、背包格子级三套消耗公式统一；**equip-manager.js 拆分 1604→686 行**（`ui/equip/drag-drop-manager.js` 工厂注入防循环 + `ui/equip/slot-renderer.js` 纯渲染）
  - **祭品体系**：`config/tribute-effects.js` 数据驱动引擎（**最终乘算** Π(1+p/100)，应用点：面板/金币/双恢复）；20 个农产品祭品（普通5/优质5/稀有4 正负效果，史诗3/神话2/传说1 纯增益）；精英必掉+普通 5% 掉落（`tributes.dropTables` 配置）；三特效：蟠桃原地复活(30%,一次)、雪莲经验+25%、人参击杀回蓝 5%（仿大理石计时器），特效上 buff 栏（syncTributeBuffs/地牢结束清理）
  - **仓库系统**：小鼠大王旁仓库 NPC（实心圆，`npcType 'warehouse'` 点击直开）；`ui/warehouse-system.js` 面板（改造栏同款滑入动画，20 格×2 页）；双击/右键双向存取（equip-manager 委托 warehouse 分支）；tooltip wh-cell 感知；**材料全局调用**（强化石/改造券/粉尘 背包+仓库合计计数、先背包后仓库扣减）；附魔栏卷轴列表（背包+仓库双击放入，`_equipScrollFromSource` 通用化）
  - **仓库增强**：同品堆叠存取（maxStack 预判，溢出占新格）；一键全部存入/取出同类（满仓中断）；满仓走 `SceneManager.showTopNotification`（场景提示语同款）；整理排序子菜单（稀有度/价值/种类三模式，种类自定义顺序）
  - **暴击排查结论**：公式饿死（crit=2+luck vs critRes=con），非代码 bug，数值待拍板
  - **复盘修复**：仓库克隆保留 weaponAsset、蟠桃复活比例读配置、ESC 关仓库、仓库来源卷轴取出后刷新
  - 验证：lint / build / test-collider / test-craft-sync 全部通过

## 祭品添加标准工作流（新增祭品一律按此开展）

### 1. 数据结构（data/equipment.json，双份同步 public/）
祭品物品：`{ name, type: '祭品', icon, category: 'tribute', rarity, level, stack, price, effects: {...}, stats: [{name, value}], desc, special?: {...} }`
- `effects` 为固定百分比数值（负数为减益），引擎最终乘算 `Π(1+p/100)`；`stats` 仅用于面板显示；`special` 为特效参数块（非百分比语义）。
- 不写贴图时用 emoji 图标。

### 2. 效果键（config/tribute-effects.js 聚合）
- 面板向：atkPercent/matkPercent/defPercent/mdefPercent/moveSpeedPercent/critPercent（calculateCombatStats 末尾乘算）
- 经济向：goldPercent/expPercent/dropChancePercent
- 恢复向：hpRegenPercent/mpRegenPercent/staminaRegenPercent（倍率）
- 怪物向：monsterDamageTakenPercent（承伤）/monsterAtkDownPercent（攻击削减）/monsterMoveSlowPercent（移速削减）
- 比例向（**耦合规则**）：combatChanceDelta（百分点，战斗↑事件↓或反向，**战斗+随机事件恒=100%，一个调整同步影响另一个**）/eliteChanceDelta（精英概率百分点）
- 特效键：revivePercent（蟠桃复活）/killMpHealPercent（人参回蓝）/expPercent（雪莲经验）

### 3. 数值带（按属性稀缺度）
| 类别 | 普通 | 优质 | 稀有 | 史诗 | 神话 | 传说 |
|---|---|---|---|---|---|---|
| 标准带（攻防/金币/体力/事件比/怪物向） | 1~2 | 3~4 | 5~6 | 7~8 | 9~10 | 11~15 |
| 珍贵带（移速/暴击/怪物减速） | 1 | 2 | 3 | 4 | 5 | 7 |
| 廉价带（生命/魔法恢复） | 4 | 8 | 12 | 18 | 22 | 30 |
- 普通/优质/稀有 = 1 增益 + 1 减益（按物品特性）；史诗及以上 = 纯增益；负效果取对应带低档。
- 神话/传说必须带特效词条（item.special + SPECIAL_BUFFS 图标）。

### 4. 特效模式（参考实现）
- surviveCapPercent：单次伤害上限（玩家 takeDamage 拦截）
- moonshadowDuration/moonshadowDamagePercent：进战斗无敌+精英/Boss 增伤（战斗入口 _triggerMoonshadow）
- oreUpgrade：拾取祭品品质+1，传说额外给一件（tryPickupItem 转换）
- revivePercent：死亡 3s 原地复活一次
- killMpHealPercent：击杀后 1s 回蓝（计时器+buff）
- 特效参数放 item.special，不上 effects 聚合；buff 栏走 syncTributeBuffs/clearTributeBuffs。

### 5. 掉率表（combat-formulas.json tributes.dropTables）
elite（必掉）/normal（5%）两表按稀有度权重；新增等级自动按 RARITY_ORDER 参与。

### 6. 验证
JSON 双份一致；lint / vite build / test-collider / test-craft-sync；CHANGELOG 记录。

- v3.5 (2026-07-18) — 20 矿石祭品/怪物向效果/比例耦合/三新特效
  - 引擎扩展：怪物向三键（承伤/攻击削减/移速削减）、比例耦合键（combatChanceDelta 战斗事件恒 100% 同步）、eliteChanceDelta、dropChancePercent、staminaRegenPercent
  - 20 矿石祭品（数值带按稀缺度三档：珍贵/标准/廉价）；磁铁矿战斗+6pp事件-6pp、星光蓝宝事件+8pp战斗-8pp（耦合实现）
  - 三新特效：金刚石「金刚不坏」（单次伤害≤15%最大生命）、月光石「月影」（入战无敌 15s+精英/Boss 物魔伤+5%）、贤者之石「点石成金」（拾取祭品品质+1，传说额外给一件随机传说）
  - 祭品添加标准工作流归档（本节）

- v3.6 (2026-07-19) — 祭坛/合成/旧祭品迁移/定价
  - 祭坛 NPC（小鼠大王下方实心圆）：献祭出征/祭品合成/退出三选项；合成 2 低→1 高随机池，传说祭品重随一件；不同稀有度拒绝（提示栏）；一键放入按稀有度筛选（仅背包，不调仓库）；奇数合成剩「最后添加/名称序最后」一件；合成槽 20、堆叠整组拖放
  - 三旧祭品（麦穗/石头/大理石）迁移数据驱动 effects，删除全部按名硬编码；初始背包映射走 ItemDatabase；祭品 maxStack 999、出征栏同名限制；全祭品按稀有度统一定价 100/200/400/800/1600/3200

- v3.7 (2026-07-19) — 附魔等级体系替换为稀有度体系
  - enchant-config.js 卷轴 `grade` 字段用 common~legendary（原 F/E/D 等字母级废弃）；显示一律 RARITY_LABELS；魔法粉尘消耗/分解产出随稀有度档调整

- v3.8 (2026-07-19) — 地牢难度分级（FEDCBA）
  - `data/dungeon-config.json` dungeonList 每地牢 `grade` 字段（zombie=D「☠ 僵尸地牢高级」、zombieBeginner=F「☠ 僵尸地牢-初级」；内部键不动，仅显示名）
  - 祭品掉落按难度分表：combat-formulas.json `tributes.dropTables` 以 F~A 为键，每级 `maxRarity` 封顶（F≤稀有、E≤史诗、D+≤传说）+ elite/boss（必掉）/normal（几率掉，F 2% 起每级 +0.5%）三张权重表；`rollTributeDrop(rank, dungeonType)` 查表
  - 骑士冲锋期间 `noCollision` 无视实体碰撞（可穿人不可穿墙），结束由分离系统墙解析挤出，防卡死/瞬移

- v3.9 (2026-07-19) — 随机事件分级体系
  - 事件两段判定（dungeon-event-system rollEventType）：先 30% 通用 / 70% 限定，再组内按权重抽
  - 限定池：`RESTRICTED_EVENT_META`（dungeon-event-definitions.js）每事件 `{ grade, scope }`——scope=地牢大类（现全部 zombie），grade=事件等级，仅出现「地牢等级 ±1」内的事件
  - 通用事件（女神像/恶魔雕像/宝箱/陷阱/补给堆）奖励分级：`combat-formulas.json universalEventRewards` 按地牢 grade 覆盖（祝福场次/粉尘/金币/恢复量等），陷阱/补给属性检定成功率每级 -2pp 下调（下限沿用 minSuccessRate）；宝箱 D 级起 10% 祭品彩蛋走 rollTributeDrop
  - 改名「僵尸地牢」→「僵尸地牢高级」全界面同步

- v4.0 (2026-07-19) — 出征等级门槛
  - 进对应等级地牢至少放入一件对应稀有度祭品：F↔普通、E↔优质、D↔稀有、C↔史诗、B↔神话、A↔传说（GRADE_ORDER 与 RARITY_ORDER 同序一一对应）
  - `expedition-system.js` depart() 前置 `_getRequiredRarity()` 判定，缺则提示「请根据提示放入对应等级祭品」拦截
  - 出征界面左侧固定说明面板 `.expedition-rule-panel`（fixed left:8px top:20vh，pointer-events:none）：F~A 对照表（RARITY_COLORS 上色）+ 当前选中地牢要求实时刷新
  - **样式坑**：根 `game-style.css` 才是 index.html 加载的全局样式表；`src/ui/` 下新建 css 无任何引用会成为孤儿文件，全局样式一律追加到根 game-style.css
  - 修复 `getTributeHpRegenFlat` 缺失导出（引用先于实现，vite build 报 Missing export——引用配置函数前先确认导出存在）

## 怪物 HUD（名字/血条）定位规则

- **统一规则**：怪物名字与血条位于**贴图上方 30px 区域**（血条 `healthBar.offsetY` 默认 -30，名字在其上方紧贴）。不要再放更高。
- **透明上沿校准**：AI 生成精灵图常有大片透明上沿，`topY` 按 displayHeight 算会远高于视觉头顶——在 enemy-config `render.hudOffsetY`（正数下移，如骑士 75）整体校准名字+血条，不要改通用代码。
- **渲染来源**：新怪配置走 `entity.config.render`，老怪走 `_animCfg.render`（GameScene `_syncEntityHud` 已做双源回退）。
- **非方形帧显示**：渲染层 `setDisplaySize` 按帧宽高比等比缩放（spriteSize=最长边），方形帧行为不变；素材帧尺寸不统一（如手脑 walk 512×1024 与其余 512×512）时无需特殊处理。

- v4.1 (2026-07-20) — 手脑裁剪修复/骑士HUD下移/仓库整体修复/出征界面调整
  - 手脑素材真实网格：idle/slam/howl 8×4（帧512×512）、walk 8×2（帧512×1024）——勿信口述"4×8"，**拿到精灵图先目检行列布局再配 frameWidth/Height**
  - 仓库：金币/消耗品无法存入+满仓误报根因=金币无 maxStack 字段（_maxStackOf 回退 gold 99999）+不可堆叠物品空间语义修正（整件1格与 stack 数无关）；overlay 点击一并关闭（warehouse 自挂监听避免循环 import）；NPC走远链补关闭；格子改一行2格×56px 对齐背包
  - 出征界面 open() 改自动关闭背包（原为主动打开）；说明弹窗重定位 left:4px bottom:2px 187×945 拉伸

## 常见陷阱：Phaser 4 的 FX API 不是 postFX

- Phaser 3.60 的 `sprite.postFX.addGlow(...)` 在 **Phaser 4 已移除**——`sprite.postFX` 为 undefined，静默失败不报错。
- Phaser 4 正确用法：`sprite.enableFilters().filters.internal.addGlow(color, outerStrength, innerStrength, scale, knockout, quality, distance)`（Camera 上为 `camera.filters.internal/external`）。
- addGlow 参数顺序与 v3 不同（第 4 位是 scale，第 5 位才是 knockout），迁移时逐位核对。
- knockout=true 会把贴图本体完全隐藏只留光晕（"only the glow is drawn, not the texture itself"）——要"贴图正常+轮廓外光晕"必须用 knockout=false，光晕会自然从贴图边缘向外渐变。

## 常见陷阱：Phaser 4 filters 是 per-object 渲染通道（数量多即卡）

- `enableFilters().filters` 每个 GameObject 一个独立 render-to-texture + shader pass——满地掉落物时几十/上百个额外通道，帧率雪崩。**实体特效一律不用 filters**。
- 替代：离屏 canvas 烘培纹理（`ctx.shadowBlur` 多次叠画出外发光渐变，`textures.addImage` 缓存复用），渲染零开销。
- 光晕宽度要按显示尺寸比例烘培：原图 512px 显示 48px 时，10px 光晕需按 ≈20% 画布比例烘，否则被缩放稀释到不可见。
