# 「无限轮回」开发变更日志

> 记录所有代码修改、功能添加、Bug修复
> 版本号规则：右上角 `versionBadge` 每次更新 +0.001（V0.001 → V0.002 → ...）

---

## 2026-06-22 — Tooltip固定 + 白色格子 + 经验规则 + 升级动画

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：Tooltip点击后固定不跟随鼠标

**问题：** 鼠标点击装备固定浮窗后，浮窗仍然跟随鼠标移动。

**修复：**
- `bindEquipTooltip`：固定显示后移除 `mousemove` 监听器
- `bindInventoryTooltip`：同上

### 需求2：格子样式统一白色 + 空装备栏不可拖拽

**修改内容：**

| 元素 | 修改前 | 修改后 |
|------|--------|--------|
| 装备栏背景 | 黑色 | **白色半透明** |
| 装备栏格子 | 浅灰色 | **白色** |
| 背包格子 | 浅灰色 | **白色** |
| 技能卡片 | 蓝色 | **白色** |
| 技能详情页 | 深蓝 | **白色** |
| 空装备栏 | 可拖拽 | **draggable=false** |

### 需求3：剑精通经验规则修改

**修改前：**
- 每次攻击积累1点（5级后不再获得）
- 击杀+10点
- 多敌人+3点

**修改后：**
- **每次击中敌人积累1点（多敌人=多倍）**
- 击杀+10点

例如：击中2个敌人 = +2点经验，击中5个敌人 = +5点经验

### 需求4：升级动画优化

**修改内容：**
- **位置：** 从屏幕40%处 → **10%处**（向上移动约300px）
- **提示文字：** "剑精通升级！Lv.X" → **"某某技能 升级！Lv.X"**（通用化）
- **技能图标：** 新增在提示文字**正上方**显示（48px）
- **技能效果：** 新增第二行显示升级后的效果
- **透明度：** 整体 **80%** 透明度
- **动画时长：** 1.5s → **2.5s**（渐变消失更平滑）

**升级动画效果：**
```
[⚔ 图标]
剑精通 升级！Lv.3
剑攻击+3  冷却-3%
```

### 版本号
- `V0.015` → `V0.016`

### 回退版本
- `backup/v20260622_020000/`

---

## 2026-06-22 — 三角形攻击判定 + 动画延长25% + 碰撞体积

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：武器1攻击改为三角形判定

**修改前：**
- 攻击范围：150px线型，30px宽
- 判定时机：点击瞬间立即判定
- 判定形状：线段

**修改后：**
- 攻击范围：**125px三角形，25px底边宽**
- 判定时机：**swing阶段（前刺动画播放时）**
- 判定形状：三角形（玩家顶点 → 底边在125px处，宽25px）

**技术实现：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `MathUtils.pointInTriangle` | 新增三角形点检测函数 |
| `legacy.js` | `ThrustAttack.execute` | 移除即时伤害判定，改为存储攻击数据 |
| `legacy.js` | `ThrustAttack.checkTriangleHit` | 新增：swing阶段每帧调用，三角形判定 |
| `legacy.js` | `Player.updateWeaponAnim` swing | 前刺开始时标记active，每帧调用判定，结束清除 |
| `legacy.js` | `Player.attacks.melee` | `range: 130 → 125`，`width: 25` |

**三角形命中判定逻辑：**
```
顶点：玩家位置 (source.x, source.y)
底边左：source + (cos(angle - 5.7°) * 125, sin(angle - 5.7°) * 125)
底边右：source + (cos(angle + 5.7°) * 125, sin(angle + 5.7°) * 125)
```

**命中规则：**
- 每个目标在一次攻击中**只受一次伤害**
- 使用 `Set` 跟踪已命中目标
- 墙壁视线检测仍然有效

### 需求2：刺击动画延长25%

| 参数 | 原值 | 新值（×1.25） |
|------|------|----------------|
| `windupMs`（蓄力） | 150ms | **188ms** |
| `swingMs`（前刺） | 200ms | **250ms** |
| `recoverMs`（收回） | 350ms | **438ms** |
| **总时间** | 700ms | **876ms** |

### 需求3：碰撞体积

