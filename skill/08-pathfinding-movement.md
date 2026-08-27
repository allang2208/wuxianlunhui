> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：8. AI 寻路、碰撞与移动

## 8. AI 寻路、碰撞与移动

### 仓鼠探险家全图随机勘探（2026-08-22）

- 探险移动目标必须从当前位面的完整可玩范围抽取：菱形位面使用
  `SceneManager._scene8Diamond()` 定义的整张地面，其他场景使用场景宽高边界；边缘按单位碰撞半径留安全距。
- 候选点依次通过 `WallSystem.canMoveTo()` 的落点碰撞检查和 `pathFinder.isReachable()` 的区域连通检查，
  不能只验证目标点为空而把单位派往隔离区域；实际路线仍统一交给 `MovementSystem`，禁止为每个随机候选预跑完整 A*。
- `isReachable()` 的 Flood Fill 队列耗尽时必须返回不可达；只有达到搜索步数预算才乐观放行并交给后续 A*，
  否则封闭小区域会被误当作合法探险目标。
- 默认排除距当前位置不足 180px 的候选，防止抽到脚边后立刻原地观察；极小或高度拥挤场景可回退到本轮最远合法点。
- 抵达目标后清除路径并切换 `viewing`，按 18 帧动画时长停留，播放结束后重新从全图合法可达区域抽取下一目标。
- 卡住看门狗必须比较单位在采样窗口内的真实坐标位移，不能用“到终点的直线距离是否缩短”代替；合法 A* 绕路可能暂时远离终点。确认未移动后需同时清除 `PathManager` 路径与 `_relayTarget`，再抽取新目标，避免新终点继续沿用旧中继路线。

### 友方单位移动平滑启停（2026-08-21 定稿，仓鼠全系 + 纯视觉平民）

- 方案详情见独立分卷 `skill/08b-animation-smoothing.md`（缓动公式 / 士兵四件套 /
  平民 moveWorker / 动画尺寸统一 / 调参旋钮）。要点：AI 决策层不再瞬时清零速度，
  站定动作改 0.85/帧指数衰减，跟随 120px 内缓出，滑行期（>25px/s）保持 walk 动画。

### 统一高架导航面（城墙/楼梯，2026-08-20）

- 墙顶、楼梯踏步、并排楼梯共享缝和墙梯桥接都必须进入
  `unified-elevated-navigation.js` 的候选集，再由 `elevated-surface-state.js`
  一次排序、一次原子提交；禁止分别写 `_surfaceRef/_surfaceWall/_surfaceStaircase/z`。
- 玩家即时移动以真实墙顶多边形、墙间连接面和楼梯踏步面为权威；RTS 远程目标才使用
  楼梯节点与墙块四邻 BFS。墙顶不能退化为中心线轨道，也不能把整张墙立面当 footprint。
- 高架路线节点使用独立的小到达半径与 Z 容差；普通 A* 卡死重算、随机脱困和跟随瞬移在
  `_surfaceRouteActive/stairs/wall_walk` 期间暂停，恢复只走表面回夹与局部看门狗。
- 高架节点“到达”必须同时满足平面距离、Z 与目标表面身份；墙顶节点还要匹配目标墙连通分量，
  楼梯节点匹配目标楼梯。楼梯顶部与墙顶同高时禁止仅凭距离/Z提前完成或释放Portal预约。
- 墙梯顶部接缝连续3帧位移小于0.05px时，只沿真实连接面中心线最多推进3px；禁止调用地面随机
  脱困、扩大全局容差或改写墙顶自由移动。入口节点保持ground，取得踏步surface后才切高架控制权。
- 所有移动、翻滚、击退和单位分离后的位移都必须携带
  `WallSystem.ignoreForEntity(entity)`；垂直区间不重叠的地面/高架单位不做二维分离，
  碰撞结束后统一调用 `DefenseSystem.reconcileElevatedSurfaces()` 最终提交表面身份。
- 友方单位取得 `stairs/wall_walk` 表面身份（或处于墙梯桥接帧）后，单位间 footprint 分离与
  同阵营排斥统一关闭；豁免只针对友方 unit-vs-unit，不能关闭墙体、建筑、防坠线或 Portal 入口排队。
  任一方已进入高架交通即豁免该友军对，避免入口外单位或墙顶单位把楼梯单位反向推离窄通道。
- 单楼梯入口仍由 FIFO 决定首个进入者；首个友军实际取得 `stairs` 身份后，同方向友军允许流水获权，
  反方向继续等待。禁止在持有者仍处于地面入口时批量放行，也禁止让敌军复用友军的同向共享规则。
- 高架长帧只限幅位置积分，不篡改其它计时器；高速位移必须从上一安全点到落点扫掠，
  保留最后一个有效表面点，不能在墙梯接口直接把单位降为地面。

#### 墙顶外轮廓防坠与 Portal 开口（2026-08-20 定稿）

- 墙顶防坠碰撞的唯一真源是墙体拓扑外轮廓，禁止从楼梯连接器向墙顶横向延伸“护翼”；后者会把合法墙顶通道切断，并在墙梯交接处重新制造卡死。
- 每块墙的真实墙顶四边中，墙墙共享边和活动楼梯 `wallEdgeIndex` 对应边必须保持开放；只有其余外露边注册 `_surfaceWallTopGuard + _elevatedOnly` 防坠线。
- 防坠线只约束已在 `wall_walk/stairs/bridge` 且 `z > 1` 的单位；地面移动、建造占地与投射物检测必须旁路，不能让高架安全边界污染原有二维碰撞。
- 墙体、楼梯建造/拆除或恢复后按 topology revision 重建防坠线；范围显示模式的红线必须直接绘制同一份 `wallGuards`，不得另算一套调试几何。
- 墙梯卡顿优先检查“共享边是否被正确开放、表面身份是否原子切换、碰撞后是否统一 reconcile”，不能靠无限放大入口容差或恢复整条楼梯口阻挡线掩盖。

