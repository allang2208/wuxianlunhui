# 《无限轮回》代码架构分析报告

> 版本：V0.134 | 分析日期：当前 | 总代码量：10,767 行（54 个 JS 文件）

---

## 一、当前架构问题总览

| 系统 | 行数 | 问题等级 | 核心问题 |
|------|------|----------|----------|
| `Player` | 2,377 | 🔴 严重 | 职责过重：移动+4个技能+武器渲染+属性计算+升级，全部在一个类 |
| `EquipManager` | 1,466 | 🔴 严重 | 数据定义+背包管理+UI渲染+拖放+Tooltip 全部混在一起 |
| `Game` | 681 | 🟡 中等 | 实体管理+拾取逻辑+NPC交互+传送门+碰撞，逻辑混杂 |
| `Enemy` | 431 | 🟡 中等 | 5个敌人类挤在一个文件 |
| `SkillManager` | 394 | 🟡 中等 | 大量重复代码（4个addXxxExp几乎相同） |
| `HitDetector` | 487 | 🟢 轻微 | 行数稍多但职责清晰，可接受 |
| `SceneManager` | 450 | 🟡 中等 | 包含Portal类定义，场景加载逻辑过长 |
| `EffectManager` | 46 | 🟢 良好 | 简洁但功能薄弱，可以加强 |

---

## 二、详细拆分/合并建议

### 🔴 高优先级（建议立即拆分）

#### 1. Player.js → 拆分为 7 个模块

**现状**：`Player` 类同时承担：基础移动、闪避体力、冲刺攻击、风车、特殊攻击、符文长剑、武器渲染、属性计算、经验升级，共 9 大职责。

**问题**：
- 任何一个技能的修改都可能影响整个 Player 文件
- 新技能添加会进一步膨胀
- 符文长剑粒子的"间接影响"问题根源在此（技能之间共享状态域）

**拆分方案**：

| 新模块 | 原方法 | 职责 |
|--------|--------|------|
| `PlayerCore` | `update(dt)`前半部分 | 移动、碰撞、体力、闪避、属性计算 |
| `PlayerCombat` | `triggerWeaponAnim`, `updateWeaponAnim` | 武器攻击输入调度 |
| `DashSystem` | `triggerDashAttack`, `updateDashAttack` | 冲刺攻击完整逻辑 |
| `WhirlwindSystem` | `triggerWhirlwind`, `updateWhirlwind` | 风车技能完整逻辑 |
| `SpecialAttackSystem` | `triggerSpecialAttack`, `updateSpecialAttack` | 夜与火之剑特殊攻击 |
| `RuneSwordSystem` | `triggerRuneSwordSpecial`, `updateRuneSwordSpecial`, `_launchRuneSwordBlade`, `_updateFlyingBlades` | 符文长剑特殊攻击（已部分拆出粒子） |
| `PlayerRenderer` | `render()`中武器渲染部分 | 所有武器渲染逻辑 |

**关键设计**：每个技能系统通过 `Player` 的 `activeSkills` 数组注册，解耦各技能状态。

```js
// PlayerCore 中
this.activeSkills = {
  dash: new DashSystem(this),
  whirlwind: new WhirlwindSystem(this),
  specialAttack: new SpecialAttackSystem(this),
  runeSword: new RuneSwordSystem(this)
};
// update 中统一调用
Object.values(this.activeSkills).forEach(s => s.update(dt, entities));
```

---

#### 2. EquipManager.js → 拆分为 5 个模块

**现状**：数据定义（TEST_EQUIPMENTS/TEST_BACKPACK_ITEMS）+ 背包管理 + 装备/卸下 + 拖放系统 + Tooltip 渲染 + 拆分对话框 + 武器状态同步，全部在一个对象里。

**问题**：
- 数据与UI混为一谈，无法独立测试背包逻辑
- Tooltip 定位逻辑与装备逻辑耦合
- 拖放事件与业务逻辑耦合

**拆分方案**：

| 新模块 | 原代码 | 职责 |
|--------|--------|------|
| `InventoryManager` | `addToBackpack`, `addToInventory`, `unequip`, `backpackItems` 操作 | 纯背包数据管理（增删改查） |
| `EquipDataManager` | `TEST_EQUIPMENTS`, `TEST_BACKPACK_ITEMS` 等所有测试数据 | 装备数据定义和加载 |
| `TooltipManager` | `renderTooltip`, `_positionTooltip`, `bindEquipTooltip` | 浮窗创建/定位/销毁 |
| `DragDropManager` | `setupDragAndDrop`, `handleDrop`, `bindDragToCell` | 拖放事件处理 |
| `EquipManager`（保留） | `init`, `equipFromBackpack`, `_syncWeaponVisual` | 装备/卸下协调器，调用上述模块 |