**新增 `Game.resolveCollisions()`：**
- 每帧检查所有活跃实体间的碰撞
- 碰撞半径 = `entity.size` 或 `entity.collisionRadius`（贴图大小）
- 重叠时沿中心连线推开，各移动重叠距离的一半
- 推开前检查墙壁阻挡

**实体碰撞半径：**
| 实体 | 半径 |
|------|------|
| 玩家 | 14px |
| 敌人 | 14px |
| 掉落物 | 16px |
| 训练靶 | 24px |

### 版本号
- `V0.014` → `V0.015`

### 回退版本
- `backup/v20260622_010000/`

---

## 2026-06-22 — UI黑色主题 + Tooltip修复 + 装备生成位置

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：空装备栏显示默认名称

**问题：** 装备栏格子没有装备时，名称被清空，用户无法识别格子用途。

**修复：**
- `index.html`：为每个装备栏格子的 `.slot-icon` 和 `.slot-name` 添加 `data-default` 属性保存默认名称
- `legacy.js`：`updateEquipSlots` 空格子时恢复默认名称和图标

### 需求2：Tooltip左键固定逻辑修复

**问题：** 鼠标悬停显示浮窗后，单击左键浮窗直接消失，而不是固定。

**根本原因：** 全局 `document.addEventListener('click', ...)` 在 `mousedown` 之后触发。`mousedown` 中设置 `tooltip._pinned = true`，然后 `click` 事件触发时，监听器看到 `pinned=true` 且点击目标不是 tooltip，立即关闭浮窗。

**修复：** `legacy.js` 全局 click 监听器添加排除条件：不响应 `.diablo-slot` 和 `.inv-cell` 的点击。

### 需求3：整体背景黑色 + 格子浅灰色

| 元素 | 修改前 | 修改后 |
|------|--------|--------|
| 系统面板背景 | 白色毛玻璃 | **黑色毛玻璃** `rgba(20,20,25,0.85)` |
| 系统面板文字 | 深色 | **浅色** `#c0c0c0` |
| 装备栏背景 | 蓝色 | **黑色** `rgba(30,30,35,0.85)` |
| 装备栏格子 | 蓝色半透明 | **浅灰色** `rgba(200,200,200,0.9)` |
| 背包格子 | 棕色 | **浅灰色** `rgba(200,200,200,0.9)` |
| 装备后格子 | 绿色半透明 | **浅绿色** `rgba(180,210,180,0.9)` |

### 需求4：装备栏字体缩小20%

| 修改 | 原值 | 新值 |
|------|------|------|
| `.slot-name` | 30px | **24px** |

使用固定像素单位，不随分辨率改变。

### 需求5：新装备生成位置管理器

**新增 `Game.spawnWeapon(itemTemplate)`：**
- 起始坐标：`(5461, 2613)`
- 排列方式：向右排列，每件间隔 100 单位横坐标
- 换行规则：每 10 件后，向下 200 单位继续排列

```javascript
Game.spawnWeapon(EquipManager.G18_PISTOL_ITEM); // 生成在 (5461, 2613)
Game.spawnWeapon(EquipManager.G18_PISTOL_ITEM); // 生成在 (5561, 2613)
// ... 第11件生成在 (5461, 2813)
```

### 版本号
- `V0.013` → `V0.014`

### 回退版本
- `backup/v20260622_000000/`

---

## 2026-06-21 — UI美化 + Tooltip升级 + 刺击动画优化

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：面板背景美化

| 文件 | 修改 | 说明 |
|------|------|------|
| `game-style.css` | `.system-panel` | 白色背景40%透明度 + 左下到右上渐变 + `backdrop-filter: blur(12px)` |
| `game-style.css` | `.panel-header` | 半透明白色背景 + 深色文字 |
| `game-style.css` | `.panel-tabs` / `.panel-tab` | 半透明白色背景 + 深色文字 |
| `game-style.css` | `.panel-close` | 半透明白色背景 + 深色文字 |

**效果：** 系统面板从暗棕色变为白色毛玻璃，文字全部反转为深色。

### 需求2：装备栏/背包栏字体和图标居中

| 文件 | 修改 | 说明 |
|------|------|------|
| `game-style.css` | `.equip-grid .diablo-slot .slot-icon` | 绝对定位居中，图标放大到40px |
| `game-style.css` | `.equip-grid .diablo-slot .slot-name` | 黑色、30px（3倍放大）、居中显示 |
| `game-style.css` | `.inv-cell .inv-stack` | 黑色 + 白色文字阴影 |

