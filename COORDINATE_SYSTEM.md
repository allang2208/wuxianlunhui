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

## 常见陷阱

- ❌ 不要把屏幕坐标系（Y+ 向下）混用
- ❌ 不要把旋转后的坐标系混淆（武器旋转 90° 后，Canvas Y 偏移变成世界 X 方向）
- ✅ 所有位置调整都直接以开发工具坐标系为基准（X+ 右，Y+ 上）

## 历史教训

- 此前因 Canvas 与 Phaser 坐标系理解不一致导致多次沟通成本
- 从 V0.192 起，所有坐标计算统一到此文档约定

## 修改武器位置的规则

1. 先给出目标坐标（开发工具坐标系）
2. 计算 `holdOffsetY = offsetY`（直接对应）
3. 计算 `holdOffsetX = offsetX - ms * 0.85 + 7`（剑类）
4. 修改 `WeaponAnimConfig` 后，Canvas 和 Phaser 自动同步

## 文件关联

- `src/config/math-utils.js` — `WEAPON_ANIM.size` 基准值
- `src/items/weapon-anim-config.js` — 武器偏移配置（holdOffsetX/Y）
- `src/combat/weapon-transform.js` — 统一变换计算（共享数据源）
- `src/phaser/scenes/GameScene.js` — Phaser 渲染层
- `src/entities/player.js` — Canvas 渲染层

---

**最后更新**：V0.192

**所有坐标调整以开发工具截图坐标系为准，即红色箭头 X+ 向右，绿色箭头 Y+ 向上。**