---

#### 3. Game.js → 拆分为 4 个模块

**现状**：游戏循环、实体管理、拾取逻辑、NPC交互、传送门、碰撞解析全在一个对象里。

**拆分方案**：

| 新模块 | 原代码 | 职责 |
|--------|--------|------|
| `EntityManager` | `entities` Map 操作、spawn/despawn | 实体生命周期管理 |
| `PickupManager` | `tryPickupItem`, `pickupNearbyItems`, 金币自动拾取 | 所有拾取逻辑集中 |
| `PortalManager` | 传送门检测、`_portalCooldown` | 传送门交互和场景切换协调 |
| `Game`（保留） | `loop`, `update`, `render` 骨架 | 游戏主循环协调器 |

---

### 🟡 中优先级（建议后续拆分）

#### 4. Enemy.js → 按类拆分到独立文件

**现状**：`Enemy`, `Zombie`, `RunnerZombie`, `FatZombie`, `SpitterZombie` 共 431 行在一个文件。

**建议**：
```
src/entities/enemies/
  ├── enemy.js          # Enemy 基类（保留通用逻辑）
  ├── zombie.js         # Zombie
  ├── runner-zombie.js  # RunnerZombie
  ├── fat-zombie.js     # FatZombie
  └── spitter-zombie.js # SpitterZombie
```

---

#### 5. SkillManager → 提取通用升级逻辑

**现状**：`addMeleeExp`, `addDashExp`, `addDashThrustExp`, `addSwordMasteryExp` 等几乎完全相同的代码重复了 4+ 次。

**建议**：提取通用经验计算函数

```js
// 新增 src/systems/skill-exp.js
export function addSkillExp(skill, hitCount, killCount, options = {}) {
  const { hitExp = 1, multiHitBonus = 3, killExp = 10, multiHitThreshold = 2 } = options;
  let gained = hitCount * hitExp;
  if (hitCount >= multiHitThreshold) gained += multiHitBonus;
  gained += killCount * killExp;
  if (gained <= 0) return 0;
  
  skill.exp += gained;
  while (skill.exp >= skill.maxExp && skill.level < skill.maxLevel) {
    skill.exp -= skill.maxExp;
    skill.level++;
    skill.maxExp = skill.getExpForNext(skill.level);
  }
  if (skill.level >= skill.maxLevel) skill.exp = 0;
  return gained;
}
```

---

#### 6. SceneManager → 分离 Portal 类

**现状**：`SceneManager` 450 行中，Portal 类占用了 40 行（虽然不多，但类定义应该独立）。

**建议**：将 `Portal` 类移到 `src/entities/portal.js`。

---

### 🟢 低优先级（可选优化）

#### 7. 特效系统合并

**现状**：18 个特效文件分散在 `src/effects/` 中，很多只有 20-80 行。

**建议**：按类别合并为文件内模块，减少文件数量：

```
src/effects/
  ├── particle-effects.js      # 已合并：DodgeEffect, DeathEffect, BloodEffect, BloodMistEffect, DustEffect, RuneSwordExplodeEffect
  ├── combat-effects.js        # 合并：SlashEffect, ThrustEffect, BloodHitEffect, SmokeEffect, MuzzleFlashEffect, ShellCasingEffect
  ├── environment-effects.js   # 合并：DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect, SweepEffect, AttackRangeEffect
  ├── weapon-effect.js         # 已独立：WeaponEffect（合理）
  ├── nightflame-effect.js    # 保留：NightFlameBeamEffect（复杂，保留独立）
  ├── floating-text.js          # 保留：FloatingTextEffect（常用）
  ├── level-up-queue.js         # 保留：LevelUpEffectQueue
  └── effect-manager.js         # 保留：EffectManager
```

> ⚠️ 注意：此合并建议优先级较低，因为当前每个文件职责清晰，合并不带来明显好处，只是减少文件数量。保持现状也可以接受。

---

## 三、新增系统时的拆分指南

以后新增任何系统时，请遵循以下原则：

### 原则 1：单一职责（Single Responsibility）

**判断标准**：如果一个模块需要同时修改 **数据** 和 **UI** 和 **输入处理**，就需要拆分。

**拆分公式**：
```
[新系统] = [DataManager] + [LogicManager] + [UIManager]

例：新增 "任务系统"
  ├── QuestDataManager     # 任务数据定义（JSON加载、配置）
  ├── QuestProgressManager   # 任务进度跟踪（完成条件判定）
  ├── QuestUIManager        # 任务面板UI渲染
  └── QuestManager（协调器） # 组合上述模块，对外提供统一接口
```