**效果：** 装备栏图标居中在格子正中间，文字黑色放大3倍居中在底部。

### 需求3：Tooltip浮窗升级

**新功能：**
- 显示装备的**全部属性**（名称、类型、稀有度、等级、分类、武器类型、装备槽位、武器ID、武器分类、堆叠数量、描述）
- **左键单击**装备格子 → 固定显示浮窗（`pinned` 状态）
- **再次左键单击**同一装备 → 取消固定
- **点击浮窗外任意位置** → 关闭浮窗
- **点击浮窗右上角红色×按钮** → 关闭浮窗

| 文件 | 修改 | 说明 |
|------|------|------|
| `index.html` | `equip-tooltip` | 添加 `tt-close` 关闭按钮 + `tt-extra` 额外属性区域 |
| `game-style.css` | `.equip-tooltip` | 白色背景、深色文字、`.pinned` 状态、`.tt-close` 按钮样式 |
| `legacy.js` | `bindEquipTooltip` | 重写：支持pin/unpin、点击外部关闭、显示全部属性 |
| `legacy.js` | `bindInventoryTooltip` | 重写：同上 |

### 需求4：刺击动画优化

| 参数 | 原值 | 新值 | 说明 |
|------|------|------|------|
| `stabDist` | 1.8 (151.2px) | **0.893** (75px) | 固定75px前刺距离 |
| `recoverSnapDist` | 无 | **8px** | 瞬移后剩余距离 |

**后摇（recover）新逻辑：**
```
0-15% (52.5ms): 线性瞬移从 -75px 到 -8px（快速回退）
15-100% (297.5ms): easeOut 从 -8px 到 0（平滑过渡）
```

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `WeaponAnimConfig.stab` | `stabDist: 0.893`，新增 `recoverSnapDist: 8` |
| `legacy.js` | `renderWeapon` recover | 分两段：瞬移 + 平滑过渡 |

### 版本号
- `V0.012` → `V0.013`

### 回退版本
- `backup/v20260621_230000/`

---

## 2026-06-21 — 修复刺击动画：修正前刺方向

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 问题描述
用户反馈：按左键攻击后，剑没有"向前刺出"的动作，视觉效果像是在回退。

### 根本原因分析

通过变换链数学推导发现：`thrustOffset` 的符号与期望方向相反。

在 `rotate(π/2)` 后的坐标系中：
- `translate(0, thrustOffset)` 的 Y轴方向 = 原Canvas的"左"方向
- `thrustOffset > 0` → 向"左"移动 → 更靠近角色（回退）
- `thrustOffset < 0` → 向"右"移动 → 远离角色（前刺）

但代码中：
- `windup`（蓄力/回退）：`thrustOffset = -29.4`（负值）→ 实际效果是**前刺** ❌
- `swing`（攻击/前刺）：`thrustOffset = 75.6`（正值）→ 实际效果是**回退** ❌

### 修复内容

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `WEAPON_ANIM` | `swingMs: 350 → 200`（前刺更快），`recoverMs: 200 → 350`（收回更慢） |
| `legacy.js` | `WeaponAnimConfig.stab` | `stabDist: 0.9 → 1.8`（前刺更远），`recoverDist: 1.8 → 0.9`（收回幅度更小） |
| `legacy.js` | `renderWeapon` windup 分支 | `thrustOffset` 改为 **正值**：`-s*0.35 → +s*0.35`，回退靠近角色 |
| `legacy.js` | `renderWeapon` swing 分支 | `thrustOffset` 改为 **负值**：`+75.6 → -151.2`，远离角色前刺 |
| `legacy.js` | `renderWeapon` recover 分支 | `thrustOffset` 从 **-151.2** 回到 **0**，缓慢收回 |

### 修复后动画效果

| 阶段 | 时间 | 位移 | 效果 |
|------|------|------|------|
| 蓄力（windup） | 150ms | 0 → **+29.4px** | 快速回退蓄力 |
| 前刺（swing） | 200ms | +29.4 → **-151.2px** | 迅速有力前刺（180.6px幅度） |
| 收回（recover） | 350ms | -151.2 → **0px** | 缓慢收回 |
| **总计** | **700ms** | — | 前刺更远更快，收回更慢 |

