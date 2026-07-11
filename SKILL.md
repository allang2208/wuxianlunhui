# Sprite Pipeline 技能文档

## 版本: 1.4

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
