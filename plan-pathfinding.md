# 智能寻路系统设计方案（参考《环世界》）

## 现状分析

**现有系统（`src/ai/pathfinder.js` + `movement-system.js`）的问题：**
1. **被动寻路**：只在卡住（500ms 移动 < 3px）时才触发寻路，而非主动预规划
2. **无路径有效性检查**：路径生成后从不检查路径上是否出现新障碍物
3. **无局部修复**：卡住时要么完全重算整条路径，要么随机转向
4. **无权重系统**：所有格子移动成本相同（直线=1.0，对角线=1.414）
5. **频繁重算**：每次卡住都重新计算整条路径，CPU 开销大

---

## 《环世界》寻路机制参考

### 1. 区域系统（Region / Area）
将地图划分为连通区域，寻路前先用 BFS/ Flood Fill 判断起点和目标是否在同一区域。如果不在同一区域，直接返回不可达，避免昂贵的 A* 计算。

### 2. 路径权重
- 普通地面：1.0
- 沙地/泥地：1.5-2.0
- 浅水：10.0
- 墙/不可通行：∞
- 拥挤区域：1.3（其他单位附近）

### 3. 路径缓存与复用
- 计算好的路径会缓存一段时间
- 相同起点和终点复用缓存路径
- 缓存受墙壁变化时失效

### 4. 定期重算
每 1-2 秒检查一次路径是否仍然有效，不是每帧检查。

### 5. 局部修复（Patch Path）
当路径上的某个节点被阻挡时：
- 在阻挡点前后取一段范围
- 只在这一段内重新搜索替代路径
- 如果找到，拼接回原路径；找不到，从阻挡点重新计算到终点

### 6. 路径队列
多个单位同时请求路径时排队处理，避免帧率骤降。

---

## 市面上类似机制

| 游戏/引擎 | 机制 | 特点 |
|-----------|------|------|
| Unity NavMesh | 导航网格 + 局部避障 | 静态网格预烘焙，动态避障用 RVO |
| Unreal Navigation | 类似 NavMesh | 支持动态障碍物 |
| Starcraft II | 流场（Flow Field） | 大量单位共用流场，性能极高 |
| Factorio | 预计算路径 + 碰撞预测 | 单位移动前先预测碰撞，提前减速 |
| Stardew Valley | A* + 定期重算 | 简单但有效，适合低密度单位 |

**本项目适合的方向：** A* + 路径缓存 + 局部修复 + 权重系统（单位数量 < 50，不需要流场）

---

## 设计方案

### 架构图

```
Enemy
  ├── PathManager（新增）
  │     ├── pathCache: 当前路径数组
  │     ├── pathIdx: 当前路径索引
  │     ├── pathCheckTimer: 路径检查计时器（1.5-2.5s）
  │     ├── pathValidityTimer: 有效性检查计时器
  │     ├── isPathValid(): 扫描路径上的所有节点
  │     ├── repairPath(): 局部修复
  │     └── invalidatePath(): 标记路径失效
  │
  ├── PathPlanner（增强现有 PathFinder）
  │     ├── buildGrid(): 增加权重计算
  │     ├── findPath(): 支持权重 A*
  │     ├── floodFillRegion(): 区域连通性检查
  │     └── pathCache: 全局路径缓存（Map<key, path>）
  │
  └── MovementSystem（修改）
        ├── update(): 主动预规划（有目标但无路径时立即计算）
        ├── _followPath(): 跟随路径点
        └── _computeMoveDirection(): 优先使用路径
```

### 模块1：PathManager（`src/ai/path-manager.js`）

每个 Enemy 实例一个 PathManager，管理自己的路径：

```javascript
class PathManager {
    constructor(enemy) {
        this.enemy = enemy;
        this.path = null;           // 当前路径
        this.pathIdx = 0;           // 当前索引
        this.checkInterval = 1500;  // 检查间隔 ms
        this.checkTimer = 0;        // 检查计时器
        this.isValid = false;       // 路径是否有效
    }

    // 设置新路径
    setPath(path) {
        this.path = path;
        this.pathIdx = 0;
        this.isValid = true;
        this.checkTimer = this.checkInterval;
    }

    // 每帧更新：检查路径有效性
    update(dt, pathPlanner) {
        if (!this.path || !this.isValid) return;
        this.checkTimer -= dt;
        if (this.checkTimer > 0) return;
        this.checkTimer = this.checkInterval;
        this._checkValidity(pathPlanner);
    }

    // 检查路径有效性：扫描路径上的所有节点
    _checkValidity(pathPlanner) {
        for (let i = this.pathIdx; i < this.path.length; i++) {
            const node = this.path[i];
            if (pathPlanner.isBlocked(node.x, node.y, this.enemy.collisionRadius || 12)) {
                this._repairPath(i, pathPlanner);
                return;
            }
        }
    }

    // 局部修复：在障碍物附近搜索替代路径
    _repairPath(blockedIdx, pathPlanner) {
        const prevIdx = Math.max(0, blockedIdx - 1);
        const nextIdx = Math.min(this.path.length - 1, blockedIdx + 1);
        const start = this.path[prevIdx];
        const end = this.path[nextIdx];

        // 小范围搜索替代路径
        const altPath = pathPlanner.findPathLocal(start.x, start.y, end.x, end.y, this.enemy.collisionRadius || 12);

        if (altPath && altPath.length > 0) {
            // 替换中间段：保留前半段 + 替代段 + 后半段
            const before = this.path.slice(0, prevIdx + 1);
            const after = this.path.slice(nextIdx);
            this.path = [...before, ...altPath.slice(1, -1), ...after];
            this.isValid = true;
        } else {
            // 局部修复失败，从阻挡点重新计算到终点
            const finalTarget = this.path[this.path.length - 1];
            const newPath = pathPlanner.findPath(start.x, start.y, finalTarget.x, finalTarget.y, this.enemy.collisionRadius || 12);
            if (newPath) {
                this.path = [...this.path.slice(0, prevIdx + 1), ...newPath.slice(1)];
                this.isValid = true;
            } else {
                this.isValid = false; // 完全不可达
            }
        }
    }

    // 获取当前目标路径点
    getCurrentWaypoint() {
        if (!this.path || this.pathIdx >= this.path.length) return null;
        return this.path[this.pathIdx];
    }

    // 前进到下一个路径点
    advanceWaypoint() {
        if (this.pathIdx < this.path.length) this.pathIdx++;
    }
}
```