### 智能寻路系统（参考《环世界》PathManager）

#### 设计目标
- **主动预规划**：看到目标时立即计算路径，而不是等卡住才反应
- **定期路径检查**：每 1.5-2.5 秒扫描路径节点，检测新障碍物
- **局部修复**：路径被阻挡时，在障碍物附近搜索替代路线，不重新计算整条路径
- **地形权重**：树木附近增加移动成本，让单位自然绕行

#### 架构

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

#### 局部修复算法（核心）

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

#### 地形权重

在 `PathFinder._buildGrid` 中，每个格子计算 `moveCost`：
- 普通地面：`1.0`
- 树木附近（碰撞半径 × 1.5 范围内）：`+0.5`（总计 1.5）
- 其他单位附近（碰撞半径 × 2.5 范围内）：`+0.3`（总计 1.3）

A* 中移动成本 = `baseMoveCost * terrainCost * gridSize`
- 直线：`1.0 * terrainCost * 40`
- 对角线：`1.414 * terrainCost * 40`

#### 区域连通性检查

在 `findPath` 之前，先用 `isReachable` 做 Flood Fill：
- 从起点向 8 方向扩展，检查是否可达目标附近
- 如果不可达，直接返回 `null`，避免昂贵的 A* 计算
- 限制最大步数，防止 Flood Fill 无限扩散

#### 路径缓存

- 全局缓存：`Map<key, {path, timestamp}>`
- 缓存 key：`量化起点 + 量化终点 + 碰撞半径`
- 量化：坐标取 `floor(x / gridSize) * gridSize`
- 有效期：3 秒
- 最大容量：50 条路径
- 墙壁变化时调用 `invalidateCache()` 清空缓存

#### 使用方式

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

#### 与旧系统的兼容性

- `enemy._path` 和 `enemy._pathIdx` 仍然保留，作为 fallback
- MovementSystem 优先使用 `enemy._pathManager`，没有 PathManager 时使用旧路径
- Enemy 的 `_updateMovement`（fallback 模式）也兼容 PathManager

#### 为什么之前被动寻路不好？

旧系统只在卡住（500ms 移动 < 3px）时才触发寻路：
- 单位先撞墙 → 被卡住 → 检测卡住 → 计算路径 → 开始移动
- 这导致单位在撞墙后有明显的"停顿"感

新系统：
- 单位看到目标 → 立即计算路径 → 沿路径移动 → 遇到障碍物时 PathManager 自动修复
- 单位更流畅，不会明显撞墙

---

### 寻路性能优化（2026-08-03 落地，改寻路代码前必读）

2026-07-13 全量审计实测：冷路径 findPath ≈ 10ms（`_buildGrid` 占 92%），
刷怪瞬间 15 只怪同帧冷寻路可达 50~115ms 主线程卡顿。以下机制已内嵌，**改动时必须保持**：

1. **静态格子记忆化（`_getCellData`）**：blocked 与 moveCost 合并为单趟空间哈希查询，
   结果按 `(格子坐标, 半径)` 缓存（**半径必须参与 key**：阻挡判定随半径线性膨胀，跨半径
   复用会读到错误结果；同型怪同半径天然共享）。`_buildGrid` 网格原点对齐到 gridSize 倍数
   （格子中心稳定为 k×40+20），使同一几何下同半径怪物共享同一份成本网格——15 怪同帧批量
   从 106ms → ~10ms。动态障碍成本（250ms 更新）不进 memo，每格实时叠加。
2. **每帧寻路预算**：`PathFinder.beginFrame()` 由 `MovementSystem.beginFrame()` 在
   game.js 主循环每帧调用一次；`frameBudgetMs` 耗尽后 `findPath`/`findPathToExit` 返回
   `PATH_DEFERRED` 哨兵，PathManager 保留旧路径、下帧重试。空间哈希冷重建、建筑终点投影、
   区域索引与反向流场建设也必须消费同一 deadline。**禁止**把超预算当"不可达"处理。
3. **不可达负缓存**：A* 失败结果按 500ms 短 TTL 入 `_pathCache`，卡住重算循环不再每 500ms
   付一次冷 A*（20ms → 0.01ms）。`findPathToExit` 另有独立 500ms 出口缓存 + 预算门禁。
4. **首寻路错峰**：PathManager 创建后 `_firstRecalcAt = now + rand×250ms`，刷怪同帧错开。
5. **防御性拷贝**：`setPath` 在副本上对齐首点，不再原地改 `path[0]`——路径缓存数组为多怪
   共享对象，原地改写是别名 bug。
6. **缓存 LRU + 告警节流**：`_setCache` 满容量先清过期再淘汰最旧；A*/forceRecalc 失败告警
   1s 节流，避免卡住循环刷屏。
7. **全局任务队列（2026-08-23；2026-08-25 跨帧续算补强）**：敌人的首次重算、目标变化、卡住强制重算和路径有效性
   检查统一进入 `PathWorkScheduler`，按卡住紧急 > 过门追击 > 防守怪 > 普通怪排序；同一
   `PathManager` 的重复任务必须合并，重算会吞并旧有效性检查。每帧最多执行 2 次重算、5 次
   有效性检查；排空耗时达到 3ms 后不得再启动新任务。`PATH_DEFERRED` 必须保留任务到下一帧，不能当失败。
   deferred 作业优先连续续算以尽快产出共享路径，但最多连续 8 个切片后让出队列，防止不可达作业饿死其他请求。
   玩家 RTS 的 `PathManager` 保持同步直算，不进入敌人队列，避免输入响应增加一帧延迟。性能报告中
   `path.validationMs/recalcMs` 表示当帧队列实际执行时间，`LastMs/PeakMs` 分别表示最近一次和本次运行生命期峰值。