### 版本号
- `V0.011` → `V0.012`

### 回退版本
- `backup/v20260621_220000/`

---

## 2026-06-21 — 待机旋转650ms

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 修改内容
- `updateWeaponAnim` idle 分支：`spinDuration` 500ms → **650ms**

### 版本号
- `V0.010` → `V0.011`

---

## 2026-06-21 — 修复技能面板UI同步问题

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 问题描述
1. 战斗中获取经验时，技能面板的经验进度条不更新
2. 升级后，技能面板的等级和经验数据不更新
3. 详情面板中经验数值保持静态，不随实时数据变化

### 根本原因
- `addMeleeExp` 仅修改数据对象，不触发UI刷新
- `onLevelUp` 仅显示闪屏和提示，不刷新技能面板
- `renderSkillDetail` 生成静态HTML，无实时更新机制

### 修复内容

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `SkillManager._currentDetailSkillId` | 新增属性，追踪当前打开的技能详情 |
| `legacy.js` | `addMeleeExp` 末尾 | 添加：面板打开时，自动调用 `renderSkillGrid()` + 详情刷新 |
| `legacy.js` | `onLevelUp` 末尾 | 添加：面板打开时，自动调用 `renderSkillGrid()` + 详情刷新 |
| `legacy.js` | `renderSkillDetail` | 设置 `_currentDetailSkillId` 绑定当前技能 |
| `legacy.js` | 返回按钮 `onclick` | 清除 `_currentDetailSkillId` + 刷新网格数据 |

### 修复后行为
- 经验增加时：若技能面板打开，立即刷新网格和详情面板
- 升级时：若技能面板打开，立即刷新等级、经验条、效果数值
- 返回详情页：重新渲染网格，确保数据最新

### 版本号
- `V0.009` → `V0.010`

---

## 2026-06-21 — 剑精通技能系统 + 待机旋转500ms

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：剑精通技能系统

**技能定义：**
- 名称：剑精通
- 图标：⚔
- 最高等级：20级
- 效果：每级提高剑武器1点攻击力，攻击间隔降低1%
- 升级经验：1-2级需10经验，每升一级所需经验增加10

**经验获取规则：**
| 条件 | 经验 |
|------|------|
| 每次攻击 | +1（5级后不再获得） |
| 每次击杀 | +10 |
| 每次攻击到>1个敌人 | +3 |

**升级效果：**
- 屏幕闪过黄光0.5s（`.screen-flash` CSS动画）
- 显示"剑精通升级！Lv.X"提示文字（1.5s后消失）
- 自动更新近战攻击冷却

**修改内容：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `index.html` | 技能页结构 | 添加 `skillGrid` + `skillDetail` 面板 |
| `game-style.css` | 新增技能样式 | `.skill-grid`、`.skill-card`、`.skill-detail`、`.screen-flash`、`.level-up-text` |
| `legacy.js` | `SkillManager` 对象 | 新增技能管理器：addMeleeExp、onLevelUp、updateMeleeCooldown、renderSkillGrid、renderSkillDetail |
| `legacy.js` | `Player` 构造函数 | 添加 `skills.swordMastery` 数据 |
| `legacy.js` | `Player` 构造函数 | 初始化后调用 `SkillManager.updateMeleeCooldown` 应用冷却缩减 |
| `legacy.js` | `ThrustAttack.execute` | 添加伤害加成计算、命中/击杀计数、经验积累调用 |
| `legacy.js` | `SystemUI.open` | 打开技能页时调用 `SkillManager.renderSkillGrid()` |

### 需求2：待机旋转动画500ms

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `updateWeaponAnim` idle 分支 | `spinDuration` 1000ms → **500ms** |

### 版本号
- `V0.008` → `V0.009`

### 回退版本
- `backup/v20260621_210000/`

---

## 2026-06-21 — 刺击动画参数对调 + 待机旋转动画优化

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：攻击与收回参数对调

**问题：** 用户反馈攻击和收回阶段的定义被弄反，需要将幅度、速度对调。

**对调内容：**

