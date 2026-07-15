# Sprite Pipeline 技能文档

## 版本: 1.6

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