**2026-08-03 剩余清单已清（改代码前必读）**：
1. **临时线障碍只做局部失效**：冰墙一次施法只往 `WallSystem.isoSegments` 推一条带
   `_iceWall` 标记的连续线，PathFinder SpatialHash 将其作为硬 `seg` 建模；创建/销毁调用
   `invalidateRegion(bbox)`，禁止调用全图 `invalidateCache()`。视觉段数增长不得增加寻路段数。
2. **WallSystem 碰撞空间网格**：walls/isoSegments/trees 经访问器暴露惰性代理，任何
   push/splice/下标赋值自动标脏；`canMoveTo/blocked/_nearestBlockingSeg/resolve` 走 128px
   网格近邻查询（谓词与线性版逐行一致，`_collisionAccel=false` 可回退线性）。
   实测 resolve 提速 ~11×。**禁止**直接用 `WallSystem.walls = [...]` 之外的原地下标改
   几何坐标（长度指纹只能兜底长度变化）；`scripts/test-collision-grid.mjs` 差分测试已入
   `npm test`，改这三处函数必须保持差分全绿。
3. **分离/侧翼近邻查询**：`MovementSystem._computeSeparation/_computeFlankOffset` 改用
   `SpatialPartitionSystem.queryRadius`（game.js 每帧重建），无分区时回退全量遍历。
4. `isReachableByRegion` 死代码已删除（BFS 预检 0.14ms 足够，勿重新引入）。

**回归防线**：`tools/pathfinding-bench.mjs`（寻路性能基准）+ `scripts/test-collision-grid.mjs`
（墙体网格差分）均已入 `npm test`。

---

### 大场景 AI 索敌 + 寻路（2026-08-08 定稿，世界-122 驱动、机制全局生效）
- **移动目标优先级契约**（movement-system `_computeMoveDirection`）：
  `_specialTacticalTarget` > `_tacticalTarget` > BattleCommander > `enemy.target` > `_lastKnownTargetPos`。
  **防守怪（`_defenseMonster`）不走 BattleCommander**（战术点围绕玩家，与基地/掩体目标冲突，
  game.js 收集处 + 优先级判断双保险）；chargeStraight 怪只认 enemy.target 直线。
- **分层接力寻路 [HIERARCHY+RELAY]**：目标超 MAX_PATHFIND_RANGE(800) 时先由
  `HierarchicalRoutePlanner` 在 640px 扇区图搜索共享门户序列；粗层搜索受独立 0.6ms 帧预算约束，
  `HIERARCHY_DEFERRED` 时保留旧路径、下帧继续。随后选不超过 700px 的门户交给细层 A*；无可用粗层路线
  才回退主方向 +±30°/±60° 五射线。`_relayTarget` 仍是非永久状态，接近 <120px/路径失效/终点偏 >100px
  推进下一段；PATH_DEFERRED、500ms 最小重算全部复用现有机制。例外：chargeStraight、战术目标移动保持直线。
- **掩体可攻击链路三件套**：① `_coverSeg._owner` 回链 DefenseCover；② 卡住 500ms 且目标够不着时
  `_retargetBlockingCover` 直接转火贴身掩体（绕过感知 1.3× 滞回）；③ LOS/Combat 对掩体目标
  `blocked(..., {segs:[target._coverSeg]})` 忽略自身 face 段——不忽略则从墙背面接近永判无视线、拒不出手。
- **索敌性能口径**：PerceptionSystem 候选走 SpatialPartitionSystem.queryRadius
  （`_sourceEntities` 引用校验，防网格与传入集合不一致串数据）；两级筛选（基础分 top-5 才补 LOS）；
  LOS 缓存 per-target Map（200ms TTL）——**新增 LOS 读取方一律走 `_checkLineOfSight`/`losCache`，
  别再读已删除的 lastLOSTargetId 单槽**。
- **防守 aggro 归一化**：spawn 时 `_aggroRange` 抬到 alertRange(3800)（`ai.defenseAggroRange` 覆盖）——
  pacing AI 怪（黑狼 2500）出生即 chasing 进场；aggro 只服务 pacing AI 与 alertRange 兜底，
  非 pacing 怪索敌完全由 PerceptionSystem `_alertRange` 决定。
- **RegionIndex 口径**：`_isBlockedQuick` 与 pathfinder SpatialHash 同源（walls/trees/`_cover` 段，
  点到线段距离 < 半径+halfThick）——改任何一边的阻挡判定，另一边必须同步。
- **CDP 探针坑**：vite HMR 后 `await import('/src/x.js')` 会拿到第二份模块实例（状态全零、
  DefenseSystem.active 恒 false）——必须按 resource entries 真实带 `?t=` query 的 URL import
  （__imp 模式，见 tools/cdp-defense-ai-verify.mjs / cdp-defense-audit.mjs）；探针挂 `__v` 的
  页面被 HMR 重载后会失效，工具需 boot()/injectProbe() 函数化 + 失效自动重建。
  **2026-08-15 补强**：整页刷新后页面模块带 `?t=`，探针裸 import 拿到空单例副本
  （游戏 100 棵树、探针读 0）——断言一律优先 window 全局（window.Game/SceneManager/
  __phaserScene/DefenseSystem）或 performance 资源表真实 URL；长会话探针要对「页面被
  HMR 刷新打回主场景」做韧性重导航（读数前先校验 `sm.currentScene`），且跨调用不得把
  状态挂 window（刷新即丢，每条 eval 自包含）。

### 二轮优化口径（2026-08-08：感知降频/局部失效/半径桶/门闸软成本/墙背啃墙）
- **感知降频**：有活跃目标的怪 PerceptionSystem 100ms tick；无目标怪与战术小队成员每帧不变。
  丢失目标搜索行为已接线（`_searchTarget` 三阶段 moveToLastKnown→searchAround→giveUp，
  movement-system 优先级链第 5 档）——别再往 DecisionSystem（死代码）里接东西。