### 原则 2：状态隔离

**判断标准**：新系统是否会在运行时切换/开启/关闭？

如果是（如技能、特效、状态Buff），请设计为 **独立状态对象**，通过 `Player` 的 `activeXxx` 或 `components` 数组注册，而不是作为 `Player` 的字段。

**反例**（当前代码的问题）：
```js
// ❌ 所有技能状态都直接挂在 Player 上
this._isDashing = false;
this._isWhirlwind = false;
this._specialAttackActive = false;
this._runeSwordSpecialActive = false;
// 新增第5个技能时又要加一行 this._xxx = false
```

**正例**（建议）：
```js
// ✅ 通过组件数组管理
this.components = [];
// 注册技能组件
this.components.push(new DashComponent(this));
this.components.push(new WhirlwindComponent(this));
// update 中统一更新
this.components.forEach(c => c.update(dt, entities));
```

### 原则 3：依赖注入而非直接引用

**反例**：
```js
// ❌ 直接引用全局对象
EquipManager._showBackpackFullNotice();
ShopSystem._addGold(amount);
```

**正例**：
```js
// ✅ 通过回调或参数注入
constructor({ onFull, onGoldChange }) {
  this._onFull = onFull;
  this._onGoldChange = onGoldChange;
}
```

### 原则 4：新系统文件行数红线

| 文件类型 | 建议最大行数 | 超过时应该... |
|----------|-------------|--------------|
| 数据配置类 | 300 行 | 拆分为多个配置文件 |
| 逻辑管理类 | 500 行 | 拆分为子模块或协调器+子模块 |
| 实体类 | 400 行 | 提取行为组件（Component） |
| 渲染类 | 300 行 | 按渲染对象拆分 |
| 工具类 | 200 行 | 保持简洁 |

### 原则 5：新增系统检查清单

在新增系统前，请回答以下问题：

1. **这个系统会修改 Player 的状态吗？**
   - 是 → 考虑拆为独立 Component，通过 `Player.components` 注册，而不是直接加字段

2. **这个系统会操作 DOM 吗？**
   - 是 → 确保 DOM 操作集中在 `xxxUIManager` 中，不在逻辑模块中操作 DOM

3. **这个系统会操作 Canvas 吗？**
   - 是 → 将渲染逻辑拆到 `xxxRenderer` 或 `xxxEffect` 中

4. **这个系统会新增或修改数据配置吗？**
   - 是 → 将数据定义放到独立文件或 JSON 中，不在业务逻辑中硬编码

5. **这个系统会与其他系统共享状态吗？**
   - 是 → 使用 EventBus 发布事件，而不是直接访问其他模块的属性

6. **这个系统预计会超过 300 行代码吗？**
   - 是 → 提前设计拆分方案，不要等膨胀后再拆分

---

## 四、已完成的优秀拆分（保持）

以下拆分已经完成，设计良好，请保持：

| 模块 | 说明 |
|------|------|
| `src/config/ui-constants.js` | ✅ Z-INDEX 常量化 |
| `src/effects/weapon-effect.js` | ✅ 粒子特效从 Player 中拆出 |
| `src/systems/gold-manager.js` | ✅ 金币逻辑集中管理 |
| `src/combat/hit-detector.js` | ✅ 判定逻辑独立 |
| `src/core/event-bus.js` | ✅ 事件总线解耦 |

---

## 五、实施路线图建议

| 阶段 | 任务 | 预计影响 | 风险 |
|------|------|----------|------|
| **Phase 1** | 拆分 `Player.js` → 核心 + 技能组件 | 高（但收益最大） | 技能状态可能遗漏，需逐个测试 |
| **Phase 2** | 拆分 `EquipManager.js` → 数据+UI+拖放 | 中 | UI 回调链需仔细检查 |
| **Phase 3** | 拆分 `Game.js` → 实体/拾取/传送门管理 | 中 | 事件订阅顺序可能受影响 |
| **Phase 4** | 拆分 `Enemy.js` → 按类型分文件 | 低 | 仅影响导入路径 |
| **Phase 5** | 合并 SkillManager 重复代码 | 低 | 纯重构，无行为变更 |
| **可选** | 特效文件合并 | 极低 | 仅文件组织调整 |

---

> 总结：当前代码最大的问题是 **Player 类承担了太多职责**（2,377 行的"上帝类"），以及 **EquipManager 数据与 UI 混为一谈**。这两个拆分完成后，整体架构将更加清晰，新增系统时也能明确知道该放在哪里。
