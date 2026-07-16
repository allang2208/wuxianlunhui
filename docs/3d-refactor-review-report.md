# 3D 碰撞/命中/渲染重构整体报告

## 一、重构范围

本次重构按 Phase 0-5 推进，覆盖：

- **Phase 0**：统一 3D Collider 数据层（`src/physics/collider.js`、`collision-3d.js`、`spatial-grid.js`）。
- **Phase 1**：地面碰撞统一为圆形 footprint（`game.js`、移动/寻路/击退/WallSystem）。
- **Phase 2**：投射物判定 3D 化 + 空间网格 broadphase（`projectile.js`）。
- **Phase 3**：近战/技能 AOE 3D 化（`skill-shapes.js` + 各技能系统）。
- **Phase 4**：玩家/敌人/武器/特效统一 Y-sort 深度排序（`GameScene._updateDynamicDepths`）。
- **Phase 5**：清理旧 `HexHitbox` / `HitDetector`，对齐攻击范围可视化。

## 二、回顾检查发现的问题与修复

### 严重问题（已修复）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | `src/entities/components/rune-sword-system.js` | 命中条件被写成 `!intersectsEntity`，导致符文剑命中逻辑完全相反 | 改为 `intersectsEntity` 命中 |
| 2 | `src/systems/spatial-partition-system.js` | `queryRadius` 返回内部复用数组，并发查询会篡改结果；`maxQueryResults=64` 会静默截断 | 返回 `.slice(0)` 副本；上限提升到 2048 |
| 3 | `src/entities/drop-item.js` | 掉落物未排除碰撞分离，会挤开玩家/敌人 | 增加 `this.noCollision = true` |
| 4 | `src/entities/damageable-entity.js` | 子类在 `super()` 后才设置碰撞字段，`Collider` 仍是默认半径 | 构造函数末尾调用 `rebuildCollider()` |
| 5 | `src/phaser/scenes/GameScene.js::_configureEnemyBody` | 用 `spriteSize` 覆盖 `collisionWidth/Height`，导致敌人 footprint 被放大数倍 | 优先保留配置/选项中的 gameplay 尺寸，fallback 用 `collisionRadius/size` 推导 |

### 深度排序不一致（已修复）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 6 | `GameScene::_syncNeutralEntities` | 中立实体仍用固定 `e.y` | 改由 `_updateDynamicDepths()` 统一排序 |
| 7 | `src/combat/projectile.js` | 投射物深度为 `this.y` | 改为 `this.y + 12` |
| 8 | `src/entities/drop-item.js`、`dungeon-chest.js` | 掉落物/宝箱深度为 `this.y` | 改为 `y + 5/+6` |
| 9 | `GameScene::_syncCollisionRadii` | 调试可视化仍分矩形/圆形绘制 | 统一画 `groundRadius` 圆 |

### 其他修正（已修复）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 10 | `special-attack-system.js` | 每帧创建新的范围提示，持续期间堆积特效 | 移除 `update()` 中的重复创建 |
| 11 | `src/combat/attack.js` | 非法角度时仍消耗体力/CD | 将角度检查移到消耗之前并返回 `false` |
| 12 | `src/entities/components/dash-system.js` | 变量遮蔽、冗余条件 | 重命名内层 `effect`，移除冗余判断 |
| 13 | `src/entities/enemy-types/mutant-3.js` | 血雾特效固定深度 | 改为 `y + 10` |
| 14 | `src/physics/index.js` | 导出未使用的 `SpatialGrid` | 移除导出（文件保留供测试引用） |

## 三、验证结果

- `npm run lint` ✅
- `npx vite build` ✅
- `node scripts/test-collider.mjs` ✅（16/16 通过）

## 四、当前状态

- 玩家 footprint 圆形半径保持 30，与重构前 `collisionRadius` 一致。
- 敌人 footprint 按配置 `collisionRadius` 或 `size*0.6` 推导，不再被显示尺寸放大。
- 所有命中判定统一使用 `Collider` + `SkillShapes`，地面 AOE 不会命中飞行单位。
- 动态 Sprite 深度统一按脚底 Y 排序，与环境墙壁/树木同一坐标空间。
- 旧 `HexHitbox`、`HitDetector` 已删除，`collision-helpers.js` 精简为 `distanceToEntityShape`。

## 五、后续可继续关注的点

1. **实机手感测试**：近战范围、敌人拥挤程度、投射物视觉前后关系需在运行时确认。
2. **`SpatialPartitionSystem` 调用时机**：网格更新在实体更新之后，快速移动目标有极轻微的 broadphase 偏差（已在设计范围内）。
3. **`VerticalSector` / `VerticalRect` 的半径扩展近似**：在弧形边缘和矩形四角存在少量过度膨胀，属于可接受的近似。
4. **飞行单位**：当前无实际飞行敌人；`collider.z/elevation` 已预留，未来只需设置 `z > 0` 即可让地面 AOE/近战无法命中。

## 六、新增：可移动实体脚底阴影（v2.4）

- 文件：`src/phaser/scenes/GameScene.js`
- 实现：
  - 创建可复用 `entity_shadow` 黑色圆形纹理。
  - 新增 `_syncEntityShadows(_game)`，每帧为玩家、敌人、中立实体在脚下生成圆影。
  - 圆影半径 = `entity.groundRadius`（统一 Collider 地面 footprint）。
  - 阴影位置位于实体脚底（`entity.y + displayHeight/2`），深度 = 实体深度 - 1，确保显示在实体下方。
  - 地图模式下隐藏；实体失效时阴影自动销毁。
- 验证：`npm run lint`、`npx vite build` 通过。