- **缓存失效口径**：掩体/门闸增删 toggle → `pathFinder.invalidateRegion(bbox)`（内部外扩 800px
  局部清）；只有整图切换（地牢/战斗房/Boss 房/setup/teardown）才 `invalidateCache` 全清。
- **半径桶**：`RADIUS_BUCKETS=[20,40,90]`（>90 各自成桶），桶上界为代表半径（只保守不穿墙）；
  `_cellMemo`/`_pathCache`/RegionIndex 全部按桶共享——新怪加半径不用管，自动归桶。
- **门闸寻路**：关门 `_gate` 段进 SpatialHash，但不是硬阻挡。敌军、竞技场门与常锁门继续使用
  `GATE_SOFT_COST=6`（绕路优先、唯一通路仍穿门）；玩家/友军仅对 `_opensForFriendly` 且非
  `locked` 的自动门使用正常成本，让实际会为其开启的门参与最短路线。`_cellMemo/_pathCache/_exitCache`
  必须把 `friendlyGateAccess` 纳入 key，禁止敌我复用错误路径；门的 auto/locked/open 模式切换还要
  递增友军门策略版本，使已经持有路线的玩家/友军失效并经原目标重算，物理开关门继续
  `invalidateRegion`。门洞段额外标 `_gateHole`，被关门贴身挡住的怪门前等待不重算
  （`_findBlockingGateHole`，门开自然恢复）。
- **结构目标 LOS 总口径**：`_isDefenseStructure` 在攻击距离内（distanceToEntityShape +
  attackDistance ?? attackRange×1.15）免 LOS——perception `_checkLineOfSight`、
  combat-system LOS 分支、attack.js `checkTriangleHit` 命中判定**三处必须同口径**，
  漏任何一处墙背出手都会断（P3 回归就是漏了 attack.js）。

### 防守怪物 A 移动 + 全局移速倍率（2026-08-15 定稿）

**A 移动（RTS A 键语义：终极目标基地，沿途攻击任何敌对目标）**
- 三件套：`DEFENSE_CONFIG.spawn.engageHostileRange`（320）→ `_spawnMonster` 下发
  `monster._engageHostileRange`；`Enemy._findNearestPlayer`（交战半径内单位优先 +
  建筑任意距离兜底，模式闸门 `_preferDefenseTargets` 而非半径——半径未配置保持旧行为）+
  `PerceptionSystem._isValidTarget`（非结构单位仅交战半径内有效）。
- 闭环两补丁（探针实机暴露）：① 脱离滞回——当前目标是单位且超出半径×1.3 即弃
  （原逻辑有视线即永久锁定，会被单位无限拉出）；② 免滞回转火——拆建筑途中单位进圈
  直接切换（否则 1.3 倍评分滞回挡住转火）。
- 探针环境坑：headless 初始状态玩家无敌（直接 takeDamage 也不掉血），交战掉血类断言
  不可用；用目标锁定/追击距离/转火断言替代（验证 `tools/cdp-defense-amove.mjs`）。

**全局怪物移速倍率（全部模式通用）**
- `data/combat-config.json` `enemyDefaults.globalSpeedMultiplier`（当前 0.60）→ Enemy 构造器
  单点缩放 speed/maxSpeed/_baseSpeed；speed=0 站桩怪（矿洞/墓碑/煮锅/集合体）天然排除；
  浅拷贝 config 同步 config.speed（time-agent 运行时回读路径，不污染 enemyConfigData 单例）；
  冲锋/扑击/lunge 攻击位移与击退不在本链路，祭品减速（getTributeMonsterMoveSlowMul）独立叠加。
- 契约测试：`scripts/test-monster-speed.mjs`（数据契约 + 源码接线，防接线被改没）。

**全局可生产兵种常规移速倍率**
- `data/combat-config.json` `friendlyUnitDefaults.globalSpeedMultiplier`（当前 0.85）由
  `unit-upgrade-store.getUnitUpgradePatch()` 在兵种自身 `walkSpeed` 与移动升级倍率之间统一叠加；
  普通生产建筑和跨位面军事工厂都消费该最终补丁，覆盖 `UNIT_KIND_CFG` 登记的15种军事单位。
- 玩家、队友、矿工和平民不在本链路；骑士冲锋等技能位移不受影响。

**道路范围移速（世界-122，2026-08-19）**
- `BuildingRoadSystem.movementMultiplierAt(x,y)`按脚底所在格返回`1.2/1.0`，自动建筑道路环与
  手动道路共用判定；道路不是状态效果，不写回`maxSpeed/speed`，离开道路当帧自动恢复。
- 常规怪物、仓鼠兵种和队友在`MovementSystem._getEnemyMoveSpeed`最终链乘算；玩家在
  `player/update.js`完成装备、Buff、Debuff计算后乘算。击退、冲锋、Dash和卡死恢复继续读取
  基础速度，不吃道路加速，防止攻击位移与纠错位移被地形意外放大。
- 新增地形速度修正一律采用这种“查询位置→最终链乘算”模式，禁止进入/离开区域时直接
  `maxSpeed *= / /=`，否则高频切格会产生倍率漂移。

### 防守怪目标分摊（拥挤感知，2026-08-16 定稿）
- 问题：大量怪锁同一结构，攻击距离内站不下，其余在墙前**原地踏步发呆**（只有 2~3 只能打）。
  方案：`src/ai/defense-targeting.js` 纯函数——按「结构同时攻击上限」（基地 6 / 塔 2 /
  掩体门默认 3，`_attackSlots` 覆盖）统计占用，候选仅 420px 内且**视线可达**（忽略候选自身
  面线/门段，与 CombatSystem/感知 LOS 同口径），选「未超上限且最近」。
- ⚠ 关键判定：**保持目标必须用 `distanceToEntityShape ≤ 攻击距离`**（与 CombatSystem 同口径）——
  中心距离+120 会把墙后 120~220px 的怪误判「够得着」导致不换目标（真实 bug，2026-08-16 修）。
