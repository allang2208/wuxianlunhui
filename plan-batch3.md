# 第3次拆分计划：UI系统 + Game循环

## 目标
将 `legacy.js` 剩余 ~2940 行代码全部提取为模块，彻底消除 `legacy.js`。

## 模块拆分清单

### 1. `src/core/event-bus.js` (已存在，需提取)
- 来源：legacy.js ~2194-2213
- 依赖：无（纯事件系统）

### 2. `src/ui/input.js`
- 来源：legacy.js ~11-62
- 依赖：CONFIG, SystemUI, Game, QuickBar
- 注意：使用全局变量引用

### 3. `src/ui/skill-manager.js`
- 来源：legacy.js ~64-338
- 依赖：SystemUI, Game, EffectManager, FloatingTextEffect

### 4. `src/ui/quick-bar.js`
- 来源：legacy.js ~340-499
- 依赖：QUICK_BAR_CONFIG, Game
- 配置：QUICK_BAR_CONFIG 合并到本模块

### 5. `src/ui/equip-manager.js`
- 来源：legacy.js ~501-1698
- 依赖：Game, EffectManager, FloatingTextEffect, QuickBar, CodexManager
- 注意：最大的模块，~1200行

### 6. `src/ui/codex-manager.js`
- 来源：legacy.js ~1700-2058
- 依赖：ItemDatabase, Game

### 7. `src/ui/system-ui.js`
- 来源：legacy.js ~2060-2125
- 依赖：SkillManager, SoundManager
- 配置：UI_DATA_CONFIG 合并到本模块或作为独立导出

### 8. `src/ui/sound-manager.js`
- 来源：legacy.js ~2215-2554
- 依赖：无（纯音频系统）

### 9. `src/game.js`
- 来源：legacy.js ~2556-2944
- 依赖：几乎所有其他模块

### 10. `src/config/weapon-anim.js`（保留）
- 来源：legacy.js ~1-9（WEAPON_ANIM + ease functions）
- 当前已在 `src/items/weapon-anim-config.js` 中有新版本，legacy.js 中的是兼容旧版本，可直接删除

## 执行顺序
由于并行子代理无法看到彼此的输出，采用分阶段策略：

**阶段 1（并行）**：
- 代理 A：提取 EventBus + Input + SoundManager
- 代理 B：提取 SkillManager + QuickBar + SystemUI + UI_DATA_CONFIG + QUICK_BAR_CONFIG
- 代理 C：提取 EquipManager + CodexManager

**阶段 2（串行）**：
- 主代理：提取 Game（依赖所有其他模块）
- 更新 `src/main.js` 导入
- 清空 `legacy.js`（保留 WEAPON_ANIM 作为临时兼容）

**阶段 3**：
- 浏览器测试

## 关键注意事项
1. 所有模块使用 `export const X = { ... }` 格式
2. 模块间依赖通过全局变量（window.*）解决，与之前批次一致
3. 保留 `legacy.js` 中的 `WEAPON_ANIM` 和 `ease*` 函数作为临时兼容（Game 模块中引用）
4. 提取完成后 `legacy.js` 应仅剩 WEAPON_ANIM 兼容代码和 `window.onload`
