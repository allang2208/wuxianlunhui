# Plan: 夜与火之剑特殊攻击系统

## 分析完成
- 单文件架构 legacy.js (~5900行)
- 武器数据在 ItemDatabase (line 3430)
- 攻击输入在 Player.update (line 2018)
- 快捷栏在 QuickBar (line 3275) + QUICK_BAR_CONFIG (line 5168)
- 特效通过 EffectManager 管理 (line 308)
- 装备/卸下在 EquipManager (line 3540)
- 冷却遮罩在 QuickBar._renderCooldownOverlays (line 3366)

## 阶段

### Stage 1 — 武器数据定义
- 在 ItemDatabase.items 中添加 `night_flame_sword` (weapon5)
- 攻击力公式：60 + 力量×1.5 + 敏捷×1.25
- 攻击间隔 450ms，参考 weapon1 的其他参数

### Stage 2 — 攻击力公式联动
- ThrustAttack 伤害计算 (line 942)：添加 weapon5 分支
- EquipPanel 公式显示 (line 4133, 4348, 4945)：添加 weapon5 公式

### Stage 3 — 特殊攻击系统
- Player 构造函数添加 `_specialAttack` 状态
- 右键攻击输入处理：检测 weapon5 装备 + 右键按下 → 触发光柱
- 光柱特效类：3秒持续，深蓝+淡黄色粒子，向鼠标方向
- 持续伤害判定：30×700 矩形，每200ms造成武器伤害×0.25
- 10秒冷却

### Stage 4 — 装备/卸下绑定
- EquipManager 装备 weapon5 时初始化特殊攻击图标
- 卸下 weapon5 时清除特殊攻击图标和状态
- Player 切换武器栏时同步更新

### Stage 5 — 快捷栏特殊攻击图标
- 在 QUICK_BAR_CONFIG 添加特殊攻击槽位（skillGroup 右侧或 itemGroup 右侧）
- QuickBar 中添加特殊攻击冷却管理（独立冷却系统）
- 冷却遮罩展示

### Stage 6 — 验证测试
- 检查所有 weapon5 相关分支
- 检查特殊攻击动画和伤害
- 检查冷却展示