- 感知层 `_findBetterTarget`：只有分摊**真返回了不同的可达目标**（`pickedDifferent`）才免
  1.3× 滞回（`structOver`/`structUnreachable`）——否则远处赶路每 500ms 在基地/掩体间
  ping-pong（已修；仿真 30s 每只换目标 1~7 次）。
- **过门追击（_gatePursuit）**：卡住转火掩体/门与感知 bypass 全部 `!enemy._gatePursuit` 守卫——
  被关在门内保持原追击目标，目标丢失/失效才由感知正常重选。
- 性能：占用表 1.2µs、分摊 0.7µs/次（含 LOS），40 怪全量 ≈ 0.06% 帧预算；`_cellMemo` 上限 100000。
- 回归：`scripts/test-defense-targeting.mjs`（19 项）+ `tools/sim-defense-crowd.mjs`（真模块仿真）
  + `tools/perf-defense-targeting.mjs`（性能基准）。

---

### 跨表面 AI 寻路接入边界（城墙/楼梯）

- **分清目标与路线**：`PerceptionSystem`、指挥命令、队友跟随/撤退/施法站位、阵型和
  `TacticalSquadAI` 继续决定“要去哪里”；高架导航只把已选定目标翻译成地面入口、楼梯、墙顶
  航点，禁止改写索敌评分、威胁表或既有目标优先级。
- **禁止复用目标槽保存路线状态**：`target`、`_lastKnownTargetPos`、`_tacticalTarget`、
  `_specialTacticalTarget` 都有既有所有者。自动登墙应使用独立的 surface-nav intent/route/stage/
  revision/progress 状态，不能用中间楼梯节点覆盖语义目标。
- **保持地面 A* 职责**：地面单位先由 `PathManager/PathFinder` 走到楼梯入口；只有单位或当前航点
  已进入 `stairs/wall_walk` 时才启用 `_surfaceRouteActive` 并暂停地面路径修复。推荐阶段为
  `ground_approach → portal_queue → stair_traverse → wall_traverse → arrived`，下楼反向执行。
- **高架必须有独立恢复**：地面随机 reposition、普通 `_tryUnstuck` 和队友掉队瞬移不得在高架阶段
  运行；改用路线进度超时、统一表面回夹、当前 portal 重试或安全退回上一阶段。墙/楼梯拓扑变化时
  通过路线 revision 失效并重算，禁止继续追陈旧 `wallId/staircaseId`。
- **敌军按能力准入**：当前高架表面更新默认只覆盖玩家、队员和 `friendlyUnits`；敌军自动登墙时
  只登记显式具备 elevated-navigation 能力的单位。近战仅在高度差阻止攻击且存在合法楼梯路线时登墙；
  远程在当前射程与弹道有效时留在原层，不能全体无脑抢楼梯。
- **多单位交通必须排队**：楼梯按 portal/方向维护预约与超时，入口 FIFO；首个友军取得楼梯身份后
  同方向可单列流水通行，反方向保持互斥。墙顶终点再分配 footprint 内的站位槽；禁止让整组选中
  单位共享同一入口点或最终墙中心。
- **地面队列只规划终点槽，不做逐帧刚性编队（2026-08-23）**：复数 RTS 移动按真实地面 `u/v`
  坐标生成朝移动方向旋转的方阵，以最大单位半径确定安全间距，并在下令时用 O(n²) 最近槽分配一次。
  每个单位继续独立投影合法落点、寻路和避障；窄门/建筑可自然打散，禁止新增每帧队长追随、全组
  重排或共享单条刚性路径，否则会与墙体、高架、不同移速和寻路预算冲突。
- **指挥点击不等于索敌改造**：RTS 右键链路只负责屏幕点拾取、`resolveSurfaceTarget`、按单位选择
  可用楼梯和消费显式 route。修复“点击墙顶却走到墙下”时先查拾取与命令契约，不得顺手修改敌军
  `PerceptionSystem`。自主追击跨层目标才进入上述 surface-nav 适配层。

#### 自动登墙实现口径（2026-08-20）

- `ElevatedNavigationController` 只读取既有语义目标，路线状态固定放在 `_surfaceNav*`；地面接近仍走
  `PathManager`，进入楼梯/墙顶后才由表面航点接管。显式 RTS 路线与自主路线共用解析器，但不共用
  `_command` 所有权。
- 路线覆盖 `ground→wall`、`wall→ground`、同一连通墙链和“下楼→地面 A*→另一楼梯上墙”的异墙链；
  楼梯或墙拓扑变化通过 250ms 节流的 revision 签名使旧路线失效重算。
- 每座楼梯使用带方向的 FIFO 队列：首个入口持有者未取得楼梯身份前保持单持有者；取得后仅允许
  同方向友军追加为流水持有者，反方向与敌军仍互斥。预约 TTL、排队超时、入口半径、重规划周期和
  失败恢复上限全部由 `defense-structures.json.wallWalk.surfaceNavigation` 驱动；规划时把队列长度折算为
  入口代价，分流到较空闲楼梯。
- **入口等待态不得参与友军分离（2026-08-23）**：`_surfaceNavWaiting` 已由 FIFO 明确禁止穿越
  Portal；等待者若继续参与地面 unit-vs-unit 分离，会把获权者推出入口并让整个队列反复回靠。
  `shouldIgnoreFriendlyElevatedSeparation` 因此把队列态视为高架交通的一部分，只关闭相关友军之间的
  footprint 推挤；墙体、建筑、楼梯边线、防坠线、Portal 许可和反向互斥仍必须照常执行。
- **排队超时必须表示“无进展”（2026-08-23）**：长队不能从入队时起共享一个不再变化的绝对截止时间，
  否则队首持续通行时最后几人仍会超时重排。只在队首获权、前方条目取消/失效等导致该单位的 FIFO 顺位
  实际前进时重置等待窗口；重复 `request` 、普通每帧 `touch` 不得续期，保证真正停滞仍能进入恢复。
