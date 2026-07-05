# 地牢地图系统 — 完整设计文档

## 1. 设计概述

将场景六（`scene6`）从"自由移动测试地图"改造为**杀戮尖塔风格的走格子地牢系统**：

- 玩家进入场景后，看到一张节点网格地图
- 节点类型：起点 → 战斗/商店/事件 → Boss
- 点击相邻节点后进入对应事件
- 战斗节点**就地生成**封闭房间 + 怪物，打完回到地图
- 不修改 `SceneManager.switchScene`，最小化侵入现有代码

---

## 2. 文件结构

```
src/
├── world/
│   ├── scene-manager.js          ← 修改：_loadScene6() 末尾初始化 DungeonMapSystem
│   ├── dungeon-map-system.js     ← 新增：本系统核心代码
│   └── wall-system.js            ← 复用：战斗房间直接修改 walls 数组
├── game.js                       ← 修改：update() / render() 插入条件分支
├── entities/
│   └── enemy.js                  ← 复用：new Enemy() 生成战斗怪物
└── ui/
    └── shop-system.js            ← 复用：_enterShop() 用虚拟 NPC 打开商店
```

---

## 3. 核心类定义：DungeonMapSystem

| 属性 / 方法 | 说明 |
|-------------|------|
| `active` | 是否处于地牢地图模式 |
| `state` | 当前状态：`map` / `combat` / `shop` / `event` / `boss` |
| `nodes[]` | 节点数组，含 id / row / col / x / y / type |
| `edges[]` | 有向边数组，from → to |
| `currentNodeId` | 玩家当前所在节点 |
| `visitedNodeIds` | 已访问节点集合 |
| `init(sceneId, player)` | 初始化地图，生成节点，冻结玩家，固定相机 |
| `generateMap()` | 生成 5 行网格节点 + 连接边 |
| `update(dt)` | 地图模式：处理鼠标悬停与点击 |
| `updateCombat(dt)` | 战斗模式：每 500ms 检查怪物是否全部死亡 |
| `render(ctx)` | 地图模式：绘制节点、边、标题、进度 |
| `_enterNode(node)` | 根据节点类型分发到对应事件 |
| `_returnToMap()` | 从事件返回地图选择界面 |
| `_generateRoom(isBoss)` | **就地生成战斗房间**：修改 WallSystem.walls |
| `_spawnMonsters(count, isBoss)` | 在房间内生成怪物到 Game.entities |
| `_checkCombatComplete()` | 检查怪物全灭，清理并返回地图 |
| `_enterShop()` | 创建虚拟 NPC，打开 ShopSystem |
| `_enterEvent()` | 显示 DOM 覆盖层事件对话框 |
| `_showVictory()` | Boss 击败后显示通关 UI |

---

## 4. 节点网格生成算法

### 目标
生成 5 行、每行 3-4 个节点的垂直网格，相邻行之间有向边连接，保证从起点到 Boss **至少有一条路径**。

### 步骤

```
行 0 (y=900):  1 个节点  [起点]
行 1 (y=700):  3 个节点  [combat/shop/event]
行 2 (y=500):  4 个节点  [combat/shop/event]
行 3 (y=300):  3 个节点  [combat/shop/event]
行 4 (y=100):  1 个节点  [Boss]
```

**Step 1 — 逐行生成节点**：
X 坐标均匀分布在 `MAP_PADDING` ~ `1024 - MAP_PADDING` 之间。

**Step 2 — 生成边**：
对于每个节点，在下一行节点中按 X 距离排序，取最近的 1-2 个建立有向边。

**Step 3 — 补入边**：
遍历所有非起点节点，若没有任何入边，则从上一行最近的节点补一条边。

**Step 4 — 补出边**：
遍历所有非 Boss 节点，若没有任何出边，则从下一行最近的节点补一条边。

### 结果
- 节点总数：12
- 边数：约 10-15
- 图结构保证连通性，同时存在分支选择（多条路线）

---

## 5. 玩家走格子交互逻辑

### 状态机

```
[map] --点击节点--> [combat/shop/event/boss]
  ↑                      |
  └------完成事件--------┘
```

### 地图模式 (`state === 'map'`)

