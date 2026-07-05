# 怪物代码重构计划

## 目标
统一怪物配置、消除重复代码、修复黑狼动画、删除状态效果重复更新。

## Stage 1：统一配置（独立）
- **文件**: `src/entities/enemy-data.js`, `src/main.js`
- **操作**: 
  - 删除 `src/entities/enemy-data.js`（被 `enemy-config.json` 替代）
  - 从 `src/main.js` 中移除 `enemy-data.js` 的导入和全局挂载
- **验证**: 游戏仍能正常启动，所有怪物从 JSON 配置读取数据

## Stage 2：修复黑狼 facing（独立）
- **文件**: `src/entities/enemy-types.js`（BlackWolf 类）
- **操作**:
  - 修改 `update()` 中的 facing 判定逻辑：使用 `this.rotation` 或累积速度方向，避免瞬时 `vx` 导致频繁切换
  - 确保 facing 有最小切换阈值（如至少连续 3 帧方向一致才切换）
- **验证**: 黑狼移动时 facing 稳定，不会来回摇摆

## Stage 3：提取 Phaser 同步到基类（前置）
- **文件**: `src/entities/enemy.js`
- **操作**:
  - 新增 `Enemy._renderPhaserSync(ctx, x, y, textureKey, spriteSize)` 方法
  - 包含：获取 sprite、设置位置/旋转/缩放、设置帧、跳过 Canvas 渲染逻辑
  - 返回 `true`（如果 Phaser 处理了渲染）或 `false`（需要 Canvas 渲染）
- **验证**: 基类方法正确同步 Phaser sprite

## Stage 4：替换所有子类的重复 Phaser 代码（依赖 Stage 3）
- **文件**: `src/entities/enemy-types.js`
- **操作**:
  - 替换 Zombie、RunnerZombie、FatZombie 等 15+ 个怪物的 `render()` 中的 Phaser 同步块
  - 使用 `this._renderPhaserSync(...)` 调用
- **验证**: 所有怪物正常渲染，Phaser 同步无异常

## Stage 5：删除状态效果重复更新（独立）
- **文件**: `src/entities/enemy.js`
- **操作**:
  - 从 `update()` 中移除 `_updatePoison()`、`_updateBleed()`、`_updateMagicVulnerability()`、`_updateDroneVulnerability()` 的调用
  - 保留这些方法（供 CombatSystem 调用），但不再在 `enemy.js` 中自调用
- **验证**: 状态效果仍然正常触发（通过 CombatSystem），不会重复更新

## 执行顺序
Stage 1 → Stage 2 → Stage 3 → Stage 4 → Stage 5
（Stage 1 和 2 可以并行，但按顺序更安全）