- **队列超时必须闭环回到重规划（2026-08-23）**：显式 RTS 路线退出 FIFO 后，下一帧必须释放旧预约、清旧路径、
  重算高架路线并允许重新入队。禁止用 `0` 作强制超时哨兵后再用 `value || now` 读取：`0` 会被每帧替换为
  当前时间，使超时信号永远无法触发恢复。时间哨兵应使用有限数检查，或写入 `now - progressTimeoutMs`。
- 友军卡死瞬移、随机 unstuck 与地面路径修复在排队/楼梯/墙顶阶段暂停；表面控制器使用进度超时重算，
  连续恢复失败后释放预约并延迟重试，避免永久占用入口。
- 所有高架位移入口都必须在位置解析前发布本帧实际移动意图。玩家由控制器写
  `_surfaceInputIntent`，走 `MovementSystem` 的 AI/友军也必须写同一字段；不能假定
  `_surfaceMoveChosenAxis` 总会兜底，因为该轴只在当前表面安装了 `_surfaceMoveAxes` 时生成，
  `wall_walk → stairs` 的 Portal 会在无意图时拒绝切面并让路线/交通预约一并停滞。
- 墙顶、楼梯、桥接帧及已接管的高架路线只能限制**位置积分 dt**（当前上限 34ms），路线超时、
  AI、动画等计时仍消费真实 dt；玩家与 AI 必须保持同口径，避免长帧跨过窄连接面后反复回夹。
- 敌军不是全量准入：`enemyArchetypes` 白名单当前只开放僵尸和黑狼近战。远程若本层已有射程与 LOS
  则不抢楼梯；近战的停步、起手、命中与骑士冲锋都必须同时满足二维范围和垂直可达条件。

#### 友军运行时脱困与墙体豁免边界（2026-08-23）

- `WallSystem.findSafeSpawn()` 只用于出生、房间切换和跨位面物化等生命周期落点校正，不能用于运行中
  卡死恢复。它只验证候选终点是否可站立，不验证当前位置到候选点的连通线段；直接把返回值写入
  `x/y` 会跨过墙段，让 A* 看似“失效”。
- 地面卡死恢复应保留语义目标和战术目标，只清理 `PathManager` 旧路径，让下一帧重新规划；确需局部
  挪动时只能采用 `WallSystem.resolve(current→candidate)` 返回的有界小步结果，不能搜索远端合法点后传送。
  长距离跟随也不能仅凭距离定时清路径，否则单位为绕墙暂时横移或远离目标时会反复丢失正确路线。
- `noCollision`、友军高架互穿和 `_elevatedNavigationBridge` 只允许缩小单位间分离，不能旁路墙段、门段、
  楼梯侧边或防坠线。`WallSystem.ignoreForEntity()` 必须同时确认 `stairs/wall_walk/active bridge` 表面身份、
  有效高度和当前承载墙；地面单位即使残留 `_surfaceWalls` 也必须返回完整墙体碰撞。
- 防御墙体的移动阻挡真源是与 footprint 同几何生成的 `_coverSeg`。玩家、队友、士兵和敌军统一消费
  这份 WallSystem 几何；不要再叠加按阵营不同的实体 footprint 豁免，否则会出现门洞二次推出或
  “玩家能挡、友军能穿”的双口径。

---

### 怪物近战打建筑零伤害排查（2026-08-16 三根因，僵尸啃掩体实测）

用户反馈：世界-122 怪物攻击掩体/墙壁，攻击距离足够、动画照播但零伤害。
CDP 探针 `tools/cdp-defense-hit.mjs`（真实场景注入僵尸/黑狼 + checkTriangleHit 打点）定位三层根因：

1. **CombatSystem swing 命中窗口时钟错配（总根因，全局影响）**：
   `attack.js` 2026-08-14 起 `_pendingThrust.startTime = nowMs()`（performance.now 单调时钟），
   读者 `enemy.js updateWeaponAnim` 同步改过，但 **`combat-system.js` 的 swing 分支漏改，仍用
   `Date.now()`** —— 墙钟减单调时钟恒为巨数 → 200ms 判定窗口永远过期 → `checkTriangleHit`
   永不执行。表现：攻击动画（windup→swing→recover）完整播放、`_pendingThrust` 存在但被置
   inactive，命中零伤害。**该坑 8-14 起影响所有敌人近战（不止建筑）**。修复：同源 nowMs()。
2. **distanceToEntityShape 对矩形建筑高估距离**：掩体/门 Collider 是半径 26 的小圆（圆心在
   墙段中点），长墙 198×133 被当成小圆 → 贴墙 24px 被算成 101.7px → dynamicRange 命中判定
   差 1.7px 落空。修复：`collision-helpers.js` 对 `collisionShape==='rect'` 的实体改算点到
   AABB 的最短距离（与 COVER_FOOT 中心偏移一致）。
3. **移动系统对结构目标不停车**：`_applyAttackRangeFriction` 用"目标中心距离"刹车，掩体中心
   在墙体后方永远到不了 → 怪沿墙滑行、路过判定窗口即挥空。修复：结构目标改用形状距离
   （distanceToEntityShape）刹车，怪贴在墙边停车持续输出。

修复后探针实测：僵尸贴墙真实挥砍命中（1100→1087→1076）、停在墙边；黑狼撕咬照常。
教训：时钟统一（nowMs）后所有读者必须同源；建筑类长条目标的"距离"一律按 footprint 形状算，
不能用中心点小圆近似。

### 常见陷阱：isReachable 步数限制导致路径计算失败

### 伊莉丝圣光 AI（2026-08-17：5 级解锁 + 治疗目标优先级）