| 参数 | 原值 | 对调后 | 说明 |
|------|------|--------|------|
| `WEAPON_ANIM.swingMs` | 200ms | **350ms** | 攻击阶段变长 |
| `WEAPON_ANIM.recoverMs` | 350ms | **200ms** | 收回阶段变短 |
| `WeaponAnimConfig.stab.stabDist` | 1.8 | **0.9** | 攻击前刺距离缩短 |
| `WeaponAnimConfig.stab.recoverDist` | 0.9 | **1.8** | 收回幅度参数对调 |
| 攻击缓动 | `easeInCubic` | **`easeOutQuad`** | 对调后使用原收回缓动 |
| 收回缓动 | `easeOutQuad` | **`easeInCubic`** | 对调后使用原攻击缓动 |

**对调后的动画效果：**
- 蓄力（windup）：150ms，回退到 -0.35，不变
- 攻击（swing）：350ms，从 -0.35 慢速前刺到 0.9
- 收回（recover）：200ms，从 0.9 快速回到 0

### 需求2：待机旋转动画优化

**修改内容：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `spinDuration` 600ms → **1000ms** | 4圈旋转在1秒内完成 |
| `legacy.js` | `renderWeapon` 待机分支 | 使用 `anim.angle`（包含呼吸+旋转），而非独立 `breatheAngle` |
| `legacy.js` | `updateWeaponAnim` windup 分支 | 添加 `anim.spinEnd = 0`，主动攻击打断旋转 |

**待机旋转规格：**
- 旋转角度：360度 × 4圈 = 1440度（`t * Math.PI * 8`）
- 旋转时间：1000ms（1秒）
- 循环间隔：3~6秒（随机）
- 旋转中心：武器中心（通过 `translate(0, -s*0.85)` 移动）
- 攻击打断：进入 windup 时自动清除旋转状态

### 版本号
- `V0.007` → `V0.008`

### 回退版本
- `backup/v20260621_200000/`

---

## 2026-06-21 — 刺击动画优化 + 待机旋转绕武器中心

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：优化刺击动画，代码独立化

**问题：**
- 原版 `swingMs = 500ms`，前刺太慢，没有"突刺"的爆发力
- 刺击代码硬编码在 `renderWeapon` melee 分支中，新武器无法复用
- 缓动函数使用 `easeInQuad`，加速感不足

**修改内容：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `WEAPON_ANIM` 时间参数 | `windupMs: 200 → 150`，`swingMs: 500 → 200`，`recoverMs: 600 → 350` |
| `legacy.js` | 新增 `easeInCubic` | 比 `easeInQuad` 加速更急，强化爆发力 |
| `legacy.js` | 新增 `WeaponAnimConfig.stab` | 刺击动画独立配置对象，可被所有剑类武器复用 |
| `legacy.js` | `renderWeapon` melee 攻击分支 | 改用 `WeaponAnimConfig.stab` 参数，前刺距离从 `1.25` 提升到 `1.8` |

**刺击动画配置参数（`WeaponAnimConfig.stab`）：**
```javascript
stab: {
    windupMs: 150,      // 蓄力时间
    stabMs: 200,        // 刺击时间（快速有力）
    recoverMs: 350,     // 收回时间
    windupDist: 0.35,   // 蓄力回退距离
    stabDist: 1.8,      // 前刺距离（比原版 1.25 提升 44%）
    recoverDist: 0.9, // 收回位置
    easeIn: easeInCubic,    // 蓄力缓动：前急后缓
    easeOut: easeOutQuad,   // 刺击缓动：快速爆发
    easeRecover: easeOutQuad // 收回缓动
}
```

**新武器复用方式：**
```javascript
// 新增武器时，在 WeaponAnimConfig 中添加：
mySword: { animType: 'thrust', thrustConfig: 'stab' }
// 渲染代码会自动读取 stab 配置
```

### 需求2：待机旋转绕武器中心

**问题：** 原版待机旋转顺序为 `rotate(finalAngle) → translate(0, -s*0.85)`，旋转中心在握持点而非武器中心。