1. **相机固定**：`Camera.x = 512, Camera.y = 512`，禁用跟随
2. **Game.update() 提前返回**：不更新实体、不处理移动、不计算碰撞
3. **Input 接管**：`DungeonMapSystem.update()` 检测鼠标悬停和点击
4. **悬停检测**：用 `Renderer.worldToScreen()` 将节点世界坐标转为屏幕坐标，计算与鼠标距离
5. **可点击范围**：仅限从 `currentNode` 出发有边可达的下一行节点

### 点击后的流程

```javascript
// 点击可用节点
_enterNode(node) {
    currentNodeId = node.id;      // 玩家"移动"到该节点
    visitedNodeIds.add(node.id);   // 标记已访问
    
    switch(node.type) {
        case 'combat': _enterCombat(); break;  // 生成房间+怪物
        case 'boss':   _enterBoss();   break;  // 生成大房间+Boss
        case 'shop':   _enterShop();   break;  // 打开商店 UI
        case 'event':  _enterEvent();  break;  // 显示事件对话框
    }
}
```

---

## 6. 战斗节点"就地生成地牢"方案

### 核心设计
**不切换场景**，直接在 `scene6` 的 1024×1024 世界内围出一个房间，打完恢复。

### 步骤详解

#### 1. 备份状态
```javascript
_backupWalls = [...WallSystem.walls];       // 备份边界墙壁
_backupCameraFollow = Camera.follow;       // 备份相机跟随函数
```

#### 2. 生成房间墙壁
在场景中央（512, 512）围出一个矩形房间，四边墙壁 + 底部入口：

```
房间大小：420×420（Boss 战 520×520）
墙壁厚度：24px
入口宽度：100px（底部中央）

   ┌─────────────────────────┐
   │                         │
   │                         │
   │      怪物生成区域        │
   │                         │
   │                         │
   └───              ───────┘
        ↑ 入口 (100px)
       玩家初始位置
```

墙壁数组直接替换 `WallSystem.walls`：
```javascript
WallSystem.walls = [
    { x: 302, y: 302, w: 420, h: 24 },   // 上
    { x: 302, y: 326, w: 24, h: 372 },   // 左
    { x: 698, y: 326, w: 24, h: 372 },   // 右
    { x: 302, y: 698, w: 189, h: 24 },   // 下左（入口左侧）
    { x: 511, y: 698, w: 211, h: 24 },   // 下右（入口右侧）
];
```

然后调用 `WallSystem._syncWallsToPhaser()` 同步到 Phaser 物理碰撞体。

#### 3. 生成怪物
使用现有 `Enemy` 类：
```javascript
const monster = new Enemy(x, y, {
    hp: 80 + random(80), size: 18-28,
    name: '骷髅战士 1', color: '#8a8a8a',
    speed: 90 + random(30), expValue: 25-45
});
Game.entities.set('dungeon_monster_...', monster);
```

#### 4. 战斗检测
`Game.update()` 正常执行（实体移动、攻击、碰撞），
`DungeonMapSystem.updateCombat(dt)` 每 500ms 检查：
```javascript
const allDead = monsters.every(m => !m.active || m.hp <= 0);
if (allDead) {
    // 清理怪物实体
    // 恢复 WallSystem.walls
    // 恢复 Camera 跟随
    // 返回地图模式
}
```

#### 5. 清理恢复
```javascript
_cleanupCombat() {
    Game.entities.delete(monsterKey);   // 删除所有怪物
    WallSystem.walls = [..._backupWalls]; // 恢复边界墙壁
    WallSystem._syncWallsToPhaser();     // 同步到 Phaser
}
```

---

## 7. 集成步骤（现有代码最小化修改）

### 修改点 1：scene-manager.js `_loadScene6()`
在方法末尾（`if (player) { QuickBar.refreshSpecialAttack(player); }` 之后）添加：

```javascript
// 初始化地牢地图系统
if (typeof DungeonMapSystem !== 'undefined') {
    DungeonMapSystem.init('scene6', player);
}
```

### 修改点 2：game.js `update()`
在 `update(dt)` 方法开头（`if (this._paused)` 之前）插入：

```javascript
// === 场景六：地牢地图系统接管 ===
if (SceneManager.currentScene === 'scene6' && typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem.active) {
    if (DungeonMapSystem.state === 'map') {
        DungeonMapSystem.update(dt);
        EffectManager.update(dt);
        QuickBar.updateCooldowns(dt);
        NPCDialogue.update();
        Input.update();
        return;  // 地图模式下跳过所有实体更新
    } else if (DungeonMapSystem.state === 'combat' || DungeonMapSystem.state === 'boss') {
        DungeonMapSystem.updateCombat(dt);
    }
}
```