- **解锁**：`data/companion-config.json` `warrior_bruno.unlockSkills = { holyLight: 5 }`（原 10 级在露娜档位，伊莉丝原本无圣光）。
  老档兜底：`Companion.fromSerialized` 存档无 unlockSkills 时回退配置档案（`s.unlockSkills || archive.unlockSkills`），读档/解散再招募即生效。
- **目标优先级**（`CompanionAI._pickHolyLightTarget`）：玩家（生命不满）→ 自己 → 其他队友（缺血最多者）→ 敌方（最近）。
  `_tryHolyLight` 挂在伊莉丝默认状态机与 aggressive/patrol 指令的顶部（防御/风车/攻击动画进行中不打断），冷却就绪且命中目标即出手，施法后 200ms 短硬直。
- **定向施法入口**：`HolyLightSystem.triggerOn(target)`——跳过鼠标瞄准/距离/视线三重判定，冷却/链式/结算口径与 `trigger()` 一致；非玩家源直接结算（伊莉丝无 spell 动画，不出玩家施法动作）。
- **友军判定坑**：圣光结算原用 `best._faction === src._faction`，而玩家 `player` / 队友 `companion` 阵营不同——伊莉丝奶玩家会被误判成"打敌人"。
  已统一为友方阵营组 `FRIENDLY_FACTIONS = {player, companion}`（与 damageable-entity.isFriendlyFire 同口径），`trigger()` 与 `triggerOn()` 同步修正。
- **验证**：`tools/cdp-elise-holylight.mjs` 实机四连用例（打点记录目标）：玩家 100→131、自己 115→144、队友 80→109、敌人 120→58（僵尸 ×2）；eslint / vite build / party 268 项全过。

### 伊莉丝动作显示尺寸统一（2026-08-17：attack/windmill 偏小）

- **2026-08-17 撤回**：用户实机反馈"放大后很奇怪"，displayScale 配置与 GameScene 改动
  已全部还原，恢复原渲染公式（本节保留排查数据，供将来参考）。

- **实测**（逐帧内容 bbox + CDP 读 Phaser 精灵显示尺寸）：idle 内容高 461px 渲染 129.7px；
  attack 平均 433px（站立帧 458~469 与 idle 一致，但挥剑帧自然倾斜 367~430 占多数）渲染 121.8px
  （-6%）；windmill 平均 399px 渲染 112px（-13.5%）。用户反馈"施法/攻击缩小"属实。
- **修复（配置驱动，不改 PNG）**：`companion-config animations.attack.displayScale=1.065`、
  `windmill.displayScale=1.155`；GameScene 归一化 `setDisplaySize(格宽×normS×k, 格高×normS×k)`，
  脚底修正同步为 `0.4375×(512−格高×k)×normS`——放大后脚底仍贴同一世界线（实测三动作脚底 y 一致）。
  其他动作无 displayScale → k=1，行为不变。
- **坑**：直接量帧格尺寸没用，要看"内容占比×显示映射"；渲染侧归一化已按帧格线性映射，
  内容占比不同的动作需要逐动作 displayScale；CDP 探针直接读 `sprite.displayWidth/Height` + `frame` 最准。

### 露娜动作显示尺寸统一（2026-08-17：walk/run/spell 偏小）

- **2026-08-17 撤回**：与伊莉丝同批撤回，displayScale 配置已删除，恢复原渲染。

- **实测**：露娜全 512×512 帧格，idle 内容 498~500px；walk/run/spell 都是 467~471px
  （约小 6%），多阈值（40/128/200）复核非阴影伪影。CDP 实机：idle 渲染 140.1px、
  walk/run/spell 渲染 132.5px。
- **修复**：`companion-config animations.walk/run/spell.displayScale = 1.062`（复用伊莉丝同款
  渲染机制，GameScene 无需再改）；实测显示 144→153、内容 132.5→140.1px 与 idle 对齐，
  脚底修正同步后与 idle/伊莉丝同线（y≈2001）。
- **教训**：全 512 帧格也会内容占比不同——只要内容高度不一致就要 displayScale，
  不能因为帧格相同就默认等大。

#### 问题
`PathFinder.isReachable()` 使用 Flood Fill 检查区域连通性，但步数限制太死：

```javascript
// 错误：步数 = ceil(maxDist / step) + 5
// 目标距离 383px，gridSize=40，步数 = ceil(383/40)+5 = 15
// 15 步 BFS 根本到不了目标，直接返回 false，A* 根本没跑
const maxSteps = Math.ceil(maxDist / step) + 5;
```

这导致黑狼被卡在树木边缘（距离=53，总阻挡=53）时，路径计算完全失败，单位没有路径，只能直线移动 → 撞墙卡住。

#### 修复
```javascript
// 正确：步数 = ceil(maxDist / step) * 3 + 20
// 383px 距离 → 49 步，BFS 能正常探索到目标
const maxSteps = Math.ceil(maxDist / step) * 3 + 20;

// 步数用完也不返回 false，让 A* 继续尝试（A* 有 maxIterations 超时保护）
return true;
```

#### 诊断方法
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

### 伪 3D 碰撞重构记录（进行中）

#### Phase 0：统一 Collider 数据层 ✅
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

#### Phase 1：地面碰撞统一为圆形 footprint ✅
1. `game.js::resolveCollisions()` 从“矩形/六边形/圆形多套分离”简化为统一的圆-圆分离，使用 `groundRadius`。
2. `MovementSystem`、玩家移动、敌人 AI、冲刺、击退、`PathManager`、`DynamicObstacleMap` 全部改用 `groundRadius`。
3. `WallSystem` 的树木新增 `height` 字段，为未来飞行单位做准备。
4. 玩家 footprint 按方案 A 改为圆形，半径保持 30（与原 `collisionRadius` 一致）。

