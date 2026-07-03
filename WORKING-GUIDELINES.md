# 《无限轮回》开发工作准则

> 版本：V0.134+ | 生效日期：当前

---

## 一、新增系统前检查清单

在新增任何系统前，必须回答以下 4 个问题：

| # | 问题 | 回答 "是" 时的处理 |
|---|------|------------------|
| 1 | 这个系统会修改 Player 的状态吗？ | 设计为独立 `Component`，通过 `Player.components` 数组注册，不要直接给 Player 加字段 |
| 2 | 这个系统会操作 DOM 吗？ | 确保 DOM 操作集中在 `xxxUIManager` 中，逻辑模块不得操作 DOM |
| 3 | 这个系统会操作 Canvas 吗？ | 将渲染逻辑拆到 `xxxRenderer` 或 `xxxEffect` 中 |
| 4 | 这个系统会与其他系统共享状态吗？ | 使用 `EventBus` 发布事件，不直接访问其他模块的属性 |

---

## 二、5 条核心原则

### 原则 1：单一职责（Single Responsibility）

**一个模块不能同时做三件：数据 + 逻辑 + UI。**

拆分公式：
```
[新系统] = [DataManager] + [LogicManager] + [UIManager]

例：新增 "任务系统"
  ├── QuestDataManager      # 任务数据定义（JSON加载、配置）
  ├── QuestProgressManager   # 任务进度跟踪（完成条件判定）
  ├── QuestUIManager         # 任务面板UI渲染
  └── QuestManager（协调器） # 组合上述模块，对外提供统一接口
```

### 原则 2：状态隔离（State Isolation）

**运行时切换的系统（技能、Buff、状态）必须通过组件数组注册，不要直接作为 Player 字段。**

反例（禁止）：
```js
// ❌ 新增技能时不断给 Player 加字段
this._isDashing = false;
this._isWhirlwind = false;
this._specialAttackActive = false;
this._runeSwordSpecialActive = false;
// 新增第5个技能时又要加一行 this._xxx = false
```

正例（推荐）：
```js
// ✅ 通过组件数组管理
this.components = [];
this.components.push(new DashComponent(this));
this.components.push(new WhirlwindComponent(this));
// update 中统一更新
this.components.forEach(c => c.update(dt, entities));
```

### 原则 3：依赖注入（Dependency Injection）

**不直接引用全局对象，通过回调或参数注入。**

反例（禁止）：
```js
// ❌ 直接引用全局对象
EquipManager._showBackpackFullNotice();
ShopSystem._addGold(amount);
```

正例（推荐）：
```js
// ✅ 通过回调或参数注入
constructor({ onFull, onGoldChange }) {
  this._onFull = onFull;
  this._onGoldChange = onGoldChange;
}
```

### 原则 4：行数红线（Line Count Limit）

| 文件类型 | 建议最大行数 | 超过时应该... |
|----------|-------------|--------------|
| 数据配置类 | 300 行 | 拆分为多个配置文件 |
| 逻辑管理类 | 500 行 | 拆分为子模块或协调器+子模块 |
| 实体类 | 400 行 | 提取行为组件（Component） |
| 渲染类 | 300 行 | 按渲染对象拆分 |
| 工具类 | 200 行 | 保持简洁 |

### 原则 5：防御性编程（Defensive Programming）

- 所有运行时依赖使用 `typeof X !== 'undefined'` 检查
- 修改他人代码前必须确认是否引入间接影响
- 新增方法不删除/不修改原有功能，仅通过扩展方式添加
- 每次提交前验证版本号递增

---

## 二、调试与排查规范

### 规则 1：控制台优先排查

**出现问题时，第一步必须是通过浏览器控制台输入指令排查，而不是直接修改代码。**

原因：浏览器控制台可以实时获取运行时状态（变量值、对象属性、模块导出的内容），直接反映当前加载的代码状态，不受编辑器和文件缓存的影响。

排查顺序：
1. 控制台输入指令检查变量/对象状态（如 `typeof DragDropManager`、`Object.keys(EquipManager)`）
2. 检查网络响应中加载的源码（`fetch` 获取模块文件内容）
3. 动态导入测试（`import()` 验证模块能否正确加载）
4. 确认问题后，再修改代码并验证