### 模块2：PathPlanner 增强（`src/ai/pathfinder.js`）

在现有 A* 基础上增加：

1. **地形权重计算**：
```javascript
_getMoveCost(x, y, radius) {
    let cost = 1.0;
    // 检查树木附近
    for (const t of WallSystem.trees) {
        const d = Math.sqrt((x - t.x)**2 + (y - t.y)**2);
        if (d < (t.collisionRadius || t.radius * 0.6) + radius * 1.5) {
            cost += 0.5; // 树木附近增加成本
        }
    }
    // 检查其他单位附近
    if (typeof Game !== 'undefined' && Game.entities) {
        for (const e of Game.entities.values()) {
            if (e === this || !e.active || e.hp <= 0) continue;
            const d = Math.sqrt((x - e.x)**2 + (y - e.y)**2);
            if (d < radius * 2.5) {
                cost += 0.3; // 其他单位附近增加成本
            }
        }
    }
    return cost;
}
```

2. **区域连通性检查**：
```javascript
isReachable(startX, startY, endX, endY, entityRadius) {
    // 使用 Flood Fill 判断起点和终点是否在同一区域
    // 如果不在同一区域，返回 false，避免 A* 计算
}
```

3. **局部搜索**：`findPathLocal`（搜索范围较小，用于局部修复）

4. **路径缓存**：全局缓存 Map，key = `startX,startY,endX,endY,radius`

### 模块3：MovementSystem 修改（`src/systems/movement-system.js`）

1. **主动预规划**：
```javascript
update(enemy, dt, entities) {
    // ... 现有代码 ...
    // 主动预规划：有目标但没有路径时，立即计算路径
    if (enemy.target && enemy.target.active && !enemy._pathManager?.path) {
        const path = pathPlanner.findPath(enemy.x, enemy.y, enemy.target.x, enemy.target.y, enemy.collisionRadius || 12);
        if (path) enemy._pathManager.setPath(path);
    }
    // ... 现有代码 ...
}
```

2. **移除被动卡住寻路**：卡住检测仍然保留，但优先使用路径管理器

3. **定期调用 PathManager.update()**：在 MovementSystem.update 中每帧调用

---

## 实现计划

### 阶段1：PathManager 核心（`src/ai/path-manager.js`）
- 新建文件，实现路径管理、有效性检查、局部修复
- 集成到 Enemy 构造函数
- 在 MovementSystem 中每帧调用

### 阶段2：PathPlanner 增强（修改 `src/ai/pathfinder.js`）
- 增加 `_getMoveCost` 权重计算
- 增加 `isReachable` 区域连通性检查
- 增加 `findPathLocal` 局部搜索（小范围）
- 增加全局路径缓存

### 阶段3：MovementSystem 集成（修改 `src/systems/movement-system.js`）
- 主动预规划：有目标无路径时立即计算
- 移除被动寻路作为唯一触发条件
- 每帧调用 `enemy._pathManager.update(dt)`
- 路径跟随逻辑使用 PathManager 的 API

### 阶段4：Enemy 集成（修改 `src/entities/enemy.js`）
- 构造函数中创建 `this._pathManager = new PathManager(this)`
- `_updateMovement` 优先使用 PathManager 的路径

### 阶段5：测试与调优
- 测试树木间移动
- 测试墙壁绕行
- 测试动态障碍物（门关闭）
- 调优权重参数和检查间隔

---

## 预期效果

1. **更智能的移动**：单位会主动预规划路径，而不是等卡住才反应
2. **更好的障碍物绕行**：定期检测路径有效性，遇到新障碍物时局部修复
3. **更自然的行为**：树木附近会自然绕行，避免硬穿（权重系统）
4. **性能提升**：路径缓存减少重复计算，区域连通性检查避免无效 A*
5. **更流畅**：局部修复比完全重算更平滑，单位不会突然转向

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/ai/path-manager.js` | 新建 | 核心路径管理器 |
| `src/ai/pathfinder.js` | 修改 | 增加权重、区域检查、局部搜索、缓存 |
| `src/systems/movement-system.js` | 修改 | 主动预规划 + PathManager 集成 |
| `src/entities/enemy.js` | 修改 | 集成 PathManager |
| `SKILL.md` | 更新 | 记录寻路系统设计 |
| `CHANGELOG.md` | 更新 | 记录变更 |