#### Phase 2：投射物判定 3D 化 + 空间网格 broadphase ✅
1. `src/combat/projectile.js` 重写命中判定：
   - 投射物增加 `z` / `prevZ`，轨迹视为 3D 线段。
   - 使用 `segmentIntersectsCapsule` 与目标 Collider 胶囊体做精确检测。
   - 移除旧的 2D 矩形扩张 / 圆心距离判定。
2. Broadphase：
   - 复用现有 `SpatialPartitionSystem.queryRadius`。
   - 以投射物本帧路径中点为中心，查询半径 = `stepLen + 160`，只检测附近实体。
   - SpatialPartitionSystem 不可用时回退到全量遍历。
3. 自然支持高低差：地面投射物 z=0，飞行单位 z>0 时自动打不到；未来抛物线/对空投射物只需设置 z。

#### 后续 Phase 状态（2026-07-17 核实，均已完成）
- Phase 3：近战 / 技能 AOE 3D 化 ✅（变更记录 v2.0）
- Phase 4：场景贴图 Y 深度排序 ✅（变更记录 v2.1）
- Phase 5：清理旧命中系统与可视化对齐 ✅（变更记录 v2.2）
- 详见下方"变更记录" v2.0–v2.4

#### 补充：投射物躯干矩形判定（方案 B，2026-07-17）✅

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

### 树木碰撞体优化（大怪物卡树问题）

#### 问题
黑狼碰撞体积 38 虽然不大，但在树木（视觉半径 25，碰撞半径 25）间移动时仍会被卡住。因为 `canMoveTo` 判定的是 `tree.radius + entity.radius < distance`，视觉半径和碰撞半径未分离。

#### 解决
1. **视觉半径和碰撞半径分离**：每棵树的 `collisionRadius = radius × 0.6`（主神空间树木从 25 降到 15）
2. **滑动回退**：`WallSystem.resolve()` 在标准 X/Y 轴滑动都失败后，尝试按 75%/50%/25% 步长找到可移动的最远位置，避免完全卡住

#### 新增属性
```javascript
addTree(x, y, radius, ...) {
    const collisionRadius = radius * 0.6;  // 碰撞半径仅为视觉的60%
    // ...
}
```

所有使用 `t.radius` 的位置（`canMoveTo`、`blocked`、Phaser 同步）统一使用 `t.collisionRadius || t.radius * 0.6`。

---

### Dash 偏移计算（_getDashOffset 统一接口）

#### 问题
`GameScene.js` 的 `_syncBodiesToPhysics` 中有一段 12 行的 switch 逻辑，用于根据 `_dashAngle` 或 `_dashStartFacing` 计算冲刺偏移量。这段逻辑在 `enemy-types.js`（BlackWolf）中也存在。

#### 解决
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

### 阶段性进度总结（2026-08-03：怪物寻路全面审计 + 性能优化落地）

#### 背景（全量审计实测，2026-08-03）
冷路径 findPath ≈ 10ms（`_buildGrid` 占 92%）；刷怪瞬间 15 只怪同帧冷寻路可达 50~115ms
主线程卡顿；不可达目标每 500ms 卡住重算重复付冷 A*（20ms/次）；冰墙生成/破碎误调
`invalidateCache()`（临时冰墙改用 `_iceWall` 单线 + `invalidateRegion` 局部失效）；
墙体碰撞对全部墙/线段/树线性扫描。

#### 本次完成
1. **静态格子记忆化**：`_getCellData` 合并 blocked+moveCost 单趟查询，按 `(格子坐标, 半径)`
   跨寻路复用；`_buildGrid` 原点对齐 gridSize 倍数 → 15 怪同帧批量 106ms→~10ms。
2. **每帧寻路预算**：`PATH_DEFERRED` 哨兵 + `beginFrame()` 帧预算（3ms），超预算保留旧路径
   下帧重试，杜绝同帧多怪冷寻路叠加。
3. **不可达负缓存**（500ms TTL）+ **出口路径短缓存**：重复失败 20ms→0.01ms。
4. **首寻路错峰**：PathManager 创建后 0~250ms 随机延迟，刷怪同帧错开。
5. **墙体碰撞空间网格**：walls/isoSegments/trees 经代理自动标脏 + 128px 惰性网格，
   resolve 提速 ~11×（20 怪 × 3 resolve/帧 1.40ms→0.12ms）。
6. **分离/侧翼空间分区**：`_computeSeparation`/`_computeFlankOffset` 改
   `SpatialPartitionSystem.queryRadius`，替代每怪每帧遍历全部实体。
7. **冰墙缓存失效删除**：`ice-wall-system` 不再调 `invalidateCache()`（约束已写死）。
8. **P3 收尾**：`setPath` 防御性拷贝（修共享缓存数组别名）、`_setCache` LRU、
   console.warn 1s 节流、删除死代码 `isReachableByRegion`。

#### 验证
- eslint 0 error / `vite build` ✓ / `npm test` 全绿（新增 collision-grid 差分 12 + 寻路基准 27）。
- 回归防线已入 `npm test`：`tools/pathfinding-bench.mjs`（合成战斗房基准+宽松阈值）、
  `scripts/test-collision-grid.mjs`（线性 vs 网格差分：12 场景×250 查询 + 变更追踪 + 空场景）。

#### 关键改动文件
`src/ai/pathfinder.js`、`src/ai/path-manager.js`、`src/systems/movement-system.js`、
`src/world/wall-system.js`、`src/entities/components/ice-wall-system.js`、`src/game.js`、
`scripts/test-collision-grid.mjs`、`tools/pathfinding-bench.mjs`、`tools/pathfinding-hooks.mjs`、
`package.json`。

#### 后续方向（已评估，暂缓）
- `findPathToExit` 的 RegionIndex 按房间 bounds 限定（当前全墙 bounds，负缓存+预算已兜底）。
- 冷路径首建 ~10ms 的"按障碍物栅格化"优化（预算下单帧一次，收益边际）。
- 跨房间怪物追踪（门闸软成本进寻路等）——需设计确认，非实现项。

---