**修改内容：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `renderWeapon` melee 待机动画 | 调整变换顺序：`translate → rotate`，旋转中心移到武器中心 |
| `legacy.js` | 待机旋转参数 | 旋转幅度从 `±0.06` 提升到 `±0.12`（约 ±7°），速度从 400ms 提升到 600ms 周期 |
| `legacy.js` | 移动时旋转 | 移动时旋转幅度稍大，配合步伐更有动感 |

**修改后变换顺序：**
```
translate(holdX, holdY) → rotate(π/2) → translate(0, -s*0.85) → rotate(breatheAngle)
```
- 第3步：移动到武器中心
- 第4步：绕武器中心旋转（呼吸效果）

### 版本号
- `V0.006` → `V0.007`

### 回退版本
- `backup/v20260621_190000/`

---

## 2026-06-21 — 生锈的长剑贴图路径重命名

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求
将生锈的长剑（weapon1）的贴图和图标改为新命名规范：
- 装备贴图（游戏中手持）：`1-rusty_sword_euip.png`
- 图标（装备栏/背包/图鉴）：`1-rusty_sword_macro.png`
- weaponId：`'武器1'` → `'weapon1'`

### 修改内容

| 文件 | 修改 | 说明 |
|------|------|------|
| `assets/weapons/` | 新增 `1-rusty_sword_euip.png` | 从 `sword_equipped.png` 复制 |
| `assets/icons/` | 新增 `1-rusty_sword_macro.png` | 从 `sword_hilt_icon.png` 复制 |
| `legacy.js` | `Player` 构造函数 meleeImage | `assets/weapons/rusty_sword_equip.png` → `assets/weapons/1-rusty_sword_euip.png` |
| `legacy.js` | `Player.render` weaponImage | `assets/weapons/rusty_sword_equip.png` → `assets/weapons/1-rusty_sword_euip.png` |
| `legacy.js` | `ItemDatabase.rusty_sword` | `iconImage` 改为 `assets/icons/1-rusty_sword_macro.png`，`weaponId` 改为 `'weapon1'` |
| `legacy.js` | `TEST_EQUIPMENTS.weapon` | `iconImage` 改为 `assets/icons/1-rusty_sword_macro.png`，`weaponId` 改为 `'weapon1'` |
| `index.html` | 版本号 | `V0.005` → `V0.006` |

### 回退版本
- `backup/v20260621_185000/`

---

## 2026-06-21 — 装备栏UI美化 + 快捷键切换修复

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 需求1：装备栏UI优化

**修改内容：**

| 文件 | 修改 | 说明 |
|------|------|------|
| `game-style.css` | `.equip-grid` 背景 | 棕色 → 蓝色毛玻璃渐变 (`rgba(30,60,120,0.85)` 到 `rgba(20,40,90,0.9)`) |
| `game-style.css` | `.equip-grid .diablo-slot` 背景 | 蓝色半透明渐变 + 蓝色边框 |
| `game-style.css` | `.slot-name` 位置 | 从 `margin-top` 改为 `position:absolute; bottom:3px`，固定在格子底部 |
| `game-style.css` | `.slot-name` 样式 | 统一字体大小10px、白色微蓝、带文字阴影、装备后变绿色 |
| `game-style.css` | `.slot-icon` 对齐 | `justify-content: flex-start` + `padding-top:6px`，图标靠上 |

**效果：**
- 装备栏整体变为蓝色毛玻璃风格，与游戏暗色主题形成对比
- 装备名称始终显示在格子底部，清晰可见
- 空槽位显示默认名称（如「头盔」「主手武器1」），装备后显示装备名并变绿色

### 需求2：快捷键切换修复

**问题：** `Input.handleKey` 第974行 `if (SystemUI.isOpen) return;` 拦截了**所有**按键，导致面板打开时 C/K/L 等 Tab 切换快捷键完全失效。

**修复后逻辑：**
```
面板关闭时：C键 → 打开装备栏（原逻辑不变）
面板打开时：
  C键 → 切换到装备栏（如果当前是其他Tab）或关闭面板（如果当前已是装备栏）
  K键 → 切换到技能页
  L键 → 切换到图鉴页
  其他按键 → 忽略（防止攻击等操作）
```

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `Input.handleKey` 面板打开逻辑 | 添加面板内Tab切换分支，仅允许 C/K/L/B/I 切换，其他按键拦截 |
| `index.html` | 版本号 | `V0.004` → `V0.005` |

