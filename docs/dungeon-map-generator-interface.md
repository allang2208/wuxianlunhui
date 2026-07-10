# DungeonMapGenerator 接口文档

## 文件位置
- `game-dev/src/world/dungeon-map-generator.js` — 地图生成器核心
- `game-dev/src/world/dungeon-map-system.js` — 集成后的地牢地图系统

## 核心导出

### 1. DUNGEON_MAP_CONFIG — 默认配置对象

```javascript
export const DUNGEON_MAP_CONFIG = {
    name: '遗忘祭坛',
    description: '古老教团的祭祀场所...',
    
    // 节点数量范围
    minNodes: 35,
    maxNodes: 40,
    
    // 分层配置（11层：1起点 + 9中间 + 1Boss）
    layerNodeCounts: [
        { min: 1, max: 1 },   // Layer 0: start
        { min: 2, max: 3 },   // Layer 1
        { min: 2, max: 4 },   // Layer 2
        ...
        { min: 1, max: 1 },   // Layer 10: boss
    ],
    
    // 最短路径要求
    minCombatPathLength: 9,
    
    // 节点类型分布
    nodeTypeWeights: {
        combat: 0.70,  // 70% 战斗
        event:  0.30,  // 30% 事件
    },
    
    // 地图尺寸
    mapWidth:  2000,
    mapHeight: 1500,
    layerSpacingX: 180,
    nodeSpacingY:  100,
    
    // 视觉配置
    typeColors: { start: '#3a5a3a', combat: '#7a3a3a', ... },
    typeBorderColors: { ... },
    typeIcons: { start: '▶', combat: '⚔', ... },
    
    // 迷雾配置
    fogOfWar: {
        enabled: true,
        unknownIcon: '?',
    },
    
    // 生成参数
    generation: {
        maxAttempts: 100,
        verticalConnectionChance: 0.6,
        minConnectionsPerNode: 1,
        maxConnectionsPerNode: 3,
    }
};
```

### 2. DungeonMapGenerator — 地图生成器类

```javascript
import { DungeonMapGenerator } from './dungeon-map-generator.js';

const generator = new DungeonMapGenerator(config); // 可选自定义配置
const result = generator.generate();
```

**返回结果：**
```javascript
{
    nodes: [ // 节点数组
        {
            id: "node_0_0",
            layer: 0,        // 层索引
            index: 0,        // 层内索引
            x: 166,          // 地图坐标X
            y: 750,          // 地图坐标Y
            type: "start",   // 节点类型
            originalType: "start", // 原始类型（用于empty恢复）
            connections: []  // 出边目标id数组
        }
    ],
    edges: [ // 边数组
        { from: "node_0_0", to: "node_1_0" }
    ],
    config: { ... }, // 使用的配置
    metadata: {      // 元数据
        totalNodes: 37,
        totalEdges: 52,
        typeDistribution: { start: 1, combat: 24, event: 11, boss: 1 },
        shortestCombatPath: 9,
        layers: 11
    }
}
```

**节点类型：**
- `start` — 起点（固定1个）
- `combat` — 战斗节点（70%）
- `event` — 随机事件（30%）
- `boss` — Boss战（固定1个）
- `reward` — 奖励节点（Boss后）
- `empty` — 已完成战斗节点（战斗后转换）

### 3. DungeonFogOfWar — 迷雾系统

```javascript
import { DungeonFogOfWar } from './dungeon-map-generator.js';

const fog = new DungeonFogOfWar();

// 访问节点（自动揭示相邻节点）
fog.visit(nodeId, nodes, edges);

// 获取节点可见性状态
const visibility = fog.getNodeVisibility(nodeId); // 'visited' | 'revealed' | 'hidden'

// 获取节点显示类型
const displayType = fog.getNodeDisplayType(node);

// 检查节点是否可点击
const clickable = fog.isClickable(nodeId, currentNodeId, edges);

// 重置
fog.reset();
```

## DungeonMapSystem 集成变更

### 新增属性
```javascript
DungeonMapSystem.fogOfWar = new DungeonFogOfWar();
```

### 新增/修改方法

**`_generateDefaultMap()`** — 现在使用 DungeonMapGenerator 生成地图

**`_enterNode(node)`** — 新增：
- 更新迷雾系统
- 标记 combat 节点为已完成
- 处理 empty 节点（直接返回地图）
- 支持 reward 节点

**`_enterReward(node)`** — 新增：打开奖励界面（复用 RewardSystem）

**`_checkCombatComplete()`** — 修改：
- 战斗完成后将 combat 节点转为 empty

**`render(ctx)`** — 修改：
- 集成迷雾效果：未访问节点显示 "?"
- 已揭示但未访问节点显示实际类型但暗淡
- 已访问节点显示实际类型

### 新增类型颜色/图标
```javascript
TYPE_COLORS: { ..., reward: '#5a3a7a', empty: '#3a3a3a' }
TYPE_BORDER_COLORS: { ..., reward: '#8a5aaa', empty: '#5a5a5a' }
TYPE_ICONS: { ..., reward: '💎', empty: '·' }
```

## 与现有系统的集成

### 1. 出征系统 (expedition-system.js)
- 已更新默认地牢描述，反映新地图特性
- 无需修改出征流程

### 2. 场景管理器 (scene-manager.js)
- 无需修改，DungeonMapSystem.init() 自动使用新生成器

### 3. 奖励系统 (reward-system.js)
- `_enterReward()` 复用现有 RewardSystem.open()
- 奖励界面关闭后自动返回地图

### 4. 事件系统 (dungeon-event-system.js)
- 通过动态 import 加载
- 事件完成后返回地图或进入战斗

## 配置调整示例

```javascript
// 创建自定义配置
const myConfig = {
    ...DUNGEON_MAP_CONFIG,
    minCombatPathLength: 12,  // 更长路径
    nodeTypeWeights: {
        combat: 0.60,  // 更少战斗
        event:  0.40,  // 更多事件
    },
    layerNodeCounts: [
        { min: 1, max: 1 },
        { min: 3, max: 5 },  // 更宽的第一层
        // ...
    ]
};

const generator = new DungeonMapGenerator(myConfig);
const map = generator.generate();
```

## 迷雾渲染规则

| 状态 | 显示图标 | 颜色 | 可点击 |
|------|---------|------|--------|
| 未访问 (hidden) | ? | 暗灰 #1a1a1a | 否 |
| 已揭示 (revealed) | 实际类型 | 暗淡 | 否 |
| 相邻可用 (available) | 实际类型 | 发光 | 是 |
| 已访问 (visited) | 实际类型 | 正常 | 否 |
| 当前 (current) | 实际类型 | 高亮+白边 | 否 |

## 错误处理

- **生成失败**：如果 `maxAttempts` 次尝试后仍无法满足最短路径要求，返回最后一次结果并打印警告
- **节点不可达**：BFS 验证确保所有节点可达
- **连接数超限**：自动修剪超出 `maxConnectionsPerNode` 的连接
