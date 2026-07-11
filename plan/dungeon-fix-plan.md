# 地牢模式修复计划

## 分析结果

### 1. 宝箱事件 (dungeon-event-system.js)
**当前问题：**
- `treasureChest.outcomes` 中 gold 是随机 50-200，material 是随机 1-5 个随机材料
- `handleTreasureChest` 按旧配置处理

**修复：**
- outcomes 改为：50%固定500金币、25% 1强化石+1改造券+200魔法粉尘、25%战斗
- handleTreasureChest 匹配新配置

### 2. 补给堆"探查巡逻" (dungeon-event-system.js)
**当前问题：**
- `handleSupplyPile` 中 `inspect` 成功后只给金币/材料随机奖励
- 用户要求：成功后显示周围相邻4个前后左右节点**再之后两个节点**的内容

**修复：**
- 检查当前实现，修复为显示相邻节点及其再下一层节点（共6个节点）的内容
- 需要与 DungeonMapSystem 集成获取节点信息

### 3. 战斗场地 (combat-room-system.js)
**当前问题：**
- `_rollRoomSize` 确实随机生成 1024-2048（步长256），✓ 正确
- `_spawnPlayer` 使用 `Math.random()` 在四边**随机位置**生成，不是"中间位置"
- 怪物生成在对边，✓ 正确
- 使用 `bottom` 固定像素？代码中没有使用 `bottom` CSS 属性

**修复：**
- 玩家生成位置改为四边**中间位置**（固定坐标，不是随机）
- 检查是否有 bottom 使用需求（代码中无CSS，可能不需要）

### 4. 迷雾系统 (dungeon-map-system.js + dungeon-map-generator.js)
**当前问题：**
- 节点类型有 start/combat/event/boss/reward/empty/shop/converge/random（太多）
- 用户要求只有 combat/event/boss/reward 四类（加上 start 和 empty）
- 迷雾显示：当前代码中 `displayType = 'unknown'` 时显示 "?"，但颜色逻辑复杂
- `empty` 节点显示为 "·"，但用户要求已完成战斗的节点显示正确

**修复：**
- 地图生成器：移除 shop/random/converge 类型，只保留 combat/event/boss/reward/start/empty
- 渲染：确保未揭示节点显示 "?"
- 确保 empty 节点（已完成战斗）显示正确
- 确保奖励节点在 Boss 之后

### 5. 奖励节点 (boss-reward-system.js)
**当前问题：**
- `RewardNodeManager._setupBossRewardCards` 追加了 Boss 奖励卡牌到 RewardSystem.CARDS
- 用户要求：复用剧情模式下雪地场景完成后奖励界面（即直接使用 RewardSystem）

**修复：**
- 奖励节点直接调用 RewardSystem.open()，不追加 Boss 专属卡牌
- 或者保持现有实现但确保复用 RewardSystem

## 执行顺序
1. dungeon-event-system.js — 宝箱修复 + 补给堆探查修复
2. combat-room-system.js — 玩家生成位置修复
3. dungeon-map-generator.js — 节点类型简化
4. dungeon-map-system.js — 迷雾与节点显示修复
5. boss-reward-system.js — 奖励节点检查
6. git 提交