### 回退版本
- `backup/v20260621_180000/`

---

## 2026-06-21 — 修复装备面板中右键 G18 自动攻击 Bug

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 问题描述
用户在装备面板打开时，右键背包中的 G18 装备后，角色会**自动开火**。

### 根本原因
`Player.update` 中的攻击逻辑**没有检查装备面板是否打开**。当用户之前按住左键时，打开装备面板，右键装备 G18（手枪）后，由于 `Input.mouse.leftDown` 仍然为 `true`，手枪立即开始全自动射击。

### 修复内容

| 文件 | 修改 | 说明 |
|------|------|------|
| `legacy.js` | `Player.update` 攻击逻辑 | 添加 `SystemUI.isOpen` 检查，面板打开时完全跳过攻击输入处理 |
| `legacy.js` | `EquipManager.equipFromBackpack` | 装备手枪到当前武器栏时，设置 `weaponSwitchCooldown = 300` |
| `index.html` | 版本号 | `V0.002` → `V0.003` |

### 修复后的行为
- 装备面板打开时，任何攻击输入（包括按住左键）都被完全忽略
- 关闭面板后，需要重新按左键才能攻击
- 装备手枪到当前武器栏时，有 300ms 切换保护

---

## 2026-06-21 — 修复 G18 右键装备到错误栏位 + 版本号初始化

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 修改内容

#### 1. 右键装备逻辑统一化（legacy.js）

| 修改 | 说明 |
|------|------|
| `equipFromBackpack` | 所有武器统一按空槽位填充逻辑，忽略 `equipSlot` |

**新右键装备规则（所有武器通用）：**
```
武器栏1为空  → 装备到武器栏1
武器栏1有装备，武器栏2为空  → 装备到武器栏2
两个栏都有装备  → 替换当前正在使用的武器栏（原装备回背包）
```

> 这意味着：剑、弓、手枪以及未来添加的任何武器，都统一遵循此规则。不再受 `item.equipSlot` 的限制。

#### 2. 版本号初始化（index.html）

| 修改 | 说明 |
|------|------|
| `versionBadge` | `v0.030` → `V0.001` |

**版本号递增规则：**
- 格式：`V0.XXX`（大写V + 三位小数）
- 每次代码更新：+0.001
- 示例：V0.001 → V0.002 → V0.003

### 回退版本
- `backup/v20260621_170000/`

---

## 2026-06-21 — 重构武器栏切换：melee/ranged → weapon/weapon2

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 修改目标
将 `weaponMode` 从「近战/远程」语义改为「武器栏1/武器栏2」语义，两个栏位完全平等，可装备任何武器类型（剑/弓/手枪）。

### 修改范围

| 函数 | 行号 | 修改说明 |
|------|------|----------|
| `Player.constructor` | 1009 | `weaponMode` 初始值 `'melee'` → `'weapon'` |
| `Player.update`（攻击） | 1114-1145 | 重写攻击输入逻辑：根据当前栏位实际装备类型决定攻击方式（剑→近战、弓→弓矢、手枪→全自动） |
| `Player.switchWeaponMode` | 1178-1213 | 重写切换逻辑：weapon ↔ weapon2，按 F 切换，目标栏位为空时禁止切换 |
| `Player.renderWeapon` | 1340-1490 | 重写渲染逻辑：根据当前栏位实际装备类型渲染（支持剑/弓/手枪任意栏位） |
| `Player._getAnimMs` | 1233-1243 | 根据当前装备类型选择动画配置 |
| `Player._fireRanged` | 1244-1291 | 根据当前装备类型（弓/手枪）发射对应投射物 |
| `Player.render` | 1501-1506 | 修复攻击引用：`this.attacks[weaponMode]` → `this.attacks[attackType]` |
| `UIManager.update` | 3433-3454 | 攻击冷却指示器根据实际装备类型显示 |
| `UIManager.update` | 3463-3467 | 武器信息：显示「武器栏1/武器栏2」+ 当前栏位装备名称 |
| `UIManager.update` | 3470-3474 | 攻击间隔根据当前装备类型计算 |
| `UIManager.update` | 3512-3517 | 详细属性渲染根据实际装备类型获取攻击配置 |
| `EquipManager._clearWeaponState` | 2034-2058 | 卸下当前使用栏位时自动切换到另一栏位（如果另一栏位有装备） |
| `EquipManager.handleDrop` | 2238-2248 | 装备到任意武器栏位统一加载武器资源 |
| `EquipManager.equipFromBackpack` | 2511-2535 | 装备到任意武器栏位统一加载武器资源 |

