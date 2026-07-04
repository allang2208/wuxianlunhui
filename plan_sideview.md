# 侧视角 2D 迁移实施计划

> 备份：backup/v2026-07-04_17-10-43
> 阶段：P0-P3 全部执行

## 核心原则
- 底层逻辑（移动、碰撞、射击角度、AI）**不改**
- 只改**渲染层**和**攻击判定范围**
- 实体按 y 坐标深度排序（已正确，无需修改）

---

## 任务清单

### 任务 1：Player 4方向朝向 + 阴影（P0）
**文件**: `src/entities/player.js`
**修改**:
1. `render(ctx)` 添加朝向判断：从鼠标位置或移动速度判断4方向（up/down/left/right）
2. 角色贴图根据朝向翻转（水平用 `scaleX`，垂直用 `scaleY` 或保持）
3. 脚下添加阴影：角色下方绘制半透明椭圆
4. 武器贴图跟随朝向：左/右时武器水平翻转；上/下时武器位置调整（上方举高，下方放低）
5. 行走动画播放逻辑适配4方向

### 任务 2：Enemy 4方向朝向 + 阴影（P0）
**文件**: `src/entities/enemy.js`
**修改**:
1. `render(ctx)` 添加朝向判断：从速度或目标方向判断4方向
2. 角色贴图翻转
3. 脚下阴影
4. 如果基类 DamageableEntity 有 render 方法，在基类添加通用 `_drawShadow()` 供所有子类调用

### 任务 3：战术小队 4方向朝向（P0）
**文件**: `src/entities/humanoid-monster.js`
**修改**:
1. `render(ctx)` 中 ShieldBearer、RiflemanA、RiflemanB 等角色的朝向判断
2. 盾位小圆盾位置根据朝向调整（左时盾在右侧，右时盾在左侧）
3. 所有角色添加阴影

### 任务 4：墙壁侧视渲染（P1）
**文件**: `src/world/wall-system.js`, `src/game.js`
**修改**:
1. WallSystem 墙壁数据添加 `height: 60` 默认高度
2. 新增 `renderWalls(ctx, cameraX, cameraY)` 方法：绘制墙面（立面矩形）+ 墙顶（小矩形）
3. `game.js` 渲染循环中：在 `Renderer.renderTerrain()` 之后、实体渲染之前调用 `WallSystem.renderWalls()`
4. 墙壁按 y 参与深度排序（需要给墙壁赋予 y 值并排序）

### 任务 5：近战攻击判定（P1）
**文件**: `src/entities/player.js`（或 `src/combat/attack.js`）
**修改**:
1. 根据当前朝向确定近战攻击矩形范围
2. 上：角色上方矩形；下：角色下方矩形；左：角色左侧矩形；右：角色右侧矩形
3. 弓箭/枪械射击：保持360°瞄准，但角色朝向由鼠标方向决定4方向之一

### 任务 6：子弹 Y 缩放 + 树木侧视（P2）
**文件**: `src/combat/projectile.js`, `src/world/wall-system.js`
**修改**:
1. `Projectile.render()`：根据子弹飞行方向的 y 分量（vy）做缩放，往上飞时缩小（70%），往下飞时放大（130%）
2. `WallSystem.addTree()`：树木渲染改为侧视（树干矩形 + 树冠圆形）
3. 树木参与 y 深度排序（需要给树木赋予合适排序位置）

### 任务 7：弹壳/血溅/特效方向（P3）
**文件**: `src/effects/shell-casing.js`, `src/effects/blood-hit-effect.js`, `src/effects/particle-effects.js` 等
**修改**:
1. 弹壳：受重力影响，y 方向增加下落趋势
2. 血溅：方向与攻击方向一致（根据来源方向）
3. 所有特效添加 y 坐标参与深度排序（如果还没有的话）

---

## 验证清单
- [ ] 玩家移动 WASD 正常（8方向）
- [ ] 玩家显示只有4方向（上/下/左/右）
- [ ] 脚下有阴影
- [ ] 墙壁有侧视高度感
- [ ] 近战攻击判定按朝向矩形
- [ ] 子弹飞行时远处缩小/近处放大
- [ ] 敌人朝向正确
- [ ] 战术小队朝向正确
- [ ] 所有文件语法通过 `node --check`
