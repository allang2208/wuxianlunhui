# DungeonMapGenerator 与现有系统集成说明

## 集成概述

DungeonMapGenerator 已集成到现有地牢系统中，主要修改了以下文件：

## 1. 新增文件

### `game-dev/src/world/dungeon-map-generator.js`
- **DungeonMapGenerator 类** — 核心地图生成器
- **DungeonFogOfWar 类** — 迷雾系统
- **DUNGEON_MAP_CONFIG** — 默认配置对象

## 2. 修改文件

### `game-dev/src/world/dungeon-map-system.js`

#### 导入新增
```javascript
import { DungeonMapGenerator, DungeonFogOfWar, DUNGEON_MAP_CONFIG } from './dungeon-map-generator.js';
```

#### 属性变更
- 新增 `fogOfWar` 属性（DungeonFogOfWar 实例）
- 新增 `TYPE_COLORS.reward` / `TYPE_COLORS.empty`
- 新增 `TYPE_BORDER_COLORS.reward` / `TYPE_BORDER_COLORS.empty`
- 新增 `TYPE_ICONS.reward` / `TYPE_ICONS.empty`

#### 方法变更

| 方法 | 变更类型 | 说明 |
|------|---------|------|
| `init()` | 修改 | 初始化迷雾系统，访问起点 |
| `_generateDefaultMap()` | 重写 | 使用 DungeonMapGenerator 替代旧网格生成 |
| `_enterNode()` | 修改 | 添加迷雾更新、empty 处理、reward 支持 |
| `_enterReward()` | 新增 | 打开奖励界面（复用 RewardSystem） |
| `_checkCombatComplete()` | 修改 | 战斗完成后节点转为 empty |
| `render()` | 修改 | 集成迷雾渲染（未访问显示 ?） |
| `_returnToMap()` | 未变 | 返回地图状态 |
| `_enterCombat()` | 未变 | 进入战斗 |
| `_enterBoss()` | 未变 | 进入Boss战 |
| `_enterShop()` | 未变 | 进入商店 |
| `_enterEvent()` | 未变 | 进入事件（优先使用 dungeon-event-system） |

### `game-dev/src/ui/expedition-system.js`

#### 修改内容
- 更新默认地牢描述，反映新地图特性（35-40节点、9场最短路径）
- 更新奖励描述为 "4500 金币 + 三选一奖励"

## 3. 未修改文件（无需变更）

- `game-dev/src/world/scene-manager.js` — 已兼容，自动调用 DungeonMapSystem.init()
- `game-dev/src/ui/reward-system.js` — 已兼容，通过 RewardSystem.open() 复用
- `game-dev/src/world/zombie-dungeon.js` — 僵尸地牢不受影响

## 4. 集成流程

### 进入地牢流程
```
ExpeditionSystem.depart()
  → DungeonMapSystem.init('scene6', player, 'default')
    → generateMap() → DungeonMapGenerator.generate()
    → fogOfWar.visit(startNode)
    → 显示地图界面
```

### 点击节点流程
```
玩家点击节点
  → _handleClick() → _enterNode(node)
    → fogOfWar.visit(node.id)
    → 根据 node.type 分发：
      - combat → _enterCombat() → 战斗完成后 → empty
      - event → _enterEvent() → 事件结果 → 返回地图
      - boss → _enterBoss() → 战斗完成后 → _showVictory()
      - reward → _enterReward() → RewardSystem.open() → 返回地图
      - empty → 直接返回地图
```

### 返回地图流程
```
战斗/事件/奖励结束
  → _returnToMap()
    → 检查当前节点是否为 boss + 已访问 → _showVictory()
    → 重新渲染地图（迷雾已更新）
```

## 5. 数据流

### 节点状态转换
```
combat → empty（战斗完成后）
event → 不变（事件可重复触发）
boss → 不变（Boss只能打一次）
reward → 不变（奖励只能领一次）
```

### 迷雾状态转换
```
hidden → revealed（相邻节点被访问时）
revealed → visited（节点被访问时）
```

## 6. 兼容性说明

### 向后兼容
- 僵尸地牢（dungeonType='zombie'）完全不受影响
- 旧的事件UI降级方案仍然可用（dungeon-event-system.js 加载失败时）
- 所有现有全局依赖保持不变

### 新依赖
- `RewardSystem` — 用于 reward 节点（全局已存在）
- `pathFinder` — 用于战斗后缓存刷新（全局已存在）

### 可选依赖
- `dungeon-event-system.js` — 新事件系统（动态导入，失败时降级）

## 7. 测试建议

1. **地图生成测试**
   - 多次生成地图，检查节点数是否在 35-40 之间
   - 验证最短路径上的 combat 节点数 >= 9
   - 检查所有节点是否可达

2. **迷雾测试**
   - 未访问节点显示 "?"
   - 访问起点后，相邻节点显示实际类型
   - 已访问节点保持显示实际类型

3. **节点转换测试**
   - 完成 combat 节点后，节点变为 empty
   - 再次点击 empty 节点直接返回地图

4. **奖励节点测试**
   - 击败 Boss 后进入 reward 节点
   - 奖励界面正常显示
   - 选择奖励后返回地图

5. **集成测试**
   - 完整通关一次地牢
   - 检查所有系统协同工作

## 8. 已知限制

1. 奖励节点目前只在 Boss 后固定1个，暂不支持多个奖励节点
2. 迷雾系统不支持"已揭示但不可达"的灰色显示（当前显示为暗淡的实际类型）
3. 地图生成器最多尝试 100 次满足最短路径要求，极端情况下可能放宽条件

## 9. 后续扩展点

1. **更多节点类型**：在 `nodeTypeWeights` 中添加新类型
2. **自定义层数**：修改 `layerNodeCounts` 配置
3. **动态难度**：根据玩家等级调整 `minCombatPathLength`
4. **保存/加载**：序列化 `nodes` + `edges` + `fogOfWar.visitedNodeIds`
