## 一、模块化拆分计划

### 目标架构
```
game-dev/
├── src/
│   ├── main.js                    ← 新入口：统一导入并初始化
│   ├── config/
│   │   ├── config.js              ← CONFIG 常量
│   │   └── math-utils.js          ← MathUtils
│   ├── world/
│   │   ├── renderer.js            ← Renderer + Camera
│   │   ├── map-generator.js       ← MapGenerator
│   │   ├── maze-generator.js      ← MazeGenerator
│   │   └── wall-system.js         ← WallSystem
│   ├── effects/
│   │   ├── effect-manager.js      ← EffectManager + 对象池
│   │   ├── slash-effect.js
│   │   ├── thrust-effect.js
│   │   ├── blood-hit-effect.js
│   │   ├── smoke-effect.js
│   │   ├── attack-range-effect.js
│   │   ├── dash-effects.js        ← DashConvergeEffect + DashAuraEffect
│   │   ├── sweep-effect.js
│   │   ├── nightflame-effect.js
│   │   ├── floating-text.js
│   │   ├── muzzle-flash.js
│   │   ├── shell-casing.js
│   │   └── particle-effects.js    ← DodgeEffect + DeathEffect + BloodEffect + DustEffect
│   ├── combat/
│   │   ├── attack.js              ← Attack 基类
│   │   ├── slash-attack.js
│   │   ├── thrust-attack.js
│   │   ├── ranged-attack.js
│   │   └── projectile.js
│   ├── entities/
│   │   ├── entity.js              ← Entity 基类
│   │   ├── damageable-entity.js
│   │   ├── player/
│   │   │   ├── player.js          ← Player 主类（瘦身到 ~500行）
│   │   │   ├── player-movement.js  ← 移动/输入/冲刺/闪避
│   │   │   ├── player-combat.js    ← 攻击/风车/特殊攻击
│   │   │   └── player-render.js    ← 武器渲染/动画
│   │   ├── enemy.js
│   │   ├── target-dummy.js
│   │   └── drop-item.js
│   ├── skills/
│   │   └── skill-manager.js       ← SkillManager
│   ├── input/
│   │   └── input.js               ← Input 系统
│   ├── items/
│   │   ├── item-factory.js
│   │   ├── item-database.js
│   │   └── weapon-anim-config.js
│   ├── ui/
│   │   ├── equip-manager.js       ← EquipManager (~1200行)
│   │   ├── system-ui.js           ← SystemUI + UI_DATA_CONFIG
│   │   ├── codex-manager.js
│   │   └── quick-bar.js           ← QuickBar + QUICK_BAR_CONFIG
│   ├── audio/
│   │   └── sound-manager.js
│   └── game/
│       └── game.js                ← Game 主循环（~500行，精简）
├── index.html                      ← 改为 src/main.js
├── vite.config.js                ← 已配置
└── package.json
```

---

## 二、需要确认的问题

### Q1: 拆分范围
- **A. 最小拆分**：只把 `Player`（~1500行）和 `EquipManager`（~1200行）拆出去，其余保持单文件 → 约 **3-4 小时**
- **B. 中等拆分**：按上述计划拆成 ~15 个文件，保留合理的文件大小（200-500行/文件） → 约 **8-12 小时**
- **C. 完整拆分**：所有类/模块都独立文件，共 ~25 个文件 → 约 **15-20 小时**

### Q2: 循环依赖处理
当前 `Player` 直接引用 `Game`、`EffectManager`、`SkillManager`、`QuickBar` 等。拆分后：
- **A. 事件总线模式**：用 `EventBus` 解耦（已存在但几乎未使用）
- **B. 依赖注入**：`Game` 初始化时把各模块注入到 `Player`
- **C. 全局导入**：保持直接 `import` 引用，允许循环依赖（ESM 可处理，但不推荐）

### Q3: Player 拆分粒度
`Player` 是最大难点（~1500行，依赖 10+ 模块）。建议拆为：
- `Player` 核心（位置、属性、状态）
- `PlayerMovement`（WASD、冲刺、闪避）
- `PlayerCombat`（攻击、风车、特殊攻击）
- `PlayerRender`（武器动画、粒子特效）

是否接受这种拆分？还是保持 `Player` 在一个文件中但减小体积？

### Q4: 构建后验证
每拆分一个模块需要：
1. 移动代码 → 新文件
2. 添加 `import/export`
3. 测试游戏启动是否正常
4. 测试该模块功能是否正常

您是否接受**分多次对话**逐步完成（每次 2-3 个模块）？还是一次全部做完？

---

## 三、时间评估与 ROI

### 预估时间（按选项 B：中等拆分）

| 阶段 | 内容 | 时间 |
|------|------|------|
| 阶段1 | 基础架构：创建目录、入口文件、config/math-utils | 1h |
| 阶段2 | 视觉系统：Renderer + Camera + 所有 Effect 类 | 2h |
| 阶段3 | 战斗系统：Attack + Projectile + 所有子类 | 1.5h |
| 阶段4 | 实体系统：Entity + DamageableEntity + Enemy + DropItem | 1.5h |
| 阶段5 | **Player 拆分**（核心→Movement/Combat/Render） | **3-4h** |
| 阶段6 | 物品系统：ItemDatabase + ItemFactory + WeaponAnimConfig | 1h |
| 阶段7 | **UI 系统：EquipManager 拆分** | **2-3h** |
| 阶段8 | 游戏循环：Game + Input + SkillManager + SoundManager | 2h |
| 阶段9 | 全量回归测试 | 1h |
| **总计** | | **15-18 小时**（分 3-5 次完成） |

### 开发效率提升

| 指标 | 拆分前 | 拆分后 | 提升 |
|------|--------|--------|------|
| 定位 Bug 时间 | 在 6000 行中搜索 | 在 300 行中搜索 | **~10x** |
| 新增武器 | 修改 legacy.js 3-4 处 | 修改 `items/weapon-*.js` + `player-combat.js` | **~3x** |
| 新增特效 | 在文件末尾追加 | 新建 `effects/*.js` | **~5x** |
| 代码复用 | 复制粘贴 | `import` 复用 | **~2x** |
| 多人协作 | 冲突率高 | 各文件独立 | **~5x** |
| 编译速度 | Vite 处理 6000 行 | 增量编译 | **~1.5x** |

### 风险

| 风险 | 概率 | 影响 |
|------|------|------|
| 拆分引入未发现的依赖断裂 | 中 | 某些功能运行时崩溃 |
| 循环依赖导致初始化失败 | 低 | 启动报错 |
| 构建工具路径问题 | 低 | 资源加载 404 |
| 回归 Bug（功能被破坏） | 中 | 需要额外调试时间 |

---

## 四、建议方案

**推荐选项 B（中等拆分）+ 分 3 次完成**：

1. **第 1 次**：拆 "无副作用" 模块（config、world、effects、items）— 约 5h
2. **第 2 次**：拆核心系统（combat、entities、Player）— 约 6h
3. **第 3 次**：拆 UI 系统（EquipManager、SystemUI、Game）— 约 5h

每次完成后测试，确认无误再进入下一阶段。

**或推荐选项 A（最小拆分）**：只拆 `Player` 和 `EquipManager`，其余不动 — 约 4h，投入产出比最高。

---

请确认：
1. 选择 **A / B / C** 哪个拆分范围？
2. 是否分多次完成？
3. 是否接受 `Player` 拆分为 4 个子模块？