### 修改点 3：game.js `render()`
在 `render()` 方法开头（`Renderer.clear()` 之前）插入：

```javascript
// === 场景六：地牢地图模式渲染 ===
if (SceneManager.currentScene === 'scene6' && typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem.active && DungeonMapSystem.state === 'map') {
    Renderer.clear();
    DungeonMapSystem.render(Renderer.ctx);
    return;  // 地图模式下不渲染实体
}
```

### 导入新模块
在 `scene-manager.js` 顶部添加：
```javascript
import { DungeonMapSystem } from './dungeon-map-system.js';
```

在 `game.js` 顶部添加：
```javascript
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
```

---

## 8. 关键代码示例

### 节点生成（generateMap）
```javascript
generateMap() {
    const rowNodeCounts = [1, 3, 4, 3, 1];
    const rowYPositions = [900, 700, 500, 300, 100];

    // 生成节点
    for (let row = 0; row < 5; row++) {
        const count = rowNodeCounts[row];
        const spacing = (1024 - 160) / (count + 1);
        for (let col = 0; col < count; col++) {
            this.nodes.push({
                id: `node_${row}_${col}`,
                row, col,
                x: 80 + spacing * (col + 1),
                y: rowYPositions[row],
                type: row === 0 ? 'start' : row === 4 ? 'boss' : randomType()
            });
        }
    }

    // 生成边 + 补全孤立节点
    // ...（见完整代码）
}
```

### 战斗房间生成（_generateRoom）
```javascript
_generateRoom(isBoss) {
    const roomSize = isBoss ? 520 : 420;
    const t = 24;  // 墙厚
    const cx = 512, cy = 512, half = roomSize / 2;
    const rx = cx - half, ry = cy - half;
    const entranceW = 100, entranceX = cx - entranceW / 2;

    WallSystem.walls = [
        { x: rx, y: ry, w: roomSize, h: t },                    // 上
        { x: rx, y: ry + t, w: t, h: roomSize - t * 2 },        // 左
        { x: rx + roomSize - t, y: ry + t, w: t, h: roomSize - t * 2 }, // 右
        { x: rx, y: ry + roomSize - t, w: entranceX - rx, h: t },       // 下左
        { x: entranceX + entranceW, y: ry + roomSize - t, w: rx + roomSize - (entranceX + entranceW), h: t }, // 下右
    ];

    WallSystem._syncWallsToPhaser();  // 同步到 Phaser

    this.player.x = cx;
    this.player.y = ry + roomSize - t - 60;  // 入口内侧
}
```

### 地图渲染（render）
```javascript
render(ctx) {
    // 1. 绘制连接线（已访问=绿色，可用=金色，其他=暗灰）
    for (const edge of this.edges) {
        // 根据状态设置 strokeStyle 和 lineWidth
        // Renderer.worldToScreen() 转换坐标
    }

    // 2. 绘制节点（圆形 + 图标 + 光晕）
    for (const node of this.nodes) {
        const pos = Renderer.worldToScreen(node.x, node.y);
        // 根据 isCurrent / isVisited / isAvailable / isHovered 设置样式
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillText(TYPE_ICONS[node.type], pos.x, pos.y);
    }

    // 3. 顶部标题 + 底部进度
    ctx.fillText('⚔ 地牢深处 — 选择你的道路', w / 2, 50);
}
```

---

## 9. 扩展性

| 扩展点 | 实现方式 |
|--------|----------|
| 更多节点类型 | 在 `TYPE_COLORS` / `TYPE_ICONS` / `_enterNode` 中添加新分支 |
| 更复杂的房间 | 替换 `_generateRoom` 中的 walls 数组，使用 DungeonGenerator 的模板 |
| 难度递增 | 在 `_spawnMonsters` 中根据 `row` 调整怪物 hp / speed |
| 持久化 | 将 `visitedNodeIds` / `currentNodeId` 存入 localStorage |
| 多人联机 | 同步 `nodes` / `edges` / `currentNodeId` 到服务器 |

---

*文档版本：v1.0 | 对应代码文件：`src/world/dungeon-map-system.js`*