### 回退版本
- `backup/v20260621_160000/`

### 测试状态
- ⬜ 未运行 Vite 测试（需要用户手动启动 `npx vite` 验证）

### 关键设计变更
- **武器栏1（weapon）** 和 **武器栏2（weapon2）** 完全平等
- 按 F 切换时，只检查目标栏位是否有装备，不限定武器类型
- 攻击时根据当前栏位的实际装备类型决定攻击方式（近战/弓/手枪）
- 渲染时根据当前栏位的实际装备类型显示对应武器贴图和动画
- UI 显示「武器栏1/武器栏2」而非「主武器/副武器」

---

## 2026-06-21 — 修复武器定义缺失字段

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 问题发现
排查 `ItemDatabase` 发现武器定义字段不一致：
- `rusty_sword`（生锈的长剑）缺少 `weaponType: 'sword'`
- `steel_bow`（精钢长弓）缺少 `weaponCategory: 'mainhand'`

### 修改内容
| 文件 | 修改行 | 修改说明 |
|------|--------|----------|
| `legacy.js` | 1827行 | `rusty_sword` 添加 `weaponType: 'sword'` |
| `legacy.js` | 1845行 | `steel_bow` 补充 `weaponCategory: 'mainhand', weaponType: 'bow'` |

### 武器定义一致性检查结果
| 武器 | `weaponType` | `weaponCategory` | 状态 |
|------|------------|----------------|------|
| 生锈的长剑 | `sword` | `mainhand` | ✅ 已修复 |
| 训练用弓 | `bow` | `mainhand` | ✅ 一致 |
| 精钢长弓 | `bow` | `mainhand` | ✅ 已修复 |
| G18 手枪 | `pistol` | `mainhand` | ✅ 一致 |

### 回退版本
- `backup/v20260621_154500/`

### 测试状态
- ⬜ 未运行 Vite 测试（本次仅数据字段补齐，无逻辑变更）

---

## 2026-06-21 — 新增内存自查与对话迁移规则

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 本次变更
- 在 `docs/work-rules.md` 中新增第六章「内存管理与对话迁移」
- 定义内存自查触发条件（6项，分红色/黄色告警等级）
- 定义对话迁移流程（3步骤：保存状态→告知用户→新对话恢复）
- 提供 `docs/migration.md` 迁移文档标准模板
- 新增预防性措施以减少迁移频率

### 相关文件
| 文件 | 修改说明 |
|------|----------|
| `docs/work-rules.md` | 新增第六章，章节编号顺延 |
| `docs/CHANGELOG.md` | 记录本次变更 |

### 规则要点
- **红色告警**：必须立即提醒（多次读取legacy.js、大范围修改、大段新增）
- **黄色告警**：建议性提醒（连续任务、复杂调试、批量资源）
- **迁移指令**：用户说"新建对话继续"时执行保存→告知→恢复流程

---

## 2026-06-21 — 项目初始化与工作规则建立

**操作人**: AI Agent  
**状态**: ✅ 已完成

### 本次变更
- 建立项目工作区 `C:\Users\allan\Documents\kimi\workspace\game-dev\`
- 从备份目录复制核心文件：`index.html`、`legacy.js`、`game-style.css`
- 创建 `docs/work-rules.md` 工作规则文档
- 创建初始备份 `backup/v20260621_143000/`
- 建立 `assets/` 资源目录结构

### 文件清单
| 文件 | 说明 |
|------|------|
| `index.html` | 游戏入口/UI骨架（未修改） |
| `legacy.js` | 游戏核心引擎（未修改） |
| `game-style.css` | 样式表（未修改） |
| `docs/work-rules.md` | 工作规则文档（新增） |
| `docs/CHANGELOG.md` | 本变更日志（新增） |

### 测试状态
- ⬜ 未进行功能测试（本次仅建立工作区）

### 备注
项目处于开发就绪状态，等待用户指定具体开发任务。

---
