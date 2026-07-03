# 模块化拆分计划（方案B）

## 目标
将 2807 行的 legacy.js 拆分为 20+ 个独立模块，保持所有功能不变。

## 文件结构

```
src/
├── main.js                 # 入口文件（已存在，需更新）
├── config/
│   └── Config.js           # CONFIG, KEYS, WeaponAnimConfig
├── core/
│   ├── Game.js             # 游戏主循环、状态管理
│   ├── Camera.js           # Camera
│   ├── Input.js            # Input
│   ├── EventBus.js         # EventBus
│   └── Renderer.js         # Renderer
├── utils/
│   └── MathUtils.js        # MathUtils
├── data/
│   └── ItemDatabase.js     # ItemDatabase, ItemFactory, TEST_EQUIPMENTS, G18_PISTOL_ITEM, STEEL_BOW_ITEM
├── world/
│   ├── MapGenerator.js     # MapGenerator
│   ├── MazeGenerator.js    # MazeGenerator
│   └── WallSystem.js       # WallSystem
├── entities/
│   ├── Player.js           # Player（原God Object，拆出Combat/Animator）
│   ├── Enemy.js            # Enemy
│   ├── TargetDummy.js      # TargetDummy
│   └── DropItem.js         # DropItem
├── combat/
│   ├── Attack.js           # Attack（基类，含SlashAttack, ThrustAttack, RangedAttack）
│   └── Projectile.js       # Projectile
├── equipment/
│   └── EquipManager.js     # EquipManager（含QuickBar, SystemUI, UI_DATA_CONFIG）
├── effects/
│   └── Effects.js          # 所有效果类 + EffectManager
└── style.css               # 从 game-style.css 迁移
```

## 依赖关系图

```
main.js
  → Game
    → Player, Enemy, TargetDummy, DropItem
    → WallSystem, MazeGenerator
    → EffectManager
    → Input, Camera, Renderer, EventBus
  → EquipManager
    → Player
    → EffectManager
  → QuickBar
    → Player

Player
  → Attack (SlashAttack, ThrustAttack, RangedAttack)
  → Projectile
  → Camera, EventBus
  → MathUtils, Config

Enemy → Player
TargetDummy → MathUtils
DropItem → Renderer, ItemDatabase

Effects → Renderer
```

## 关键注意事项

1. **全局变量 Game** → main.js 中创建后传给需要的模块
2. **相互依赖** → Game 作为中央状态持有者
3. **内联函数绑定** → 保持为类方法或独立函数
4. **DOM 事件** → 在各自模块中处理
5. **export 模式** → 使用 ES6 named exports
