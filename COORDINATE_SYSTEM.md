# 坐标系约定（Coordinate System Convention）

## 统一认知

本项目采用**游戏世界坐标系**，所有位置计算、开发工具、配置参数均遵循此约定：

| 方向 | 含义 | 开发工具箭头 | 对应游戏坐标 |
|------|------|-------------|-------------|
| **X+** | 向右 | 红色箭头（右） | `x` 增加 |
| **X-** | 向左 | 红色箭头反方向 | `x` 减少 |
| **Y+** | 向上 | 绿色箭头（上） | `y` 减少（Canvas Y-） |
| **Y-** | 向下 | 绿色箭头反方向 | `y` 增加（Canvas Y+） |

## 关键说明

1. **开发工具**：显示绿色箭头 Y+ 朝上，红色箭头 X+ 朝右
2. **Canvas 绘制**：`ctx.translate(0, -20)` = 向 Y+ 方向（上）移动 20px
3. **Phaser 位置**：`wx = player.x - Math.sin(angle) * offset` 表示向 Y+ 方向偏移
4. **武器配置**：`holdOffsetY` 为正 = 向上（Y+），为负 = 向下（Y-）

## 变换链完整公式

### 主手武器（Canvas）

```
T(mainBaseX, mainBaseY) → T(holdOffsetX, holdOffsetY) → R(π/2) → T(0, -centerOffset)
```

| 武器类型 | mainBaseX | mainBaseY | centerOffset |
|----------|-----------|-----------|--------------|
| 剑（sword） | -7 | 0 | ms * 0.85 |
| 弓（bow） | -7 | 0 | 0 |
| 手枪（pistol） | -15 | 16.5 | s * 0.42 |
| 双手枪械（pkm/akm/shotgun） | 8 | 0 | s * 0.42 |

其中 `ms = WEAPON_ANIM.size * 0.75 = 78.75`，`s = WEAPON_ANIM.size = 105`。

### 副手武器（Canvas）

```
T(offBaseX, offBaseY) → R(π/2) → T(0, -centerOffset)
```

| 武器类型 | offBaseX | offBaseY |
|----------|----------|----------|
| 剑/弓/手枪 | -5 | -16.5 |
| 双手枪械 | 0 | -8 |

注意：副手 melee 同样使用 `holdOffsetX/Y`（与主手共享 `sword` 配置）。

## Phaser 渲染同步

1. `syncWeapon` 的 `wx/wy` 必须与 `renderWeapon` 的最终世界坐标一致
2. 所有武器类型（pistol、PKM、shotgun、bow、melee）都有独立的偏移公式
3. 禁止在 Phaser 中使用与 Canvas 不匹配的硬编码值
4. 统一使用 `WeaponTransform.getWeaponWorldPosition()` 计算世界坐标

## 常见陷阱

- ❌ 不要把屏幕坐标系（Y+ 向下）混用
- ❌ 不要把旋转后的坐标系混淆（武器旋转 90° 后，Canvas Y 偏移变成世界 X 方向）
- ✅ 所有位置调整都直接以开发工具坐标系为基准（X+ 右，Y+ 上）

## 历史教训

- 此前因 Canvas 与 Phaser 坐标系理解不一致导致多次沟通成本
- 从 V0.192 起，所有坐标计算统一到此文档约定

## 修改武器位置的规则

1. 先给出目标坐标（开发工具坐标系）
2. 计算 `holdOffsetY = -offsetY`（因为 Canvas 坐标系 Y+ 向下，与开发工具 Y+ 向上相反）
   - 注意：`rotate(π/2)` 后，`holdOffsetY` 的实际影响方向变为左右偏移
3. 计算 `holdOffsetX = offsetX - ms * 0.85 + 7`（剑类）
4. 计算 `holdOffsetX = offsetX - 104.6`（枪械类）
5. 计算 `holdOffsetX = offsetX + 7`（弓类）
6. 修改 `WeaponAnimConfig` 后，Canvas 和 Phaser 自动同步

## 文件关联

- `src/config/math-utils.js` — `WEAPON_ANIM.size` 基准值
- `src/items/weapon-anim-config.js` — 武器偏移配置（holdOffsetX/Y、idleRotation、idleScale）
- `src/combat/weapon-transform.js` — 统一变换计算（共享数据源，含 mainBaseX/Y、offBaseX/Y、centerOffset）
- `src/phaser/scenes/GameScene.js` — Phaser 渲染层
- `src/entities/player.js` — Canvas 渲染层

---

**最后更新**：V0.198

**所有坐标调整以开发工具截图坐标系为准，即红色箭头 X+ 向右，绿色箭头 Y+ 向上。**