> 注意：用户已养成每次开始游戏前强制刷新（Ctrl+F5）的习惯，因此排查时应假设浏览器已使用最新文件，问题根源在代码逻辑而非缓存。

### 规则 2：动态导入 vs 静态导入规范

**导入方式选择应遵循以下标准：**

| 场景 | 推荐方式 | 说明 |
|------|----------|------|
| 核心框架、工具库 | 静态导入（import） | 项目启动即需要，且依赖关系稳定 |
| 路由页面 | 动态导入（import()） | 路由懒加载，减少初始包体积 |
| 大体积第三方库（图表、编辑器） | 动态导入（import()） | 按需加载，仅在需要时加载 |
| 多语言文件 | 动态导入（import()） | 按当前语言加载，避免打包所有语言 |
| 静态图片/图标 | 静态导入（import） | 构建时打包，无需运行时选择 |
| 条件性功能模块 | 动态导入（import()） | 根据条件决定是否加载，如仅在开启某功能时加载 |

**本项目特殊规则：**
- 已存在 Vite 模块缓存不一致问题，当静态导入的模块出现"方法不存在但文件内容正确"的异常时，优先使用动态导入 `import()` 绕过缓存
- 动态导入的模块返回的是 Promise，调用方需等待加载完成或做防御性检查（如 `if (this._module && typeof this._module.method === 'function')`）
- 被动态导入的模块，其依赖的模块（如 DragDropManager 依赖 Game.player）必须在初始化时通过参数注入，不能依赖全局变量

---

## 三、代码结构规范

### 目录结构
```
src/
  config/         # 配置常量（CONFIG, UI常量, 数学工具）
  core/           # 核心系统（EventBus, 数据加载）
  systems/        # 游戏系统（GoldManager, 背包, 实体管理）
  entities/       # 游戏实体（Player, Enemy, NPC, DropItem）
  entities/components/  # 实体行为组件（技能、Buff等）
  entities/enemies/     # 各类型敌人
  combat/         # 战斗系统（Attack, Projectile, HitDetector）
  effects/        # 特效系统（粒子、动画、浮动文字）
  items/          # 物品系统（ItemDatabase, ItemFactory, 武器动画）
  ui/             # UI系统（面板、Tooltip、商店、技能栏）
  world/          # 世界系统（Renderer, Camera, 场景管理）
```

### 命名规范
- 模块名：大驼峰（`GoldManager`, `DashSystem`）
- 文件名：短横线连接（`gold-manager.js`, `dash-system.js`）
- 私有方法：下划线前缀（`_privateMethod`）
- 全局挂载：仅 `main.js` 中执行，业务代码不直接挂载

---

## 四、提交检查清单

每次修改前自查：

- [ ] 版本号是否已递增？（`src/game.js` + `index.html`）
- [ ] 是否引入了新的全局依赖？（如新增 `window.Xxx` 需同步 `main.js`）
- [ ] 是否修改了未明确要求的文件？（只改目标文件，不改无关文件）
- [ ] 是否测试了旧功能仍然可用？（不破坏已有功能）
- [ ] 是否遵循了"状态隔离"原则？（新技能不加 Player 字段）
- [ ] 是否遵循了"依赖注入"原则？（不直接引用 `EquipManager._xxx` 等）

---

## 五、常见反模式警示

| 反模式 | 描述 | 后果 | 修复 |
|--------|------|------|------|
| 上帝类 | 一个类超过 2000 行，承担 5+ 职责 | 修改一处影响全局，难以测试 | 按职责拆分为协调器+子模块 |
| 全局硬编码 | z-index/数值直接写死在代码中 | 修改时容易遗漏，导致层级冲突 | 集中到 `config/ui-constants.js` |
| 状态泄漏 | 技能A的字段被技能B误用 | 未修改的目标系统异常 | 使用组件数组隔离，每个组件独立状态 |
| 直接引用 | 直接调用 `EquipManager._xxx` | 模块间强耦合，无法独立测试 | 通过回调注入，或通过 EventBus 解耦 |
| 数据UI混合 | 背包数据和 Tooltip 渲染在一个模块 | 无法独立测试数据逻辑 | 拆分为 DataManager + UIManager |

---

*本准则随版本迭代更新，每次架构调整时同步修订。*
